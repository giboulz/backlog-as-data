// SKILL-78 — télémétrie OTEL : le collecteur local (`tools/sdd-telemetry/collector.mjs`)
// et son lecteur (`tools/sdd-telemetry/read.mjs`), specs/skill-78.md.
//
// Tests sur des charges OTLP **synthétiques** (`__tests__/fixtures/sdd-telemetry/`) —
// ⛔ jamais une capture réelle : elle porterait `user.email` et `organization.id` dans
// un dépôt suivi par git (§ Portée). Système de fichiers, horloge et home sont
// INJECTÉS : aucun test n'écrit dans un vrai `~/sdd-metrics`.
//
// ⚠️ Convention de ce dépôt (SKILL-29, D3) : chaque assertion porte en commentaire la
// MUTATION qui doit la faire rougir. Le rapport final liste les mutations réellement
// appliquées et leur résultat.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect } from 'vitest';

import {
  TELEMETRY_DIR_NAME,
  TOKEN_METRIC,
  KEPT_ATTRIBUTES,
  UNATTRIBUTED_FILE,
  DIAGNOSTICS_FILE,
  ACTIVATION_FILE,
  LOCK_FILE,
  DEFAULT_HOST,
  SETTINGS_ENV_BLOCK,
  resolveTelemetryRoot,
  attributesOf,
  pointValue,
  safeSessionId,
  extractPoints,
  createAccumulator,
  accumulate,
  writeSnapshots,
  loadSnapshots,
  readLiveSettings,
  handlePayload,
  browserGuard,
  acquireLock,
  checkTelemetrySettings,
  startCollector,
  main as collectorMain,
} from '../tools/sdd-telemetry/collector.mjs';

import {
  STATE_CAPTURED,
  STATE_NOT_CONFIGURED,
  STATE_NOT_CAPTURED,
  STATE_BEFORE_ACTIVATION,
  STATE_UNDETERMINED,
  REASON_NOT_CONFIGURED,
  REASON_NOT_CAPTURED,
  REASON_BEFORE_ACTIVATION,
  AGENT_UNNAMED,
  REASON_CUT_NO_HISTORY,
  REASON_CUT_BAD_INSTANT,
  CUT_LABEL_BEFORE,
  CUT_LABEL_AFTER,
  sessionStartedAt,
  readActivation,
  readDiagnostics,
  readSession,
  cutSubagentAt,
  readSessionCut,
  isStrictUtcInstant,
  parseArgs as readParseArgs,
  main as readMain,
} from '../tools/sdd-telemetry/read.mjs';

import { SCHEMA_VERSION } from '../tools/review-log/write.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'sdd-telemetry');

const readFixture = (name) => fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Home jetable portant un `~/sdd-metrics` qui EST un dépôt git (`.git` présent). */
function makeHome({ withRepo = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill78-home-'));
  tmpDirs.push(home);
  if (withRepo) fs.mkdirSync(path.join(home, 'sdd-metrics', '.git'), { recursive: true });
  return home;
}

const telemetryDir = (home) => path.join(home, 'sdd-metrics', TELEMETRY_DIR_NAME);

/** `<home>/.claude/settings.json` — avec ou sans le bloc `env` de la télémétrie. */
function writeSettings(home, { configured }) {
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const doc = configured ? { env: { ...SETTINGS_ENV_BLOCK } } : { skipWorkflowUsageWarning: true };
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(doc, null, 2), 'utf8');
}

/** Transcript synthétique `<home>/.claude/projects/<slug>/<sessionId>.jsonl`. */
function writeTranscript(home, sessionId, isoTimestamp) {
  const dir = path.join(home, '.claude', 'projects', 'C--Users-personne-projet');
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: 'user', timestamp: isoTimestamp, message: { role: 'user' } });
  fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), `${line}\n`, 'utf8');
}

/** Une charge OTLP minimale : des points `claude_code.token.usage`. */
function payload(points, metric = TOKEN_METRIC) {
  return {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: metric,
                sum: {
                  aggregationTemporality: 1,
                  isMonotonic: true,
                  dataPoints: points.map((p) => ({
                    timeUnixNano: '1756000010000000000',
                    asInt: String(p.value),
                    attributes: Object.entries(p.attributes).map(([key, value]) => ({
                      key,
                      value: { stringValue: value },
                    })),
                  })),
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

const SUBAGENT_CACHE_READ = (sessionId, value, agent = 'custom') =>
  payload([
    {
      value,
      attributes: {
        'session.id': sessionId,
        type: 'cacheRead',
        query_source: 'subagent',
        'agent.name': agent,
      },
    },
  ]);

/** POST http/json sur le collecteur. Rend `{ status, body }`, ne jette jamais. */
function post(port, body, { pathname = '/v1/metrics', headers } = {}) {
  return new Promise((resolve) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: headers || { 'content-type': 'application/json' },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode, body: out }));
      }
    );
    req.on('error', (err) => resolve({ status: null, body: '', error: err }));
    req.end(data);
  });
}

const readDoc = (home, file) =>
  JSON.parse(fs.readFileSync(path.join(telemetryDir(home), file), 'utf8'));

// ===========================================================================
// Les sources restent lisibles par git
// ===========================================================================

describe('SKILL-78 — les modules livrés sont du TEXTE pour git', () => {
  // Un SEUL octet NUL fait basculer git en mode binaire pour un chemin : plus de
  // `git diff`, plus de `git blame`, plus de normalisation de fins de ligne — et la
  // procédure de relecture du dépôt (`git diff main...HEAD`) ne voit plus rien.
  // ⚠️ La garde SE BALAIE ELLE-MÊME, et balaie les fixtures. Un garde-fou qui exclut
  // son propre fichier laisse passer exactement le cas qu'il surveille — c'est ce qui
  // est arrivé ici : le NUL a été retiré des deux modules et RÉINTRODUIT, dans le même
  // geste, par le commentaire de mutation de CE test, hors du balayage. Les fixtures
  // sont listées par `readdirSync`, jamais énumérées à la main : une fixture ajoutée
  // demain entre dans la garde sans que personne y pense.
  // ⚠️ Mutation : réintroduire un octet NUL brut (U+0000 non échappé) dans N'IMPORTE
  // LEQUEL des fichiers livrés — module, fichier de test, ou fixture → rouge.
  it('aucun octet NUL dans AUCUN fichier livré par le ticket', () => {
    const livres = [
      'tools/sdd-telemetry/collector.mjs',
      'tools/sdd-telemetry/read.mjs',
      '__tests__/sdd-telemetry-coherence.test.js',
      ...fs.readdirSync(FIXTURES_DIR).map((n) => path.join('__tests__', 'fixtures', 'sdd-telemetry', n)),
    ];
    // ⚠️ Mutation : réduire la liste (p. ex. en retirer le fichier de test) → rouge.
    expect(livres.length, 'la liste des fichiers balayés a fondu').toBeGreaterThanOrEqual(7);
    expect(livres, 'la garde ne se balaie plus elle-même').toContain(
      '__tests__/sdd-telemetry-coherence.test.js'
    );
    for (const rel of livres) {
      const buf = fs.readFileSync(path.join(REPO_ROOT, rel));
      expect(buf.includes(0), `${rel} porte un octet NUL : git le classera binaire`).toBe(false);
    }
  });

  // ⛔ « Aucune commande `git` en écriture n'est émise » (§ Portée).
  // ⚠️ L'assertion porte sur la SOURCE, pas sur un lanceur injecté : ces modules n'ont
  // PAS de `deps.run`, donc un espion ne serait jamais appelé et l'assertion serait
  // vraie par construction — quoi que fasse le code.
  // ⚠️ Mutation : ajouter `execFileSync('git', ['add', target])` à la fin de
  // `writeSnapshots` → rouge.
  it('aucun lanceur de processus : ni import, ni appel', () => {
    // Les commentaires PARLENT de `git` et de `node:child_process` (c'est même leur
    // objet) : l'assertion porte sur le CODE. On retire les blocs `/** … */` et les
    // lignes entièrement commentées — jamais un `//` en milieu de ligne, qui couperait
    // un `http://…` dans une chaîne.
    const stripComments = (src) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n');
    for (const rel of ['tools/sdd-telemetry/collector.mjs', 'tools/sdd-telemetry/read.mjs']) {
      const src = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
      expect(src, `${rel} importe child_process`).not.toMatch(/from\s+['"]node:child_process['"]/);
      expect(src, `${rel} require child_process`).not.toMatch(/require\(\s*['"](node:)?child_process['"]\s*\)/);
      expect(src, `${rel} appelle un lanceur`).not.toMatch(
        /\b(spawnSync|spawn|execSync|execFileSync|execFile|exec)\s*\(/
      );
      expect(src, `${rel} nomme la commande git`).not.toMatch(/['"`]git['"`]/);
    }
  });
});

// ===========================================================================
// collector.mjs — localisation du puits
// ===========================================================================

describe('SKILL-78 — collector.mjs : le puits est DÉRIVÉ du home, jamais configuré', () => {
  // Contrat repris tel quel de `write.mjs` (§ Portée) : `~/sdd-metrics` absent, non
  // répertoire, ou sans `.git` → no-op, motif, et AUCUN répertoire créé.
  // ⚠️ Mutation : faire créer le dépôt par `resolveTelemetryRoot` (`mkdirSync`) → rouge.
  it('rend null + motif quand `~/sdd-metrics` est absent, et ne crée rien', () => {
    const home = makeHome({ withRepo: false });
    const { root, reason } = resolveTelemetryRoot(home);
    expect(root, 'un root est rendu alors que le dépôt de mesures est absent').toBeNull();
    expect(reason, 'aucun motif rendu pour un dépôt absent').toMatch(/absent|no-op/i);
    expect(
      fs.existsSync(path.join(home, 'sdd-metrics')),
      '`~/sdd-metrics` a été CRÉÉ — le collecteur ne crée jamais le dépôt de données'
    ).toBe(false);
  });

  // ⚠️ Mutation : accepter un `~/sdd-metrics` sans `.git` → rouge.
  it('rend null + motif quand `~/sdd-metrics` n’est pas un dépôt git', () => {
    const home = makeHome({ withRepo: false });
    fs.mkdirSync(path.join(home, 'sdd-metrics'), { recursive: true });
    const { root, reason } = resolveTelemetryRoot(home);
    expect(root, 'un root est rendu pour un répertoire sans `.git`').toBeNull();
    expect(reason, 'le motif ne nomme pas l’absence de `.git`').toMatch(/git/i);
  });

  // ⚠️ Mutation : rendre `<home>/sdd-metrics` au lieu de son sous-dossier `telemetry/`
  // → rouge (le collecteur écrirait à côté des fiches de cycle).
  it('rend `<home>/sdd-metrics/telemetry` quand le dépôt est là', () => {
    const home = makeHome();
    const { root, reason } = resolveTelemetryRoot(home);
    expect(reason, 'un motif est rendu alors que le dépôt est valide').toBeNull();
    expect(root).toBe(telemetryDir(home));
  });
});

// ===========================================================================
// collector.mjs — extraction des points
// ===========================================================================

describe('SKILL-78 — collector.mjs : extraction des points OTLP', () => {
  // ⚠️ Mutation : ignorer `asDouble` (ou `asInt`) → rouge.
  it('lit la valeur en `asInt` (chaîne, mapping JSON protobuf) comme en `asDouble`', () => {
    expect(pointValue({ asInt: '100' })).toBe(100);
    expect(pointValue({ asDouble: 3.5 })).toBe(3.5);
    expect(pointValue({ asInt: 'abc' }), 'une valeur non numérique passe pour un nombre').toBeNull();
    expect(pointValue({}), 'un point sans valeur passe pour un nombre').toBeNull();
  });

  // ⚠️ Mutation : renvoyer `attributes` tel quel (le tableau KeyValue) → rouge.
  it('aplatit les `KeyValue[]` OTLP en objet, et tolère une forme inattendue', () => {
    const flat = attributesOf({
      attributes: [
        { key: 'type', value: { stringValue: 'cacheRead' } },
        { key: 'session.id', value: { stringValue: 'sess-1' } },
      ],
    });
    expect(flat).toEqual({ type: 'cacheRead', 'session.id': 'sess-1' });
    expect(attributesOf({ attributes: 'pas-un-tableau' })).toEqual({});
    expect(attributesOf({})).toEqual({});
  });

  // Le point central de la confidentialité (D4) : `user.email`, `organization.id`,
  // `terminal.type` NE DOIVENT PAS entrer dans `~/sdd-metrics`, qui est un dépôt git.
  // ⚠️ Mutation : conserver tous les attributs au lieu de la liste blanche → rouge.
  it('ne retient QUE les attributs de la liste blanche — l’identité est jetée', () => {
    const { points } = extractPoints(JSON.parse(readFixture('token-usage-mixed.json')));
    const all = new Set(points.flatMap((p) => Object.keys(p.attributes)));
    for (const key of all) {
      expect(KEPT_ATTRIBUTES, `l’attribut \`${key}\` n’est pas dans la liste blanche`).toContain(key);
    }
    expect([...all], '`user.email` a été retenu').not.toContain('user.email');
    expect([...all], '`organization.id` a été retenu').not.toContain('organization.id');
    expect([...all], '`terminal.type` a été retenu').not.toContain('terminal.type');
  });

  // `effort` est le SEUL discriminant de rôle qui survive à la redaction de `agent.name`
  // en `custom` (cf. l'en-tête de collector.mjs). Le jeter ne laissait plus rien.
  // ⚠️ Mutation : retirer `effort` de `KEPT_ATTRIBUTES` → rouge.
  it('retient `effort` : sans lui, plus aucun discriminant de rôle ne survit', () => {
    expect(KEPT_ATTRIBUTES).toContain('effort');
    const { points } = extractPoints(
      payload([
        { value: 5, attributes: { 'session.id': 's', type: 'cacheRead', query_source: 'subagent', 'agent.name': 'custom', effort: 'max' } },
      ])
    );
    expect(points[0].attributes.effort, '`effort` a été jeté à la réception').toBe('max');
  });

  // ⚠️ Mutation : accepter toute métrique au lieu du seul `claude_code.token.usage`
  // → rouge (`claude_code.session.count` de la fixture remonterait).
  it('ignore les métriques autres que `claude_code.token.usage`, sans erreur', () => {
    const { points } = extractPoints(JSON.parse(readFixture('token-usage-mixed.json')));
    expect(points.length, 'la fixture porte 6 points de token.usage').toBe(6);
    for (const p of points) expect(p.metric).toBe(TOKEN_METRIC);
  });

  // ⚠️ Mutation : accepter un point sans `type` ou sans `query_source` → rouge.
  it('rejette les points inexploitables (valeur non numérique, champs manquants)', () => {
    const { points, ignored } = extractPoints(JSON.parse(readFixture('hostile-points.json')));
    expect(points, 'un point inexploitable a été accepté').toEqual([]);
    expect(ignored, 'les points rejetés ne sont pas comptés').toBe(3);
  });

  // ⚠️ Mutation : accepter n'importe quel `session.id` → rouge (traversée de chemin).
  it('refuse un `session.id` qui ne peut pas devenir un nom de fichier', () => {
    expect(safeSessionId('7f3c-4a1b_ab.cd')).toBe(true);
    expect(safeSessionId('../../evil'), 'une traversée de chemin est acceptée').toBe(false);
    expect(safeSessionId('a/b'), 'un séparateur de chemin est accepté').toBe(false);
    expect(safeSessionId('a\\b'), 'un séparateur Windows est accepté').toBe(false);
    expect(safeSessionId(''), 'une chaîne vide est acceptée').toBe(false);
    expect(safeSessionId('x'.repeat(200)), 'un identifiant sans borne est accepté').toBe(false);
    // ⚠️ Mutation : ajouter `~` à l'alphabet → rouge. C'est ce refus qui RÉSERVE les
    // noms `~*.json` aux fichiers du puits, hors de portée de toute session.
    expect(safeSessionId('~unattributed'), '`~` est accepté : une session pourrait viser un fichier du puits').toBe(false);
  });

  // ⚠️ Mutation : `JSON.parse` sans `try` → rouge ; ou ne pas compter `ignored` → rouge.
  it('handlePayload : rejette, accepte et COMPTE, sans jamais jeter', () => {
    const acc = createAccumulator();
    const bad = handlePayload(acc, '{ ceci n’est pas du JSON');
    expect(bad.status).toBe(400);
    expect(acc.buckets.size, 'une charge invalide a accumulé quelque chose').toBe(0);

    const ok = handlePayload(acc, JSON.stringify(SUBAGENT_CACHE_READ('sess-hp', 5)));
    expect(ok).toMatchObject({ status: 200, accepted: 1, ignored: 0 });

    const hostile = handlePayload(acc, readFixture('hostile-points.json'));
    expect(hostile).toMatchObject({ status: 200, accepted: 0, ignored: 3 });
    expect(acc.ignoredPoints, 'les points jetés ne sont pas comptabilisés dans l’accumulateur').toBe(3);
  });
});

// ===========================================================================
// collector.mjs — accumulation delta
// ===========================================================================

describe('SKILL-78 — collector.mjs : la temporalité `delta` est SOMMÉE', () => {
  // C'EST l'assertion qui porte le plus gros risque de chiffre plausible et faux
  // (§ Tests). `delta` : chaque envoi porte l'incrément, pas un cumul.
  // ⚠️ Mutation : garder le dernier point (`sum = value`) au lieu de `sum += value`
  // → rouge (100 au lieu de 300).
  it('trois envois de 100 pour la même série rendent 300, pas 100', () => {
    const acc = createAccumulator();
    for (let i = 0; i < 3; i += 1) {
      accumulate(acc, extractPoints(SUBAGENT_CACHE_READ('sess-1', 100)).points);
    }
    const home = makeHome();
    writeSnapshots(telemetryDir(home), acc);
    const doc = readDoc(home, 'sess-1.json');
    expect(doc.series.length, 'la série a été dupliquée au lieu d’être sommée').toBe(1);
    expect(doc.series[0].value, 'le dernier point a écrasé la somme').toBe(300);
    expect(doc.series[0].points, 'le nombre de points reçus n’est pas tenu').toBe(3);
  });

  // ⚠️ Mutation : fondre `main`/`auxiliary` dans le total `subagent` → rouge.
  it('garde `main`, `auxiliary` et `subagent` dans des séries DISTINCTES', () => {
    const acc = createAccumulator();
    accumulate(acc, extractPoints(JSON.parse(readFixture('token-usage-mixed.json'))).points);
    const home = makeHome();
    writeSnapshots(telemetryDir(home), acc);
    const doc = readDoc(home, 'sess-captured-001.json');
    const sources = doc.series.map((s) => s.attributes.query_source);
    expect(sources).toContain('main');
    expect(sources).toContain('auxiliary');
    expect(sources).toContain('subagent');
    const bySource = (src) =>
      doc.series
        .filter((s) => s.attributes.query_source === src && s.attributes.type === 'cacheRead')
        .reduce((n, s) => n + s.value, 0);
    expect(bySource('main'), 'le total `main` a bougé').toBe(5000);
    expect(bySource('auxiliary'), 'le total `auxiliary` a bougé').toBe(40);
    expect(bySource('subagent'), 'les sous-agents ont absorbé main/auxiliary').toBe(1000);
  });

  // ⚠️ Mutation : écrire toutes les sessions dans un seul fichier → rouge.
  it('écrit un fichier par `session.id`', () => {
    const acc = createAccumulator();
    accumulate(acc, extractPoints(JSON.parse(readFixture('token-usage-mixed.json'))).points);
    const home = makeHome();
    const written = writeSnapshots(telemetryDir(home), acc);
    expect(written.length).toBe(2);
    expect(fs.existsSync(path.join(telemetryDir(home), 'sess-captured-001.json'))).toBe(true);
    expect(fs.existsSync(path.join(telemetryDir(home), 'sess-captured-002.json'))).toBe(true);
    expect(readDoc(home, 'sess-captured-002.json').series[0].value).toBe(42);
  });

  // Le point hostile n'est ni écrit sous son nom, ni perdu en silence.
  // ⚠️ Mutation : écrire `path.join(root, sessionId + '.json')` sans validation →
  // rouge (un fichier apparaîtrait hors de `telemetry/`).
  it('range un `session.id` inutilisable dans le seau non attribué, jamais dans un chemin', () => {
    const acc = createAccumulator();
    accumulate(acc, extractPoints(JSON.parse(readFixture('hostile-session-id.json'))).points);
    const home = makeHome();
    const written = writeSnapshots(telemetryDir(home), acc);
    for (const p of written) {
      expect(path.resolve(p).startsWith(path.resolve(telemetryDir(home))), `écriture hors du puits : ${p}`).toBe(true);
    }
    expect(written.map((p) => path.basename(p))).toEqual([UNATTRIBUTED_FILE]);
    const doc = readDoc(home, UNATTRIBUTED_FILE);
    expect(doc.series[0].value, 'le point a été perdu en silence').toBe(9);
    expect(
      doc.series[0].rejectedSessionId,
      'l’identifiant brut refusé n’est pas conservé DANS le JSON'
    ).toBe('../../evil');
  });

  // Le seau non attribué porte un nom qu'aucune session ne peut revendiquer.
  // ⚠️ Mutation : renommer `UNATTRIBUTED_FILE` en `_unattributed.json` (le `_` passe
  // `safeSessionId`) → rouge : les deux seaux écriraient le MÊME chemin, le dernier de
  // l'itération gagnerait, et au rechargement la vraie session serait reclassée « non
  // attribuée » pour toujours.
  it('une session nommée comme le seau non attribué n’entre pas en collision', () => {
    const acc = createAccumulator();
    accumulate(acc, extractPoints(SUBAGENT_CACHE_READ('_unattributed', 999999)).points);
    accumulate(acc, extractPoints(JSON.parse(readFixture('hostile-session-id.json'))).points);
    const home = makeHome();
    const names = writeSnapshots(telemetryDir(home), acc).map((p) => path.basename(p));
    expect(new Set(names).size, `deux seaux ont écrit le MÊME fichier : ${names.join(', ')}`).toBe(names.length);
    expect(names).toContain(UNATTRIBUTED_FILE);
    expect(names).toContain('_unattributed.json');

    // Et au rechargement, la session reste une session.
    const r = readSession('_unattributed', { homedir: home });
    expect(r.state).toBe(STATE_CAPTURED);
    expect(r.subagent.cacheRead, 'la session a été reclassée en « non attribuée »').toBe(999999);
  });
});

// ===========================================================================
// collector.mjs — le flush n'écrit que ce qui a bougé
// ===========================================================================

describe('SKILL-78 — collector.mjs : le flush est BORNÉ au travail réel', () => {
  function seedHistory(dir, count) {
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < count; i += 1) {
      fs.writeFileSync(
        path.join(dir, `sess-hist-${i}.json`),
        JSON.stringify({
          schema: 1,
          sessionId: `sess-hist-${i}`,
          firstSeen: null,
          lastSeen: null,
          series: [
            { metric: TOKEN_METRIC, attributes: { type: 'cacheRead', query_source: 'subagent' }, value: 1, points: 1 },
          ],
        }),
        'utf8'
      );
    }
  }

  // Le débounce borne la FRÉQUENCE des écritures ; seul le drapeau `dirty` en borne le
  // VOLUME. Sans lui, chaque tick réécrit tout le puits — des milliers de fichiers,
  // synchronement, sur la boucle du serveur : D6 attaqué par la durée.
  // ⚠️ Mutation : retirer le filtre `b.dirty` de `writeSnapshots` → rouge.
  it('ne réécrit QUE les seaux touchés, jamais l’historique', async () => {
    const home = makeHome();
    seedHistory(telemetryDir(home), 20);
    const writes = [];
    const spyFs = {
      ...fs,
      writeFileSync: (...args) => {
        writes.push(String(args[0]));
        return fs.writeFileSync(...args);
      },
    };
    const c = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000, deps: { fs: spyFs } });
    try {
      await post(c.port, SUBAGENT_CACHE_READ('sess-neuve', 100));
      writes.length = 0; // on ignore le verrou et le marqueur, écrits au démarrage
      c.flush();
      expect(
        writes.filter((w) => w.includes('sess-hist')),
        'des seaux jamais touchés ont été réécrits'
      ).toEqual([]);
      expect(writes.some((w) => w.includes('sess-neuve')), 'le seau touché n’a pas été écrit').toBe(true);
    } finally {
      await c.close();
    }
  });

  // Le scénario du second collecteur : B charge le puits, ne reçoit rien, se ferme —
  // et ne doit RIEN réécrire avec sa mémoire périmée.
  // ⚠️ Mutation : retirer `dirty: false` du rechargement dans `loadSnapshots` → rouge
  // (B réécrirait `sess-42.json` à 200, effaçant les 300 d'A).
  it('un collecteur qui n’a fait que LIRE n’écrase rien à sa fermeture', async () => {
    const home = makeHome();
    const a = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    await post(a.port, SUBAGENT_CACHE_READ('sess-42', 200));
    a.flush();
    expect(readDoc(home, 'sess-42.json').series[0].value).toBe(200);

    const b = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000, lock: false });
    await b.close(); // B se ferme sans avoir rien reçu

    await post(a.port, SUBAGENT_CACHE_READ('sess-42', 100));
    a.flush();
    await a.close();
    expect(
      readDoc(home, 'sess-42.json').series[0].value,
      'le second collecteur a écrasé le puits avec sa mémoire périmée'
    ).toBe(300);
  });
});

// ===========================================================================
// SKILL-87 — collector.mjs : la série passe d'un total à une SÉRIE horodatée (D2)
// ===========================================================================

describe('SKILL-87 — collector.mjs : `history` porte les incréments REÇUS, horodatés', () => {
  // ⚠️ Mutation : pousser dans `history` le CUMUL courant plutôt que l'incrément reçu
  // (ou ne rien pousser) → rouge. C'est l'invariant sur lequel toute coupe s'appuie.
  it('Σ des incréments de `history` égale le cumul `value`, sur toute série', () => {
    const acc = createAccumulator();
    let ms = Date.parse('2026-08-28T10:00:00.000Z');
    const now = () => new Date(ms++);
    accumulate(acc, extractPoints(SUBAGENT_CACHE_READ('sess-hist', 100)).points, now);
    accumulate(acc, extractPoints(SUBAGENT_CACHE_READ('sess-hist', 40)).points, now);
    accumulate(acc, extractPoints(SUBAGENT_CACHE_READ('sess-hist', 7)).points, now);
    const home = makeHome();
    writeSnapshots(telemetryDir(home), acc);
    const s = readDoc(home, 'sess-hist.json').series[0];
    expect(s.history.length, 'les trois incréments n’ont pas été conservés séparément').toBe(3);
    const sum = s.history.reduce((n, h) => n + h.value, 0);
    expect(sum, 'Σ des incréments de `history` ne correspond pas au cumul `value`').toBe(s.value);
    expect(s.value).toBe(147);
  });

  // ⚠️ Mutation : ne pas écrire `history` du tout (retirer le champ dans `docOf`) →
  // rouge. Le total (`value`) reste écrit ET reste la lecture par défaut (D2) : ce
  // ticket AJOUTE une dimension, il n'en retire aucune.
  it('un instantané neuf porte `history` par série, horodaté, SANS retirer `value`', () => {
    const acc = createAccumulator();
    accumulate(
      acc,
      extractPoints(SUBAGENT_CACHE_READ('sess-h2', 5)).points,
      () => new Date('2026-08-28T09:00:00.000Z')
    );
    const home = makeHome();
    writeSnapshots(telemetryDir(home), acc);
    const doc = readDoc(home, 'sess-h2.json');
    expect(Array.isArray(doc.series[0].history)).toBe(true);
    expect(doc.series[0].history).toEqual([{ at: '2026-08-28T09:00:00.000Z', value: 5 }]);
    expect(doc.series[0].value, 'le total a disparu au profit de la seule série').toBe(5);
  });

  // ⚠️ Mutation : dans `loadSnapshots`, ne pas relire `history` (le laisser `[]` même
  // quand le fichier en porte un) → rouge. Sans ça, un redémarrage du collecteur
  // romprait l'invariant Σ history == value pour les points déjà accumulés avant le
  // redémarrage.
  it('un redémarrage du collecteur conserve `history`, pas seulement le cumul', async () => {
    const home = makeHome();
    const c1 = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    await post(c1.port, SUBAGENT_CACHE_READ('sess-redem-hist', 10));
    await c1.close();
    expect(readDoc(home, 'sess-redem-hist.json').series[0].history.length).toBe(1);

    const c2 = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    await post(c2.port, SUBAGENT_CACHE_READ('sess-redem-hist', 20));
    await c2.close();
    const doc = readDoc(home, 'sess-redem-hist.json');
    expect(doc.series[0].history.length, 'l’historique d’avant redémarrage a été perdu').toBe(2);
    expect(doc.series[0].history.reduce((n, h) => n + h.value, 0)).toBe(doc.series[0].value);
    expect(doc.series[0].value).toBe(30);
  });

  // Finding SKILL-87 #1 — un instantané SKILL-78 (SANS `history`) rechargé puis touché
  // par un point neuf ne doit JAMAIS finir avec un `history` qui ne couvre pas tout le
  // cumul : ce serait indiscernable, pour `read.mjs`, d'un historique réellement
  // complet, et la coupe rendrait un `0` fabriqué au lieu d'un `null` + motif.
  // ⚠️ Mutation : retirer le drapeau `historyComplete` (ou le forcer à `true` au
  // rechargement) → rouge — `sess-legacy.json` finirait avec `history: [{…, value: 10}]`
  // à côté d'un `value: 5010`, brisant Σ history == value.
  it('une série SKILL-78 rechargée reste SANS `history` même après un point neuf', () => {
    const home = makeHome();
    const dir = telemetryDir(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'sess-legacy.json'),
      JSON.stringify({
        schema: 1,
        sessionId: 'sess-legacy',
        firstSeen: null,
        lastSeen: null,
        series: [
          {
            metric: TOKEN_METRIC,
            // ⚠️ `agent.name` DOIT correspondre à celui du point neuf ci-dessous
            // (`SUBAGENT_CACHE_READ` le fixe à `'custom'`) : `seriesKeyOf` inclut tous
            // les attributs, un désaccord créerait une SECONDE série au lieu de
            // toucher celle-ci — et le test ne prouverait plus rien.
            attributes: { type: 'cacheRead', query_source: 'subagent', 'agent.name': 'custom' },
            value: 5000,
            points: 2,
          },
        ],
      }),
      'utf8'
    );
    const acc = createAccumulator();
    loadSnapshots(dir, acc);
    accumulate(acc, extractPoints(SUBAGENT_CACHE_READ('sess-legacy', 10)).points, () => new Date('2026-08-28T11:00:00.000Z'));
    writeSnapshots(dir, acc);

    const doc = readDoc(home, 'sess-legacy.json');
    expect(doc.series[0].value, 'le point neuf n’a pas été sommé au cumul hérité').toBe(5010);
    expect(
      doc.series[0].history,
      'la série contaminée porte un `history` PARTIEL, indiscernable d’un historique complet'
    ).toBeUndefined();

    // Et la coupe le refuse — jamais un `0` fabriqué à la place de ces 5000 tokens.
    fs.writeFileSync(path.join(dir, ACTIVATION_FILE), JSON.stringify({ since: '2026-08-01T00:00:00.000Z' }), 'utf8');
    writeSettings(home, { configured: true });
    const r = readSessionCut('sess-legacy', '2026-08-28T10:30:00.000Z', { homedir: home });
    expect(r.state).toBe(STATE_UNDETERMINED);
    expect(r.before, 'un `before` a été rendu alors que 5000 tokens sont d’origine inconnue').toBeNull();
    expect(r.after).toBeNull();
    expect(r.reason).toContain(REASON_CUT_NO_HISTORY);
  });
});

// ===========================================================================
// collector.mjs — verrou
// ===========================================================================

describe('SKILL-78 — collector.mjs : un seul collecteur vivant par puits', () => {
  // ⚠️ Mutation : rendre `{ ok: true }` inconditionnellement dans `acquireLock` → rouge.
  it('refuse un second collecteur vivant, reprend un verrou périmé', () => {
    const home = makeHome();
    const dir = telemetryDir(home);
    fs.mkdirSync(dir, { recursive: true });

    const first = acquireLock(dir, { pid: 4242, port: 4318, isAlive: () => true });
    expect(first.ok).toBe(true);

    const second = acquireLock(dir, { pid: 4243, port: 4319, isAlive: () => true });
    expect(second.ok, 'un second collecteur vivant a pris le verrou').toBe(false);
    expect(second.reason).toMatch(/déjà/i);

    // ⚠️ Mutation : refuser un verrou dont le processus est mort → rouge. Un `kill -9`
    // condamnerait le puits pour toujours.
    const stale = acquireLock(dir, { pid: 4244, port: 4320, isAlive: () => false });
    expect(stale.ok, 'un verrou périmé bloque encore le démarrage').toBe(true);
    expect(stale.reason).toMatch(/périmé/i);
  });

  // ⚠️ Mutation : ne pas prendre le verrou dans `startCollector` → rouge.
  it('un second `startCollector` sur le même puits est refusé, et le verrou est rendu à la fermeture', async () => {
    const home = makeHome();
    const a = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    expect(fs.existsSync(path.join(telemetryDir(home), LOCK_FILE))).toBe(true);
    await expect(startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 })).rejects.toThrow(/déjà/i);
    await a.close();
    expect(
      fs.existsSync(path.join(telemetryDir(home), LOCK_FILE)),
      'le verrou survit à la fermeture : le puits reste condamné'
    ).toBe(false);
    const b = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    await b.close();
  });
});

// ===========================================================================
// collector.mjs — réception HTTP
// ===========================================================================

describe('SKILL-78 — collector.mjs : réception HTTP sur la boucle locale', () => {
  // ⚠️ Mutation : écouter sur `0.0.0.0` → rouge. Le puits est LOCAL (D1) : ces
  // métriques portent `user.email`, elles ne doivent pas être exposées au réseau.
  it('n’écoute que sur 127.0.0.1', () => {
    expect(DEFAULT_HOST, 'le collecteur écoute au-delà de la boucle locale').toBe('127.0.0.1');
  });

  it('reçoit une charge bien formée, et les points sont retrouvables par `session.id`', async () => {
    const home = makeHome();
    const c = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    try {
      const res = await post(c.port, readFixture('token-usage-subagent.json'));
      expect(res.status, 'une charge valide n’est pas acceptée').toBe(200);
      // ⚠️ Mutation : écrire au moment de la requête (flush synchrone) → rouge.
      // C'est la preuve que la réponse ne dépend d'AUCUNE écriture disque (D6).
      expect(
        fs.existsSync(path.join(telemetryDir(home), 'sess-captured-001.json')),
        'le disque a été touché pendant la requête — la réponse dépend du flush'
      ).toBe(false);
      c.flush();
      const doc = readDoc(home, 'sess-captured-001.json');
      const val = (type) =>
        doc.series.find((s) => s.attributes.type === type && s.attributes.query_source === 'subagent').value;
      expect(val('cacheRead')).toBe(100);
      expect(val('cacheCreation')).toBe(20);
      expect(val('input')).toBe(5);
      expect(val('output')).toBe(3);
    } finally {
      await c.close();
    }
  });

  // ⚠️ Mutation : `JSON.parse` sans `try` dans le gestionnaire → rouge (le serveur
  // tombe, la requête suivante n'a plus d'interlocuteur).
  it('un JSON invalide n’écrit rien, ne tue pas le serveur, et le suivant passe', async () => {
    const home = makeHome();
    const c = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    try {
      const bad = await post(c.port, '{ ceci n’est pas du JSON');
      expect(bad.status, 'un JSON invalide n’est pas rejeté proprement').toBe(400);
      c.flush();
      expect(
        fs.readdirSync(telemetryDir(home)).filter((f) => f.endsWith('.json') && f !== ACTIVATION_FILE),
        'une charge invalide a écrit un instantané'
      ).toEqual([]);
      const good = await post(c.port, SUBAGENT_CACHE_READ('sess-1', 7));
      expect(good.status, 'le serveur est mort sur une entrée hostile').toBe(200);
    } finally {
      await c.close();
    }
  });

  // ⚠️ Mutation : supprimer la garde de taille → rouge.
  it('refuse un corps démesuré au lieu de le charger en mémoire', async () => {
    const home = makeHome();
    const c = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000, maxBodyBytes: 64 });
    try {
      const res = await post(c.port, SUBAGENT_CACHE_READ('sess-1', 1));
      expect(res.status, 'un corps au-delà de la borne est accepté').toBe(413);
    } finally {
      await c.close();
    }
  });

  // Le flush finit par tomber tout seul, sans qu'on l'appelle.
  // ⚠️ Mutation : ne jamais armer le minuteur de flush → rouge.
  it('flushe de lui-même après le délai de débounce', async () => {
    const home = makeHome();
    const c = await startCollector({ homedir: home, port: 0, flushDelayMs: 5 });
    try {
      await post(c.port, SUBAGENT_CACHE_READ('sess-debounce', 100));
      const target = path.join(telemetryDir(home), 'sess-debounce.json');
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(target) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(fs.existsSync(target), 'le flush automatique n’a jamais eu lieu').toBe(true);
    } finally {
      await c.close();
    }
  });

  // ⚠️ Mutation : ne pas écrire le marqueur au démarrage → rouge. Sans lui, le
  // lecteur ne peut PAS distinguer « collecteur éteint » de « session antérieure à
  // l'activation » (D5) — les deux états se confondraient.
  it('pose un marqueur d’activation au premier démarrage, et ne l’écrase jamais', async () => {
    const home = makeHome();
    const c1 = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    await c1.close();
    const first = readDoc(home, ACTIVATION_FILE);
    expect(typeof first.since, 'le marqueur ne porte pas de date d’activation').toBe('string');
    const c2 = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    await c2.close();
    expect(readDoc(home, ACTIVATION_FILE).since, 'le marqueur a été réécrit au second démarrage').toBe(first.since);
  });
});

// ===========================================================================
// collector.mjs — un endpoint LOCAL n'est pas un endpoint PRIVÉ
// ===========================================================================

describe('SKILL-78 — collector.mjs : le navigateur de la machine n’est pas un exporteur', () => {
  // Écouter sur 127.0.0.1 n'exclut pas une page ouverte dans le navigateur : un
  // `fetch(..., {mode:'no-cors'})` est une requête « simple » au sens CORS, donc sans
  // préflight. La donnée étant le DÉNOMINATEUR de l'arbitrage de dosage, un chiffre
  // falsifiable en écriture est aussi inutilisable qu'un chiffre absent.
  // ⚠️ Mutation : rendre `null` inconditionnellement dans `browserGuard` → rouge.
  it('browserGuard refuse Origin, Sec-Fetch-* et les content-types de requête simple', () => {
    expect(browserGuard({ 'content-type': 'application/json' }), 'un exporteur légitime est refusé').toBeNull();
    expect(browserGuard({ 'content-type': 'application/json; charset=utf-8' })).toBeNull();
    expect(browserGuard({ 'content-type': 'text/plain' }), '`text/plain` passe : une requête simple entre').toMatch(
      /content-type/
    );
    expect(browserGuard({ 'content-type': 'application/x-www-form-urlencoded' })).toMatch(/content-type/);
    expect(browserGuard({}), 'une requête sans content-type passe').toMatch(/content-type/);
    expect(
      browserGuard({ 'content-type': 'application/json', origin: 'https://exemple.invalid' }),
      'une requête portant `Origin` passe'
    ).toMatch(/Origin/);
    expect(
      browserGuard({ 'content-type': 'application/json', 'sec-fetch-mode': 'no-cors' }),
      'une requête portant `Sec-Fetch-Mode` passe'
    ).toMatch(/Sec-Fetch/);
  });

  // ⚠️ Mutation : retirer l'appel à `browserGuard` du gestionnaire → rouge.
  it('le serveur répond 403 à une charge de page web, et n’accumule rien', async () => {
    const home = makeHome();
    const c = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    try {
      const res = await post(c.port, SUBAGENT_CACHE_READ('sess-victime', 999999), {
        headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'https://exemple.invalid' },
      });
      expect(res.status, 'une requête de navigateur a été acceptée').toBe(403);
      c.flush();
      expect(
        fs.existsSync(path.join(telemetryDir(home), 'sess-victime.json')),
        'une page web a pu gonfler la mesure d’une session'
      ).toBe(false);
    } finally {
      await c.close();
    }
  });
});

// ===========================================================================
// collector.mjs — un point jeté laisse une trace
// ===========================================================================

describe('SKILL-78 — collector.mjs : un point jeté n’est jamais un silence', () => {
  // Une charge dont 100 % des points sont écartés produit un `200 OK` et aucun
  // fichier — indiscernable d'une absence d'envoi. C'est le mode d'échec que la spec
  // nomme (« l'absence de métrique est indiscernable d'une métrique à zéro »),
  // reproduit à l'intérieur de l'instrument censé le fermer.
  // ⚠️ Mutation : ne pas persister `ignoredPoints` (retirer `noteIgnored` de
  // `handlePayload`, ou l'écriture de `DIAGNOSTICS_FILE`) → rouge.
  it('compte, persiste et remonte au lecteur les points reçus puis jetés', async () => {
    const home = makeHome();
    const c = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    try {
      const res = await post(c.port, readFixture('hostile-points.json'));
      expect(res.status, 'une charge intégralement jetée n’est pas acceptée').toBe(200);
      c.flush();
    } finally {
      await c.close();
    }
    expect(readDoc(home, DIAGNOSTICS_FILE).ignoredPoints, 'le compteur de points jetés n’est pas écrit').toBe(3);
    expect(readDiagnostics(telemetryDir(home)).ignoredPoints).toBe(3);

    // Le lecteur le RELAIE : c'est le seul indice qui distingue « rien n'est arrivé »
    // de « tout ce qui est arrivé a été jeté » (un renommage d'attribut en amont).
    const r = readSession('sess-quelconque', { homedir: home });
    expect(r.warnings.join(' '), 'le lecteur ne relaie pas les points jetés').toMatch(/JET/i);
  });
});

// ===========================================================================
// collector.mjs — survivre à un redémarrage
// ===========================================================================

describe('SKILL-78 — collector.mjs : un redémarrage n’efface pas le total déjà accumulé', () => {
  // ⚠️ Mutation : retirer l’appel à `loadSnapshots` dans `startCollector` → rouge
  // (100 au lieu de 300).
  it('recharge les instantanés existants au démarrage', async () => {
    const home = makeHome();
    const c1 = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    await post(c1.port, SUBAGENT_CACHE_READ('sess-redemarre', 200));
    await c1.close();
    expect(readDoc(home, 'sess-redemarre.json').series[0].value).toBe(200);

    const c2 = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000 });
    await post(c2.port, SUBAGENT_CACHE_READ('sess-redemarre', 100));
    await c2.close();
    const doc = readDoc(home, 'sess-redemarre.json');
    expect(doc.series.length, 'la série a été dupliquée au rechargement').toBe(1);
    expect(doc.series[0].value, 'le redémarrage a écrasé le total déjà accumulé').toBe(300);
    expect(doc.series[0].points).toBe(2);
  });

  // ⚠️ Mutation : laisser `JSON.parse` jeter dans `loadSnapshots` → rouge (le
  // collecteur refuserait de démarrer à cause d’un fichier corrompu).
  it('saute un instantané corrompu, d’un autre schéma, ou d’un nom illégitime', () => {
    const home = makeHome();
    const dir = telemetryDir(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sess-casse.json'), '{ pas du json', 'utf8');
    fs.writeFileSync(path.join(dir, 'sess-vieux.json'), JSON.stringify({ schema: 0, series: [] }), 'utf8');
    // ⚠️ Mutation : ne pas revalider le nom au rechargement → rouge.
    fs.writeFileSync(
      path.join(dir, 'nom~illegitime.json'),
      JSON.stringify({ schema: 1, series: [], firstSeen: null, lastSeen: null }),
      'utf8'
    );
    fs.writeFileSync(path.join(dir, ACTIVATION_FILE), JSON.stringify({ since: '2026-08-01T00:00:00.000Z' }), 'utf8');
    const acc = createAccumulator();
    const r = loadSnapshots(dir, acc);
    expect(r.skipped, 'les instantanés inexploitables ne sont pas comptés').toBe(3);
    expect(r.loaded).toBe(0);
    // ⚠️ Mutation : charger `ACTIVATED.json` comme une session → rouge.
    expect([...acc.buckets.keys()], 'le marqueur d’activation a été pris pour une session').toEqual([]);
  });

  // ⚠️ Mutation : rendre `{}` au lieu de `null` quand le fichier manque → rouge : le
  // collecteur affirmerait « télémétrie éteinte » sans avoir pu lire le fichier.
  it('lit le `settings.json` du poste, ou dit pourquoi il ne peut pas', () => {
    const home = makeHome();
    const absent = readLiveSettings(home);
    expect(absent.settings).toBeNull();
    expect(absent.reason, 'aucun motif rendu pour un settings.json illisible').toMatch(/illisible/i);

    writeSettings(home, { configured: true });
    const present = readLiveSettings(home);
    expect(present.reason).toBeNull();
    expect(checkTelemetrySettings(present.settings).configured).toBe(true);
  });
});

// ===========================================================================
// collector.mjs — no-op et CLI
// ===========================================================================

describe('SKILL-78 — collector.mjs : no-op si le dépôt de données manque', () => {
  // Même contrat que `write.mjs` : motif sur stderr, exit 0, rien créé.
  // ⚠️ Mutation : `return 1` au lieu de `return 0` → rouge (le lanceur croirait à une
  // panne alors que l'absence de dépôt est un état normal).
  it('sort 0 avec un motif sur stderr, sans rien créer ni écouter', async () => {
    const home = makeHome({ withRepo: false });
    const errs = [];
    const code = await collectorMain([], { homedir: home, stderr: (s) => errs.push(s) });
    expect(code, 'le no-op ne sort pas 0').toBe(0);
    expect(errs.join(''), 'aucun motif sur stderr').toMatch(/no-op/i);
    expect(fs.existsSync(path.join(home, 'sdd-metrics')), 'le dépôt a été créé').toBe(false);
  });

  // ⚠️ Mutation : avaler un drapeau inconnu → rouge (invariant du dépôt : jamais de
  // valeur inventée ni de token avalé en silence).
  it('refuse un drapeau inconnu', async () => {
    const home = makeHome();
    const errs = [];
    const code = await collectorMain(['--inconnu'], { homedir: home, stderr: (s) => errs.push(s) });
    expect(code, 'un drapeau inconnu passe').toBe(1);
    expect(errs.join('')).toMatch(/inconnu/i);
  });

  // ⛔ RIEN de ce que livre ce ticket n'allume la télémétrie : `settings.json` est
  // gitignoré (SKILL-39), il se modifie à la main. Renvoyer l'opérateur à une constante
  // au fond d'un fichier de 700 lignes n'est pas une procédure : `--print-env` crache
  // le bloc, prêt à fusionner.
  // ⚠️ Mutation : retirer `--print-env`, ou le placer APRÈS le no-op de `~/sdd-metrics`
  // → rouge (il doit marcher sur un poste qui n'a pas encore de dépôt de mesures).
  it('`--print-env` imprime le bloc à fusionner, même sans dépôt de mesures', async () => {
    const home = makeHome({ withRepo: false });
    const out = [];
    const errs = [];
    const code = await collectorMain(['--print-env'], {
      homedir: home,
      stdout: (s) => out.push(s),
      stderr: (s) => errs.push(s),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(''));
    expect(parsed.env, 'le bloc imprimé n’est pas sous la clé `env` attendue par le harnais').toBeTruthy();
    expect(parsed.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1');
    expect(parsed.env, 'le bloc imprimé diverge du bloc de référence').toEqual({ ...SETTINGS_ENV_BLOCK });
    expect(errs.join(''), 'rien ne dit où coller le bloc').toMatch(/settings\.json/);
  });
});

// ===========================================================================
// D6 — le non-blocage se TESTE
// ===========================================================================

describe('SKILL-78 — D6 : un collecteur absent ou lent ne bloque jamais l’appelant', () => {
  // ⚠️ Ce test constate le refus de connexion de la boucle locale — il ne pilote PAS
  // l'exporteur d'OpenTelemetry, qui vit dans le harnais et n'est pas mécanisable
  // ici. Le rapport final le dit (§ Tests : « s'il n'est pas mécanisable en l'état,
  // le dire dans le rapport plutôt que de le déclarer vert »).
  // ⚠️ Mutation : pointer le POST sur un port OUVERT → rouge (pas de refus).
  it('port fermé : le POST échoue vite et ne pend pas', async () => {
    const started = Date.now();
    const res = await post(59_999, SUBAGENT_CACHE_READ('sess-1', 1));
    const elapsed = Date.now() - started;
    expect(res.status, 'une réponse est arrivée d’un port censé être fermé').toBeNull();
    expect(res.error, 'aucune erreur de connexion — le port n’était pas fermé').toBeTruthy();
    // Borne CONSTATÉE, pas supposée : un refus sur la boucle locale est immédiat.
    expect(elapsed, `le refus a pris ${elapsed} ms`).toBeLessThan(2000);
  });

  // ⚠️ Mutation : appeler `flush` dans le gestionnaire de requête (au lieu de l'armer
  // sur un minuteur) → rouge : le `writeFileSync` lent bloquerait la réponse.
  it('collecteur lent : la réponse est rendue AVANT toute écriture disque, et bornée', async () => {
    const home = makeHome();
    const writes = [];
    const slowFs = {
      ...fs,
      writeFileSync: (...args) => {
        const end = Date.now() + 150;
        while (Date.now() < end) { /* écriture volontairement lente */ }
        writes.push(String(args[0]));
        return fs.writeFileSync(...args);
      },
    };
    const c = await startCollector({ homedir: home, port: 0, flushDelayMs: 60_000, deps: { fs: slowFs } });
    try {
      const started = Date.now();
      const res = await post(c.port, SUBAGENT_CACHE_READ('sess-lent', 100));
      const elapsed = Date.now() - started;
      expect(res.status).toBe(200);
      expect(writes.filter((w) => w.includes('sess-lent')), 'le flush a eu lieu pendant la requête').toEqual([]);
      expect(elapsed, `la réponse a pris ${elapsed} ms`).toBeLessThan(2000);
      c.flush();
      expect(writes.some((w) => w.includes('sess-lent')), 'le flush différé n’a rien écrit').toBe(true);
    } finally {
      await c.close();
    }
  });
});

// ===========================================================================
// read.mjs — les états de D5
// ===========================================================================

describe('SKILL-78 — read.mjs : une absence de mesure reste une absence, jamais un zéro', () => {
  /** Puits activé le `since` donné, avec les documents fournis, télémétrie allumée. */
  function seed(home, since, docs = {}, { configured = true } = {}) {
    const dir = telemetryDir(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ACTIVATION_FILE), JSON.stringify({ since }), 'utf8');
    for (const [name, doc] of Object.entries(docs)) {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(doc), 'utf8');
    }
    writeSettings(home, { configured });
  }

  function capturedDoc(sessionId, series) {
    return { schema: 1, sessionId, firstSeen: '2026-08-28T10:00:00.000Z', lastSeen: '2026-08-28T10:01:00.000Z', series };
  }

  // ÉTAT 1 — captée, sous-agents à zéro → `0`, et surtout PAS `null`.
  // ⚠️ Mutation : rendre `null` quand le total des sous-agents est nul → rouge.
  // C'est exactement le défaut que SKILL-69 vient de corriger dans l'ancien compteur.
  it('session captée, aucun sous-agent : rend 0 — mesuré, et nul', () => {
    const home = makeHome();
    seed(home, '2026-08-01T00:00:00.000Z', {
      'sess-zero.json': capturedDoc('sess-zero', [
        { metric: TOKEN_METRIC, attributes: { type: 'cacheRead', query_source: 'main' }, value: 5000, points: 2 },
      ]),
    });
    const r = readSession('sess-zero', { homedir: home });
    expect(r.state).toBe(STATE_CAPTURED);
    expect(r.reason, 'un motif est rendu pour une mesure pourtant faite').toBeNull();
    expect(r.subagent, 'les sous-agents sont `null` alors que la session est captée').not.toBeNull();
    expect(r.subagent.cacheRead, 'un 0 mesuré a été rendu `null`').toBe(0);
    expect(r.subagent.cacheCreation).toBe(0);
    expect(r.byQuerySource.main.cacheRead, 'le total `main` a disparu').toBe(5000);
    expect(r.warnings, 'un avertissement est levé sans raison').toEqual([]);
  });

  // ÉTAT 2 — collecteur éteint pendant une session POSTÉRIEURE à l'activation.
  // ⚠️ Mutation : rendre `{ cacheRead: 0 }` au lieu de `null` → rouge.
  it('session non captée : rend null + motif', () => {
    const home = makeHome();
    seed(home, '2026-08-01T00:00:00.000Z');
    writeTranscript(home, 'sess-apres', '2026-08-20T09:00:00.000Z');
    const r = readSession('sess-apres', { homedir: home });
    expect(r.state).toBe(STATE_NOT_CAPTURED);
    expect(r.subagent, 'un chiffre est rendu pour une session non captée').toBeNull();
    expect(r.reason, 'aucun motif').toContain(REASON_NOT_CAPTURED);
  });

  // ÉTAT 3 — session ANTÉRIEURE à l'activation.
  // ⚠️ Mutation qui doit rougir (§ Tests) : rendre le MÊME motif pour les états 2 et 3.
  // Ils ne se soignent pas de la même façon — les confondre rendrait le lecteur inutile.
  it('session antérieure à l’activation : rend null + un motif DISTINCT du précédent', () => {
    const home = makeHome();
    seed(home, '2026-08-27T00:00:00.000Z');
    writeTranscript(home, 'sess-avant', '2026-08-10T09:00:00.000Z');
    const r = readSession('sess-avant', { homedir: home });
    expect(r.state).toBe(STATE_BEFORE_ACTIVATION);
    expect(r.subagent).toBeNull();
    expect(r.reason).toContain(REASON_BEFORE_ACTIVATION);
    expect(
      REASON_BEFORE_ACTIVATION,
      'les deux motifs d’absence sont confondus — le lecteur ne sait plus quoi soigner'
    ).not.toBe(REASON_NOT_CAPTURED);
    expect(r.reason, 'le motif d’antériorité est celui du collecteur éteint').not.toContain(REASON_NOT_CAPTURED);
  });

  // ÉTAT 4 — la télémétrie n'est PAS allumée dans `settings.json`.
  // Le marqueur `ACTIVATED.json` date le premier démarrage du COLLECTEUR, pas
  // l'activation de la télémétrie. Sans ce quatrième état, un poste dont le bloc `env`
  // n'a jamais été posé s'entend répondre « relancer le collecteur », indéfiniment.
  // ⚠️ Mutation : retirer l’appel à `checkTelemetrySettings` dans `readSession` → rouge
  // (l’état retomberait sur `not-captured`, et le motif accuserait le collecteur).
  it('télémétrie non configurée : état et motif PROPRES, jamais « collecteur éteint »', () => {
    const home = makeHome();
    seed(home, '2026-08-01T00:00:00.000Z', {}, { configured: false });
    writeTranscript(home, 'sess-sans-config', '2026-08-20T09:00:00.000Z');
    const r = readSession('sess-sans-config', { homedir: home });
    expect(r.state).toBe(STATE_NOT_CONFIGURED);
    expect(r.subagent).toBeNull();
    expect(r.reason).toContain(REASON_NOT_CONFIGURED);
    expect(r.reason, 'on accuse le collecteur alors que la télémétrie est éteinte').not.toContain(REASON_NOT_CAPTURED);
    expect(REASON_NOT_CONFIGURED).not.toBe(REASON_NOT_CAPTURED);
    // Le motif doit porter le geste à faire, pas seulement le constat.
    expect(r.reason, 'le motif ne dit pas quoi faire').toMatch(/print-env|settings\.json/);
  });

  // Aucune activation du tout : c'est encore de l'antériorité, pas un collecteur éteint.
  // ⚠️ Mutation : classer en `not-captured` → rouge.
  it('aucun marqueur d’activation : la session est antérieure à l’activation', () => {
    const home = makeHome();
    fs.mkdirSync(telemetryDir(home), { recursive: true });
    writeSettings(home, { configured: true });
    const r = readSession('sess-quelconque', { homedir: home });
    expect(r.state).toBe(STATE_BEFORE_ACTIVATION);
    expect(r.subagent).toBeNull();
  });

  // Ni fichier, ni date de session : on ne SAIT pas — et on le dit.
  // ⚠️ Mutation : replier ce cas sur `not-captured` → rouge (on affirmerait que le
  // collecteur était éteint alors qu'on n'a pas pu dater la session).
  it('session indatable : état `undetermined`, jamais un état affirmé', () => {
    const home = makeHome();
    seed(home, '2026-08-01T00:00:00.000Z');
    const r = readSession('sess-sans-transcript', { homedir: home });
    expect(r.state).toBe(STATE_UNDETERMINED);
    expect(r.subagent).toBeNull();
    expect(r.reason, 'le motif ne dit pas que la session est indatable').toMatch(/dater|introuvable/i);
  });

  // ⚠️ Mutation : lire la date d'un transcript par son mtime → rouge (le mtime bouge
  // à chaque copie de fichier ; l'horodatage de la première ligne, non).
  it('date une session par le premier horodatage de son transcript', () => {
    const home = makeHome();
    writeTranscript(home, 'sess-datee', '2026-08-15T12:34:56.000Z');
    const { at, reason } = sessionStartedAt('sess-datee', home);
    expect(reason).toBeNull();
    expect(at).toBe('2026-08-15T12:34:56.000Z');
    expect(sessionStartedAt('sess-absente', home).at).toBeNull();
  });

  // ⚠️ Mutation : rendre `at` non nul quand le marqueur est absent → rouge.
  it('lit le marqueur d’activation, ou dit pourquoi il ne peut pas', () => {
    const home = makeHome();
    fs.mkdirSync(telemetryDir(home), { recursive: true });
    expect(readActivation(telemetryDir(home)).at).toBeNull();
    fs.writeFileSync(path.join(telemetryDir(home), ACTIVATION_FILE), '{ pas du json', 'utf8');
    const r = readActivation(telemetryDir(home));
    expect(r.at, 'un marqueur illisible passe pour une activation').toBeNull();
    expect(r.reason).toMatch(/illisible|invalide/i);
  });

  // Le zéro le plus dangereux : celui qu'on estampille « mesuré ».
  // Le collecteur ne valide que la PRÉSENCE de `type` ; si Claude Code renomme la
  // valeur (`cacheRead` → `cache_read`), les instantanés se remplissent et le lecteur
  // rendrait `captured` + `cacheRead: 0` — « mesuré, et nul ». C'est le mot-à-mot de ce
  // que D5 interdit.
  // ⚠️ Mutation : remplacer le seau `unusable` par un `continue` muet → rouge.
  it('`type` inconnu : jamais un 0 estampillé `captured`', () => {
    const home = makeHome();
    seed(home, '2026-08-01T00:00:00.000Z', {
      'sess-renomme.json': capturedDoc('sess-renomme', [
        { metric: TOKEN_METRIC, attributes: { type: 'cache_read', query_source: 'subagent' }, value: 48231, points: 9 },
        { metric: TOKEN_METRIC, attributes: { type: 'cache_creation', query_source: 'subagent' }, value: 412, points: 9 },
      ]),
    });
    const r = readSession('sess-renomme', { homedir: home });
    expect(r.state, 'un total nul obtenu après avoir tout écarté a été estampillé `captured`').toBe(
      STATE_UNDETERMINED
    );
    expect(r.subagent, 'un 0 est rendu alors que rien n’a pu être lu').toBeNull();
    expect(r.reason, 'le motif ne nomme pas les `type` écartés').toMatch(/type` inconnu|type. inconnu/);
    expect(r.reason).toContain('cache_read');
  });

  // Une session dont SEULES quelques séries sont illisibles garde sa mesure, mais
  // l'avertissement remonte : on ne cache pas ce qu'on a écarté.
  // ⚠️ Mutation : vider `warnings` → rouge.
  it('séries partiellement illisibles : la mesure tient, l’écart est signalé', () => {
    const home = makeHome();
    seed(home, '2026-08-01T00:00:00.000Z', {
      'sess-partielle.json': capturedDoc('sess-partielle', [
        { metric: TOKEN_METRIC, attributes: { type: 'cacheRead', query_source: 'subagent' }, value: 700, points: 3 },
        { metric: TOKEN_METRIC, attributes: { type: 'inconnu', query_source: 'subagent' }, value: 5, points: 1 },
        { metric: TOKEN_METRIC, attributes: { type: 'cacheRead' }, value: 9, points: 1 },
      ]),
    });
    const r = readSession('sess-partielle', { homedir: home });
    expect(r.state).toBe(STATE_CAPTURED);
    expect(r.subagent.cacheRead).toBe(700);
    expect(r.warnings.join(' '), 'les séries écartées ne sont pas signalées').toMatch(/écartée/);
    expect(r.warnings.join(' ')).toMatch(/query_source` absent|query_source. absent/);
  });
});

// ===========================================================================
// read.mjs — ventilation
// ===========================================================================

describe('SKILL-78 — read.mjs : ventilation par rôle et par type', () => {
  function seedCaptured(home, series) {
    const dir = telemetryDir(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ACTIVATION_FILE), JSON.stringify({ since: '2026-08-01T00:00:00.000Z' }), 'utf8');
    fs.writeFileSync(
      path.join(dir, 'sess-v.json'),
      JSON.stringify({ schema: 1, sessionId: 'sess-v', firstSeen: null, lastSeen: null, series }),
      'utf8'
    );
  }

  const S = (type, query_source, value, extra = {}) => ({
    metric: TOKEN_METRIC,
    attributes: { type, query_source, ...extra },
    value,
    points: 1,
  });

  // ⚠️ Mutation : fondre `custom` dans un autre rôle (ou dans le rôle « sans nom »)
  // → rouge. Un `custom` est un rôle qu'on n'a pas su nommer, pas un rôle nul.
  // ⚠️ Les valeurs `sdd-reviewer` / `sdd-impl-high` testées ici ne sont produites par la
  // source QUE pour un agent intégré ou de marketplace officielle. Sur ce poste, les
  // agents sont définis dans `~/.claude/agents/`, donc redactés en `custom` — ce test
  // verrouille les RÈGLES de fusion, pas une discrimination que la réalité exhiberait.
  // Le test suivant, lui, porte sur ce que le poste produit réellement.
  it('sépare des `agent.name` distincts, `custom` et le rôle sans nom', () => {
    const home = makeHome();
    seedCaptured(home, [
      S('cacheRead', 'subagent', 700, { 'agent.name': 'sdd-reviewer' }),
      S('cacheRead', 'subagent', 300, { 'agent.name': 'sdd-impl-high' }),
      S('cacheRead', 'subagent', 50, { 'agent.name': 'custom' }),
      S('cacheRead', 'subagent', 11),
      // ⚠️ Le volume de l'ORCHESTRATEUR, présent dans le même instantané : c'est lui
      // qui rend la mutation « fondre main/auxiliary dans les rôles » détectable.
      S('cacheRead', 'main', 9000),
    ]);
    const r = readSession('sess-v', { homedir: home });
    expect(Object.keys(r.subagent.byAgent).sort()).toEqual(
      [AGENT_UNNAMED, 'custom', 'sdd-impl-high', 'sdd-reviewer'].sort()
    );
    expect(r.subagent.byAgent['sdd-reviewer'].cacheRead).toBe(700);
    expect(r.subagent.byAgent['sdd-impl-high'].cacheRead).toBe(300);
    expect(r.subagent.byAgent.custom.cacheRead, '`custom` a été fondu dans un autre rôle').toBe(50);
    // ⚠️ Mutation : retirer le filtre `query_source === 'subagent'` de la ventilation
    // par rôle → rouge (les 9000 de l'orchestrateur atterriraient ici).
    expect(r.subagent.byAgent[AGENT_UNNAMED].cacheRead, 'le rôle sans nom a absorbé `main`').toBe(11);
    expect(r.subagent.cacheRead, 'le total ne recouvre pas la ventilation').toBe(1061);
    expect(r.byQuerySource.main.cacheRead, 'le volume de l’orchestrateur a bougé').toBe(9000);
    const ventile = Object.values(r.subagent.byAgent).reduce((n, b) => n + b.cacheRead, 0);
    expect(ventile, 'la ventilation par rôle ne somme pas au total des sous-agents').toBe(r.subagent.cacheRead);
  });

  // CE QUE LE POSTE PRODUIT RÉELLEMENT. La doc : « Other user-defined agent names are
  // replaced with "custom" », et `OTEL_LOG_TOOL_DETAILS` n'y change rien. Nos agents
  // vivent dans `~/.claude/agents/` → `byAgent` n'a qu'UNE clé. `byRole` ajoute
  // l'`effort`, seul discriminant documenté qui survive.
  // ⚠️ Mutation : retirer `effort` de la clé de `byRole` → rouge (les trois seaux
  // fusionneraient en un seul).
  it('`agent.name` toujours `custom` : `byRole` désambiguïse par `effort`', () => {
    const home = makeHome();
    seedCaptured(home, [
      S('cacheRead', 'subagent', 700, { 'agent.name': 'custom', effort: 'high' }),
      S('cacheRead', 'subagent', 300, { 'agent.name': 'custom', effort: 'max' }),
      S('cacheCreation', 'subagent', 12, { 'agent.name': 'custom', effort: 'high' }),
    ]);
    const r = readSession('sess-v', { homedir: home });
    expect(Object.keys(r.subagent.byAgent), 'la redaction en `custom` n’est pas ce que le poste produit').toEqual([
      'custom',
    ]);
    expect(Object.keys(r.subagent.byRole).sort()).toEqual(['custom (effort high)', 'custom (effort max)']);
    expect(r.subagent.byRole['custom (effort high)'].cacheRead).toBe(700);
    expect(r.subagent.byRole['custom (effort high)'].cacheCreation).toBe(12);
    expect(r.subagent.byRole['custom (effort max)'].cacheRead).toBe(300);
    // ⛔ Et la LIMITE, écrite noir sur blanc : `sdd-reviewer` et `sdd-impl-high` sont
    // tous deux à `effort: high` (`agents/*.md`). `effort` sépare les paliers
    // d'implémentation, PAS la revue de l'implémentation. Cette ventilation-là n'est
    // pas atteignable en l'état : c'est escaladé, pas contourné.
    const reviewerEffort = fs
      .readFileSync(path.join(REPO_ROOT, 'agents', 'sdd-reviewer.md'), 'utf8')
      .match(/^effort:\s*(\S+)/m)[1];
    const implHighEffort = fs
      .readFileSync(path.join(REPO_ROOT, 'agents', 'sdd-impl-high.md'), 'utf8')
      .match(/^effort:\s*(\S+)/m)[1];
    expect(
      reviewerEffort,
      'si ces deux efforts divergeaient, `byRole` séparerait enfin revue et implémentation — ' +
        'reprendre l’escalade du finding 3'
    ).toBe(implHighEffort);
  });

  // ⚠️ Mutation : rendre `cache: cacheRead + cacheCreation` → rouge. Les deux termes
  // n'ont ni le même prix ni la même cause ; les additionner d'office les perd.
  it('rend `cacheRead` et `cacheCreation` distinctement, jamais additionnés', () => {
    const home = makeHome();
    seedCaptured(home, [
      S('cacheRead', 'subagent', 1000, { 'agent.name': 'custom' }),
      S('cacheCreation', 'subagent', 7, { 'agent.name': 'custom' }),
    ]);
    const r = readSession('sess-v', { homedir: home });
    expect(r.subagent.cacheRead).toBe(1000);
    expect(r.subagent.cacheCreation).toBe(7);
    expect(r.subagent.byAgent.custom.cacheRead).toBe(1000);
    expect(r.subagent.byAgent.custom.cacheCreation).toBe(7);
    expect(Object.keys(r.subagent), 'un total agrégé cache a été ajouté').not.toContain('cache');
  });

  // ⚠️ Mutation : faire sortir 1 quand la session n'est pas captée → rouge. Le
  // lecteur RAPPORTE une absence, il ne la traite pas comme une panne (D6).
  it('le CLI rend du JSON sur stdout et sort 0, même sur une absence', () => {
    const home = makeHome();
    fs.mkdirSync(telemetryDir(home), { recursive: true });
    const out = [];
    const code = readMain(['sess-inconnue'], { homedir: home, stdout: (s) => out.push(s), stderr: () => {} });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(''));
    expect(parsed.sessionId).toBe('sess-inconnue');
    expect(parsed.subagent).toBeNull();
    expect(parsed.reason).toBeTruthy();
  });

  // ⚠️ Mutation : inventer un `session.id` quand l'argument manque → rouge.
  it('le CLI refuse d’inventer un `session.id` manquant', () => {
    const home = makeHome();
    const errs = [];
    const code = readMain([], { homedir: home, stdout: () => {}, stderr: (s) => errs.push(s) });
    expect(code).toBe(1);
    expect(errs.join('')).toMatch(/session/i);
  });
});

// ===========================================================================
// SKILL-87 — read.mjs : la coupe « avant / après » un instant (D3, D4)
// ===========================================================================

describe('SKILL-87 — read.mjs : la coupe avant/après un instant donné', () => {
  /** Puits activé, une session captée dont les séries portent les `history` fournis. */
  function seedCut(home, since, series, { configured = true } = {}) {
    const dir = telemetryDir(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ACTIVATION_FILE), JSON.stringify({ since }), 'utf8');
    fs.writeFileSync(
      path.join(dir, 'sess-cut.json'),
      JSON.stringify({ schema: 1, sessionId: 'sess-cut', firstSeen: null, lastSeen: null, series }),
      'utf8'
    );
    writeSettings(home, { configured });
  }

  /** Série `subagent` synthétique dont `value`/`points` sont dérivés de `history`. */
  const H = (type, history) => ({
    metric: TOKEN_METRIC,
    attributes: { type, query_source: 'subagent', 'agent.name': 'custom' },
    value: history.reduce((n, h) => n + h.value, 0),
    points: history.length,
    history,
  });

  // Le cas nominal : `before + after == total`, la coupe suit STRICTEMENT l'horodatage.
  // ⚠️ Mutation : sommer tous les points dans `before` sans regarder la borne → rouge.
  it('coupe nominale : `before + after == total`, réparti par instant', () => {
    const home = makeHome();
    seedCut(home, '2026-08-01T00:00:00.000Z', [
      H('cacheRead', [
        { at: '2026-08-28T10:00:00.000Z', value: 100 },
        { at: '2026-08-28T10:05:00.000Z', value: 300 },
      ]),
    ]);
    const r = readSessionCut('sess-cut', '2026-08-28T10:02:00.000Z', { homedir: home });
    expect(r.state).toBe(STATE_CAPTURED);
    expect(r.reason).toBeNull();
    expect(r.before.cacheRead).toBe(100);
    expect(r.after.cacheRead).toBe(300);
    expect(r.before.cacheRead + r.after.cacheRead, 'before + after ne somme pas au total').toBe(400);
  });

  // Bornes DÉGÉNÉRÉES — deux `0` LÉGITIMES, à ne jamais confondre avec une coupe
  // impossible. ⚠️ Mutation : rendre `null` pour ces bornes → rouge.
  it('coupe avant le premier point : `before` mesuré à 0, `after` == total', () => {
    const home = makeHome();
    seedCut(home, '2026-08-01T00:00:00.000Z', [H('cacheRead', [{ at: '2026-08-28T10:00:00.000Z', value: 50 }])]);
    const r = readSessionCut('sess-cut', '2026-08-28T09:00:00.000Z', { homedir: home });
    expect(r.state).toBe(STATE_CAPTURED);
    expect(r.before.cacheRead, 'un 0 légitime (coupe avant le premier point) est rendu `null`').toBe(0);
    expect(r.after.cacheRead).toBe(50);
  });

  it('coupe après le dernier point : `before` == total, `after` mesuré à 0', () => {
    const home = makeHome();
    seedCut(home, '2026-08-01T00:00:00.000Z', [H('cacheRead', [{ at: '2026-08-28T10:00:00.000Z', value: 50 }])]);
    const r = readSessionCut('sess-cut', '2026-08-28T11:00:00.000Z', { homedir: home });
    expect(r.state).toBe(STATE_CAPTURED);
    expect(r.before.cacheRead).toBe(50);
    expect(r.after.cacheRead, 'un 0 légitime (coupe après le dernier point) est rendu `null`').toBe(0);
  });

  // Coupe IMPOSSIBLE, cas 1 — instantané au format SKILL-78 (sans `history`).
  // ⚠️ Mutation : rendre `{ before: 0, after: total }` en l'absence de `history` → rouge
  // (ce serait un `before` inventé, l'exact défaut que ce ticket ferme).
  it('instantané au format SKILL-78 (sans `history`) : coupe impossible, motif propre', () => {
    const home = makeHome();
    seedCut(home, '2026-08-01T00:00:00.000Z', [
      { metric: TOKEN_METRIC, attributes: { type: 'cacheRead', query_source: 'subagent' }, value: 5000, points: 2 },
    ]);
    const r = readSessionCut('sess-cut', '2026-08-28T10:00:00.000Z', { homedir: home });
    expect(r.state).toBe(STATE_UNDETERMINED);
    expect(r.before, 'un `before` est rendu alors qu’aucune série n’est horodatée').toBeNull();
    expect(r.after).toBeNull();
    expect(r.reason).toContain(REASON_CUT_NO_HISTORY);
  });

  // Coupe IMPOSSIBLE, cas 2 — session non captée (réutilise les états de D5).
  // ⚠️ Mutation : rendre `{ before: 0, after: 0 }` pour une session non captée → rouge.
  it('session non captée : coupe impossible, motif DISTINCT du cas « sans historique »', () => {
    const home = makeHome();
    seedCut(home, '2026-08-01T00:00:00.000Z', []);
    writeTranscript(home, 'sess-cut-apres', '2026-08-20T09:00:00.000Z');
    const r = readSessionCut('sess-cut-apres', '2026-08-28T10:00:00.000Z', { homedir: home });
    expect(r.state).toBe(STATE_NOT_CAPTURED);
    expect(r.before).toBeNull();
    expect(r.after).toBeNull();
    expect(r.reason).toContain(REASON_NOT_CAPTURED);
    expect(r.reason, 'les deux motifs d’impossibilité sont confondus').not.toContain(REASON_CUT_NO_HISTORY);
  });

  // Coupe IMPOSSIBLE, cas 3 — borne illisible.
  // ⚠️ Mutation : accepter une borne non-ISO en la comparant quand même (comparaison de
  // chaînes toujours vraie) → rouge, la coupe rendrait un total plausible et faux.
  it('borne illisible : coupe impossible, motif DISTINCT des deux précédents', () => {
    const home = makeHome();
    seedCut(home, '2026-08-01T00:00:00.000Z', [H('cacheRead', [{ at: '2026-08-28T10:00:00.000Z', value: 50 }])]);
    const r = readSessionCut('sess-cut', 'ceci-n’est-pas-un-instant', { homedir: home });
    expect(r.state).toBe(STATE_UNDETERMINED);
    expect(r.before).toBeNull();
    expect(r.after).toBeNull();
    expect(r.reason).toContain(REASON_CUT_BAD_INSTANT);
    expect(r.reason).not.toContain(REASON_CUT_NO_HISTORY);
    expect(r.reason).not.toContain(REASON_NOT_CAPTURED);
  });

  // Finding SKILL-87 #2 — `Date.parse` est permissif : une forme qu'il accepte mais qui
  // n'est pas la forme EXACTE de `history[].at` romprait la comparaison de chaînes en
  // silence. ⚠️ Mutation : revenir à `Number.isNaN(Date.parse(atIso))` comme SEUL garde
  // → rouge, ces deux bornes rendraient alors `{ before: 400, after: 0 }` au lieu d'un
  // `null` + motif.
  it('borne « parseable » mais de forme différente de `history[].at` : coupe impossible', () => {
    const home = makeHome();
    seedCut(home, '2026-08-01T00:00:00.000Z', [
      H('cacheRead', [
        { at: '2026-08-28T09:00:00.000Z', value: 100 },
        { at: '2026-08-28T11:00:00.000Z', value: 300 },
      ]),
    ]);
    // (a) forme non-ISO, acceptée par `Date.parse`.
    const a = readSessionCut('sess-cut', 'Aug 28, 2026', { homedir: home });
    expect(a.state).toBe(STATE_UNDETERMINED);
    expect(a.before, 'la borne non-ISO a quand même produit une coupe').toBeNull();
    expect(a.after).toBeNull();
    expect(a.reason).toContain(REASON_CUT_BAD_INSTANT);

    // (b) même instant que `10:00Z`, mais écrit avec un décalage horaire : la
    // comparaison LEXICOGRAPHIQUE romprait sans que rien ne le signale.
    const b = readSessionCut('sess-cut', '2026-08-28T12:00:00+02:00', { homedir: home });
    expect(b.state).toBe(STATE_UNDETERMINED);
    expect(b.before, 'un décalage horaire a produit une coupe (before == total)').toBeNull();
    expect(b.after).toBeNull();
    expect(b.reason).toContain(REASON_CUT_BAD_INSTANT);
  });

  // `isStrictUtcInstant` en direct : la forme exacte passe, les voisines non.
  // ⚠️ Mutation : assouplir la regex (rendre le nombre de décimales optionnel, ou `Z`
  // facultatif) → rouge.
  it('`isStrictUtcInstant` n’accepte QUE la forme exacte `AAAA-MM-JJThh:mm:ss.sssZ`', () => {
    expect(isStrictUtcInstant('2026-08-28T10:00:00.000Z')).toBe(true);
    expect(isStrictUtcInstant('2026-08-28T10:00:00Z'), 'millisecondes optionnelles acceptées').toBe(false);
    expect(isStrictUtcInstant('2026-08-28T10:00:00.000+00:00'), 'un décalage explicite est accepté').toBe(false);
    expect(isStrictUtcInstant('Aug 28, 2026'), 'une forme non-ISO est acceptée').toBe(false);
    expect(isStrictUtcInstant(null)).toBe(false);
    expect(isStrictUtcInstant(undefined)).toBe(false);
  });

  // Rétrocompatibilité (D2) : un instantané SKILL-78 se lit EXACTEMENT comme avant sur
  // le total, coupe ou pas. ⚠️ Mutation : rendre une série vide au lieu du total lu
  // normalement → rouge — c'est le mot-à-mot de l'exigence de compatibilité ascendante.
  it('rétrocompatibilité : le total d’un instantané SKILL-78 reste lu normalement', () => {
    const home = makeHome();
    seedCut(home, '2026-08-01T00:00:00.000Z', [
      { metric: TOKEN_METRIC, attributes: { type: 'cacheRead', query_source: 'subagent' }, value: 5000, points: 2 },
    ]);
    const r = readSession('sess-cut', { homedir: home });
    expect(r.state).toBe(STATE_CAPTURED);
    expect(r.subagent.cacheRead, 'le total a été rendu vide au lieu de la valeur du format ancien').toBe(5000);
  });

  // D4 — l'attribution est ÉCRITE dans la sortie, jamais tacite.
  // ⚠️ Mutation : retirer le libellé de la sortie → rouge.
  it('le libellé de D4 est présent et nomme ce que contient `after`', () => {
    const home = makeHome();
    seedCut(home, '2026-08-01T00:00:00.000Z', [H('cacheRead', [{ at: '2026-08-28T10:00:00.000Z', value: 50 }])]);
    const r = readSessionCut('sess-cut', '2026-08-28T09:00:00.000Z', { homedir: home });
    expect(r.label).not.toBeNull();
    expect(r.label.before).toBe(CUT_LABEL_BEFORE);
    expect(r.label.after, 'le libellé ne nomme pas ce que « after » contient').toMatch(/revue/i);
    expect(r.label.after, 'le libellé n’attribue pas la passe de correction (D4)').toMatch(/correction/i);
  });

  // `cutSubagentAt` en direct : la fonction bas niveau ne regarde QUE les séries
  // `subagent` des quatre `type` documentés — `main`/`auxiliary` n'entrent jamais.
  // ⚠️ Mutation : retirer le filtre `query_source === 'subagent'` → rouge.
  it('`cutSubagentAt` ignore `main`/`auxiliary`, ne coupe que les séries `subagent`', () => {
    const doc = {
      series: [
        H('cacheRead', [{ at: '2026-08-28T10:00:00.000Z', value: 700 }]),
        {
          metric: TOKEN_METRIC,
          attributes: { type: 'cacheRead', query_source: 'main' },
          value: 9000,
          points: 1,
          history: [{ at: '2026-08-28T09:00:00.000Z', value: 9000 }],
        },
      ],
    };
    const { before, after, reason } = cutSubagentAt(doc, '2026-08-28T09:30:00.000Z');
    expect(reason).toBeNull();
    expect(before.cacheRead, 'le volume `main` a été compté dans la coupe des sous-agents').toBe(0);
    expect(after.cacheRead).toBe(700);
  });

  // ===========================================================================
  // Finding SKILL-87 #3 — le chemin CLI de `--at` (D5 : « la jointure se fait à la
  // main, en ligne de commande »), qui n'était couvert par AUCUN test.
  // ===========================================================================

  // ⚠️ Mutation : retirer le branchement `--at` de `parseArgs` → rouge.
  it('`parseArgs` reconnaît `--at <instant>` en plus du `session.id`', () => {
    const r = readParseArgs(['sess-cut', '--at', '2026-08-28T10:00:00.000Z']);
    expect(r.ok).toBe(true);
    expect(r.args).toEqual({ sessionId: 'sess-cut', at: '2026-08-28T10:00:00.000Z' });
  });

  // ⚠️ Mutation : ne pas vérifier la présence d'une valeur après `--at` (avaler le
  // token suivant en silence) → rouge — l'invariant du dépôt (jamais de token avalé).
  it('`parseArgs` refuse `--at` sans valeur, ou suivi d’un autre drapeau', () => {
    expect(readParseArgs(['sess-cut', '--at']).ok, '`--at` sans valeur est accepté').toBe(false);
    expect(readParseArgs(['sess-cut', '--at', '--autre']).ok, '`--at` avale le drapeau suivant').toBe(false);
  });

  // Sans `--at`, la sortie est INCHANGÉE (pas de champ `cut`) : la coupe est une
  // dimension EN PLUS (D3), jamais une substitution à la lecture par défaut.
  it('sans `--at`, le CLI ne rend aucun champ `cut`', () => {
    const home = makeHome();
    fs.mkdirSync(telemetryDir(home), { recursive: true });
    const out = [];
    const code = readMain(['sess-sans-borne'], { homedir: home, stdout: (s) => out.push(s), stderr: () => {} });
    expect(code).toBe(0);
    expect(JSON.parse(out.join('')).cut).toBeUndefined();
  });

  // Le point d'entrée RÉEL du ticket (D5) : `--at` sur la ligne de commande produit le
  // champ `cut` attendu, SANS toucher au reste de la sortie habituelle.
  // ⚠️ Mutation : retirer le bloc `if (parsed.args.at !== null) { result.cut = … }` de
  // `main` → rouge (`node read.mjs <sid> --at <instant>` n'émettrait plus jamais `cut`).
  it('`--at` sur la ligne de commande produit le champ `cut`, sans changer le reste', () => {
    const home = makeHome();
    seedCut(home, '2026-08-01T00:00:00.000Z', [
      H('cacheRead', [
        { at: '2026-08-28T10:00:00.000Z', value: 100 },
        { at: '2026-08-28T10:05:00.000Z', value: 300 },
      ]),
    ]);
    const out = [];
    const errs = [];
    const code = readMain(['sess-cut', '--at', '2026-08-28T10:02:00.000Z'], {
      homedir: home,
      stdout: (s) => out.push(s),
      stderr: (s) => errs.push(s),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(''));
    expect(parsed.sessionId, 'la sortie habituelle a été altérée par `--at`').toBe('sess-cut');
    expect(parsed.subagent.cacheRead, 'le total habituel a bougé à cause de `--at`').toBe(400);
    expect(parsed.cut, 'le champ `cut` est absent alors que `--at` a été passé').toBeTruthy();
    expect(parsed.cut.before.cacheRead).toBe(100);
    expect(parsed.cut.after.cacheRead).toBe(300);
    expect(parsed.cut.label.after).toContain(CUT_LABEL_AFTER);
  });

  // Le CLI refuse `--at` sans valeur — code 1, motif exploitable.
  it('le CLI refuse `--at` sans valeur (jamais de token avalé en silence)', () => {
    const home = makeHome();
    const errs = [];
    const code = readMain(['sess-cut', '--at'], { homedir: home, stdout: () => {}, stderr: (s) => errs.push(s) });
    expect(code).toBe(1);
    expect(errs.join('')).toMatch(/--at/);
  });
});

// ===========================================================================
// Cohérence de configuration — le couplage D2 ↔ D3
// ===========================================================================

describe('SKILL-78 — cohérence de la configuration de télémétrie', () => {
  // LE garde-fou du ticket : `OTEL_LOG_TOOL_DETAILS=1` n'est sûr QUE parce que logs et
  // traces sont éteints (D3). Un ticket futur qui rallumerait les logs rouvrirait en
  // silence tout ce que D3 referme.
  // ⚠️ Mutation-témoin nommée par la spec : passer `OTEL_LOGS_EXPORTER` à `otlp` en
  // laissant le drapeau → rouge.
  it('refuse `OTEL_LOG_TOOL_DETAILS=1` si logs ou traces ne sont pas `none`', () => {
    const base = { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_METRICS_INCLUDE_SESSION_ID: 'true' };
    const ok = checkTelemetrySettings({
      env: { ...base, OTEL_LOG_TOOL_DETAILS: '1', OTEL_LOGS_EXPORTER: 'none', OTEL_TRACES_EXPORTER: 'none' },
    });
    expect(ok.violations, `violations inattendues : ${JSON.stringify(ok.violations)}`).toEqual([]);

    const logs = checkTelemetrySettings({
      env: { ...base, OTEL_LOG_TOOL_DETAILS: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_TRACES_EXPORTER: 'none' },
    });
    expect(logs.violations.join(' '), 'le couplage D2 ↔ D3 ne bloque pas les logs').toMatch(/OTEL_LOGS_EXPORTER/);

    const traces = checkTelemetrySettings({
      env: { ...base, OTEL_LOG_TOOL_DETAILS: '1', OTEL_LOGS_EXPORTER: 'none', OTEL_TRACES_EXPORTER: 'otlp' },
    });
    expect(traces.violations.join(' '), 'le couplage D2 ↔ D3 ne bloque pas les traces').toMatch(/OTEL_TRACES_EXPORTER/);

    // Drapeau absent : le couplage est sans objet, pas violé.
    const sansDrapeau = checkTelemetrySettings({ env: { ...base, OTEL_LOGS_EXPORTER: 'otlp' } });
    expect(
      sansDrapeau.violations.join(' '),
      'le couplage est appliqué alors que le drapeau est absent'
    ).not.toMatch(/OTEL_LOG_TOOL_DETAILS/);
  });

  // ⚠️ Mutation : retirer `OTEL_METRICS_INCLUDE_SESSION_ID` du bloc → rouge. C'est la
  // SEULE clé de jointure avec les fiches de cycle : elle ne doit pas dépendre d'un
  // défaut en amont (D4).
  it('exige `OTEL_METRICS_INCLUDE_SESSION_ID=true`, écrit, dès que la télémétrie est allumée', () => {
    const manquant = checkTelemetrySettings({ env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1' } });
    expect(manquant.configured).toBe(true);
    expect(manquant.violations.join(' ')).toMatch(/OTEL_METRICS_INCLUDE_SESSION_ID/);

    const faux = checkTelemetrySettings({
      env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_METRICS_INCLUDE_SESSION_ID: 'false' },
    });
    expect(faux.violations.join(' ')).toMatch(/OTEL_METRICS_INCLUDE_SESSION_ID/);
  });

  // Le bloc versionné livré par ce ticket est LUI-MÊME conforme — c'est lui qu'on
  // recopie dans `settings.json`, un fichier gitignoré (SKILL-39) qu'aucun test ne
  // peut exiger.
  // ⚠️ Mutation : retirer `OTEL_LOGS_EXPORTER`/`OTEL_TRACES_EXPORTER` du bloc, ou
  // passer la temporalité en `cumulative` → rouge.
  it('le bloc `env` de référence livré par SKILL-78 est conforme', () => {
    const r = checkTelemetrySettings({ env: SETTINGS_ENV_BLOCK });
    expect(r.configured).toBe(true);
    expect(r.violations, `le bloc de référence viole son propre contrat : ${JSON.stringify(r.violations)}`).toEqual([]);
    expect(SETTINGS_ENV_BLOCK.OTEL_LOGS_EXPORTER, 'D2 : les logs doivent être éteints EXPLICITEMENT').toBe('none');
    expect(SETTINGS_ENV_BLOCK.OTEL_TRACES_EXPORTER, 'D2 : les traces doivent être éteintes EXPLICITEMENT').toBe('none');
    expect(SETTINGS_ENV_BLOCK.OTEL_METRICS_INCLUDE_SESSION_ID).toBe('true');
    expect(SETTINGS_ENV_BLOCK.OTEL_METRICS_INCLUDE_ACCOUNT_UUID, 'D4 : le compte ne doit pas être émis').toBe('false');
    expect(
      SETTINGS_ENV_BLOCK.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE,
      'D5 : la temporalité doit être écrite explicitement'
    ).toBe('delta');
    expect(
      SETTINGS_ENV_BLOCK.OTEL_METRIC_EXPORT_INTERVAL,
      'D5 : l’intervalle d’export doit être choisi, pas hérité du défaut de 60 s'
    ).toBeDefined();
    expect(Number(SETTINGS_ENV_BLOCK.OTEL_METRIC_EXPORT_INTERVAL)).toBeLessThan(60_000);
    // ⛔ `prometheus` est éliminé (D1) : son port n'est pas configurable, une seule
    // des 10–15 sessions parallèles le lierait.
    expect(SETTINGS_ENV_BLOCK.OTEL_METRICS_EXPORTER, 'l’exporteur éliminé par D1 est revenu').toBe('otlp');
    expect(SETTINGS_ENV_BLOCK.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  // `settings.json` est GITIGNORÉ (SKILL-39) : il n'existe ni dans ce worktree, ni
  // dans un clone frais. Le test ne peut donc pas exiger sa présence — mais quand il
  // est là, il DOIT respecter le couplage. C'est le garde-fou réel contre un ticket
  // futur qui rallumerait les logs sur le poste.
  // ⚠️ Mutation : écrire `OTEL_LOG_TOOL_DETAILS=1` + `OTEL_LOGS_EXPORTER=otlp` dans
  // le `settings.json` du poste → rouge.
  it('le `settings.json` du poste, s’il existe, respecte le couplage', () => {
    const live = path.join(os.homedir(), '.claude', 'settings.json');
    let parsed = null;
    let motif = null;
    try {
      parsed = JSON.parse(fs.readFileSync(live, 'utf8'));
    } catch (err) {
      motif = `settings.json non lu (${err.code || err.message}) — fichier gitignoré (SKILL-39)`;
    }
    if (parsed === null) {
      // Pas un skip silencieux : le motif est constaté, et l'absence est nommée.
      expect(motif, 'aucun motif alors que le fichier n’a pas été lu').toBeTruthy();
      return;
    }
    const r = checkTelemetrySettings(parsed);
    expect(r.violations, `settings.json du poste : ${JSON.stringify(r.violations)}`).toEqual([]);
  });

  // Le collecteur DOIT savoir dire « pas de télémétrie pour cette session » (D1).
  // ⚠️ Mutation : rendre `configured: true` par défaut → rouge.
  it('sait dire qu’aucune télémétrie n’est configurée', () => {
    expect(checkTelemetrySettings(null).configured).toBe(false);
    expect(checkTelemetrySettings({}).configured).toBe(false);
    expect(checkTelemetrySettings({ env: {} }).configured).toBe(false);
    expect(checkTelemetrySettings({ env: {} }).violations).toEqual([]);
  });
});

// ===========================================================================
// D7 — le format de la fiche de cycle NE BOUGE PAS
// ===========================================================================

describe('SKILL-78 — D7 : la fiche de cycle n’est pas touchée', () => {
  // ⛔ Le point qui rendrait un ticket futur (celui qui remplit ces deux champs)
  // dangereux : `SCHEMA_VERSION` vaut désormais `5` (SKILL-103) et
  // `SUPPORTED_SCHEMAS` de `personal-hub` l'accepte déjà — le prochain bump
  // légitime pour CE changement-ci est donc `6`, pas `5`. Le reposer à `5` sans
  // vérifier que le consommateur accepte `6` referait courir le même risque
  // (rejet en `400`, avalé en silence par `sdd-push`, et
  // `~/sdd-metrics/cycles/` n'est pas suivi par git) sous un autre numéro.
  // ⚠️ Mutation : faire écrire une valeur à `write.mjs` pour ces champs → rouge.
  it('`write.mjs` laisse les quatre `subagentCache…Tokens` à `null`', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'review-log', 'write.mjs'), 'utf8');
    expect(src).toMatch(/subagentCacheReadTokens:\s*null/);
    expect(src).toMatch(/subagentCacheCreateTokens:\s*null/);
    expect(src, '`write.mjs` importe la télémétrie — D7 est rompu').not.toMatch(/sdd-telemetry/);
  });

  // ⚠️ Mutation : passer `SCHEMA_VERSION` à autre chose que 5 dans `write.mjs`
  // → rouge. SKILL-103 a fait passer la valeur de 4 à 5, légitimement : la
  // précondition D3 (SDD-23 shipped, `personal-hub` sans `ahead`) était remplie
  // au moment du bump.
  it('le schéma de la fiche de cycle reste 5', () => {
    expect(
      SCHEMA_VERSION,
      'le schéma de la fiche de cycle a bougé — consommateur d’abord (SDD-23)'
    ).toBe(5);
  });
});
