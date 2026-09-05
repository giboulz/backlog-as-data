// SKILL-29 — écrivain de mesures (`tools/review-log/write.mjs`).
//
// Un fichier JSON par cycle de ticket dans `~/sdd-metrics`, écrit par
// l'orchestrateur à l'Étape 6.8 de `/sdd-run-ticket` (specs/skill-29.md).
//
// Tests sur des fixtures SYNTHÉTIQUES (`__tests__/fixtures/review-log/`) — jamais
// sur des transcripts réels (hors dépôt, non reproductibles). Système de fichiers,
// horloge et home sont INJECTÉS, jamais devinés : aucun test n'écrit dans un vrai
// `~/sdd-metrics`.
//
// ⚠️ Convention D3 : chaque assertion porte en commentaire la MUTATION qui doit la
// faire rougir. Le rapport final du ticket liste les mutations réellement
// appliquées et leur résultat.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect } from 'vitest';
import { extractSection, readNormalized } from './helpers/prompt-blocks.js';
import { parseSession, extractSpawns } from '../tools/review-log/baseline.mjs';
import {
  parseArgs,
  parseFindingSpec,
  resolveMetricsRoot,
  resolveTranscript,
  subagentReportedTokensByRole,
  tokensAt,
  collectTranscriptMetrics,
  extractRecordWrites,
  localSpawnPositions,
  collectConcurrency,
  verifySha,
  verifyRef,
  verifyRefReachableFromMain,
  verifyFindingRefs,
  buildRecord,
  recordPath,
  writeRecord,
  main,
  SCHEMA_VERSION,
} from '../tools/review-log/write.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'review-log');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

// Dépouillement d'une fixture en tours de conversation. AU NIVEAU MODULE, à
// côté de `readFixture` : trois `describe` en avaient chacun leur copie
// identique (gate de reprise, finding nº 4). Le jour où la lecture d'une
// fixture doit changer — normalisation CRLF, BOM, `\r` isolé —, une copie
// corrigée et deux oubliées laisseraient leurs `describe` verts sur une
// lecture différente du MÊME fichier, sans qu'aucun test ne rougisse.
function messagesOf(fixture) {
  return parseSession(readFixture(fixture));
}

const SHA40 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const FULL_ARGV = [
  '--ticket', 'SKILL-29',
  '--project', 'claude-config',
  '--repo', 'C:/Users/gibou/.claude',
  '--mode', 'cross-repo',
  '--sha', SHA40,
  '--date', '2026-08-19',
  '--model', 'opus',
  '--effort', 'high',
  '--review', 'deep',
  '--dosage', 'deep',
  '--reviewers', '3',
  '--r', '7',
  '--u', '4',
];

// argv complet privé d'UN flag (et de sa valeur).
function argvWithout(flag) {
  const out = [];
  for (let i = 0; i < FULL_ARGV.length; i += 2) {
    if (FULL_ARGV[i] === flag) continue;
    out.push(FULL_ARGV[i], FULL_ARGV[i + 1]);
  }
  return out;
}

function argvWith(overrides) {
  const out = [...FULL_ARGV];
  for (const [flag, value] of Object.entries(overrides)) {
    const i = out.indexOf(flag);
    if (i === -1) out.push(flag, value);
    else out[i + 1] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
describe('SKILL-29 — parseArgs', () => {
  // ⚠️ Mutation : rendre un champ optionnel dans FLAGS → ce test rougit sur le
  // champ disparu de l'objet rendu.
  it('arguments complets -> succès, chaque champ à sa place', () => {
    const res = parseArgs(FULL_ARGV);
    expect(res.ok, res.error).toBe(true);
    expect(res.args).toEqual({
      ticket: 'SKILL-29',
      project: 'claude-config',
      repo: 'C:/Users/gibou/.claude',
      mode: 'cross-repo',
      sha: SHA40,
      date: '2026-08-19',
      exec: { model: 'opus', effort: 'high', review: 'deep' },
      dosage: 'deep',
      reviewers: 3,
      r: 7,
      u: 4,
      findings: [],
    });
  });

  // ⚠️ Mutation : retirer `ticket` de la liste des requis → rougit (un
  // enregistrement sans ticket ne pointe en arrière vers rien).
  it('identifiant de ticket manquant -> échec citant le flag', () => {
    const res = parseArgs(argvWithout('--ticket'));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('--ticket');
  });

  // ⚠️ Mutation : défaut sur l'horloge (`--date` absent → date du jour) →
  // rougit. La date n'est JAMAIS inventée (même règle que l'outil backlog).
  it('date manquante -> échec (la date n’est jamais inventée)', () => {
    const res = parseArgs(argvWithout('--date'));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('--date');
  });

  // ⚠️ Mutation : accepter n'importe quelle forme de date → rougit.
  it('date mal formée -> échec citant la valeur reçue', () => {
    const res = parseArgs(argvWith({ '--date': '19/08/2026' }));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('19/08/2026');
  });

  // ⚠️ Mutation : retirer la validation d'énuméré du dosage → rougit.
  it('dosage hors de {none, light, deep} -> échec citant la valeur reçue', () => {
    const res = parseArgs(argvWith({ '--dosage': 'heavy' }));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('heavy');
  });

  // ⚠️ Mutation : `Number(value) || 0` à la place de la validation → rougit.
  // Une coercition silencieuse en 0 fabriquerait « des relecteurs ont cherché
  // et n'ont rien trouvé » là où le compteur est simplement illisible.
  it('r ou u non numérique -> échec, jamais une coercition silencieuse en 0', () => {
    const resR = parseArgs(argvWith({ '--r': 'sept' }));
    expect(resR.ok).toBe(false);
    expect(resR.error).toContain('sept');

    const resU = parseArgs(argvWith({ '--u': '' }));
    expect(resU.ok).toBe(false);
  });

  // ⚠️ Mutation : ignorer les flags inconnus → rougit (une valeur passée sous
  // un nom fautif serait silencieusement perdue).
  it('flag inconnu -> échec (aucune valeur inventée)', () => {
    const res = parseArgs([...FULL_ARGV, '--tokens', '12345']);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('--tokens');
  });

  // ⚠️ Mutation (gate de reprise, finding nº 6) : ajouter un flag de
  // concurrence à `STRING_FLAGS`/`NUMBER_FLAGS` (ou à toute autre liste
  // acceptée) pour « aider » l'écrivain → rougit. D2 (specs/skill-61.md) est
  // explicite : `concurrentCycles` est COMPTÉ dans le transcript, JAMAIS
  // déclaré — aucun nouvel argument de ligne de commande, précisément parce
  // qu'un orchestrateur qui se déclarerait lui-même en concurrence serait
  // l'attestation que ce dispositif de mesure évite. Non-régression de la
  // ligne de commande (§ Tests de specs/skill-61.md).
  it('un flag qui prétendrait déclarer la concurrence est refusé (D2 : rien ne se déclare)', () => {
    for (const flag of ['--concurrent-cycles', '--concurrency', '--concurrent']) {
      const res = parseArgs([...FULL_ARGV, flag, 'SKILL-49']);
      expect(res.ok, `${flag} ne devrait pas être un flag accepté`).toBe(false);
      expect(res.error).toContain(flag);
    }
  });

  // ⚠️ Mutation : ajouter un flag `tokensAtSpawn`/`tokens-at-spawn` à
  // `STRING_FLAGS`/`NUMBER_FLAGS` (ou à toute autre liste acceptée) pour
  // « aider » l'écrivain quand le transcript est introuvable → rougit. D3
  // (specs/skill-63.md) est explicite : `tokensAtSpawn` est COMPTÉ dans le
  // transcript, JAMAIS déclaré — même tranchage que `spawnIndex` (C4) et
  // `concurrentCycles` (SKILL-61 D2), et pour la même raison : un
  // orchestrateur qui déclarerait lui-même le coût de sa propre gate serait
  // l'attestation que ce dispositif évite. Non-régression de la ligne de
  // commande (§ Tests de specs/skill-63.md). Le cas générique `--tokens` de
  // la ligne 156 ne couvre PAS ce flag-là : `--tokens` et `--tokens-at-spawn`
  // sont deux littéraux distincts, un flag inconnu doit être refusé
  // NOMMÉMENT, pas par coïncidence avec un autre refus.
  it('un flag qui prétendrait déclarer tokensAtSpawn est refusé (D3 : rien ne se déclare)', () => {
    for (const flag of ['--tokens-at-spawn', '--tokensAtSpawn', '--token-at-spawn']) {
      const res = parseArgs([...FULL_ARGV, flag, '12345']);
      expect(res.ok, `${flag} ne devrait pas être un flag accepté`).toBe(false);
      expect(res.error).toContain(flag);
    }
  });

  // ⚠️ Mutation : écraser au lieu d'empiler les `--finding` → rougit.
  it('--finding répété -> un tableau dans l’ordre donné ; absent -> tableau vide', () => {
    const res = parseArgs([
      ...FULL_ARGV,
      '--finding', '1|A|corrigé|9f2c1ab|premier',
      '--finding', '2|B,C|E1||second',
    ]);
    expect(res.ok, res.error).toBe(true);
    expect(res.args.findings.map((f) => f.i)).toEqual([1, 2]);
    expect(res.args.findings[1].reviewers).toEqual(['B', 'C']);
    expect(parseArgs(FULL_ARGV).args.findings).toEqual([]);
  });

  // ⚠️ Mutation : exiger r/u en toutes circonstances → rougit. Le cycle `none`
  // est justement celui qui doit produire un enregistrement.
  it('dosage none sans r/u -> accepté (cas nominal)', () => {
    const noneArgv = [
      '--ticket', 'SKILL-29', '--project', 'claude-config',
      '--repo', 'C:/repo', '--mode', 'same-repo',
      '--sha', SHA40, '--date', '2026-08-19',
      '--model', 'sonnet', '--effort', 'none', '--review', 'none',
      '--dosage', 'none',
    ];
    const res = parseArgs(noneArgv);
    expect(res.ok, res.error).toBe(true);
    expect(res.args.r).toBeNull();
    expect(res.args.u).toBeNull();
    expect(res.args.reviewers).toBeNull();
  });

  // ⚠️ Mutation : accepter r/u absents en light/deep → rougit. Là, l'absence
  // est une omission, pas un constat.
  it('dosage light/deep sans r/u -> échec (l’absence est une omission)', () => {
    const noR = argvWithout('--r');
    expect(parseArgs(noR).ok).toBe(false);
    expect(parseArgs(noR).error).toContain('--r');

    const noU = argvWithout('--u');
    expect(parseArgs(noU).ok).toBe(false);
    expect(parseArgs(noU).error).toContain('--u');

    const noReviewers = argvWithout('--reviewers');
    expect(parseArgs(noReviewers).ok).toBe(false);
    expect(parseArgs(noReviewers).error).toContain('--reviewers');
  });

  // ⚠️ Mutation : retirer la validation d'énuméré du mode → rougit.
  it('mode hors de {same-repo, cross-repo} -> échec citant la valeur', () => {
    const res = parseArgs(argvWith({ '--mode': 'mono-repo' }));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('mono-repo');
  });

  // ⚠️ Mutation : consommer le flag suivant comme valeur → rougit.
  it('flag sans valeur -> échec, jamais la consommation du flag suivant', () => {
    const res = parseArgs(['--ticket']);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('--ticket');
  });

  // ⚠️ Mutation : remettre `--review` dans REQUIRED_FLAGS → rougit. L'Étape 2 du
  // skill pose que le champ `review` du frontmatter peut légitimement être
  // ABSENT (« les tickets historiques n'en ont pas ») : l'exiger ferait sortir
  // l'écrivain en 1 sur ces tickets-là — aucun fichier, aucune mesure, pour un
  // champ vide. Et `null` + motif garde la distinction qu'un défaut recopié
  // perdrait : « frontmatter sans review » n'est pas « review: light déclaré ».
  it('--review absent ou vide -> accepté, exec.review à null (jamais un défaut recopié)', () => {
    const sansReview = parseArgs(argvWithout('--review'));
    expect(sansReview.ok, sansReview.error).toBe(true);
    expect(sansReview.args.exec.review).toBeNull();
    expect(sansReview.args.exec.review).not.toBe('light');

    const vide = parseArgs(argvWith({ '--review': '' }));
    expect(vide.ok, vide.error).toBe(true);
    expect(vide.args.exec.review).toBeNull();

    // Les deux autres champs du triplet restent, eux, requis.
    expect(parseArgs(argvWithout('--model')).ok).toBe(false);
    expect(parseArgs(argvWithout('--effort')).ok).toBe(false);
  });

  // ⚠️ Mutation : valider `model`/`effort` contre une liste écrite en dur ici →
  // ce test rougit. Ces vocabulaires vivent dans l'outil backlog : les recopier
  // ici les ferait diverger, et une nouvelle valeur bloquerait la MESURE.
  it('model/effort/review ne sont PAS validés contre un énuméré local', () => {
    const res = parseArgs(argvWith({ '--model': 'fable', '--effort': 'xhigh', '--review': 'light' }));
    expect(res.ok, res.error).toBe(true);
    expect(res.args.exec).toEqual({ model: 'fable', effort: 'xhigh', review: 'light' });
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-29 — parseFindingSpec', () => {
  // ⚠️ Mutation : inverser l'ordre des champs (titre en premier) → rougit.
  it('spec nominale -> i, relecteurs, disposition, ref, titre', () => {
    const res = parseFindingSpec('2|A,C|corrigé|9f2c1ab|le SHA annoncé n’existe pas');
    expect(res.ok, res.error).toBe(true);
    expect(res.finding).toEqual({
      i: 2,
      title: 'le SHA annoncé n’existe pas',
      reviewers: ['A', 'C'],
      disposition: 'corrigé',
      ref: '9f2c1ab',
    });
  });

  // ⚠️ Mutation : `spec.split('|')` sans borne → rougit (le titre serait tronqué
  // à la première barre, et les champs décalés).
  it('titre contenant une barre verticale -> titre rendu ENTIER', () => {
    const res = parseFindingSpec('3|B|E1||le pipe | casse le découpage | deux fois');
    expect(res.ok, res.error).toBe(true);
    expect(res.finding.title).toBe('le pipe | casse le découpage | deux fois');
    expect(res.finding.disposition).toBe('E1');
  });

  // ⚠️ Mutation : rendre `''` au lieu de `null` → rougit. Une chaîne vide se
  // lirait comme « une référence a été donnée ».
  it('ref vide -> null, pas une chaîne vide', () => {
    const res = parseFindingSpec('3|B|E1||l’invariant n’est pas testé');
    expect(res.finding.ref).toBeNull();
    expect(res.finding.ref).not.toBe('');
  });

  // ⚠️ Mutation : retirer la validation de l'énuméré fermé → rougit.
  it('disposition hors de {corrigé, E1, E2, E3} -> échec citant la valeur', () => {
    const res = parseFindingSpec('1|A|classé sans suite||un défaut jugé mineur');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('classé sans suite');
  });

  // ⚠️ Mutation : compléter les champs manquants par des valeurs par défaut →
  // rougit.
  it('moins de 5 champs -> échec ; i non numérique -> échec', () => {
    expect(parseFindingSpec('1|A|corrigé|9f2c1ab').ok).toBe(false);
    expect(parseFindingSpec('premier|A|corrigé|9f2c1ab|titre').ok).toBe(false);
    expect(parseFindingSpec('premier|A|corrigé|9f2c1ab|titre').error).toContain('premier');
  });

  // ⚠️ Mutation : revenir à `Number.isInteger(Number(rawI))` seul → rougit.
  // `Number('')` vaut 0 et `Number.isInteger(0)` est vrai : un numéro OMIS
  // deviendrait le finding « n° 0 », qui ne désigne aucune ligne du registre —
  // et `controls.uMatchesFindings` resterait vert, le compte étant bon. C'est
  // la coercition silencieuse que cet outil refuse partout ailleurs.
  it('numéro de finding vide, nul ou négatif -> échec, jamais coercé en 0', () => {
    const empty = parseFindingSpec('|A,C|corrigé|9f2c1ab|le SHA annoncé n’existe pas');
    expect(empty.ok).toBe(false);
    expect(empty.error).toMatch(/numéro/i);

    expect(parseFindingSpec('0|A|E1||titre').ok).toBe(false);
    expect(parseFindingSpec('-3|A|E1||titre').ok).toBe(false);
    expect(parseFindingSpec(' 2 |A|E1||titre').ok).toBe(true); // les espaces restent tolérés
  });

  // ⚠️ Mutation : rendre la chaîne brute au lieu d'un tableau → rougit.
  it('un seul relecteur -> [\'A\'], jamais la chaîne \'A\'', () => {
    const res = parseFindingSpec('1|A|corrigé|9f2c1ab|titre');
    expect(res.finding.reviewers).toEqual(['A']);
    expect(res.finding.reviewers).not.toBe('A');
  });

  // ⚠️ Mutation : ne pas trimmer → rougit (« A, C » donnerait [' C']).
  it('relecteurs séparés par « , » -> trimmés', () => {
    const res = parseFindingSpec('1| A, C |corrigé|9f2c1ab|titre');
    expect(res.finding.reviewers).toEqual(['A', 'C']);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-29 — resolveMetricsRoot', () => {
  function fakeFs(entries) {
    const calls = [];
    return {
      calls,
      statSync(p) {
        calls.push(['statSync', String(p)]);
        const key = String(p).replace(/\\/g, '/');
        const entry = entries[key];
        if (!entry) {
          const err = new Error(`ENOENT: ${key}`);
          err.code = 'ENOENT';
          throw err;
        }
        return { isDirectory: () => entry === 'dir', isFile: () => entry === 'file' };
      },
      mkdirSync(p) {
        calls.push(['mkdirSync', String(p)]);
      },
    };
  }

  const HOME = 'C:/Users/gibou';

  // ⚠️ Mutation : dériver la racine d'autre chose que `<home>/sdd-metrics` →
  // rougit.
  it('<home>/sdd-metrics avec .git -> racine rendue', () => {
    const deps = { fs: fakeFs({ 'C:/Users/gibou/sdd-metrics': 'dir', 'C:/Users/gibou/sdd-metrics/.git': 'dir' }) };
    const res = resolveMetricsRoot(HOME, deps);
    expect(res.root.replace(/\\/g, '/')).toBe('C:/Users/gibou/sdd-metrics');
  });

  // ⚠️ Mutation : `mkdirSync(root, {recursive:true})` « pour aider » → rougit.
  // L'écrivain ne crée JAMAIS le dépôt de données.
  it('répertoire absent -> null + motif, et AUCUNE création', () => {
    const deps = { fs: fakeFs({}) };
    const res = resolveMetricsRoot(HOME, deps);
    expect(res.root).toBeNull();
    expect(res.reason).toMatch(/sdd-metrics/);
    expect(deps.fs.calls.filter((c) => c[0] === 'mkdirSync')).toEqual([]);
  });

  // ⚠️ Mutation : ne plus exiger `.git` → rougit (un dossier homonyme n'est pas
  // le dépôt de données).
  it('présent mais sans .git -> null + motif', () => {
    const deps = { fs: fakeFs({ 'C:/Users/gibou/sdd-metrics': 'dir' }) };
    const res = resolveMetricsRoot(HOME, deps);
    expect(res.root).toBeNull();
    expect(res.reason).toMatch(/\.git/);
    expect(deps.fs.calls.filter((c) => c[0] === 'mkdirSync')).toEqual([]);
  });

  // ⚠️ Mutation : ne pas tester `isDirectory()` → rougit.
  it('chemin existant mais fichier -> null + motif', () => {
    const deps = { fs: fakeFs({ 'C:/Users/gibou/sdd-metrics': 'file' }) };
    const res = resolveMetricsRoot(HOME, deps);
    expect(res.root).toBeNull();
    expect(res.reason).toMatch(/répertoire/i);
  });

  // ⚠️ Mutation : lire `process.env.SDD_METRICS_ROOT` (ou tout autre) → rougit.
  // D11 : « dérivé, jamais configuré ».
  it('aucune variable d’environnement n’influence le résultat', () => {
    const entries = { 'C:/Users/gibou/sdd-metrics': 'dir', 'C:/Users/gibou/sdd-metrics/.git': 'dir' };
    const before = resolveMetricsRoot(HOME, { fs: fakeFs(entries) }).root;
    const saved = {};
    for (const name of ['SDD_METRICS_ROOT', 'SDD_METRICS_DIR', 'REVIEW_LOG_ROOT']) {
      saved[name] = process.env[name];
      process.env[name] = 'D:/ailleurs';
    }
    try {
      const after = resolveMetricsRoot(HOME, { fs: fakeFs(entries) }).root;
      expect(after).toBe(before);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-29 — resolveTranscript', () => {
  const tmpDirs = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function makeProjectsRoot(layout) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill29-proj-'));
    tmpDirs.push(root);
    for (const [slug, files] of Object.entries(layout)) {
      fs.mkdirSync(path.join(root, slug), { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(root, slug, name), content);
      }
    }
    return root;
  }

  const SESSION = 'a334e39e-a56d-482b-8ff6-3704ae845b66';

  // ⚠️ Mutation : chercher `<projectsRoot>/<slug recalculé>/<id>.jsonl` →
  // rougit (le slug de ce test n'a aucun rapport avec un répertoire courant).
  it('un seul candidat -> chemin rendu, sans jamais recalculer le slug de projet', () => {
    const root = makeProjectsRoot({ 'slug-arbitraire-sans-rapport': { [`${SESSION}.jsonl`]: '{}' } });
    const res = resolveTranscript(SESSION, root);
    expect(res.path).toBe(path.join(root, 'slug-arbitraire-sans-rapport', `${SESSION}.jsonl`));
  });

  // ⚠️ Mutation : défaut sur un id vide → rougit ; le motif doit nommer la
  // variable d'environnement pour être actionnable.
  it('session id vide ou absente -> null + motif nommant CLAUDE_CODE_SESSION_ID', () => {
    const root = makeProjectsRoot({});
    for (const id of ['', undefined, null]) {
      const res = resolveTranscript(id, root);
      expect(res.path).toBeNull();
      expect(res.reason).toContain('CLAUDE_CODE_SESSION_ID');
    }
  });

  // ⚠️ Mutation : rendre un chemin « probable » non vérifié → rougit.
  it('aucun candidat -> null + motif « transcript introuvable »', () => {
    const root = makeProjectsRoot({ 'un-projet': { 'autre-session.jsonl': '{}' } });
    const res = resolveTranscript(SESSION, root);
    expect(res.path).toBeNull();
    expect(res.reason).toMatch(/introuvable/i);
  });

  // ⚠️ Mutation : prendre le PREMIER candidat rencontré → rougit.
  it('deux candidats -> le plus récemment modifié, et le motif ne prétend pas qu’il n’y en avait qu’un', () => {
    const root = makeProjectsRoot({
      'projet-ancien': { [`${SESSION}.jsonl`]: '{"a":1}' },
      'projet-recent': { [`${SESSION}.jsonl`]: '{"a":2}' },
    });
    const older = path.join(root, 'projet-ancien', `${SESSION}.jsonl`);
    const newer = path.join(root, 'projet-recent', `${SESSION}.jsonl`);
    fs.utimesSync(older, new Date('2026-08-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'));
    fs.utimesSync(newer, new Date('2026-08-19T00:00:00Z'), new Date('2026-08-19T00:00:00Z'));

    const res = resolveTranscript(SESSION, root);
    expect(res.path).toBe(newer);
    expect(res.candidates).toBe(2);
    expect(res.reason).toMatch(/2 /);
  });

  // ⚠️ Mutation : laisser remonter l'exception de readdirSync → rougit.
  it('racine des projets illisible -> null + motif, jamais d’exception', () => {
    const missing = path.join(os.tmpdir(), 'skill29-racine-inexistante-xyz');
    let res;
    expect(() => {
      res = resolveTranscript(SESSION, missing);
    }).not.toThrow();
    expect(res.path).toBeNull();
    expect(typeof res.reason).toBe('string');
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-29 — subagentReportedTokensByRole (défaut n° 3)', () => {
  const messages = parseSession(readFixture('background-cumulative-session.jsonl'));

  // ⚠️ Mutation : rattacher l'occurrence au dernier rôle vu → rougit.
  it('un résultat d’outil de relecteur est attribué à sdd-reviewer via l’identifiant d’appel', () => {
    const { byRole } = subagentReportedTokensByRole(messages);
    expect(byRole['sdd-reviewer']).toBe(5000);
  });

  // ⚠️ Mutation : ignorer `<tool-use-id>` de la notification → rougit
  // (l'implémenteur tomberait dans `unattributed`).
  it('une notification de tâche d’implémenteur est attribuée à sdd-impl-<palier>', () => {
    const { byRole } = subagentReportedTokensByRole(messages);
    expect(Object.keys(byRole)).toContain('sdd-impl-high');
  });

  // ⚠️ Mutation : `total += amount` sans déduplication par task-id → rougit
  // (475297 au lieu de 189711). C'est le défaut n° 3, mesuré à 2,13× sur le
  // corpus réel.
  it('trois notifications de la MÊME tâche (142793, 142793, 189711) -> 189711, jamais 475297', () => {
    const { byRole, total } = subagentReportedTokensByRole(messages);
    expect(byRole['sdd-impl-high']).toBe(189711);
    expect(byRole['sdd-impl-high']).not.toBe(475297);
    expect(total).toBe(189711 + 5000 + 77);
  });

  // ⚠️ Mutation : dédupliquer par `tool-use-id` au lieu de `task-id` → rougit.
  // Chaque reprise par SendMessage crée un NOUVEL identifiant d'appel : la
  // clé de déduplication doit être la tâche, pas l'appel.
  it('les notifications d’une même tâche portent des identifiants d’appel DIFFÉRENTS', () => {
    const raw = readFixture('background-cumulative-session.jsonl');
    // Les notifications de la tâche `t_impl`, et leurs identifiants d'appel.
    const implNotifs = [...raw.matchAll(/<task-id>t_impl<\/task-id>\\n<tool-use-id>([^<]+)<\/tool-use-id>/g)];
    // Une seule tâche…
    expect(implNotifs).toHaveLength(4);
    // …mais TROIS identifiants d'appel distincts pour elle.
    expect(new Set(implNotifs.map((m) => m[1])).size).toBe(3);
    // Donc dédupliquer par identifiant d'appel donnerait un total gonflé :
    const naiveByToolUse = 142793 + 142793 + 189711;
    const { byRole } = subagentReportedTokensByRole(messages);
    expect(byRole['sdd-impl-high']).toBe(189711);
    expect(byRole['sdd-impl-high']).not.toBe(naiveByToolUse);
  });

  // ⚠️ Mutation : replier les occurrences dont le rôle ne se résout pas sur le
  // dernier rôle vu (ou les jeter) → rougit. La fixture porte une notification
  // BIEN FORMÉE (elle a son `<task-id>`, c'est une vraie comptabilité) dont le
  // `<tool-use-id>` ne renvoie à aucun appel `Agent` du transcript — le cas réel
  // d'une session reprise ou compactée, où l'appel a disparu mais pas son coût.
  it('occurrence sans identifiant exploitable -> unattributed, jamais rattachée au dernier rôle vu', () => {
    const { byRole } = subagentReportedTokensByRole(messages);
    expect(byRole.unattributed).toBe(77);
    expect(byRole['sdd-reviewer']).toBe(5000); // le dernier rôle vu ne l'a pas absorbée
  });

  // ⚠️ Mutation : retirer l'exigence de marqueur d'accounting (write.mjs,
  // « Marqueur d'accounting EXIGÉ ») → rougit. La fixture porte un message
  // d'ASSISTANT qui cite un bloc `<usage>` complet en prose : aucun
  // `tool_use_id` ne permettrait de l'écarter (un assistant n'écrit pas dans un
  // `tool_result`), et sans le marqueur il entrerait dans `unattributed` — donc
  // dans `subagentReportedTokens`. Constat sur le corpus réel : 981 occurrences sur 991
  // portent `<task-id>` ou `agentId:`, et les 10 sans marqueur sont TOUTES de
  // la prose.
  it('un <usage> cité en prose par l’assistant lui-même n’est jamais compté', () => {
    const raw = readFixture('background-cumulative-session.jsonl');
    expect(raw).toContain('<subagent_tokens>999999</subagent_tokens>');
    const { total, byRole } = subagentReportedTokensByRole(messages);
    expect(total).toBe(189711 + 5000 + 77);
    expect(byRole.unattributed).not.toBe(77 + 999999);
  });

  // ⚠️ Mutation : ne garder qu'une des deux formes textuelles → rougit.
  it('les deux formes textuelles connues sont reconnues (balisée et « subagent_tokens: N »)', () => {
    const raw = readFixture('background-cumulative-session.jsonl');
    expect(raw).toContain('<subagent_tokens>189711</subagent_tokens>'); // forme balisée
    expect(raw).toContain('subagent_tokens: 5000'); // forme plate
    const { byRole } = subagentReportedTokensByRole(messages);
    expect(byRole['sdd-impl-high']).toBe(189711); // balisée
    expect(byRole['sdd-reviewer']).toBe(5000); // plate
  });

  // ⚠️ Mutation : rendre `{}` quand aucun `subagent_tokens` n'est trouvé →
  // rougit. Ici `0` est JUSTE : on a lu, il n'y avait rien.
  it('session sans aucun subagent_tokens -> tous les rôles à 0 ET un total à 0', () => {
    const none = parseSession(readFixture('mixed-agents-session.jsonl'));
    const { byRole, total } = subagentReportedTokensByRole(none);
    expect(total).toBe(0);
    expect(byRole).toEqual({
      'general-purpose': 0,
      'sdd-reviewer': 0,
      'sdd-impl-medium': 0,
      unattributed: 0,
    });
  });

  // ⚠️ Mutation : compter un rôle sans l'ajouter au total (ou l'inverse) →
  // rougit. Un rôle ne peut pas être perdu en route.
  it('réconciliation : la somme des rôles (unattributed compris) égale le total rendu', () => {
    for (const fixture of [
      'background-cumulative-session.jsonl',
      'write-cycle-session.jsonl',
      'mixed-agents-session.jsonl',
      'subagent-tokens-text-session.jsonl',
      'quoted-usage-session.jsonl',
    ]) {
      const { byRole, total } = subagentReportedTokensByRole(parseSession(readFixture(fixture)));
      const sum = Object.values(byRole).reduce((a, b) => a + b, 0);
      expect(sum, `réconciliation cassée sur ${fixture}`).toBe(total);
    }
  });

  // ⚠️ Mutation : retirer le `continue` sur un outil ordinaire (write.mjs,
  // « Sortie d'un outil ORDINAIRE ») → rougit. Un `Bash`/`Read` qui AFFICHE un
  // bloc `<usage>` — une session qui dépouille des transcripts, ou qui lit
  // simplement `write.mjs` — n'est pas une comptabilité de sous-agent : son
  // `tool_use_id` le dit sans ambiguïté. Mesuré à +58 % sur le transcript réel
  // du cycle qui a écrit ce ticket.
  it('un <usage> affiché par un outil ordinaire (Bash, Read) est ÉCARTÉ, pas compté', () => {
    const quoted = parseSession(readFixture('quoted-usage-session.jsonl'));
    const { total, byRole } = subagentReportedTokensByRole(quoted);
    expect(total).toBe(262504);
    expect(byRole).toEqual({ 'sdd-impl-high': 262504, unattributed: 0 });
    // Ni dans le total, ni dans `unattributed` : ici on SAIT d'où ça vient.
    expect(total).not.toBe(262504 + 43534 + 33129 + 999999);
    expect(byRole.unattributed).toBe(0);
  });

  // ⚠️ Mutation : retirer le saut de la clé `toolUseResult` (write.mjs,
  // `HARNESS_ECHO_KEY`) → rougit. Le harnais écrit DEUX fois la sortie d'un
  // outil dans le même enregistrement (`message.content[].tool_result` et la
  // clé racine `toolUseResult`) ; la seconde copie a perdu son `tool_use_id`,
  // prenait donc une clé `anon:` distincte et s'additionnait — invisible pour le
  // contrôle de réconciliation, qui gonfle des deux côtés à la fois.
  it('l’écho `toolUseResult` du harnais ne contourne pas la garde de contexte', () => {
    const raw = readFixture('quoted-usage-session.jsonl');
    const line = raw.split('\n').find((l) => l.includes('toolUseResult'));
    expect(line, 'la fixture ne porte plus d’écho toolUseResult').toBeDefined();
    expect([...line.matchAll(/<subagent_tokens>43534<\/subagent_tokens>/g)]).toHaveLength(2);

    // Le cas où l'écho compte VRAIMENT : un `Bash` qui dépouille un transcript
    // étranger affiche des task-notifications COMPLÈTES — marqueur inclus. La
    // copie du `tool_result` est écartée par son contexte (`Bash`), mais celle
    // de `toolUseResult` a perdu ce contexte : sans le saut de cette clé, elle
    // passe la garde et fait entrer le coût d'une AUTRE session dans la mesure.
    const dump =
      '<task-notification>\n<task-id>t_etranger</task-id>\n<tool-use-id>toolu_ailleurs</tool-use-id>\n' +
      '<usage><subagent_tokens>500000</subagent_tokens></usage>\n</task-notification>';
    const bashCall = {
      type: 'assistant',
      message: {
        role: 'assistant',
        id: 'msg_bash',
        content: [{ type: 'tool_use', id: 'toolu_bash_dump', name: 'Bash', input: { command: 'cat autre.jsonl' } }],
      },
    };
    const bashResult = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ tool_use_id: 'toolu_bash_dump', type: 'tool_result', content: [{ type: 'text', text: dump }] }],
      },
      toolUseResult: { stdout: dump, stderr: '', interrupted: false },
    };
    const { total, byRole } = subagentReportedTokensByRole([bashCall, bashResult]);
    expect(total).toBe(0);
    expect(total).not.toBe(500000);
    expect(byRole.unattributed).toBe(0);
  });

  // ⚠️ Mutation : chercher `subagent_tokens` dans TOUT le texte plutôt que dans
  // les seuls blocs `<usage>…</usage>` → rougit. Constat sur le corpus réel
  // (103 transcripts, 2026-08-19) : 988 occurrences dans un `<usage>`, 8 hors —
  // et les 8 sont de la PROSE qui décrit le format (défaut n° 1, la
  // sur-détection par relecture de prose).
  it('ne compte pas un subagent_tokens cité en prose hors d’un bloc <usage>', () => {
    const prose = parseSession(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          id: 'msg_prose',
          content: [
            {
              type: 'text',
              text: 'La forme réelle est textuelle : `subagent_tokens: 33129` ou <subagent_tokens>43534</subagent_tokens>.',
            },
          ],
        },
      })
    );
    const { total, byRole } = subagentReportedTokensByRole(prose);
    expect(total).toBe(0);
    expect(byRole.unattributed).toBe(0);
  });

  // ⚠️ Mutation : laisser remonter une exception sur une entrée non conforme →
  // rougit.
  it('entrée vide ou non conforme -> 0, jamais une exception', () => {
    expect(() => subagentReportedTokensByRole([])).not.toThrow();
    expect(subagentReportedTokensByRole([]).total).toBe(0);
    expect(subagentReportedTokensByRole(undefined).total).toBe(0);
  });

  // ⚠️ Mutation (SKILL-69, D1) : réintroduire un export `subagentTokensByRole`
  // (alias rétro-compatible de l'ancien nom, corps inchangé) → rougit. Deux
  // noms pour une quantité est exactement ce que ce renommage ferme — le
  // module entier est inspecté, pas seulement l'import nommé de ce fichier
  // (qui, lui, ne verrait jamais un export EN TROP).
  it('l’ancien nom n’est plus exporté (pas d’alias rétro-compatible)', async () => {
    const mod = await import('../tools/review-log/write.mjs');
    expect(Object.prototype.hasOwnProperty.call(mod, 'subagentTokensByRole')).toBe(false);
    expect(mod.subagentReportedTokensByRole).toBeTypeOf('function');
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-29 — cohérence avec baseline.mjs (motifs recopiés)', () => {
  // La spec exige que la reconnaissance des compteurs vive « à un seul endroit »,
  // pour que baseline et écrivain restent COMPARABLES — c'est tout l'intérêt de
  // mesurer un « après » contre un « avant ». Trois fonctions y répondent par un
  // vrai import (`parseSession`, `extractSpawns`, `summarize`), mais les deux
  // formes textuelles de `subagent_tokens` ne sont pas exportées par
  // `baseline.mjs`, et la Portée du ticket interdit de le modifier. Elles sont
  // donc RECOPIÉES — et ce test verrouille leur non-divergence sur le texte des
  // deux fichiers, faute de pouvoir la verrouiller sur une seule constante.
  //
  // ⚠️ Mutation : changer l'un des deux motifs dans UN seul des deux fichiers
  // (ex. tolérer un espace avant les deux-points, `subagent_tokens :`, côté
  // baseline seulement) → ce test rougit. Sans lui, `write.mjs` garderait son
  // ancienne copie, rendrait `null` pour toutes les occurrences plates, et
  // `subagentReportedTokens` s'effondrerait silencieusement dans chaque fichier de
  // cycle — précisément contre le baseline qu'ils doivent être comparés.
  const TOOLS_DIR = path.join(__dirname, '..', 'tools', 'review-log');
  const baselineSource = fs.readFileSync(path.join(TOOLS_DIR, 'baseline.mjs'), 'utf8');
  const writeSource = fs.readFileSync(path.join(TOOLS_DIR, 'write.mjs'), 'utf8');

  function literalOf(source, name) {
    const m = new RegExp(`const ${name} = (/.*/[gimsuy]*);`).exec(source);
    return m ? m[1] : null;
  }

  for (const name of ['SUBAGENT_TOKENS_XML_RE', 'SUBAGENT_TOKENS_PLAIN_RE']) {
    it(`${name} est identique dans baseline.mjs et write.mjs`, () => {
      const fromBaseline = literalOf(baselineSource, name);
      const fromWrite = literalOf(writeSource, name);
      expect(fromBaseline, `baseline.mjs ne déclare plus ${name}`).not.toBeNull();
      expect(fromWrite, `write.mjs ne déclare plus ${name}`).not.toBeNull();
      expect(
        fromWrite,
        `${name} a divergé entre baseline.mjs et write.mjs : les deux populations ` +
          `(baseline « avant » et enregistrements « après ») ne comptent plus la ` +
          `même chose, donc ne sont plus comparables.`
      ).toBe(fromBaseline);
    });
  }

  function stringLiteralOf(source, name) {
    const m = new RegExp(`const ${name}\\s*=\\s*'([^']*)'`).exec(source);
    return m ? m[1] : null;
  }

  // ⚠️ Mutation (gate de reprise, finding nº 7) : renommer le préfixe des
  // sous-agents implémenteurs d'un seul côté (ex. `baseline.mjs` passe à
  // `sdd-implementer-`, `write.mjs` garde `sdd-impl-`) → rougit. Sans ce
  // verrou, `localSpawnPositions` (SKILL-61) filtrerait sur un préfixe
  // périmé : elle rendrait `[]` pour CHAQUE lancement réel, la garde de
  // divergence de longueur de `collectConcurrency` se déclencherait sur
  // TOUTE session, et `concurrentCycles` deviendrait `null` partout — un
  // troisième motif recopié, aussi silencieusement cassable que les deux
  // formes de `subagent_tokens` ci-dessus.
  it('IMPLEMENTER_SUBAGENT_PREFIX est identique dans baseline.mjs et write.mjs', () => {
    const fromBaseline = stringLiteralOf(baselineSource, 'IMPLEMENTER_SUBAGENT_PREFIX');
    const fromWrite = stringLiteralOf(writeSource, 'IMPLEMENTER_SUBAGENT_PREFIX');
    expect(fromBaseline, 'baseline.mjs ne déclare plus IMPLEMENTER_SUBAGENT_PREFIX').not.toBeNull();
    expect(fromWrite, 'write.mjs ne déclare plus IMPLEMENTER_SUBAGENT_PREFIX').not.toBeNull();
    expect(
      fromWrite,
      'IMPLEMENTER_SUBAGENT_PREFIX a divergé entre baseline.mjs et write.mjs : ' +
        '`localSpawnPositions` filtrerait sur un préfixe différent de celui ' +
        "qu'utilise réellement `extractSpawns`."
    ).toBe(fromBaseline);
  });

  // ⚠️ Mutation : ré-écrire à la main la somme des `usage` dans write.mjs au
  // lieu d'importer `summarize` → rougit. La déduplication par `message.id`
  // doit exister à UN SEUL endroit (défaut n° 2).
  it('write.mjs importe parseSession / extractSpawns / summarize, il ne les réécrit pas', () => {
    expect(writeSource).toMatch(
      /import \{[^}]*parseSession[^}]*extractSpawns[^}]*summarize[^}]*\} from '\.\/baseline\.mjs'/s
    );
    expect(writeSource).not.toContain('cache_read_input_tokens');
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-29 — collectTranscriptMetrics', () => {
  // ⚠️ Mutation : prendre le premier lancement du transcript quel que soit son
  // ticket → rougit (spawnIndex 0 au lieu de 1).
  it('deux lancements de tickets différents -> le spawnIndex du ticket demandé', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.spawnIndex).toBe(1);
    const other = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-40' });
    expect(other.spawnIndex).toBe(0);
  });

  // ⚠️ Mutation : retenir le PREMIER rang correspondant → rougit. Après une
  // relance, c'est le dernier cycle qu'on enregistre.
  it('ticket lancé deux fois -> le DERNIER rang', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('relaunched-ticket-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.spawnIndex).toBe(2);
  });

  // ⚠️ Mutation : rendre `spawnIndex: 0` quand le ticket est absent → rougit.
  // Et les tokens doivent rester mesurés : les deux informations sont
  // indépendantes.
  it('ticket absent du transcript -> spawnIndex null + entrée unmeasured, tokens toujours mesurés', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-99' });
    expect(m.spawnIndex).toBeNull();
    expect(m.spawnIndex).not.toBe(0);
    expect(m.prompt).toBeNull();
    expect(m.unmeasured.map((e) => e.field)).toContain('spawnIndex');
    expect(m.unmeasured.find((e) => e.field === 'spawnIndex').reason).toMatch(/SKILL-99/);
    expect(m.tokens.output).toBe(150);
  });

  // ⚠️ Mutation : compter tout appel `Agent` dans le rang → rougit (le
  // relecteur et l'explorateur décaleraient SKILL-29 de 1 à 3).
  it('relecteurs et sous-agents ordinaires n’incrémentent PAS le rang', () => {
    const raw = readFixture('write-cycle-session.jsonl');
    expect(raw).toContain('general-purpose');
    expect(raw).toContain('sdd-reviewer');
    expect(collectTranscriptMetrics({ raw, ticket: 'SKILL-29' }).spawnIndex).toBe(1);
  });

  // ⚠️ Mutation : réimplémenter la somme des usage sans dédupliquer par
  // `message.id` → rougit (le tour msg_dup_1 serait compté 3 fois).
  it('tokens dédupliqués par message.id (fixture SKILL-30) -> total non gonflé', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('usage-duplication-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.tokens.input).toBe(2 + 5);
    expect(m.tokens.output).toBe(411 + 10);
    expect(m.tokens.cacheRead).toBe(33747 + 1);
    expect(m.tokens.cacheCreate).toBe(22952 + 2);
  });

  // ⚠️ Mutation : rendre des zéros au lieu de null sur un transcript vide →
  // rougit. Un compteur absent n'est jamais un compteur nul.
  it('contenu vide ou corrompu -> tout à null AVEC motifs, aucune exception', () => {
    for (const raw of ['', null, undefined, 'ceci n’est pas du JSONL']) {
      let m;
      expect(() => {
        m = collectTranscriptMetrics({ raw, ticket: 'SKILL-29' });
      }).not.toThrow();
      expect(m.spawnIndex).toBeNull();
      expect(m.prompt).toBeNull();
      expect(m.tokens).toBeNull();
      expect(m.messageCount).toBeNull();
      expect(m.concurrentCycles).toBeNull();
      const fields = m.unmeasured.map((e) => e.field);
      expect(fields).toEqual(
        expect.arrayContaining([
          'spawnIndex',
          'prompt',
          'tokens',
          'session.messageCount',
          'concurrentCycles',
        ])
      );
      for (const entry of m.unmeasured) expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  // ⚠️ Mutation : rendre `tokens: {input: 0, …}` quand aucun bloc `usage`
  // n'existe → rougit. On a lu des messages mais pas un seul `usage` : c'est
  // une mesure absente, pas une mesure nulle.
  it('messages présents mais aucun bloc usage -> tokens null + motif', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('corrupted-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.messageCount).toBe(2);
    expect(m.tokens).toBeNull();
    expect(m.unmeasured.map((e) => e.field)).toContain('tokens');
    // ⚠️ Mutation (SKILL-69, D2) : pousser quand même les entrées
    // `tokens.subagentCacheReadTokens`/`tokens.subagentCacheCreateTokens` ici
    // → rougit. `tokens: null` porte DÉJÀ l'entrée `tokens` : en ajouter deux
    // de plus pour ce qu'il exclut déclarerait deux fois la même absence.
    expect(m.unmeasured.filter((e) => e.field === 'tokens')).toHaveLength(1);
    expect(m.unmeasured.map((e) => e.field)).not.toContain('tokens.subagentCacheReadTokens');
    expect(m.unmeasured.map((e) => e.field)).not.toContain('tokens.subagentCacheCreateTokens');
  });

  // ⚠️ Mutation : recalculer la longueur du prompt (ou la présence des
  // sections) au lieu de reprendre `extractSpawns` → rougit.
  it('prompt.length et prompt.sections repris d’extractSpawns, sans réinterprétation', () => {
    const raw = readFixture('write-cycle-session.jsonl');
    const messages = parseSession(raw);
    const spawnBlock = messages[5].message.content[0];
    const m = collectTranscriptMetrics({ raw, ticket: 'SKILL-29' });
    expect(m.prompt.length).toBe(spawnBlock.input.prompt.length);
    expect(m.prompt.sections['## Étape 0']).toBe(true);
    expect(m.prompt.sections['## Étape 0.5']).toBe(true);
    expect(m.prompt.sections['## Discipline SDD']).toBe(true);
    expect(m.prompt.sections['## Garde-fous génériques']).toBe(false);
  });

  // ⚠️ Mutation : reprendre le `subagentReportedTokens` de `summarize` (somme naïve) →
  // rougit : 60000 + 4000 en somme naïve DOUBLERAIT si le transcript répétait
  // la notification ; ici on vérifie surtout que le compteur par rôle est celui
  // qui alimente l'enregistrement.
  it('tokens.subagentReportedTokensByRole accompagne le total, et le total est celui par rôle', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.tokens.subagentReportedTokensByRole).toEqual({
      'sdd-impl-medium': 0,
      'general-purpose': 0,
      'sdd-reviewer': 4000,
      'sdd-impl-high': 60000,
      unattributed: 0,
    });
    expect(m.tokens.subagentReportedTokens).toBe(64000);
    expect(m.tokens.scope).toBe('session-to-date');
  });

  // ⚠️ Mutation : compter les lignes du fichier plutôt que les tours de
  // conversation → rougit (la queue-operation serait comptée).
  it('messageCount ne compte que les vrais tours de conversation', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.messageCount).toBe(7);
  });

  // ⚠️ Mutation : oublier `concurrentCycles` dans le retour de
  // `collectTranscriptMetrics` → rougit. SKILL-40 n'est jamais écrit dans cette
  // fixture : son intervalle reste ouvert, donc concurrent de tout lancement
  // postérieur, y compris SKILL-29.
  it('concurrentCycles accompagne les autres mesures du transcript', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.concurrentCycles).toEqual([{ ticket: 'SKILL-40', spawnIndex: 0 }]);
  });

  // ⚠️ Mutation : rendre `[]` au lieu de `null` quand le lancement du ticket
  // demandé est introuvable → rougit (compteur absent ≠ compteur nul, SKILL-29).
  it('ticket absent du transcript -> concurrentCycles null + entrée unmeasured', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-99' });
    expect(m.concurrentCycles).toBeNull();
    expect(m.unmeasured.map((e) => e.field)).toContain('concurrentCycles');
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-63 — tokensAt(messages, endIndex, scope)', () => {
  const messages = parseSession(readFixture('write-cycle-session.jsonl'));

  // ⚠️ Mutation (assertion de non-régression du refactor) : faire diverger
  // `tokensAt` du calcul historique de `tokens` (ex. réintroduire
  // `summary.tokens.subagentReportedTokens`, la somme naïve) → rougit. C'est cette
  // assertion qui prouve que la factorisation n'a pas changé le calcul.
  it('sur la liste entière, rend exactement ce que rend le bloc `tokens` d’aujourd’hui', () => {
    const full = tokensAt(messages, messages.length - 1, 'session-to-date');
    expect(full).toEqual({
      scope: 'session-to-date',
      input: 13,
      output: 150,
      cacheRead: 1500,
      cacheCreate: 27,
      subagentReportedTokens: 64000,
      subagentReportedTokensByRole: {
        'sdd-impl-medium': 0,
        'general-purpose': 0,
        'sdd-reviewer': 4000,
        'sdd-impl-high': 60000,
        unattributed: 0,
      },
      // ⚠️ Mutation (SKILL-69, D2) : rendre `0` au lieu de `null` pour l'un des
      // deux → rougit. C'est l'assertion qui porte tout le ticket : le contexte
      // relu des sous-agents n'est pas mesuré, ce n'est pas mesuré à zéro.
      subagentCacheReadTokens: null,
      subagentCacheCreateTokens: null,
    });
  });

  // ⚠️ Mutation : ignorer `endIndex` et toujours prendre la liste entière →
  // rougit (les compteurs sont cumulatifs, un préfixe rend forcément moins).
  it('sur un préfixe, rend MOINS que sur la liste entière, champ par champ', () => {
    const prefix = tokensAt(messages, 1, 'session-to-spawn'); // jusqu’au lancement de SKILL-40 inclus
    const full = tokensAt(messages, messages.length - 1, 'session-to-date');
    expect(prefix.input).toBeLessThan(full.input);
    expect(prefix.output).toBeLessThan(full.output);
    expect(prefix.cacheRead).toBeLessThan(full.cacheRead);
    expect(prefix.cacheCreate).toBeLessThan(full.cacheCreate);
    expect(prefix.subagentReportedTokens).toBeLessThan(full.subagentReportedTokens);
  });

  // D2 — borne INCLUSIVE : le message qui porte le `tool_use` de spawn29
  // (messages[5]) a un `usage` non nul (input 3) ; il DOIT être compté.
  // ⚠️ Mutation qui doit rougir : passer `endIndex - 1` (borne exclusive) —
  // `input` vaudrait alors 10 au lieu de 13.
  it('borne inclusive : le message qui porte le tool_use du lancement est compté', () => {
    const inclusive = tokensAt(messages, 5, 'x');
    const exclusive = tokensAt(messages, 4, 'x');
    expect(inclusive.input).toBe(13); // 10 (spawn40) + 3 (spawn29 lui-même)
    expect(exclusive.input).toBe(10); // spawn29 pas encore compté
  });

  // ⚠️ Mutation : reprendre `summary.tokens.subagentReportedTokens` (somme naïve) au
  // lieu du total par rôle → rougit.
  //
  // `write-cycle-session.jsonl` ne peut PAS servir ici : la somme naïve et le
  // total par rôle y valent tous deux 64000 (aucune notification répétée), et
  // `expect(x).toBe(byRoleTotal)` calculé depuis LE MÊME objet est de toute
  // façon tautologique (`byRole` réconcilie déjà `Σ byRole === total` par
  // construction — write.mjs:551-556). Il faut une fixture où la tâche de
  // fond notifie PLUSIEURS FOIS le même `task-id` (le harnais le fait POUR
  // de vrai : « the same task-id may notify more than once », en reportant à
  // chaque fois le TOTAL COURANT) : `subagent-tokens-naive-divergence-session.jsonl`
  // porte trois notifications (50000, 90000, 120000) pour le MÊME `task-id` —
  // la somme naïve (260000) et le total dédupliqué (120000, la DERNIÈRE
  // valeur) divergent réellement, et seule la seconde est correcte.
  it('subagentReportedTokens est la valeur de subagentReportedTokensByRole, pas la somme naïve — sur un transcript où les deux DIVERGENT réellement', () => {
    const divergent = parseSession(readFixture('subagent-tokens-naive-divergence-session.jsonl'));
    const result = tokensAt(divergent, divergent.length - 1, 'session-to-date');
    expect(result.subagentReportedTokens).toBe(120000); // dédupliqué : la dernière notification du task-id
    expect(result.subagentReportedTokens).not.toBe(260000); // somme naïve des 3 notifications (défaut n° 3)
  });

  // ⚠️ Mutation : rendre un bloc de zéros au lieu de `null` quand le préfixe
  // ne porte aucun `usage` → rougit.
  it('préfixe sans aucun bloc usage -> null, jamais un bloc de zéros', () => {
    // Les deux premiers messages de no-spawn-session.jsonl : un `user` (pas de
    // `usage`) et un `Bash` sans `usage`.
    const noUsageMessages = parseSession(readFixture('no-spawn-session.jsonl'));
    expect(tokensAt(noUsageMessages, noUsageMessages.length - 1, 'x')).toBeNull();
  });

  // ⚠️ Mutation : laisser `endIndex` négatif ou hors bornes lever une
  // exception (ou lire hors tableau) → rougit.
  it('endIndex à 0, négatif, ou au-delà de la longueur : aucune exception, comportement défini', () => {
    expect(() => tokensAt(messages, 0, 'x')).not.toThrow();
    expect(tokensAt(messages, 0, 'x')).toBeNull(); // messages[0] est un `user` sans usage

    expect(() => tokensAt(messages, -1, 'x')).not.toThrow();
    expect(tokensAt(messages, -1, 'x')).toBeNull(); // préfixe vide

    // ⚠️ Mutation (gate de reprise, finding nº 5) : retirer `Math.max(requested, -1)`
    // (ne garder que le clamp haut) → rougit SEULEMENT sur cette plage. `-1` et
    // `-100` restent `null` même SANS ce clamp bas (`Array.slice` a sa propre
    // sémantique d'index négatif qui, par coïncidence, redonne `[]` pour ces
    // deux valeurs précises sur ce transcript de 8 entrées) — `-1` retombe
    // pile sur `slice(0, 0)`, et `-100` est assez négatif pour que `slice`
    // reclampe tout seul à `0`. Seule la plage `-(messages.length - 1) … -2`
    // distingue « borné à -1 » de « jamais borné » : sans le clamp,
    // `slice(0, -2 + 1)` vaut `slice(0, -1)`, qui retient les 7 PREMIERS
    // messages (tout sauf le dernier) — non vide, donc PAS `null`.
    expect(() => tokensAt(messages, -2, 'x')).not.toThrow();
    expect(tokensAt(messages, -2, 'x')).toBeNull(); // préfixe vide, PAS "tout sauf le dernier message"

    expect(() => tokensAt(messages, -(messages.length - 1), 'x')).not.toThrow();
    expect(tokensAt(messages, -(messages.length - 1), 'x')).toBeNull(); // idem, à l'autre bout de la plage non couverte

    expect(() => tokensAt(messages, -100, 'x')).not.toThrow();
    expect(tokensAt(messages, -100, 'x')).toBeNull();

    expect(() => tokensAt(messages, 10000, 'session-to-date')).not.toThrow();
    expect(tokensAt(messages, 10000, 'session-to-date')).toEqual(
      tokensAt(messages, messages.length - 1, 'session-to-date')
    ); // clampé à la liste entière
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-63 — collectTranscriptMetrics.tokensAtSpawn', () => {
  // D2 — même mutation que ci-dessus, vue depuis l’API publique : passer
  // `slice(0, position)` (exclusif) ferait chuter `input` à 10.
  it('la borne est inclusive : le tokensAtSpawn de SKILL-29 compte le message de son propre lancement', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.tokensAtSpawn).toEqual({
      scope: 'session-to-spawn',
      input: 13,
      output: 150,
      cacheRead: 1500,
      cacheCreate: 27,
      subagentReportedTokens: 0,
      subagentReportedTokensByRole: {
        'sdd-impl-medium': 0,
        'general-purpose': 0,
        'sdd-reviewer': 0,
        'sdd-impl-high': 0,
        unattributed: 0,
      },
      subagentCacheReadTokens: null,
      subagentCacheCreateTokens: null,
    });
  });

  // ⚠️ Mutation : retenir le PREMIER lancement au lieu du dernier → rougit
  // (tokensAtSpawn serait mesuré trop tôt, donc plus petit).
  it('le lancement retenu est le DERNIER du ticket : deux lancements -> tokensAtSpawn mesuré au second, plus grand qu’au premier', () => {
    const raw = readFixture('tokens-at-spawn-relaunch-session.jsonl');
    const messages = parseSession(raw);
    const spawns = extractSpawns(messages);
    expect(spawns).toHaveLength(2);

    const m = collectTranscriptMetrics({ raw, ticket: 'SKILL-63B' });
    // Second lancement (messages[3]) : 5 + 7 + 3 = 15.
    expect(m.tokensAtSpawn.input).toBe(15);
    // Premier lancement (messages[1] seul) : 5. Vérifié en calculant
    // directement via tokensAt, pour prouver que le second est bien PLUS
    // GRAND que le premier — pas juste une valeur en dur.
    const firstSpawnOnly = tokensAt(messages, 1, 'session-to-spawn');
    expect(m.tokensAtSpawn.input).toBeGreaterThan(firstSpawnOnly.input);
  });

  // Invariant D2/Tests : `tokensAtSpawn[c] ≤ tokens[c]` pour les 5 compteurs,
  // sur toute fixture où les deux sont mesurés — jamais un exemple isolé.
  //
  // ⚠️ `write-cycle-session.jsonl` et `tokens-at-spawn-relaunch-session.jsonl`
  // ne portent AUCUN bloc `usage` après le lancement retenu : `input`,
  // `output`, `cacheRead` et `cacheCreate` y sont des égalités `x ≤ x`, qui ne
  // peuvent distinguer une mesure correcte d'une mesure prise au mauvais
  // endroit. `tokens-at-spawn-post-usage-session.jsonl` porte un tour de gate
  // (l'orchestrateur, APRÈS le lancement, avant le retour du sous-agent) : les
  // quatre compteurs de session y sont STRICTEMENT supérieurs dans `tokens`,
  // exactement le « coût de la gate à l'orchestrateur » du § Problème n° 1.
  // ⚠️ Mutation qui doit rougir : calculer les quatre compteurs de session sur
  // la liste ENTIÈRE et ne garder le préfixe que pour `subagentReportedTokens` — la
  // dernière assertion (stricte) le détecterait alors que la boucle `≤` seule
  // resterait verte.
  it('cohérence des deux blocs : tokensAtSpawn ≤ tokens, champ par champ — et STRICTEMENT inférieur quand un tour suit le lancement', () => {
    for (const [fixture, ticket] of [
      ['write-cycle-session.jsonl', 'SKILL-29'],
      ['tokens-at-spawn-relaunch-session.jsonl', 'SKILL-63B'],
      ['tokens-at-spawn-post-usage-session.jsonl', 'SKILL-63G'],
    ]) {
      const raw = readFixture(fixture);
      const m = collectTranscriptMetrics({ raw, ticket });
      expect(m.tokens).not.toBeNull();
      expect(m.tokensAtSpawn).not.toBeNull();
      for (const field of ['input', 'output', 'cacheRead', 'cacheCreate', 'subagentReportedTokens']) {
        expect(m.tokensAtSpawn[field]).toBeLessThanOrEqual(m.tokens[field]);
      }
    }

    const post = collectTranscriptMetrics({
      raw: readFixture('tokens-at-spawn-post-usage-session.jsonl'),
      ticket: 'SKILL-63G',
    });
    for (const field of ['input', 'output', 'cacheRead', 'cacheCreate', 'subagentReportedTokens']) {
      expect(post.tokensAtSpawn[field]).toBeLessThan(post.tokens[field]);
    }
  });

  // D4, ligne 1 : aucun lancement pour ce ticket -> null + entrée unmeasured,
  // et `spawnIndex` déjà `null` — UNE SEULE entrée par champ.
  it('aucun lancement pour ce ticket -> tokensAtSpawn null + entrée unmeasured, motif partagé avec spawnIndex', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-99' });
    expect(m.spawnIndex).toBeNull();
    expect(m.tokensAtSpawn).toBeNull();
    const spawnIndexEntry = m.unmeasured.find((e) => e.field === 'spawnIndex');
    const tokensAtSpawnEntry = m.unmeasured.find((e) => e.field === 'tokensAtSpawn');
    expect(tokensAtSpawnEntry, 'aucune entrée `unmeasured` pour `tokensAtSpawn`').toBeDefined();
    expect(tokensAtSpawnEntry.reason).toBe(spawnIndexEntry.reason);
    expect(m.unmeasured.filter((e) => e.field === 'tokensAtSpawn')).toHaveLength(1);

    // SKILL-69, D2 — cas croisé exigé par les Tests : `tokens` mesuré et
    // `tokensAtSpawn: null` (aucun lancement pour ce ticket) → les deux
    // entrées de `tokens` sont présentes, celles de `tokensAtSpawn` sont
    // absentes (une seule entrée `tokensAtSpawn`, vérifié ci-dessus), c'est la
    // bijection null/unmeasured qui attrape ce cas.
    expect(m.tokens).not.toBeNull();
    const fields = m.unmeasured.map((e) => e.field);
    expect(fields).toContain('tokens.subagentCacheReadTokens');
    expect(fields).toContain('tokens.subagentCacheCreateTokens');
    expect(fields).not.toContain('tokensAtSpawn.subagentCacheReadTokens');
    expect(fields).not.toContain('tokensAtSpawn.subagentCacheCreateTokens');
  });

  // D4, ligne 3 : aucun bloc `usage` avant le lancement (mais `tokens`, lui,
  // peut rester lui aussi non mesuré — les deux motifs restent DISTINCTS).
  it('aucun bloc usage avant le lancement -> tokensAtSpawn null + motif dédié, distinct de celui de `tokens`', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('relaunched-ticket-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.tokens).toBeNull();
    expect(m.tokensAtSpawn).toBeNull();
    const tokensEntry = m.unmeasured.find((e) => e.field === 'tokens');
    const tokensAtSpawnEntry = m.unmeasured.find((e) => e.field === 'tokensAtSpawn');
    expect(tokensAtSpawnEntry.reason).toBe('aucun bloc usage avant le lancement');
    expect(tokensEntry.reason).not.toBe(tokensAtSpawnEntry.reason);
  });

  // D4 : `tokens` mesuré et `tokensAtSpawn` à `null` est un état NORMAL, pas
  // une incohérence — les deux échecs ne se contaminent pas l’un l’autre.
  it('tokens mesuré et tokensAtSpawn à null : les deux échecs ne se contaminent pas', () => {
    // Fixture synthétique locale : un lancement de SKILL-63C SANS aucun bloc
    // `usage` avant lui, suivi d’un tour qui, lui, en porte un (donc `tokens`
    // global est mesuré, mais pas `tokensAtSpawn`).
    const raw = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'lance SKILL-63C' } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'm1',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Agent',
              input: { subagent_type: 'sdd-impl-medium', description: 'SDD SKILL-63C', prompt: 'ticket SKILL-63C' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'm2',
          role: 'assistant',
          content: [{ type: 'text', text: 'lancé.' }],
          usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 },
        },
      }),
    ].join('\n');
    const m = collectTranscriptMetrics({ raw, ticket: 'SKILL-63C' });
    expect(m.tokens).not.toBeNull();
    expect(m.tokensAtSpawn).toBeNull();
    expect(m.unmeasured.map((e) => e.field)).toContain('tokensAtSpawn');
  });

  // D1 (specs/skill-63.md) : « même forme EXACTEMENT, pour que la soustraction
  // champ à champ soit évidente ». Le relecteur (SKILL-63E) est lancé APRÈS
  // l'implémenteur (cas nominal de `/sdd-run-ticket` : Étape 4 puis 6.3) — son
  // rôle doit quand même apparaître, à `0`, dans `tokensAtSpawn.subagentReportedTokensByRole`,
  // sans quoi `tokens[r] - tokensAtSpawn[r]` vaudrait `NaN` pour ce rôle.
  // ⚠️ Mutation qui doit rougir : seeder `byRole` depuis le PRÉFIXE plutôt que
  // depuis la liste entière (revenir à `subagentReportedTokensByRole(prefix)` sans le
  // second argument) — `sdd-reviewer` disparaîtrait de `tokensAtSpawn.subagentReportedTokensByRole`.
  it('les deux blocs partagent EXACTEMENT le même jeu de clés dans subagentReportedTokensByRole, même quand un rôle n’est appelé qu’après le lancement', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('tokens-at-spawn-role-after-session.jsonl'), ticket: 'SKILL-63E' });
    expect(m.tokens.subagentReportedTokensByRole).toEqual({
      unattributed: 0,
      'sdd-impl-medium': 400000,
      'sdd-reviewer': 30000,
    });
    expect(m.tokensAtSpawn.subagentReportedTokensByRole).toEqual({
      unattributed: 0,
      'sdd-impl-medium': 0,
      'sdd-reviewer': 0,
    });
    const tokensKeys = Object.keys(m.tokens.subagentReportedTokensByRole).sort();
    const spawnKeys = Object.keys(m.tokensAtSpawn.subagentReportedTokensByRole).sort();
    expect(spawnKeys).toEqual(tokensKeys);
    // La soustraction champ à champ que D1 promet ne doit jamais produire NaN.
    for (const role of tokensKeys) {
      const delta = m.tokens.subagentReportedTokensByRole[role] - m.tokensAtSpawn.subagentReportedTokensByRole[role];
      expect(Number.isNaN(delta), `delta NaN pour le rôle ${role}`).toBe(false);
    }
    expect(m.tokens.subagentReportedTokensByRole['sdd-reviewer'] - m.tokensAtSpawn.subagentReportedTokensByRole['sdd-reviewer']).toBe(30000);
  });

  // ⚠️ Mutation : écrire `"session-to-date"` (au lieu de `"session-to-spawn"`)
  // sur `tokensAtSpawn.scope` → rougit.
  it('scope vaut "session-to-spawn", jamais "session-to-date"', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.tokensAtSpawn.scope).toBe('session-to-spawn');
    expect(m.tokensAtSpawn.scope).not.toBe('session-to-date');
  });

  // Invariant déjà posé pour les autres champs (D1), étendu à celui-ci :
  // aucun `null` sans entrée correspondante dans `unmeasured`.
  it('aucun null sans entrée unmeasured — étendu à tokensAtSpawn', () => {
    for (const [fixture, ticket] of [
      ['write-cycle-session.jsonl', 'SKILL-99'],
      ['relaunched-ticket-session.jsonl', 'SKILL-29'],
    ]) {
      const m = collectTranscriptMetrics({ raw: readFixture(fixture), ticket });
      if (m.tokensAtSpawn === null) {
        expect(m.unmeasured.map((e) => e.field)).toContain('tokensAtSpawn');
      }
    }
  });

  // SKILL-69, D2 : « aucun doublon d'entrée pour un même field, sur toutes les
  // fixtures du groupe » — balayage large, pas un exemple isolé.
  // ⚠️ Mutation : pousser une entrée `tokens.subagentCacheReadTokens` deux fois
  // (ex. une fois inconditionnellement, une fois dans la branche `else`) →
  // rougit.
  it('aucun doublon d’entrée unmeasured pour un même field, sur un large jeu de fixtures', () => {
    for (const [fixture, ticket] of [
      ['write-cycle-session.jsonl', 'SKILL-29'],
      ['write-cycle-session.jsonl', 'SKILL-99'],
      ['relaunched-ticket-session.jsonl', 'SKILL-29'],
      ['corrupted-session.jsonl', 'SKILL-29'],
      ['no-spawn-session.jsonl', 'SKILL-29'],
      ['tokens-at-spawn-relaunch-session.jsonl', 'SKILL-63B'],
      ['tokens-at-spawn-post-usage-session.jsonl', 'SKILL-63G'],
      ['tokens-at-spawn-role-after-session.jsonl', 'SKILL-63E'],
    ]) {
      const m = collectTranscriptMetrics({ raw: readFixture(fixture), ticket });
      const fields = m.unmeasured.map((e) => e.field);
      expect(fields.length, `doublon sur ${fixture}/${ticket}`).toBe(new Set(fields).size);
    }
  });

  // SKILL-69, D2, § Tests : « motifs non vides et IDENTIQUES à ceux de
  // `tokensAtSpawn` — ⚠️ mutation : deux motifs recopiés qui divergent d'un mot
  // doivent rougir. » `tokens-at-spawn-post-usage-session.jsonl` est la seule
  // fixture du groupe où `tokens` ET `tokensAtSpawn` sont TOUS DEUX mesurés :
  // c'est la seule où les quatre entrées coexistent et où une divergence de
  // motif entre les deux blocs serait observable.
  it('les motifs des quatre entrées subagentCache… sont non vides et rigoureusement identiques entre eux', () => {
    const m = collectTranscriptMetrics({
      raw: readFixture('tokens-at-spawn-post-usage-session.jsonl'),
      ticket: 'SKILL-63G',
    });
    expect(m.tokens).not.toBeNull();
    expect(m.tokensAtSpawn).not.toBeNull();
    const byField = Object.fromEntries(m.unmeasured.map((e) => [e.field, e.reason]));
    const reasons = [
      byField['tokens.subagentCacheReadTokens'],
      byField['tokens.subagentCacheCreateTokens'],
      byField['tokensAtSpawn.subagentCacheReadTokens'],
      byField['tokensAtSpawn.subagentCacheCreateTokens'],
    ];
    for (const reason of reasons) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    }
    expect(new Set(reasons).size, 'les quatre motifs doivent être un seul et même texte').toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-61 — extractRecordWrites', () => {
  // ⚠️ Mutation : ne relever que `node` OU `write.mjs` seul → rougit sur les
  // cas voisins ci-dessous (le piège mesuré, et le --ticket sans invocation).
  it('une commande node invoquant write.mjs avec --ticket -> une entrée, ticketId et position croissante', () => {
    const writes = extractRecordWrites(messagesOf('record-writes-session.jsonl'));
    expect(writes[0]).toEqual({ ticketId: 'SKILL-48', at: 0 });
    expect(writes.map((w) => w.at)).toEqual([...writes.map((w) => w.at)].sort((a, b) => a - b));
  });

  // ⚠️ Mutation : compter une mention nue de `write.mjs` comme une invocation
  // → rougit. Le cas mesuré ligne 754 (§ Problème) : un `grep` qui cite le
  // fichier n'invoque rien.
  it('mention nue de write.mjs (grep) -> aucune entrée', () => {
    const writes = extractRecordWrites(messagesOf('record-writes-session.jsonl'));
    expect(writes.some((w) => w.ticketId === undefined)).toBe(false);
    expect(writes).toHaveLength(3);
  });

  // ⚠️ Mutation : accepter une invocation sans `--ticket` → rougit (et ne doit
  // jamais lever d'exception).
  it('node …/write.mjs sans --ticket -> aucune entrée, aucune exception', () => {
    expect(() => extractRecordWrites(messagesOf('record-writes-session.jsonl'))).not.toThrow();
    const writes = extractRecordWrites(messagesOf('record-writes-session.jsonl'));
    expect(writes.filter((w) => w.ticketId === 'SKILL-48')).toHaveLength(2); // pas 3
  });

  // ⚠️ Mutation : matcher `--ticket SKILL-48` seul, sans exiger l'invocation →
  // rougit (une commande qui ne fait que CITER le flag serait comptée).
  it('--ticket SKILL-48 sans invoquer l’écrivain -> aucune entrée', () => {
    const writes = extractRecordWrites(messagesOf('record-writes-session.jsonl'));
    // La commande "echo … --ticket SKILL-48 …" (msg_rw_4) ne doit produire
    // aucune entrée à la position qui lui correspond (position 3).
    expect(writes.some((w) => w.at === 3)).toBe(false);
  });

  // ⚠️ Mutation : ignorer les `tool_use` `PowerShell` → rougit.
  it('un tool_use PowerShell invoquant l’écrivain est compté comme un Bash', () => {
    const writes = extractRecordWrites(messagesOf('record-writes-session.jsonl'));
    expect(writes).toContainEqual({ ticketId: 'SKILL-50', at: 4 });
  });

  // ⚠️ Mutation : dédupliquer par ticket au lieu de garder chaque invocation →
  // rougit (une relance doit produire DEUX entrées, dans l'ordre).
  it('deux invocations pour le même ticket (relance) -> deux entrées, dans l’ordre', () => {
    const writes = extractRecordWrites(messagesOf('record-writes-session.jsonl'));
    const forSkill48 = writes.filter((w) => w.ticketId === 'SKILL-48');
    expect(forSkill48).toEqual([
      { ticketId: 'SKILL-48', at: 0 },
      { ticketId: 'SKILL-48', at: 5 },
    ]);
  });

  // ⚠️ Mutation : matcher sur le TEXTE plutôt que sur l'outil ET la forme →
  // rougit. Un `Grep` dont le motif est la citation exacte d'une invocation
  // n'est pas une invocation.
  it('un tool_use Grep dont l’entrée contient le texte d’une invocation -> aucune entrée', () => {
    const writes = extractRecordWrites(messagesOf('record-writes-session.jsonl'));
    expect(writes.some((w) => w.at === 6)).toBe(false);
    expect(writes).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-61 — collectConcurrency', () => {
  // ⚠️ Mutation : déclarer B concurrent de A malgré l'écriture de A avant le
  // lancement de B → rougit.
  it('session séquentielle (lancement A, écriture A, lancement B) -> pour B, []', () => {
    const result = collectConcurrency(messagesOf('concurrency-sequential-session.jsonl'), 'SKILL-71');
    expect(result).toEqual({ concurrentCycles: [], reason: null });
  });

  // ⚠️ Mutation : ne détecter la concurrence que par inversion (comme
  // `personal-hub`) → rougit. Ici l'ordre des écritures suit l'ordre des
  // lancements (48 puis 49) et les deux doivent quand même se déclarer.
  it('cas sans inversion (lancements 48,49 puis écritures 48,49) -> les DEUX se déclarent mutuellement', () => {
    const messages = messagesOf('concurrency-no-inversion-session.jsonl');
    expect(collectConcurrency(messages, 'SKILL-48').concurrentCycles).toEqual([
      { ticket: 'SKILL-49', spawnIndex: 1 },
    ]);
    expect(collectConcurrency(messages, 'SKILL-49').concurrentCycles).toEqual([
      { ticket: 'SKILL-48', spawnIndex: 0 },
    ]);
  });

  // ⚠️ Mutation : ne déclarer qu'un seul des deux autres (au lieu des deux) →
  // rougit. Chacun des trois lancements de la vague déclare les deux autres.
  it('vague de trois (41, BLG-07, 42 lancés avant toute écriture) -> chacun déclare les deux autres', () => {
    const messages = messagesOf('concurrency-wave-session.jsonl');
    expect(collectConcurrency(messages, 'SKILL-41').concurrentCycles).toEqual([
      { ticket: 'BLG-07', spawnIndex: 1 },
      { ticket: 'SKILL-42', spawnIndex: 2 },
    ]);
    expect(collectConcurrency(messages, 'BLG-07').concurrentCycles).toEqual([
      { ticket: 'SKILL-41', spawnIndex: 0 },
      { ticket: 'SKILL-42', spawnIndex: 2 },
    ]);
    expect(collectConcurrency(messages, 'SKILL-42').concurrentCycles).toEqual([
      { ticket: 'SKILL-41', spawnIndex: 0 },
      { ticket: 'BLG-07', spawnIndex: 1 },
    ]);
  });

  // ⚠️ Mutation : déclarer un cycle lancé APRÈS la fin de la vague concurrent
  // de ses membres → rougit. Son propre lancement suit la dernière écriture
  // de la vague : il ne chevauche rien.
  it('le cycle lancé après la dernière écriture de la vague déclare []', () => {
    const messages = messagesOf('concurrency-wave-with-after-session.jsonl');
    expect(collectConcurrency(messages, 'SKILL-43').concurrentCycles).toEqual([]);
  });

  // ⚠️ Mutation (gate de reprise, finding nº 5) : traiter la borne de « moi »
  // comme toujours +Infinity (« l'instant courant ») au lieu de sa propre
  // écriture RÉELLEMENT présente dans `messages` → rougit. Sur cette même
  // fixture (SKILL-41 a déjà sa propre écriture), un lancement SANS RAPPORT
  // (`SKILL-43`) situé APRÈS la fin de la vague ne doit PAS se déclarer
  // concurrent de `SKILL-41`, même si `SKILL-43` apparaît quelque part plus
  // loin dans le MÊME tableau `messages` : `SKILL-41` a déjà refermé son
  // intervalle avant que `SKILL-43` ne soit seulement lancé. Sans cette
  // symétrie, TOUT lancement plus tardif d'un transcript complet se
  // déclarerait à tort concurrent de tout ce qui le précède — mesuré en réel
  // sur `d493aa1f` (SKILL-36 déclarait à tort SKILL-41/BLG-07/SKILL-42/
  // SKILL-43/SKILL-44).
  it('un lancement postérieur et sans rapport ne contamine pas un cycle déjà refermé, même rejoué sur le transcript complet', () => {
    const messages = messagesOf('concurrency-wave-with-after-session.jsonl');
    expect(collectConcurrency(messages, 'SKILL-41').concurrentCycles).toEqual([
      { ticket: 'BLG-07', spawnIndex: 1 },
      { ticket: 'SKILL-42', spawnIndex: 2 },
    ]);
  });

  // ⚠️ Mutation (gate de reprise, finding nº 5) : même défaut, variante
  // production — une SECONDE exécution de l'Étape 6.8 pour un cycle déjà
  // refermé, plus tard dans la même session (le verrou `wx` de `writeRecord`
  // ne l'empêche pas dès que `--date` diffère). `SKILL-X` a déjà sa propre
  // écriture dans le transcript ; `SKILL-Y`, sans rapport, est lancé et écrit
  // bien après. Rejouer `collectConcurrency` pour `SKILL-X` ne doit PAS
  // déclarer `SKILL-Y` concurrent.
  it('rejouer collectConcurrency pour un cycle déjà écrit ne contamine pas avec un cycle sans rapport lancé après', () => {
    const messages = messagesOf('concurrency-rerun-session.jsonl');
    expect(collectConcurrency(messages, 'SKILL-X').concurrentCycles).toEqual([]);
  });

  // ⚠️ Mutation : laisser l'intervalle d'un lancement abandonné se fermer tout
  // seul → rougit. C'est le biais assumé (D2) : un cycle jamais écrit reste
  // concurrent de TOUS les cycles postérieurs, y compris un cycle déjà fermé
  // avant que le suivant démarre.
  it('lancement abandonné (jamais écrit) -> concurrent de tous les cycles postérieurs', () => {
    // Fixture réduite (80 abandonné, 81 seul postérieur) : isole l'assertion de
    // l'effet — sans rapport avec le biais D2 — d'un second cycle 82 lui-même
    // JAMAIS écrit et lancé encore plus tard (cf. assertion suivante).
    const onlyTwo = messagesOf('concurrency-abandoned-only-session.jsonl');
    expect(collectConcurrency(onlyTwo, 'SKILL-81').concurrentCycles).toEqual([
      { ticket: 'SKILL-80', spawnIndex: 0 },
    ]);

    // Fixture complète (80 abandonné, 81 fermé, 82 postérieur) : 82 reste
    // concurrent de 80 (jamais fermé), mais PAS de 81 (fermé avant que 82 ne
    // soit lancé) — la même distinction que le cas de relance ci-dessus.
    const withThird = messagesOf('concurrency-abandoned-session.jsonl');
    expect(collectConcurrency(withThird, 'SKILL-82').concurrentCycles).toEqual([
      { ticket: 'SKILL-80', spawnIndex: 0 },
    ]);
  });

  // ⚠️ Mutation : faire partir la fenêtre du PREMIER lancement (au lieu du
  // dernier) → rougit sur SKILL-91 (déclaré à tort). Un cycle fermé ENTRE les
  // deux lancements (SKILL-91, fermé avant la relance) n'est pas déclaré ; un
  // cycle ouvert après la relance (SKILL-92) l'est — et le PREMIER essai de
  // SKILL-90 lui-même, jamais écrit (essai abandonné), reste un candidat à
  // part entière : `j ≠ moi` compare l'OBJET du lancement, pas son ticket
  // (gate de reprise, finding nº 1 — un cycle abandonné du même ticket que
  // « moi » brûle des tokens exactement comme n'importe quel autre).
  it('ticket relancé deux fois -> la fenêtre part du dernier lancement (mais le premier essai abandonné reste candidat)', () => {
    const messages = messagesOf('concurrency-relaunch-session.jsonl');
    expect(collectConcurrency(messages, 'SKILL-90').concurrentCycles).toEqual([
      { ticket: 'SKILL-90', spawnIndex: 0 },
      { ticket: 'SKILL-92', spawnIndex: 3 },
    ]);
  });

  // ⚠️ Mutation : omettre l'entrée quand le ticket ne se résout pas → rougit
  // (D1 : l'entrée existe quand même, avec son rang, `ticket: null`).
  it('lancement sans ticket identifiable -> entrée avec ticket: null et son spawnIndex', () => {
    const messages = messagesOf('concurrency-unidentified-session.jsonl');
    expect(collectConcurrency(messages, 'SKILL-95').concurrentCycles).toEqual([
      { ticket: null, spawnIndex: 1 },
    ]);
  });

  // ⚠️ Mutation : rendre `[]` quand mon propre lancement est introuvable →
  // rougit (compteur absent ≠ compteur nul).
  it('mon propre lancement introuvable -> null + motif, jamais []', () => {
    const result = collectConcurrency(messagesOf('write-cycle-session.jsonl'), 'SKILL-99');
    expect(result.concurrentCycles).toBeNull();
    expect(result.reason).toMatch(/SKILL-99/);
  });

  // ⚠️ Mutation (gate de reprise, finding nº 3) : rendre le motif « transcript
  // vide ou illisible » quand le transcript est PARFAITEMENT lisible mais ne
  // contient aucun lancement d'implémenteur → rougit. Un transcript non vide
  // sans lancement doit porter le MÊME motif que le cas « ticket absent » (le
  // test précédent) — pas un motif qui accuse à tort un transcript corrompu,
  // introuvable, ou une session codée sans `/sdd-run-ticket`.
  it('transcript lisible mais sans aucun lancement d’implémenteur -> motif « aucun lancement », pas « vide ou illisible »', () => {
    const result = collectConcurrency(messagesOf('no-spawn-session.jsonl'), 'SKILL-61');
    expect(result.concurrentCycles).toBeNull();
    expect(result.reason).toMatch(/SKILL-61/);
    expect(result.reason).not.toMatch(/vide ou illisible/);
    // Même motif que `collectTranscriptMetrics` produit pour `spawnIndex` sur
    // le même cas (specs/skill-29.md) — un opérateur qui dépouille l'un et
    // l'autre champ ne doit jamais lire deux causes incompatibles.
    expect(result.reason).toBe("aucun lancement d'implémenteur pour SKILL-61 dans le transcript");
  });

  // ⚠️ Mutation : rendre `[]` sur un transcript vide/illisible → rougit.
  it('transcript vide ou illisible -> null + motif', () => {
    for (const messages of [[], parseSession(''), parseSession('ceci n’est pas du JSONL')]) {
      const result = collectConcurrency(messages, 'SKILL-1');
      expect(result.concurrentCycles).toBeNull();
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  // ⚠️ Mutation (gate de reprise, finding nº 2) : retirer le filtre
  // `subagentType.startsWith(IMPLEMENTER_SUBAGENT_PREFIX)` de
  // `localSpawnPositions` (ou l'appliquer à un mauvais préfixe) → rougit.
  // Fixture avec de VRAIS relecteurs et un explorateur entrelacés (comme le
  // corpus réel, où `d493aa1f` porte 16 blocs `Agent` `sdd-reviewer` pour 8
  // `sdd-impl-medium`) : sans le filtre, `localSpawnPositions` compterait
  // 9 positions (tous les `Agent`) au lieu des 3 vrais lancements.
  it('invariant anti-dérive : localSpawnPositions compte EXACTEMENT autant de positions que extractSpawns, sur une fixture qui mélange relecteurs et implémenteurs', () => {
    const messages = messagesOf('concurrency-mixed-agents-session.jsonl');
    const spawns = extractSpawns(messages);
    expect(spawns).toHaveLength(3); // SKILL-A1, SKILL-B1, SKILL-C1 — pas les 4 relecteurs ni l'explorateur
    const positions = localSpawnPositions(messages);
    expect(positions).toHaveLength(spawns.length);
    expect(positions).toEqual([0, 3, 7]); // les seules positions de VRAIS lancements
  });

  // ⚠️ Mutation (gate de reprise, finding nº 2) : si la passe locale et
  // `extractSpawns` divergeaient malgré tout (longueurs différentes), la
  // fonction doit refuser de mesurer plutôt que rendre `[]` par accident
  // (`positions[i] === undefined` ne doit jamais se lire comme « rien trouvé »,
  // D1). Vérifié en réel, pas déduit : `extractSpawns` et `localSpawnPositions`
  // appelées sur la MÊME fixture mélangée rendent bien des longueurs égales —
  // c'est cette égalité que la garde de `collectConcurrency` compare.
  it('extractSpawns et localSpawnPositions rendent des longueurs égales sur transcript nominal', () => {
    for (const fixture of ['concurrency-mixed-agents-session.jsonl', 'concurrency-wave-session.jsonl', 'write-cycle-session.jsonl']) {
      const messages = messagesOf(fixture);
      expect(localSpawnPositions(messages)).toHaveLength(extractSpawns(messages).length);
    }
  });

  // ⛔ D3 — l'ordre attendu est DÉCLARÉ ici, jamais importé du comparateur
  // qu'il contrôle : rangs ENTIERS triés en tête, `null` en fin dans leur
  // ordre d'arrivée. C'est R4 (SKILL-114), et ce n'est PLUS
  // `.sort((a, b) => a - b)` : cet ancien oracle, appliqué à une sortie R4
  // CORRECTE comme `[1, null, null]`, rend `[null, null, 1]`
  // (`null - 1 === -1`) — il aurait fait rougir une sortie juste, et ne
  // restait vert que parce qu'il était épinglé à `concurrency-wave-session`,
  // seule fixture sans correcteur.
  const attenduR4 = (indexes) => [
    ...indexes.filter((s) => Number.isInteger(s)).sort((a, b) => a - b),
    ...indexes.filter((s) => !Number.isInteger(s)),
  ];

  // ⚠️ Supersession : la clause « triée par `spawnIndex` croissant » de
  // specs/skill-61.md (§ Décision D1 et § Tests, les deux bandérolées) est
  // remplacée par R4. Cette garde-ci porte donc R4, et elle couvre désormais
  // une fixture SANS `null` et une AVEC — c'est l'extension qui rougissait sur
  // le code correct tant que l'oracle était l'ancien.
  //
  // ⚠️ Mutation : trier par ordre d'écriture, ou ne pas trier → rougit sur
  // `gate-only-mixed-ranks-session.jsonl`. ⚠️ Note honnête (gate de SKILL-61,
  // finding nº 8 ; reconduite par la gate de SKILL-114, finding nº 4) : seule
  // la PARTITION entiers/`null` est falsifiable. L'ordre des rangs entiers
  // ENTRE EUX est déjà croissant à l'insertion — `voisins` garde l'ordre de
  // `withPositions`, et `extractSpawns` numérote dans cet ordre —, donc aucune
  // fixture ne peut faire rougir la soustraction finale du comparateur
  // (mesuré : la remplacer par `return 0` laisse la suite entière verte).
  it('ordre (R4) : rangs connus d’abord et croissants, null en fin — sur une fixture sans null ET une avec', () => {
    for (const [fixture, ticket] of [
      ['concurrency-wave-session.jsonl', 'BLG-07'],
      ['gate-only-mixed-ranks-session.jsonl', 'SKILL-M1'],
    ]) {
      const { concurrentCycles } = collectConcurrency(messagesOf(fixture), ticket);
      const indexes = concurrentCycles.map((c) => c.spawnIndex);
      expect(indexes, fixture).toEqual(attenduR4(indexes));
    }
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-112 — le correcteur de l’Étape 6.5 n’est pas un lancement du cycle', () => {
  // ⛔ D3 : le suffixe et le motif du régime orphelin sont DÉCLARÉS ICI, jamais
  // importés du code qu'ils contrôlent.
  const SUFFIXE_CORRECTION = ' (correction)';
  const motifOrphelin = (ticket) =>
    `seuls des lancements de correction pour ${ticket} dans le transcript — ` +
    `aucun lancement d'implémentation à mesurer`;
  const motifAucunLancement = (ticket) =>
    `aucun lancement d'implémenteur pour ${ticket} dans le transcript`;

  // Cas 5 — c'est le défaut mesuré en production
  // (`2026-09-05-SKILL-111-267e6cfa-s01.json`, `spawnIndex: 1`).
  // ⚠️ Mutation : retirer le filtre `!s.isCorrection` de la population des
  // lancements du ticket → rougit sur `spawnIndex` (1 au lieu de 0) et sur
  // `prompt.length` (celui du correcteur).
  it('implémenteur PUIS correcteur du même ticket -> spawnIndex et prompt désignent l’implémenteur', () => {
    const raw = readFixture('correction-after-impl-session.jsonl');
    const messages = parseSession(raw);
    const promptImpl = messages[1].message.content[0].input.prompt;
    const promptFix = messages[3].message.content[0].input.prompt;
    expect(promptImpl.length).not.toBe(promptFix.length); // sinon l'assertion ne discrimine rien

    const m = collectTranscriptMetrics({ raw, ticket: 'SKILL-B1' });
    expect(m.spawnIndex).toBe(0);
    expect(m.prompt.length).toBe(promptImpl.length);
    expect(m.prompt.sections['## Discipline SDD']).toBe(true); // section du prompt d'IMPLÉMENTATION
    expect(m.unmeasured.map((e) => e.field)).not.toContain('spawnIndex');
  });

  // Mutation-témoin du cas 5, jouée en vrai : le MÊME transcript privé du seul
  // marqueur redevient deux lancements ordinaires, et la mesure bascule sur le
  // second. Sans elle, un `spawnIndex: 0` obtenu par accident (« prendre
  // toujours le premier ») passerait l'assertion ci-dessus.
  it('mutation-témoin : sans le marqueur, la mesure bascule sur le second lancement', () => {
    const rawSansMarqueur = readFixture('correction-after-impl-session.jsonl').split(SUFFIXE_CORRECTION).join('');
    expect(rawSansMarqueur).not.toContain(SUFFIXE_CORRECTION);
    const m = collectTranscriptMetrics({ raw: rawSansMarqueur, ticket: 'SKILL-B1' });
    expect(m.spawnIndex).toBe(1);
  });

  // Cas 6 — l'enregistrement de production portait
  // `concurrentCycles: [{ ticket: "SKILL-111", spawnIndex: 0 }]` : le ticket
  // concurrent de LUI-MÊME. ⚠️ Mutation : exclure « moi » par identité d'objet
  // seule, sans retirer les correcteurs des candidats → rougit.
  it('implémenteur PUIS correcteur du même ticket -> concurrentCycles vide, jamais le ticket concurrent de lui-même', () => {
    const result = collectConcurrency(messagesOf('correction-after-impl-session.jsonl'), 'SKILL-B1');
    expect(result).toEqual({ concurrentCycles: [], reason: null });
  });

  it('mutation-témoin : sans le marqueur, le ticket se déclare concurrent de lui-même', () => {
    const rawSansMarqueur = readFixture('correction-after-impl-session.jsonl').split(SUFFIXE_CORRECTION).join('');
    expect(collectConcurrency(parseSession(rawSansMarqueur), 'SKILL-B1').concurrentCycles).toEqual([
      { ticket: 'SKILL-B1', spawnIndex: 0 },
    ]);
  });

  // Cas 7 — non-régression EXPLICITE de D2 (specs/skill-61.md) : une VRAIE
  // relance (deux lancements non marqués) garde sa sémantique — le dernier est
  // retenu, et la relance antérieure reste un candidat de concurrence.
  // ⚠️ Mutation : traiter tout second lancement du même ticket comme une
  // correction (sans regarder le marqueur) → rougit des deux côtés.
  it('D2 intacte : deux lancements NON marqués du même ticket -> le dernier est retenu, l’antérieur reste candidat', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('relaunched-ticket-session.jsonl'), ticket: 'SKILL-29' });
    expect(m.spawnIndex).toBe(2);
    expect(collectConcurrency(messagesOf('concurrency-relaunch-session.jsonl'), 'SKILL-90').concurrentCycles).toEqual([
      { ticket: 'SKILL-90', spawnIndex: 0 },
      { ticket: 'SKILL-92', spawnIndex: 3 },
    ]);
  });

  // Cas 8 — l'ACQUIS de SKILL-112, conservé intact par SKILL-114 : quand
  // l'implémentation du voisin est là et COUVRE son correcteur (elle le
  // précède et son intervalle n'est pas encore refermé), le correcteur ne
  // représente pas un cycle distinct — c'est le second étage de R2. Ce que
  // SKILL-114 a retiré, c'est le « quel que soit son ticket » : la couverture
  // est désormais VÉRIFIÉE au lieu d'être présumée.
  //
  // ⚠️ Note honnête (SKILL-114) : la mutation d'origine (« n'exclure des
  // candidats que les correcteurs de MON ticket ») ne rougit PLUS — c'est
  // exactement ce que R2 fait aujourd'hui. Et neutraliser le second étage de
  // R2 ne rougit pas non plus, mesuré : un correcteur COUVERT qui chevauche
  // « moi » implique que son implémentation le chevauche aussi (elle le
  // précède, et sa fermeture est la même, puisque le couvrir signifie qu'aucune
  // écriture ne les sépare) — R3 absorbe alors son entrée `null` au profit du
  // rang entier. C'est le § Décision de SKILL-114 qui fixe où vit le motif
  // (dans la population, pas « filtrer à la sortie »), pas une mutation.
  it('un voisin ayant eu implémenteur ET correcteur ne produit QU’UNE entrée, celle de son implémenteur', () => {
    const messages = messagesOf('correction-neighbour-session.jsonl');
    expect(collectConcurrency(messages, 'SKILL-D1').concurrentCycles).toEqual([
      { ticket: 'SKILL-D2', spawnIndex: 1 },
    ]);
    // Symétrie : « moi » est le dernier lancement NON-correction de mon ticket.
    expect(collectConcurrency(messages, 'SKILL-D2').concurrentCycles).toEqual([
      { ticket: 'SKILL-D1', spawnIndex: 0 },
    ]);
  });

  // Cas 9 — régime ORPHELIN (transcript tronqué, cycle repris à la gate
  // seule). ⚠️ Mutation : réutiliser `noSpawnReason` ici → rougit : il dit
  // « aucun lancement d'implémenteur pour X », devenu MENSONGER puisqu'il en
  // existe un. ⚠️ Mutation : n'alimenter que `spawnIndex` en laissant `prompt`
  // ou `tokensAtSpawn` sans entrée → rougit (bijection null ⇄ `unmeasured`).
  it('ticket n’ayant QUE des lancements de correction -> les trois champs null, avec le motif du régime orphelin', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('correction-only-session.jsonl'), ticket: 'SKILL-E1' });
    expect(m.spawnIndex).toBeNull();
    expect(m.prompt).toBeNull();
    expect(m.tokensAtSpawn).toBeNull();
    for (const field of ['spawnIndex', 'prompt', 'tokensAtSpawn']) {
      const entry = m.unmeasured.find((e) => e.field === field);
      expect(entry, `aucune entrée unmeasured pour ${field}`).toBeDefined();
      expect(entry.reason).toBe(motifOrphelin('SKILL-E1'));
      expect(entry.reason).not.toBe(motifAucunLancement('SKILL-E1'));
    }
    // Les tokens de la session restent MESURÉS : les deux informations sont
    // indépendantes (même règle qu'au régime « ticket absent »).
    expect(m.tokens.output).toBe(110 + 120);
    // Et `collectConcurrency` porte le MÊME motif, écrit une seule fois : un
    // opérateur qui dépouille les deux champs ne doit jamais lire deux causes
    // incompatibles pour le même fait.
    const c = collectConcurrency(parseSession(readFixture('correction-only-session.jsonl')), 'SKILL-E1');
    expect(c.concurrentCycles).toBeNull();
    expect(c.reason).toBe(motifOrphelin('SKILL-E1'));
    expect(m.unmeasured.find((e) => e.field === 'concurrentCycles').reason).toBe(c.reason);
  });

  // Cas 10 — non-régression du régime EXISTANT « aucun lancement du tout » :
  // son motif ne bouge pas. ⚠️ Mutation : rendre le motif orphelin dès qu'un
  // lancement du ticket est introuvable → rougit.
  it('ticket sans AUCUN lancement -> noSpawnReason inchangé et concurrentCycles null', () => {
    const m = collectTranscriptMetrics({ raw: readFixture('write-cycle-session.jsonl'), ticket: 'SKILL-99' });
    expect(m.spawnIndex).toBeNull();
    expect(m.concurrentCycles).toBeNull();
    for (const field of ['spawnIndex', 'prompt', 'tokensAtSpawn']) {
      expect(m.unmeasured.find((e) => e.field === field).reason).toBe(motifAucunLancement('SKILL-99'));
    }
    const c = collectConcurrency(messagesOf('write-cycle-session.jsonl'), 'SKILL-99');
    expect(c.concurrentCycles).toBeNull();
    expect(c.reason).toBe(motifAucunLancement('SKILL-99'));
  });
});

// ---------------------------------------------------------------------------
// SKILL-114 — la borne de SKILL-112 (« TOUS les correcteurs sortent des
// candidats ») était plus large que son motif : celui-ci suppose le lancement
// d'implémentation du voisin PRÉSENT dans le transcript, ce qu'un voisin repris
// à la GATE SEULE (implémentation dans une session antérieure) ne garantit pas.
// Quatre règles la remplacent — R1 deux populations, R2 la population des
// voisins à deux étages, R3 l'invariant de sortie, R4 l'ordre.
describe('SKILL-114 — collectConcurrency : règle unifiée d’exclusion des correcteurs', () => {
  // Cas 1 — le cas qui a produit ce ticket. ⚠️ Mutation : rétablir le filtre
  // global `!s.isCorrection` sur la population des candidats (la borne de
  // SKILL-112) → l'entrée disparaît et la fonction rend `[]`, c'est-à-dire
  // « mesuré, rien trouvé » sur un chevauchement bien réel (D1, SKILL-61).
  it('voisin repris à la GATE SEULE (correcteur sans implémentation dans le transcript) -> une entrée, spawnIndex null', () => {
    const result = collectConcurrency(messagesOf('gate-only-neighbour-session.jsonl'), 'SKILL-D1');
    expect(result).toEqual({
      concurrentCycles: [{ ticket: 'SKILL-D2', spawnIndex: null }],
      reason: null,
    });
  });

  // Cas 2 — non-régression de l'ACQUIS de SKILL-112 (son cas 8, resté vert et
  // inchangé) : quand l'implémentation du voisin EST là et couvre son
  // correcteur, le voisin ne produit toujours QU'UNE entrée, celle de son
  // implémenteur. ⚠️ Mutation : rétablir le filtre global `!s.isCorrection`
  // → rougit ailleurs (cas 1), pas ici ; c'est bien le point de cette
  // assertion — elle garde l'acquis, elle n'exerce pas la règle neuve. Voir la
  // note honnête du cas 8 de SKILL-112 sur ce que R3 absorbe du second étage
  // de R2.
  it('voisin dont l’implémentation couvre son correcteur -> une seule entrée, celle de l’implémenteur', () => {
    expect(collectConcurrency(messagesOf('correction-neighbour-session.jsonl'), 'SKILL-D1').concurrentCycles).toEqual([
      { ticket: 'SKILL-D2', spawnIndex: 1 },
    ]);
  });

  // Cas 3 — R2, premier étage : le cycle courant ne se déclare JAMAIS
  // concurrent de lui-même. Les TROIS formes, pas une : (a) était déjà verte
  // avant ce ticket (c'est le cas 6 de SKILL-112), (b) et (c) sont neuves et
  // sont le défaut d'origine de SKILL-112 que le seul prédicat du second étage
  // réintroduirait. ⚠️ Mutation commune : retirer le premier étage de R2 (ne
  // garder que le prédicat de couverture) → (b) et (c) rendent
  // `[{ ticket: 'SKILL-B1', spawnIndex: null }]`.
  it('le cycle courant ne se déclare pas concurrent de lui-même — implémenteur PUIS correcteur', () => {
    expect(collectConcurrency(messagesOf('correction-after-impl-session.jsonl'), 'SKILL-B1').concurrentCycles).toEqual([]);
  });

  it('le cycle courant ne se déclare pas concurrent de lui-même — correcteur AVANT son implémentation', () => {
    expect(collectConcurrency(messagesOf('correction-before-impl-session.jsonl'), 'SKILL-B1').concurrentCycles).toEqual([]);
  });

  it('le cycle courant ne se déclare pas concurrent de lui-même — implémentation, écriture, correcteur, relance', () => {
    expect(collectConcurrency(messagesOf('correction-then-relaunch-session.jsonl'), 'SKILL-B1').concurrentCycles).toEqual([]);
  });

  // Cas 4 — R1, le régime ORPHELIN. Sans les DEUX populations, un correcteur
  // redevenu candidat entre dans `mine` et peut devenir « moi » : le `null` +
  // motif deviendrait `[]` + `reason: null` — le `[]` menteur que ce ticket
  // existe pour supprimer, recréé par lui. ⚠️ Mutation : tirer `mine` de la
  // population des voisins (population commune) → `[]` et `reason: null`.
  it('R1 — ticket n’ayant QUE des lancements de correction -> null + motif du régime orphelin, jamais []', () => {
    const c = collectConcurrency(messagesOf('correction-only-session.jsonl'), 'SKILL-E1');
    expect(c.concurrentCycles).toBeNull();
    expect(c.concurrentCycles).not.toEqual([]);
    expect(c.reason).toBe(
      'seuls des lancements de correction pour SKILL-E1 dans le transcript — ' +
        "aucun lancement d'implémentation à mesurer"
    );
  });

  // Cas 5 — R1, second effet : « moi » reste le dernier lancement
  // NON-CORRECTION de mon ticket, même quand mon correcteur est le DERNIER
  // lancement de la session et que mon écriture est déjà tombée. ⚠️ Mutation :
  // population commune → « moi » devient le correcteur (lancé après toute
  // écriture, donc chevauchant plus rien) et SKILL-V9 disparaît (`[]`).
  it('R1 — « moi » reste l’implémenteur même quand mon correcteur est postérieur à ma propre écriture', () => {
    expect(collectConcurrency(messagesOf('correction-after-own-write-session.jsonl'), 'SKILL-B1').concurrentCycles).toEqual([
      { ticket: 'SKILL-V9', spawnIndex: 1 },
    ]);
  });

  // Cas 6 — R2, second étage : deux lancements dont `extractTicketId` n'a
  // identifié NI L'UN NI L'AUTRE ne sont pas « le même ticket ». Le correcteur
  // non identifié porte donc un cycle que rien ne couvre, et reste voisin.
  // ⚠️ Mutation : retirer `c.ticketId !== null` du prédicat → `null === null`
  // fait exclure ce correcteur au titre d'une implémentation sans rapport.
  it('R2 — un correcteur non identifié n’est pas couvert par une implémentation non identifiée', () => {
    const cycles = collectConcurrency(messagesOf('unidentified-correction-session.jsonl'), 'SKILL-Z1').concurrentCycles;
    expect(cycles).toContainEqual({ ticket: null, spawnIndex: null });
  });

  // Cas 7 — R3 : un voisin nommé repris DEUX fois à la gate produit deux
  // entrées strictement identiques, indiscernables. ⚠️ Mutation : retirer R3 →
  // deux entrées `{ SKILL-D2, null }`, le défaut d'origine de SKILL-112 rouvert.
  it('R3 — double reprise à la gate du même voisin -> UNE entrée null, pas deux', () => {
    expect(collectConcurrency(messagesOf('gate-only-neighbour-twice-session.jsonl'), 'SKILL-D1').concurrentCycles).toEqual([
      { ticket: 'SKILL-D2', spawnIndex: null },
    ]);
  });

  // Cas 8 — R3 : `closureOf(impl D2)` s'arrête à l'écriture de D2, ANTÉRIEURE
  // au correcteur — le prédicat de R2 ne l'exclut donc pas, et le tableau porte
  // `[{D2,1},{D2,null}]` dans l'ordre d'insertion. Or l'ordre « 6.5 correcteur
  // → 6.8 écriture » de `/sdd-run-ticket` fait de cette configuration le cas
  // NOMINAL d'une gate de reprise. ⚠️ Mutation : retirer R3 → deux entrées.
  it('R3 — correcteur postérieur à l’écriture du voisin -> le rang connu absorbe l’entrée null', () => {
    expect(collectConcurrency(messagesOf('correction-after-neighbour-write-session.jsonl'), 'SKILL-D1').concurrentCycles).toEqual([
      { ticket: 'SKILL-D2', spawnIndex: 1 },
    ]);
  });

  // Cas 9 — R3 ne touche PAS `ticket: null` : deux lancements non identifiés ne
  // sont pas « le même ticket », c'est la borne que R2 vient de poser et que R3
  // renierait. Deux défauts distincts, deux transcrits. ⚠️ Mutation : appliquer
  // R3 sans exclure `ticket: null` → la seconde entrée disparaît des DEUX.
  it('R3 — un rang connu ne mange pas l’entrée null d’un AUTRE lancement non identifié', () => {
    expect(collectConcurrency(messagesOf('unidentified-correction-session.jsonl'), 'SKILL-Z1').concurrentCycles).toEqual([
      { ticket: null, spawnIndex: 1 },
      { ticket: null, spawnIndex: null },
    ]);
  });

  it('R3 — deux correcteurs non identifiés sont deux cycles voisins réels, pas un', () => {
    expect(collectConcurrency(messagesOf('unidentified-corrections-pair-session.jsonl'), 'SKILL-Z1').concurrentCycles).toEqual([
      { ticket: null, spawnIndex: null },
      { ticket: null, spawnIndex: null },
    ]);
  });

  // Cas 10 — R3 ne collapse pas deux VRAIES relances : deux implémentations
  // distinctes d'un même voisin (relance antérieure abandonnée) restent DEUX
  // entrées, elles ont un rang pour se distinguer. ⛔ Mesuré sur SKILL-92, pas
  // sur SKILL-90 : c'est le seul point de vue qui rende deux entrées du MÊME
  // ticket, donc le seul où une R3 « dédupliquer par ticket » rougirait.
  // ⚠️ Mutation : dédupliquer par ticket → une seule entrée SKILL-90.
  it('R3 — deux relances du même voisin, chacune avec son rang, restent DEUX entrées', () => {
    expect(collectConcurrency(messagesOf('concurrency-relaunch-session.jsonl'), 'SKILL-92').concurrentCycles).toEqual([
      { ticket: 'SKILL-90', spawnIndex: 0 },
      { ticket: 'SKILL-90', spawnIndex: 2 },
    ]);
  });

  // Cas 11 — R4 : rangs entiers en tête et croissants, `null` en fin dans
  // l'ordre d'insertion (donc de position — `Array.prototype.sort` est stable
  // depuis ES2019). ⚠️ Mutation : le comparateur d'AVANT ce ticket
  // (`a.spawnIndex - b.spawnIndex`) → `null - 1 === -1` range les `null` à la
  // place d'un rang 0 et rend `[N7, N9, N8]`.
  it('R4 — les rangs connus d’abord et croissants, les null en fin dans l’ordre de position', () => {
    const cycles = collectConcurrency(messagesOf('gate-only-mixed-ranks-session.jsonl'), 'SKILL-M1').concurrentCycles;
    expect(cycles).toEqual([
      { ticket: 'SKILL-N8', spawnIndex: 1 },
      { ticket: 'SKILL-N7', spawnIndex: null },
      { ticket: 'SKILL-N9', spawnIndex: null },
    ]);
  });

  // Cas 12 — non-régression : aucun lancement du ticket, ni implémentation ni
  // correction. Le motif EXISTANT ne bouge pas, et `concurrentCycles` reste
  // `null`. ⚠️ Mutation : rendre `[]` ici → rougit (compteur absent ≠ nul).
  it('aucun lancement du ticket -> noSpawnReason inchangé et concurrentCycles null', () => {
    const c = collectConcurrency(messagesOf('write-cycle-session.jsonl'), 'SKILL-99');
    expect(c.concurrentCycles).toBeNull();
    expect(c.reason).toBe("aucun lancement d'implémenteur pour SKILL-99 dans le transcript");
  });

  // Cas 13 — D1 : un `spawnIndex: null` DANS une entrée est un constat
  // délibéré (`baseline.mjs` ne numérote pas les correcteurs), pas une mesure
  // ratée — l'exemption d'`assertUnmeasuredInvariant` le nomme donc à côté de
  // `.ticket`. ⛔ Sur un record produit par le VRAI pipeline
  // (`collectConcurrency` → `buildRecord`), jamais fabriqué à la main.
  // ⚠️ Mutation : retirer le nom `.spawnIndex` de l'exemption → la première
  // assertion rougit. ⚠️ Ne PAS satisfaire cette mutation en supprimant tout le
  // bloc : plus rien ne balaierait l'intérieur du tableau (§ Décision, D1).
  it('D1 — une entrée à spawnIndex null ne réclame PAS d’entrée unmeasured, un concurrentCycles null global si', () => {
    // ⛔ `argvWith`, jamais une recopie de `FULL_ARGV` : un drapeau requis
    // ajouté à `parseArgs` (SKILL-63, SKILL-69, SKILL-103 l'ont chacun fait)
    // se propage alors ici comme aux onze autres appels. Seul `--ticket` est
    // paramétré ; `--date`, `--r` et `--u` ne le sont que pour rester à
    // l'identique de ce que ce cas mesurait déjà.
    const argv = (ticket) =>
      argvWith({ '--ticket': ticket, '--date': '2026-09-05', '--r': '2', '--u': '0' });

    const record = build(argv('SKILL-D1'), {
      metrics: metricsOf('gate-only-neighbour-session.jsonl', 'SKILL-D1'),
    });
    expect(record.concurrentCycles).toEqual([{ ticket: 'SKILL-D2', spawnIndex: null }]);
    expect(record.unmeasured.map((e) => e.field)).not.toContain('concurrentCycles[0].spawnIndex');
    assertUnmeasuredInvariant(record);

    // Le `null` GLOBAL, lui, reste une mesure ratée et garde son entrée.
    const sansMesure = build(argv('SKILL-99'), {
      metrics: metricsOf('write-cycle-session.jsonl', 'SKILL-99'),
    });
    expect(sansMesure.concurrentCycles).toBeNull();
    expect(sansMesure.unmeasured.map((e) => e.field)).toContain('concurrentCycles');
    assertUnmeasuredInvariant(sansMesure);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-29 — verifySha', () => {
  function recordingRun(result) {
    const calls = [];
    const run = (cmd, args) => {
      calls.push([cmd, ...args]);
      return typeof result === 'function' ? result(cmd, args) : result;
    };
    run.calls = calls;
    return run;
  }

  // ⚠️ Mutation : rendre `true` sans appeler git → rougit (aucune commande
  // enregistrée).
  it('SHA de 40 caractères hexadécimaux présent dans le dépôt -> true', () => {
    const run = recordingRun({ status: 0, stdout: `${SHA40}\n`, stderr: '' });
    const res = verifySha('C:/repo', SHA40, run);
    expect(res.verified).toBe(true);
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0][0]).toBe('git');
  });

  // ⚠️ Mutation : ne pas contrôler la longueur → rougit. C'est le mode de
  // défaillance vécu : un SHA retranscrit à 39 caractères.
  it('SHA de 39 caractères -> false + motif, et le SHA reçu est conservé tel quel', () => {
    const short = SHA40.slice(0, 39);
    const run = recordingRun({ status: 0, stdout: '', stderr: '' });
    const res = verifySha('C:/repo', short, run);
    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(/39/);
    // Aucune commande git n'est nécessaire pour constater une longueur fausse.
    expect(run.calls).toEqual([]);
    // Le SHA reçu n'est pas réparé ni tronqué : buildRecord le recopie tel quel.
    const record = buildRecord({
      args: parseArgs(argvWith({ '--sha': short })).args,
      session: { id: null, transcript: null },
      metrics: collectTranscriptMetrics({ raw: '', ticket: 'SKILL-29' }),
      shaCheck: res,
      now: '2026-08-19T21:04:11.512Z',
    });
    expect(record.sha).toBe(short);
    expect(record.shaVerified).toBe(false);
  });

  // ⚠️ Mutation : traiter un code de retour non nul comme « git en erreur » →
  // rougit (on perdrait le constat « absent du dépôt »).
  it('SHA bien formé mais absent du dépôt -> false + motif', () => {
    const run = recordingRun({ status: 1, stdout: '', stderr: '' });
    const res = verifySha('C:/repo', SHA40, run);
    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(/absent/i);
  });

  // ⚠️ Mutation : rendre `false` quand git est indisponible → rougit :
  // « pas vérifié » n'est pas « faux ».
  it('git indisponible ou en erreur -> null + motif', () => {
    const missing = verifySha('C:/repo', SHA40, recordingRun({ error: new Error('ENOENT git') }));
    expect(missing.verified).toBeNull();
    expect(missing.verified).not.toBe(false);

    const notARepo = verifySha('C:/pas-un-repo', SHA40, recordingRun({ status: 128, stderr: 'fatal: not a git repository' }));
    expect(notARepo.verified).toBeNull();
    expect(notARepo.reason).toMatch(/git/i);

    const thrown = verifySha('C:/repo', SHA40, () => {
      throw new Error('spawn impossible');
    });
    expect(thrown.verified).toBeNull();
  });

  // ⚠️ Mutation : invoquer `git rev-parse` sans `-C <repo>` → rougit. Un git nu
  // viserait le repo de la session, pas le dépôt cible (défaut SKILL-32).
  it('la commande git vise explicitement le dépôt (-C)', () => {
    const run = recordingRun({ status: 0 });
    verifySha('C:/Users/gibou/.claude', SHA40, run);
    expect(run.calls[0]).toContain('-C');
    expect(run.calls[0]).toContain('C:/Users/gibou/.claude');
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-46 — verifyRef (ref de finding, éventuellement abrégé)', () => {
  function recordingRun(result) {
    const calls = [];
    const run = (cmd, args) => {
      calls.push([cmd, ...args]);
      return typeof result === 'function' ? result(cmd, args) : result;
    };
    run.calls = calls;
    return run;
  }

  // ⚠️ Mutation : rendre `true` sans appeler git → rougit.
  it('ref abrégé (7 caractères) présent dans le dépôt -> true', () => {
    const run = recordingRun({ status: 0, stdout: '9f2c1ab\n', stderr: '' });
    const res = verifyRef('C:/repo', '9f2c1ab', run);
    expect(res.verified).toBe(true);
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0][0]).toBe('git');
  });

  // ⚠️ Mutation : exiger 40 caractères comme `verifySha` → rougit. Un `ref` de
  // finding est couramment abrégé, contrairement à `<sha_final>`.
  it('ref plus court que 40 caractères -> vérifié normalement, jamais rejeté sur la longueur', () => {
    const run = recordingRun({ status: 0 });
    const res = verifyRef('C:/repo', 'ab12', run);
    expect(res.verified).toBe(true);
  });

  // ⚠️ Mutation : retirer le contrôle de format → rougit (un texte libre
  // serait envoyé tel quel à git).
  it('ref non hexadécimal -> false + motif, AUCUN appel git', () => {
    const run = recordingRun({ status: 0 });
    const res = verifyRef('C:/repo', 'ceci-nest-pas-un-sha', run);
    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(/mal formé/);
    expect(run.calls).toEqual([]);
  });

  // ⚠️ Mutation : traiter un ref absent comme une erreur → rougit. `E1`/`E3`
  // n'en portent pas : c'est un cas VALIDE, pas un défaut.
  it('ref absent (null ou vide) -> null, jamais false', () => {
    expect(verifyRef('C:/repo', null, recordingRun({})).verified).toBeNull();
    expect(verifyRef('C:/repo', '', recordingRun({})).verified).toBeNull();
  });

  // ⚠️ Mutation : traiter un code 1 comme une erreur git → rougit (on perdrait
  // le constat « absent du dépôt »).
  it('ref hexadécimal mais absent du dépôt -> false + motif', () => {
    const run = recordingRun({ status: 1, stdout: '', stderr: '' });
    const res = verifyRef('C:/repo', 'deadbee', run);
    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(/absent/i);
  });

  // ⚠️ Mutation : rendre `false` quand git est indisponible → rougit :
  // « pas vérifié » n'est pas « faux ».
  it('git indisponible -> null, jamais false', () => {
    const res = verifyRef('C:/repo', 'deadbee', () => {
      throw new Error('spawn impossible');
    });
    expect(res.verified).toBeNull();
  });

  // ⚠️ Mutation : invoquer `git rev-parse` sans `-C <repo>` → rougit (défaut
  // SKILL-32 : un git nu viserait le repo de la session).
  it('la commande git vise explicitement le dépôt (-C)', () => {
    const run = recordingRun({ status: 0 });
    verifyRef('C:/Users/gibou/.claude', 'deadbee', run);
    expect(run.calls[0]).toContain('-C');
    expect(run.calls[0]).toContain('C:/Users/gibou/.claude');
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-46 — verifyFindingRefs', () => {
  // ⚠️ Mutation : vérifier tous les findings sans filtrer par disposition →
  // rougit — git ne doit JAMAIS être appelé pour E1/E2/E3, sous peine de faux
  // négatif (un identifiant de ticket comme `SKILL-42` n'est pas un SHA).
  it('seules les dispositions `corrigé` sont vérifiées ; E1/E2/E3 traversent inchangés', () => {
    const findings = [
      { i: 1, title: 'a', reviewers: [], disposition: 'E1', ref: null },
      { i: 2, title: 'b', reviewers: [], disposition: 'E2', ref: 'SKILL-42' },
      { i: 3, title: 'c', reviewers: [], disposition: 'E3', ref: null },
    ];
    const run = () => {
      throw new Error('git ne doit jamais être appelé ici');
    };
    expect(verifyFindingRefs(findings, 'C:/repo', run)).toEqual(findings);
  });

  // ⚠️ Mutation : ne pas propager `refVerified` sur les findings `corrigé` →
  // rougit.
  it('finding `corrigé` avec ref vivant -> refVerified true, reste du finding inchangé', () => {
    const findings = [{ i: 1, title: 't', reviewers: ['A'], disposition: 'corrigé', ref: '9f2c1ab' }];
    const run = () => ({ status: 0, stdout: '9f2c1ab\n', stderr: '' });
    const result = verifyFindingRefs(findings, 'C:/repo', run);
    // ⚠️ Mutation (SKILL-56) : ne pas propager `shaReachableFromBranch` →
    // rougit. Le mock git répond `status: 0` à TOUT appel (rev-parse comme
    // merge-base), donc les deux constats sont vrais ici.
    expect(result).toEqual([
      {
        ...findings[0],
        refVerified: true,
        refVerifiedReason: null,
        shaReachableFromBranch: true,
        shaReachableFromBranchReason: null,
      },
    ]);
  });

  // ⚠️ Mutation : faire échouer l'appel (throw, code de sortie non nul) sur un
  // ref mort → rougit. Doctrine inchangée : « l'absence de mesure est une
  // mesure », jamais un blocage. C'est l'assertion la plus importante du
  // ticket.
  it('finding `corrigé` avec ref mort -> refVerified false, jamais une exception', () => {
    const findings = [{ i: 1, title: 't', reviewers: ['A'], disposition: 'corrigé', ref: 'deadbee' }];
    // ⚠️ `run` rend `status: 1` pour TOUT appel — y compris un éventuel
    // `merge-base` — mais `verifyFindingRefs` (SKILL-56) n'invoque JAMAIS
    // `merge-base` quand `verifyRef` a déjà constaté `false` : ce mock unique
    // n'est donc exercé qu'une fois (`rev-parse --verify`), jamais deux, et ne
    // prétend pas simuler le code 128 réel de `merge-base --is-ancestor` sur
    // un objet inconnu (cf. le dépôt jetable RÉEL, describe « SKILL-56 — cas
    // central … », pour ce dernier).
    const run = () => ({ status: 1, stdout: '', stderr: '' });
    let result;
    expect(() => {
      result = verifyFindingRefs(findings, 'C:/repo', run);
    }).not.toThrow();
    expect(result[0].refVerified).toBe(false);
    expect(result[0].refVerifiedReason).toMatch(/absent/i);
    // ⚠️ Mutation (SKILL-56) : laisser `shaReachableFromBranch` non peuplé, ou
    // le rendre bloquant → rougit.
    expect(result[0].shaReachableFromBranch).toBe(false);
  });

  // ⚠️ Mutation (gate de revue, finding nº 2) : laisser un `corrigé` sans
  // `ref` retomber dans la branche générique « ref absent -> null » de
  // `verifyRef` → rougit. Un `corrigé` EXIGE un SHA ; son absence est le
  // défaut le plus banal (« le SHA annoncé n'existe pas », mais en pire :
  // il n'a même pas été recopié), donc un constat NÉGATIF, jamais « non
  // mesuré ». `E1`/`E3`, eux, n'appellent jamais cette branche : leur `ref`
  // vide ne traverse même pas `verifyRef` (filtré par disposition).
  it('finding `corrigé` SANS ref -> refVerified false (constat, pas `null`), jamais une exception', () => {
    const findings = [{ i: 1, title: 't', reviewers: ['A'], disposition: 'corrigé', ref: null }];
    const run = () => {
      throw new Error('git ne doit jamais être appelé pour un ref absent');
    };
    let result;
    expect(() => {
      result = verifyFindingRefs(findings, 'C:/repo', run);
    }).not.toThrow();
    expect(result[0].refVerified).toBe(false);
    expect(result[0].refVerified).not.toBeNull();
    expect(result[0].refVerifiedReason).toMatch(/sans .*ref|ref.*attendu/i);
    // ⚠️ Mutation (SKILL-56) : laisser `shaReachableFromBranch` à `null` ici →
    // rougit. Même raisonnement que `refVerified` : l'absence de SHA est un
    // constat négatif, pas une non-mesure.
    expect(result[0].shaReachableFromBranch).toBe(false);
    expect(result[0].shaReachableFromBranchReason).toMatch(/sans .*ref|ref.*attendu/i);
  });

  // ⚠️ Mutation (gate de revue, finding nº 1) : jeter `check.reason` au lieu
  // de le propager dans `refVerifiedReason` → rougit. C'est ce motif que
  // `buildRecord` consomme pour peupler `unmeasured` quand `refVerified` est
  // `null` (dépôt inconnu, git indisponible, git en erreur).
  it('finding `corrigé`, dépôt inconnu -> refVerified null AVEC son motif propagé', () => {
    const findings = [{ i: 1, title: 't', reviewers: ['A'], disposition: 'corrigé', ref: '9f2c1ab' }];
    const result = verifyFindingRefs(findings, '', () => ({ status: 0 }));
    expect(result[0].refVerified).toBeNull();
    expect(typeof result[0].refVerifiedReason).toBe('string');
    expect(result[0].refVerifiedReason.length).toBeGreaterThan(0);
    // ⚠️ Mutation (SKILL-56) : laisser `shaReachableFromBranch` bloquant ou
    // sans motif quand le dépôt est inconnu → rougit.
    expect(result[0].shaReachableFromBranch).toBeNull();
    expect(typeof result[0].shaReachableFromBranchReason).toBe('string');
    expect(result[0].shaReachableFromBranchReason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-56 — verifyRefReachableFromMain (ref de finding, atteignable depuis main)', () => {
  function recordingRun(result) {
    const calls = [];
    const run = (cmd, args) => {
      calls.push([cmd, ...args]);
      return typeof result === 'function' ? result(cmd, args) : result;
    };
    run.calls = calls;
    return run;
  }

  // ⚠️ Mutation : rendre `true` sans appeler git → rougit.
  it('ref atteignable depuis main -> true, via `git merge-base --is-ancestor`', () => {
    const run = recordingRun({ status: 0, stdout: '', stderr: '' });
    const res = verifyRefReachableFromMain('C:/repo', '9f2c1ab', run);
    expect(res.verified).toBe(true);
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]).toEqual(['git', '-C', 'C:/repo', 'merge-base', '--is-ancestor', '9f2c1ab', 'main']);
  });

  // ⚠️ Mutation : traiter le code 1 comme une erreur git (au lieu du constat
  // « non ancêtre ») → rougit. C'est le mode de défaillance visé : un SHA d'un
  // commit EXISTANT (donc `refVerified: true`) mais qui n'est jamais devenu
  // ancêtre de `main` — ce que `verifyRef` seul ne peut pas voir. La commande
  // git elle-même n'échoue jamais côté processus : `--is-ancestor` sort en 1
  // pour un « non », pas une erreur.
  it('ref existant mais non ancêtre de main -> false (constat, pas une erreur)', () => {
    const run = recordingRun({ status: 1, stdout: '', stderr: '' });
    const res = verifyRefReachableFromMain('C:/repo', 'deadbee', run);
    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(/pas ancêtre/i);
  });

  // ⚠️ Mutation (gate de reprise, finding nº 1) : ranger le code 128
  // « objet inconnu » dans le `null` générique → rougit. `merge-base
  // --is-ancestor` sort en **128**, jamais 1, quand `<rev>` lui-même n'existe
  // pas dans la base d'objets (`fatal: Not a valid object name <rev>`, mesuré
  // en réel git 2.53 — cf. aussi le dépôt jetable RÉEL, describe « SKILL-56 —
  // cas central … »). Sans ce triage, le SHA de finding le plus banal (inventé
  // ou mal recopié) atterrirait en « non mesuré » plutôt qu'en `false`, alors
  // qu'un objet absent de la base n'est atteignable de nulle part.
  it('ref inexistant dans la base d’objets (code 128, "Not a valid object name") -> false, PAS null', () => {
    const run = recordingRun({
      status: 128,
      stdout: '',
      stderr: "fatal: Not a valid object name deadbee",
    });
    const res = verifyRefReachableFromMain('C:/repo', 'deadbee', run);
    expect(res.verified).toBe(false);
    expect(res.verified).not.toBeNull();
    // ⚠️ Mutation (gate de reprise SKILL-103, finding nº 6) : réutiliser la
    // chaîne du code 1 (« n'est pas ancêtre de main ») pour ce code 128 →
    // rougit. Une fois persisté (`shaReachableFromBranchReason`), ce motif est
    // la SEULE chose qui distingue « objet absent de la base » de « objet
    // présent mais jamais fusionné » — les deux sont désormais visibles à
    // l'écran (SDD-23).
    expect(res.reason).toMatch(/n'existe pas/);
    expect(res.reason).not.toMatch(/pas ancêtre/i);
  });

  // ⚠️ Mutation : retirer le contrôle de format → rougit (un texte libre
  // serait envoyé tel quel à git).
  it('ref non hexadécimal -> false + motif, AUCUN appel git', () => {
    const run = recordingRun({ status: 0 });
    const res = verifyRefReachableFromMain('C:/repo', 'ceci-nest-pas-un-sha', run);
    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(/mal formé/);
    expect(run.calls).toEqual([]);
  });

  // ⚠️ Mutation : traiter un ref absent comme une erreur → rougit.
  it('ref absent (null ou vide) -> null, jamais false', () => {
    expect(verifyRefReachableFromMain('C:/repo', null, recordingRun({})).verified).toBeNull();
    expect(verifyRefReachableFromMain('C:/repo', '', recordingRun({})).verified).toBeNull();
  });

  // ⚠️ Mutation : rendre `false` quand git est indisponible, ou quand le
  // dépôt/`main` sont introuvables → rougit : « pas vérifié » n'est jamais
  // « faux ». C'est la doctrine « jamais bloquant » (§ Décision 1).
  it('git indisponible, dépôt inconnu, ou `main` introuvable -> null, jamais false', () => {
    const thrown = verifyRefReachableFromMain('C:/repo', 'deadbee', () => {
      throw new Error('spawn impossible');
    });
    expect(thrown.verified).toBeNull();

    const noRepo = verifyRefReachableFromMain('', 'deadbee', recordingRun({ status: 0 }));
    expect(noRepo.verified).toBeNull();

    const noMain = verifyRefReachableFromMain(
      'C:/repo',
      'deadbee',
      recordingRun({ status: 128, stderr: "fatal: 'main' n'est pas un objet valide" })
    );
    expect(noMain.verified).toBeNull();
  });

  // ⚠️ Mutation : invoquer git sans `-C <repo>` → rougit (défaut SKILL-32 : un
  // git nu viserait le repo de la session).
  it('la commande git vise explicitement le dépôt (-C)', () => {
    const run = recordingRun({ status: 0 });
    verifyRefReachableFromMain('C:/Users/gibou/.claude', 'deadbee', run);
    expect(run.calls[0]).toContain('-C');
    expect(run.calls[0]).toContain('C:/Users/gibou/.claude');
  });

  // ⚠️ Mutation : lire une autre branche que `main` (ex. la branche courante,
  // ou un flag) → rougit. § Décision 1 : c'est `main` du dépôt CIBLE,
  // toujours, jamais configurable.
  it('la commande cible `main`, jamais une autre branche', () => {
    const run = recordingRun({ status: 0 });
    verifyRefReachableFromMain('C:/repo', 'deadbee', run);
    expect(run.calls[0]).toContain('main');
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-56 — cas central monté en réel : un dépôt jetable, une branche rebasée', () => {
  const tmpDirs = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  // Reproduit EXACTEMENT le scénario de specs/skill-56.md § Problème 1 : un
  // commit rendu orphelin par `git rebase` survit dans la base d'objets
  // (protégé par le reflog) — `refVerified` doit donc rester `true` — mais
  // n'est jamais devenu ancêtre de `main`, ce que `shaReachableFromBranch`
  // seul distingue.
  function makeRebasedRepo() {
    const repo = initGitRepo(tmpDirs, 'skill56-repo-');

    git(repo, ['checkout', '-q', '-b', 'feat']);
    fs.writeFileSync(path.join(repo, 'b.txt'), '1\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'feat commit']);
    const preRebaseSha = git(repo, ['rev-parse', 'HEAD']);

    git(repo, ['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(repo, 'c.txt'), '1\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'main advances']);

    git(repo, ['checkout', '-q', 'feat']);
    git(repo, ['rebase', '-q', 'main']);
    const postRebaseSha = git(repo, ['rev-parse', 'HEAD']);

    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '-q', '--ff-only', 'feat']);

    return { repo, preRebaseSha, postRebaseSha };
  }

  // ⚠️ C'est l'assertion qui porte le ticket (§ Tests, specs/skill-56.md) :
  // sans rebase réel, on ne teste que le cas facile (SHA inventé), déjà
  // couvert ailleurs. `verifyRef`/`verifyRefReachableFromMain` sont appelés
  // SANS `run` injecté : le vrai binaire `git` tourne sur le dépôt jetable.
  it('ref pré-rebase -> refVerified true (reflog), shaReachableFromBranch false (jamais livré)', () => {
    const { repo, preRebaseSha } = makeRebasedRepo();

    expect(verifyRef(repo, preRebaseSha).verified).toBe(true);
    expect(verifyRefReachableFromMain(repo, preRebaseSha).verified).toBe(false);

    const findings = [{ i: 1, title: 't', reviewers: ['A'], disposition: 'corrigé', ref: preRebaseSha }];
    const result = verifyFindingRefs(findings, repo);
    expect(result[0].refVerified).toBe(true);
    expect(result[0].shaReachableFromBranch).toBe(false);
  });

  // Mutation-témoin explicite du § Tests : le SHA post-rebase — le commit
  // RÉELLEMENT fusionné dans `main` — bascule le constat à `true`.
  it('ref post-rebase (réellement fusionné dans main) -> shaReachableFromBranch true', () => {
    const { repo, postRebaseSha } = makeRebasedRepo();
    expect(verifyRefReachableFromMain(repo, postRebaseSha).verified).toBe(true);
  });

  // ⚠️ Gate de reprise, finding nº 1 et nº 3 : la production de git 2.53 sort
  // en 128 (PAS 1) sur `merge-base --is-ancestor <ref-inexistant> main`, avec
  // `stderr` de la forme `fatal: Not a valid object name <ref>`. SANS `run`
  // injecté — le vrai binaire git tourne sur le dépôt jetable — pour ne
  // vérifier ce code de sortie réel qu'EN RÉEL, jamais par un mock qui pourrait
  // simuler un code que la production ne produit pas.
  it('ref hexadécimal jamais existé dans le dépôt -> shaReachableFromBranch false (code 128 réel), PAS null', () => {
    const { repo } = makeRebasedRepo();
    const res = verifyRefReachableFromMain(repo, 'deadbeef');
    expect(res.verified).toBe(false);
    expect(res.verified).not.toBeNull();
    // ⚠️ Mutation (gate de reprise SKILL-103, finding nº 6) : figer la FORME du
    // motif produit par le vrai binaire git sur ce code de sortie — sans cette
    // assertion, une reformulation silencieuse le rendrait indiscernable du
    // code 1 (« pas ancêtre de main ») dans un enregistrement `schema: 5`
    // persisté.
    expect(res.reason).toMatch(/n'existe pas/);
    expect(res.reason).not.toMatch(/pas ancêtre/i);
  });

  // Vérification 2 de specs/skill-56.md : constaté en LANÇANT l'écrivain
  // (`main`), pas en déduisant le résultat des fonctions pures ci-dessus.
  it('main() : cycle réel avec un ref pré-rebase -> code 0, fichier écrit, les deux constats attendus', () => {
    const { repo, preRebaseSha } = makeRebasedRepo();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill56-home-'));
    tmpDirs.push(home);
    fs.mkdirSync(path.join(home, 'sdd-metrics'));
    fs.mkdirSync(path.join(home, 'sdd-metrics', '.git'));
    fs.mkdirSync(path.join(home, '.claude', 'projects', 'slug'), { recursive: true });

    const shaFinal = git(repo, ['rev-parse', 'main']);
    const argv = [
      '--ticket', 'SKILL-56', '--project', 'claude-config',
      '--repo', repo, '--mode', 'same-repo',
      '--sha', shaFinal, '--date', '2026-08-23',
      '--model', 'sonnet', '--effort', 'medium', '--review', 'deep',
      '--dosage', 'deep', '--reviewers', '1', '--r', '1', '--u', '1',
      '--finding', `1|A|corrigé|${preRebaseSha}|un ref jamais rebasé dans main`,
    ];
    const out = [];
    const err = [];
    const code = main(argv, {
      homedir: home,
      env: {},
      now: '2026-08-23T00:00:00.000Z',
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    expect(code, err.join('')).toBe(0);
    const written = out.join('').trim();
    expect(fs.existsSync(written)).toBe(true);
    const record = JSON.parse(fs.readFileSync(written, 'utf8'));
    expect(record.findings).toHaveLength(1);
    expect(record.findings[0].refVerified).toBe(true);
    expect(record.findings[0].shaReachableFromBranch).toBe(false);
  });
});

// Module-scope (SKILL-103, gate de reprise finding nº 8) : `git`, `NOW`,
// `metricsOf` et `build` étaient dupliqués À L'IDENTIQUE dans « SKILL-29 —
// buildRecord » et le nouveau describe SKILL-103 ci-dessous — un seul
// exemplaire, partagé, pour que le prochain ticket qui fait évoluer la
// signature de `buildRecord` (SKILL-61, SKILL-63, SKILL-69 l'ont chacun fait)
// n'ait qu'un endroit à mettre à jour.
function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} a échoué (${res.status}) : ${res.stderr}`);
  }
  return res.stdout.trim();
}

// Dépôt jetable minimal (un seul commit) — pousse `tmpDirs` pour que
// l'`afterEach` de l'appelant le nettoie. Base commune à `makeRebasedRepo`
// (SKILL-56) et aux dépôts jetables de SKILL-103 : les six premières lignes
// des deux étaient recopiées à l'identique (gate de reprise finding nº 8).
function initGitRepo(tmpDirs, prefix) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'a.txt'), '1\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

const NOW = '2026-08-19T21:04:11.512Z';

function metricsOf(fixture, ticket = 'SKILL-29') {
  return collectTranscriptMetrics({ raw: readFixture(fixture), ticket });
}

function build(argv, overrides = {}) {
  const parsed = parseArgs(argv);
  expect(parsed.ok, parsed.error).toBe(true);
  return buildRecord({
    args: parsed.args,
    session: { id: 'a334e39e-a56d-482b-8ff6-3704ae845b66', transcript: '/tmp/a334e39e.jsonl' },
    metrics: metricsOf('write-cycle-session.jsonl'),
    shaCheck: { verified: true, reason: null },
    now: NOW,
    ...overrides,
  });
}

// Toute valeur null de l'enregistrement doit avoir son entrée `unmeasured`,
// et réciproquement. `unmeasured` (le registre lui-même) est hors balayage,
// structurellement.
//
// `findings` (SKILL-46, gate de revue finding nº 4) n'est PAS exclu en bloc :
// le reste du finding (titre, relecteurs, disposition, `ref`) est recopié de
// l'orchestrateur (D5/D6) — l'écrivain n'y mesure rien, donc hors invariant —
// mais `refVerified`, lui, EST une mesure de l'écrivain (`verifyFindingRefs`)
// et suit la règle générale. Sa clé se nomme sur le NUMÉRO DE FINDING (`f.i`),
// pas sa position dans le tableau — la même convention que `buildRecord`
// utilise pour peupler `unmeasured`.
//
// Module-scope (SKILL-103) : partagé par « SKILL-29 — buildRecord » et
// « SKILL-103 — le motif d'un `false` survit… » ci-dessous.
function nullPaths(node, prefix, out) {
  if (node === null) {
    out.push(prefix);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => nullPaths(v, `${prefix}[${i}]`, out));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (!prefix && k === 'unmeasured') continue;
      if (!prefix && k === 'findings') {
        for (const finding of v) {
          if (Object.prototype.hasOwnProperty.call(finding, 'refVerified') && finding.refVerified === null) {
            out.push(`findings[${finding.i}].refVerified`);
          }
          // ⚠️ Mutation (SKILL-56) : ne pas balayer `shaReachableFromBranch`
          // ici → un `null` non déclaré dans `unmeasured` passerait inaperçu.
          if (
            Object.prototype.hasOwnProperty.call(finding, 'shaReachableFromBranch') &&
            finding.shaReachableFromBranch === null
          ) {
            out.push(`findings[${finding.i}].shaReachableFromBranch`);
          }
        }
        continue;
      }
      // `concurrentCycles[i].ticket` peut légitimement valoir `null` (D1,
      // SKILL-61) : un lancement dont `extractTicketId` n'a pas retrouvé le
      // ticket porte quand même son entrée, avec son rang. Ce n'est pas une
      // mesure manquée de l'écrivain — même exception que `findings[i].ref`
      // ci-dessus (recopié, jamais mesuré). Le tableau lui-même (ou un
      // `concurrentCycles: null` global, mesure ratée) reste balayé
      // normalement.
      //
      // SKILL-114 — `.spawnIndex` rejoint `.ticket`, pour le MÊME motif : un
      // voisin repris à la gate seule est un CORRECTEUR, et `baseline.mjs` ne
      // numérote pas les correcteurs (`spawnIndex: isCorrection ? null :
      // spawnIndex`). Ce `null`-là est délibérément CONSTATÉ, jamais manqué :
      // lui donner le rang d'un voisin d'implémentation fabriquerait un rang,
      // et une entrée `unmeasured` porterait un motif faux.
      // ⛔ L'exemption nomme les DEUX clés, elle ne vide pas la branche : une
      // entrée elle-même `null`, ou un champ `null` ajouté demain, restent
      // balayés. Sans quoi ce bloc dégénérerait en `continue` nu et plus rien
      // ne verrait l'intérieur du tableau. ⚠️ Mutation (SKILL-114) : retirer le
      // nom `.spawnIndex` de l'exemption → le cas 13 de SKILL-114 rougit.
      if (!prefix && k === 'concurrentCycles' && Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          const entry = v[i];
          if (entry === null || typeof entry !== 'object') {
            nullPaths(entry, `concurrentCycles[${i}]`, out);
            continue;
          }
          for (const [champ, valeur] of Object.entries(entry)) {
            if (champ === 'ticket' || champ === 'spawnIndex') continue;
            nullPaths(valeur, `concurrentCycles[${i}].${champ}`, out);
          }
        }
        continue;
      }
      nullPaths(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
}

function assertUnmeasuredInvariant(record) {
  const nulls = [];
  nullPaths(record, '', nulls);
  const declared = record.unmeasured.map((e) => e.field);
  expect([...nulls].sort(), 'un champ null sans entrée unmeasured est un bug').toEqual(
    [...declared].sort()
  );
  for (const entry of record.unmeasured) {
    expect(typeof entry.reason, `motif manquant pour ${entry.field}`).toBe('string');
    expect(entry.reason.length).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
describe('SKILL-29 — buildRecord (pure, aucune entrée/sortie)', () => {
  // ⚠️ Mutation : renommer ou retirer n'importe quel champ du schéma → rougit
  // (comparaison EN ENTIER).
  it('dosage deep complet -> enregistrement conforme au schéma, comparé en entier', () => {
    const argv = [
      ...FULL_ARGV,
      '--finding', '1|A,C|corrigé|9f2c1ab|le SHA annoncé n’existe pas',
      '--finding', '2|B|E1||l’invariant n’est pas testé',
      '--finding', '3|A|E2|SKILL-42|dette préexistante',
      '--finding', '4|C|E3||la correction casse un test vert',
    ];
    const parsed = parseArgs(argv);
    expect(parsed.ok, parsed.error).toBe(true);
    // Comme `main` : les `ref` des findings `corrigé` sont vérifiés AVANT
    // `buildRecord` (SKILL-46). `9f2c1ab` est vivant dans ce dépôt simulé.
    const verifiedFindings = verifyFindingRefs(parsed.args.findings, parsed.args.repo, () => ({
      status: 0,
      stdout: '9f2c1ab\n',
      stderr: '',
    }));
    const record = buildRecord({
      args: parsed.args,
      session: { id: 'a334e39e-a56d-482b-8ff6-3704ae845b66', transcript: '/tmp/a334e39e.jsonl' },
      metrics: metricsOf('write-cycle-session.jsonl'),
      shaCheck: { verified: true, reason: null },
      findings: verifiedFindings,
      now: NOW,
    });
    const metrics = metricsOf('write-cycle-session.jsonl');
    expect(record).toEqual({
      schema: 5,
      ticket: 'SKILL-29',
      project: 'claude-config',
      repo: 'C:/Users/gibou/.claude',
      mode: 'cross-repo',
      sha: SHA40,
      shaVerified: true,
      date: '2026-08-19',
      writtenAt: NOW,
      exec: { model: 'opus', effort: 'high', review: 'deep' },
      dosage: 'deep',
      reviewed: true,
      reviewers: 3,
      r: 7,
      u: 4,
      findings: [
        {
          i: 1,
          title: 'le SHA annoncé n’existe pas',
          reviewers: ['A', 'C'],
          disposition: 'corrigé',
          ref: '9f2c1ab',
          refVerified: true,
          shaReachableFromBranch: true,
        },
        { i: 2, title: 'l’invariant n’est pas testé', reviewers: ['B'], disposition: 'E1', ref: null },
        { i: 3, title: 'dette préexistante', reviewers: ['A'], disposition: 'E2', ref: 'SKILL-42' },
        { i: 4, title: 'la correction casse un test vert', reviewers: ['C'], disposition: 'E3', ref: null },
      ],
      controls: { uMatchesFindings: true, rAtLeastU: true, lightRequalsU: null },
      session: {
        id: 'a334e39e-a56d-482b-8ff6-3704ae845b66',
        transcript: '/tmp/a334e39e.jsonl',
        messageCount: 7,
      },
      spawnIndex: 1,
      prompt: { length: metrics.prompt.length, sections: metrics.prompt.sections },
      tokens: {
        scope: 'session-to-date',
        input: 13,
        output: 150,
        cacheRead: 1500,
        cacheCreate: 27,
        subagentReportedTokens: 64000,
        subagentReportedTokensByRole: {
          'sdd-impl-medium': 0,
          'general-purpose': 0,
          'sdd-reviewer': 4000,
          'sdd-impl-high': 60000,
          unattributed: 0,
        },
        // SKILL-69, D2 : le terme manquant devient un champ `null`, jamais une
        // absence muette.
        subagentCacheReadTokens: null,
        subagentCacheCreateTokens: null,
      },
      // SKILL-63 : bornée au message qui porte le tool_use du lancement de
      // SKILL-29 (borne INCLUSE, D2) — les deux `<usage>` de sous-agents
      // (relecteur, implémenteur) arrivent APRÈS ce message dans la fixture,
      // donc `subagentReportedTokens` y est nul alors que `tokens.subagentReportedTokens` (sur
      // toute la session) vaut 64000.
      tokensAtSpawn: {
        scope: 'session-to-spawn',
        input: 13,
        output: 150,
        cacheRead: 1500,
        cacheCreate: 27,
        subagentReportedTokens: 0,
        subagentReportedTokensByRole: {
          'sdd-impl-medium': 0,
          'general-purpose': 0,
          'sdd-reviewer': 0,
          'sdd-impl-high': 0,
          unattributed: 0,
        },
        subagentCacheReadTokens: null,
        subagentCacheCreateTokens: null,
      },
      concurrentCycles: [{ ticket: 'SKILL-40', spawnIndex: 0 }],
      unmeasured: [
        { field: 'controls.lightRequalsU', reason: expect.any(String) },
        { field: 'tokens.subagentCacheReadTokens', reason: expect.any(String) },
        { field: 'tokens.subagentCacheCreateTokens', reason: expect.any(String) },
        { field: 'tokensAtSpawn.subagentCacheReadTokens', reason: expect.any(String) },
        { field: 'tokensAtSpawn.subagentCacheCreateTokens', reason: expect.any(String) },
      ],
    });
    assertUnmeasuredInvariant(record);
  });

  // ⚠️ Mutation : laisser `SCHEMA_VERSION` à 4 (ou toute autre valeur que 5)
  // → rougit. Un renommage change le format autant qu'un ajout — même
  // incrément que prescrit specs/skill-55.md § Évolution (D3, SKILL-103).
  it('schema vaut 5', () => {
    expect(build(FULL_ARGV).schema).toBe(5);
  });

  // ⚠️ Mutation : oublier `tokensAtSpawn` dans le record produit (ou faire
  // qu'il remplace `tokens` au lieu de coexister) → rougit.
  it('tokensAtSpawn est présent, à côté de tokens et sans le remplacer', () => {
    const record = build(FULL_ARGV);
    expect(record.tokens).not.toBeNull();
    expect(record.tokensAtSpawn).not.toBeNull();
    expect(record.tokensAtSpawn.scope).toBe('session-to-spawn');
    expect(record.tokens.scope).toBe('session-to-date');
  });

  const NONE_ARGV = [
    '--ticket', 'SKILL-29', '--project', 'claude-config',
    '--repo', 'C:/Users/gibou/.claude', '--mode', 'cross-repo',
    '--sha', SHA40, '--date', '2026-08-19',
    '--model', 'sonnet', '--effort', 'none', '--review', 'none',
    '--dosage', 'none',
  ];

  // ⚠️ Mutation : écrire `r: 0, u: 0` en dosage `none` → rougit. Ce serait une
  // preuve inventée : « des relecteurs ont cherché et n'ont rien trouvé ».
  it('dosage none -> reviewed false, reviewers 0, findings [], r/u null AVEC motifs', () => {
    const record = build(NONE_ARGV);
    expect(record.reviewed).toBe(false);
    expect(record.reviewers).toBe(0);
    expect(record.findings).toEqual([]);
    expect(record.r).toBeNull();
    expect(record.u).toBeNull();
    expect(record.r).not.toBe(0); // assertion explicite exigée par la spec
    expect(record.u).not.toBe(0);
    const fields = record.unmeasured.map((e) => e.field);
    expect(fields).toContain('r');
    expect(fields).toContain('u');
    assertUnmeasuredInvariant(record);
  });

  // ⚠️ Mutation : dériver `reviewed` de `r === null` → rougit. C'est le cas
  // jumeau du précédent : ici des relecteurs ONT cherché.
  it('dosage light avec r=0 et u=0 -> reviewed true, r: 0, u: 0', () => {
    const record = build([
      '--ticket', 'SKILL-29', '--project', 'claude-config',
      '--repo', 'C:/Users/gibou/.claude', '--mode', 'same-repo',
      '--sha', SHA40, '--date', '2026-08-19',
      '--model', 'sonnet', '--effort', 'think', '--review', 'light',
      '--dosage', 'light', '--reviewers', '1', '--r', '0', '--u', '0',
    ]);
    expect(record.reviewed).toBe(true);
    expect(record.r).toBe(0);
    expect(record.u).toBe(0);
    expect(record.reviewers).toBe(1);
    expect(record.controls.lightRequalsU).toBe(true);
    assertUnmeasuredInvariant(record);
  });

  // ⚠️ Mutation : refuser d'écrire quand un contrôle est faux → rougit.
  // L'écrivain CONSTATE, il ne corrige ni ne se tait.
  it('u différent du nombre de findings -> controls.uMatchesFindings false, enregistrement produit quand même', () => {
    const record = build([...FULL_ARGV, '--finding', '1|A|corrigé|9f2c1ab|un seul finding déclaré']);
    expect(record.u).toBe(4);
    expect(record.findings).toHaveLength(1);
    expect(record.controls.uMatchesFindings).toBe(false);
    expect(record.ticket).toBe('SKILL-29');
  });

  // ⚠️ Mutation (gate de revue, findings nº 1 et nº 4) : rendre `refVerified`
  // au sein de `findings` sans peupler `unmeasured`, ou laisser
  // `refVerifiedReason` survivre dans l'enregistrement final → rougit.
  it('finding `corrigé` avec refVerified null -> entrée `unmeasured` nommée par son numéro, `refVerifiedReason` disparaît', () => {
    const argv = [...FULL_ARGV, '--finding', '1|A|corrigé|9f2c1ab|un ref non vérifiable'];
    const parsed = parseArgs(argv);
    expect(parsed.ok, parsed.error).toBe(true);
    const findings = verifyFindingRefs(parsed.args.findings, '', () => ({ status: 0 }));
    const record = buildRecord({
      args: parsed.args,
      session: { id: 'a334e39e-a56d-482b-8ff6-3704ae845b66', transcript: '/tmp/a334e39e.jsonl' },
      metrics: metricsOf('write-cycle-session.jsonl'),
      shaCheck: { verified: true, reason: null },
      findings,
      now: NOW,
    });
    expect(record.findings[0].refVerified).toBeNull();
    expect(record.findings[0]).not.toHaveProperty('refVerifiedReason');
    const entry = record.unmeasured.find((e) => e.field === 'findings[1].refVerified');
    expect(entry, 'aucune entrée `unmeasured` pour `findings[1].refVerified`').toBeDefined();
    expect(entry.reason.length).toBeGreaterThan(0);
    // ⚠️ Mutation (SKILL-56) : rendre `shaReachableFromBranch` sans entrée
    // `unmeasured`, ou laisser `shaReachableFromBranchReason` survivre dans
    // l'enregistrement final → rougit. Même garde que `refVerified` ci-dessus.
    expect(record.findings[0].shaReachableFromBranch).toBeNull();
    expect(record.findings[0]).not.toHaveProperty('shaReachableFromBranchReason');
    const reachEntry = record.unmeasured.find((e) => e.field === 'findings[1].shaReachableFromBranch');
    expect(reachEntry, 'aucune entrée `unmeasured` pour `findings[1].shaReachableFromBranch`').toBeDefined();
    expect(reachEntry.reason.length).toBeGreaterThan(0);
    assertUnmeasuredInvariant(record);
  });

  // ⚠️ Mutation : normaliser r à `max(r, u)` → rougit.
  it('r inférieur à u -> controls.rAtLeastU false', () => {
    const record = build(argvWith({ '--r': '2', '--u': '5' }));
    expect(record.controls.rAtLeastU).toBe(false);
  });

  // ⚠️ Mutation : appliquer lightRequalsU en `deep` → rougit (en `deep`,
  // `R > U` est le cas NOMINAL : le contrôle est sans objet).
  it('light avec r != u -> lightRequalsU false ; en deep -> null (sans objet)', () => {
    const light = build([
      '--ticket', 'SKILL-29', '--project', 'claude-config',
      '--repo', 'C:/Users/gibou/.claude', '--mode', 'same-repo',
      '--sha', SHA40, '--date', '2026-08-19',
      '--model', 'sonnet', '--effort', 'think', '--review', 'light',
      '--dosage', 'light', '--reviewers', '1', '--r', '3', '--u', '2',
    ]);
    expect(light.controls.lightRequalsU).toBe(false);

    const deep = build(FULL_ARGV);
    expect(deep.controls.lightRequalsU).toBeNull();
    expect(deep.unmeasured.map((e) => e.field)).toContain('controls.lightRequalsU');
  });

  // ⚠️ Mutation : recopier le défaut `light` dans `exec.review` quand le
  // frontmatter n'en porte pas → rougit. L'enregistrement doit distinguer
  // « frontmatter sans review » de « review: light déclaré ».
  it('frontmatter sans review -> exec.review null AVEC motif, jamais `light` recopié', () => {
    const record = build(argvWithout('--review'));
    expect(record.exec.review).toBeNull();
    expect(record.exec.review).not.toBe('light');
    expect(record.unmeasured.map((e) => e.field)).toContain('exec.review');
    // Le dosage réellement appliqué, lui, reste enregistré.
    expect(record.dosage).toBe('deep');
    assertUnmeasuredInvariant(record);
  });

  // ⚠️ Mutation : oublier l'entrée `unmeasured` d'un seul champ null → rougit,
  // par BALAYAGE, sans qu'aucun test n'ait à nommer le champ.
  it('invariant : tout champ null a son entrée unmeasured, et réciproquement', () => {
    const cases = [
      build(FULL_ARGV),
      build(NONE_ARGV),
      build(argvWithout('--review')),
      build(FULL_ARGV, { metrics: collectTranscriptMetrics({ raw: '', ticket: 'SKILL-29' }) }),
      build(FULL_ARGV, {
        session: { id: null, transcript: null },
        metrics: collectTranscriptMetrics({ raw: '', ticket: 'SKILL-29' }),
        shaCheck: { verified: null, reason: 'git indisponible' },
      }),
      build(FULL_ARGV, { shaCheck: { verified: false, reason: 'SHA absent du dépôt' } }),
    ];
    for (const record of cases) assertUnmeasuredInvariant(record);
  });

  // ⚠️ Mutation : lire l'horloge dans buildRecord (`new Date()`) → rougit.
  it('writtenAt vient de l’horloge injectée -> sortie déterministe', () => {
    expect(build(FULL_ARGV).writtenAt).toBe(NOW);
    const withDate = build(FULL_ARGV, { now: new Date('2026-01-02T03:04:05.678Z') });
    expect(withDate.writtenAt).toBe('2026-01-02T03:04:05.678Z');
    expect(build(FULL_ARGV)).toEqual(build(FULL_ARGV)); // pure : deux appels identiques
  });

  // ⚠️ Mutation : garder `date` de l'horloge → rougit. La date vient de
  // l'argument, jamais de l'horloge (règle de l'outil backlog).
  it('date vient de l’argument, jamais de l’horloge', () => {
    const record = build(argvWith({ '--date': '2026-07-01' }));
    expect(record.date).toBe('2026-07-01');
    expect(record.writtenAt).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// SKILL-103 — un `false` porte son motif dans un champ frère du booléen, sans
// jamais passer par `unmeasured` (réservé aux `null`). D1/D2 de specs/skill-103.md.
//
// ⛔ Composer, ne pas fabriquer (§ Tests, ⛔) : les cas de discernabilité
// passent par `verifySha` / `verifyFindingRefs` / `verifyRefReachableFromMain`
// RÉELLES, jamais par deux `shaCheck` écrits à la main.
describe('SKILL-103 — le motif d’un `false` survit, discernable de son voisin', () => {
  const tmpDirs = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function makeRepo() {
    return initGitRepo(tmpDirs, 'skill103-repo-');
  }

  // Bien formé (40 hexadécimaux), mais absent de la base d'objets de
  // n'importe quel dépôt jetable créé par `makeRepo`.
  const KNOWN_ABSENT_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  // -------------------------------------------------------------------------
  // shaVerified — trois régimes (Tests, cas 1-4)
  // -------------------------------------------------------------------------

  // Cas 1. shaVerified false AVEC motif -> shaVerifiedReason porte la chaîne
  // du contrôle, aucune entrée `unmeasured`.
  it('shaVerified false (SHA mal formé) -> shaVerifiedReason porte le motif, aucune entrée unmeasured', () => {
    const repo = makeRepo();
    const shaCheck = verifySha(repo, 'e4d8956'); // 7 caractères — le cas réel du § Symptôme
    expect(shaCheck.verified).toBe(false);
    const record = build(FULL_ARGV, { shaCheck });
    expect(record.shaVerified).toBe(false);
    expect(record.shaVerifiedReason).toMatch(/mal formé/);
    expect(record.unmeasured.map((e) => e.field)).not.toContain('shaVerified');
    assertUnmeasuredInvariant(record);
  });

  // Discernabilité : le second mode de `false`, textuellement distinct du
  // premier — c'est l'objet même du ticket (§ Symptôme, § Cause racine).
  it('shaVerified false (SHA absent du dépôt) -> motif nommant "absent", distinct du "mal formé"', () => {
    const repo = makeRepo();
    const shaCheck = verifySha(repo, KNOWN_ABSENT_SHA);
    expect(shaCheck.verified).toBe(false);
    const record = build(FULL_ARGV, { shaCheck });
    expect(record.shaVerifiedReason).toMatch(/absent/);
    expect(record.shaVerifiedReason).not.toMatch(/mal formé/);
  });

  // Cas 2. shaVerified null -> RÉGIME INCHANGÉ : entrée `unmeasured` avec
  // motif, `shaVerifiedReason` absent.
  it('shaVerified null -> unmeasured avec motif (inchangé), shaVerifiedReason absent', () => {
    const record = build(FULL_ARGV, { shaCheck: { verified: null, reason: 'git indisponible' } });
    expect(record.shaVerified).toBeNull();
    expect(record).not.toHaveProperty('shaVerifiedReason');
    const entry = record.unmeasured.find((e) => e.field === 'shaVerified');
    expect(entry, 'aucune entrée unmeasured pour shaVerified').toBeDefined();
    expect(entry.reason).toBe('git indisponible');
    assertUnmeasuredInvariant(record);
  });

  // Cas 3. shaVerified true -> ni l'un ni l'autre.
  it('shaVerified true -> ni shaVerifiedReason ni entrée unmeasured', () => {
    const record = build(FULL_ARGV, { shaCheck: { verified: true, reason: null } });
    expect(record.shaVerified).toBe(true);
    expect(record).not.toHaveProperty('shaVerifiedReason');
    expect(record.unmeasured.map((e) => e.field)).not.toContain('shaVerified');
  });

  // Cas 4. shaVerified false SANS `reason` -> le repli symétrique de D2
  // s'applique ; le champ n'est jamais `undefined` (preuve en mémoire — la
  // preuve complète, sur le disque, est le cas 13 plus bas).
  it('shaVerified false sans `reason` -> repli, jamais `undefined`', () => {
    const record = build(FULL_ARGV, { shaCheck: { verified: false } });
    expect(record.shaVerified).toBe(false);
    expect(typeof record.shaVerifiedReason).toBe('string');
    expect(record.shaVerifiedReason.length).toBeGreaterThan(0);
    expect(record.shaVerifiedReason).not.toBeUndefined();
  });

  // Gate de reprise, finding nº 1 : un `refVerified`/`shaReachableFromBranch`
  // à `false` livré SANS sa clé `…Reason` (donc PAS composé par
  // `verifyFindingRefs`, qui pose toujours les deux ensemble) doit quand même
  // recevoir le repli — le garde ne peut PAS tester la présence de la clé de
  // motif, seulement celle du champ mesuré.
  it('finding refVerified/shaReachableFromBranch false SANS la clé …Reason -> repli quand même, jamais nu', () => {
    const record = build(FULL_ARGV, {
      findings: [
        { i: 1, title: 't', reviewers: ['A'], disposition: 'corrigé', ref: 'abc', refVerified: false, shaReachableFromBranch: false },
      ],
    });
    expect(record.findings[0].refVerified).toBe(false);
    expect(typeof record.findings[0].refVerifiedReason).toBe('string');
    expect(record.findings[0].refVerifiedReason.length).toBeGreaterThan(0);
    expect(record.findings[0].shaReachableFromBranch).toBe(false);
    expect(typeof record.findings[0].shaReachableFromBranchReason).toBe('string');
    expect(record.findings[0].shaReachableFromBranchReason.length).toBeGreaterThan(0);
    expect(record.unmeasured.map((e) => e.field)).not.toContain('findings[1].refVerified');
    expect(record.unmeasured.map((e) => e.field)).not.toContain('findings[1].shaReachableFromBranch');
  });

  // Gate de reprise, finding nº 2 : le repli d'un `false` (aucune donnée
  // transmise) NE réutilise PAS le vocabulaire du repli d'un `null` — sinon un
  // `false` mesuré se lirait comme un `null` non mesuré, exactement la
  // confusion que ce ticket ferme.
  it('les replis de false ne réutilisent PAS le vocabulaire des replis de null', () => {
    const shaFalse = build(FULL_ARGV, { shaCheck: { verified: false } });
    const shaNull = build(FULL_ARGV, { shaCheck: { verified: null } });
    expect(shaFalse.shaVerifiedReason).not.toBe(shaNull.unmeasured.find((e) => e.field === 'shaVerified').reason);

    const findingsFalse = [
      { i: 1, title: 't', reviewers: ['A'], disposition: 'corrigé', ref: 'abc', refVerified: false, shaReachableFromBranch: false },
    ];
    // Dépôt inconnu (`''`) : `verifyFindingRefs` rend `refVerified: null`, le
    // régime que le repli ne doit surtout pas imiter.
    const findingsNull = verifyFindingRefs(
      [{ i: 1, title: 't', reviewers: ['A'], disposition: 'corrigé', ref: '9f2c1ab' }],
      ''
    );
    const recFalse = build(FULL_ARGV, { findings: findingsFalse });
    const recNull = build(FULL_ARGV, { findings: findingsNull });
    const nullReason = recNull.unmeasured.find((e) => e.field === 'findings[1].refVerified').reason;
    expect(recFalse.findings[0].refVerifiedReason).not.toBe(nullReason);
  });

  // -------------------------------------------------------------------------
  // findings[].refVerified / findings[].shaReachableFromBranch — Tests cas 5-10
  // -------------------------------------------------------------------------

  function findingWithRef(repo, ref) {
    const findings = [{ i: 1, title: 't', reviewers: ['A'], disposition: 'corrigé', ref }];
    return verifyFindingRefs(findings, repo);
  }

  // Cas 5. refVerified false (finding `corrigé` sans `ref`) -> motif dans le
  // finding, aucune entrée `unmeasured`.
  it('finding refVerified false (sans ref) -> motif DANS le finding, aucune entrée unmeasured', () => {
    const repo = makeRepo();
    const findings = findingWithRef(repo, null);
    const record = build(FULL_ARGV, { findings });
    expect(record.findings[0].refVerified).toBe(false);
    expect(record.findings[0].refVerifiedReason).toMatch(/sans .*ref|ref.*attendu/i);
    expect(record.unmeasured.map((e) => e.field)).not.toContain('findings[1].refVerified');
    assertUnmeasuredInvariant(record);
  });

  // Discernabilité : `ref` mal formé, un motif distinct du précédent.
  it('finding refVerified false (ref mal formé) -> motif distinct de "sans ref"', () => {
    const repo = makeRepo();
    const findings = findingWithRef(repo, 'not-a-sha!!');
    const record = build(FULL_ARGV, { findings });
    expect(record.findings[0].refVerified).toBe(false);
    expect(record.findings[0].refVerifiedReason).toMatch(/mal formé/);
    expect(record.findings[0].refVerifiedReason).not.toMatch(/sans .*ref|ref.*attendu/i);
  });

  // Discernabilité : `ref` absent du dépôt, un troisième motif distinct.
  it('finding refVerified false (ref absent du dépôt) -> motif distinct des deux précédents', () => {
    const repo = makeRepo();
    const findings = findingWithRef(repo, KNOWN_ABSENT_SHA);
    const record = build(FULL_ARGV, { findings });
    expect(record.findings[0].refVerified).toBe(false);
    expect(record.findings[0].refVerifiedReason).toMatch(/absent/);
    expect(record.findings[0].refVerifiedReason).not.toMatch(/mal formé/);
    expect(record.findings[0].refVerifiedReason).not.toMatch(/sans .*ref|ref.*attendu/i);
  });

  // Cas 6. refVerified null (dépôt inconnu) -> RÉGIME INCHANGÉ.
  it('finding refVerified null (dépôt inconnu) -> unmeasured (inchangé), refVerifiedReason absent', () => {
    const findings = findingWithRef('', '9f2c1ab');
    const record = build(FULL_ARGV, { findings });
    expect(record.findings[0].refVerified).toBeNull();
    expect(record.findings[0]).not.toHaveProperty('refVerifiedReason');
    expect(record.unmeasured.map((e) => e.field)).toContain('findings[1].refVerified');
    assertUnmeasuredInvariant(record);
  });

  // Cas 7 + piège D1 : refVerified true -> ni `refVerifiedReason` (posé à
  // `null` par `verifyFindingRefs`) ni entrée `unmeasured` — sinon un `null`
  // sans entrée, invisible à `assertUnmeasuredInvariant` (nullPaths ne balaie
  // pas `findings`).
  it('finding refVerified true -> ni refVerifiedReason ni entrée unmeasured (piège D1)', () => {
    const repo = makeRepo();
    const head = git(repo, ['rev-parse', 'HEAD']);
    const findings = findingWithRef(repo, head);
    const record = build(FULL_ARGV, { findings });
    expect(record.findings[0].refVerified).toBe(true);
    expect(record.findings[0]).not.toHaveProperty('refVerifiedReason');
    expect(record.unmeasured.map((e) => e.field)).not.toContain('findings[1].refVerified');
    assertUnmeasuredInvariant(record);
  });

  // Cas 8-10, shaReachableFromBranch, mêmes trois régimes. Table de
  // discernabilité (§ Tests) : dérivé de refVerified false (sans ref · mal
  // formé · absent) et non-ancêtre de main (code 1, dépôt jetable réel).
  it('finding shaReachableFromBranch false, DÉRIVÉ de refVerified false (sans ref) -> même motif, dans le finding', () => {
    const repo = makeRepo();
    const findings = findingWithRef(repo, null);
    const record = build(FULL_ARGV, { findings });
    expect(record.findings[0].shaReachableFromBranch).toBe(false);
    expect(record.findings[0].shaReachableFromBranchReason).toMatch(/sans .*ref|ref.*attendu/i);
    expect(record.unmeasured.map((e) => e.field)).not.toContain('findings[1].shaReachableFromBranch');
  });

  it('finding shaReachableFromBranch false, DÉRIVÉ de refVerified false (ref absent du dépôt) -> motif "ref non existant", distinct', () => {
    const repo = makeRepo();
    const findings = findingWithRef(repo, KNOWN_ABSENT_SHA);
    const record = build(FULL_ARGV, { findings });
    expect(record.findings[0].shaReachableFromBranch).toBe(false);
    expect(record.findings[0].shaReachableFromBranchReason).toMatch(/ref non existant/i);
    expect(record.findings[0].shaReachableFromBranchReason).not.toMatch(/sans .*ref|ref.*attendu/i);
  });

  // Reproduit le scénario réel de specs/skill-56.md (rebase) : `refVerified`
  // reste `true` (reflog), mais `shaReachableFromBranch` est `false` — motif
  // « n'est pas ancêtre de main », un TROISIÈME mode distinct des deux
  // dérivés ci-dessus.
  it('finding shaReachableFromBranch false, NON-ANCÊTRE de main (code 1 réel) -> motif distinct des dérivés', () => {
    const repo = makeRepo();
    git(repo, ['checkout', '-q', '-b', 'feat']);
    fs.writeFileSync(path.join(repo, 'b.txt'), '1\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'feat commit']);
    const featSha = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['checkout', '-q', 'main']);
    // `feat` n'est jamais fusionnée dans `main` : le `ref` existe (refVerified
    // true) mais n'est ancêtre de rien.
    const findings = findingWithRef(repo, featSha);
    const record = build(FULL_ARGV, { findings });
    expect(record.findings[0].refVerified).toBe(true);
    expect(record.findings[0].shaReachableFromBranch).toBe(false);
    expect(record.findings[0].shaReachableFromBranchReason).toMatch(/n'est pas ancêtre/);
    expect(record.findings[0].shaReachableFromBranchReason).not.toMatch(/ref non existant/i);
    expect(record.findings[0].shaReachableFromBranchReason).not.toMatch(/sans .*ref|ref.*attendu/i);
  });

  it('finding shaReachableFromBranch null (dépôt inconnu) -> RÉGIME INCHANGÉ', () => {
    const findings = findingWithRef('', '9f2c1ab');
    const record = build(FULL_ARGV, { findings });
    expect(record.findings[0].shaReachableFromBranch).toBeNull();
    expect(record.findings[0]).not.toHaveProperty('shaReachableFromBranchReason');
    expect(record.unmeasured.map((e) => e.field)).toContain('findings[1].shaReachableFromBranch');
    assertUnmeasuredInvariant(record);
  });

  it('finding shaReachableFromBranch true -> ni motif ni entrée unmeasured', () => {
    const repo = makeRepo();
    const head = git(repo, ['rev-parse', 'HEAD']);
    const findings = findingWithRef(repo, head);
    const record = build(FULL_ARGV, { findings });
    expect(record.findings[0].shaReachableFromBranch).toBe(true);
    expect(record.findings[0]).not.toHaveProperty('shaReachableFromBranchReason');
  });

  // -------------------------------------------------------------------------
  // Cas 11 — bijection : passer par l'helper EXISTANT, ne pas en écrire un neuf.
  // -------------------------------------------------------------------------
  it('bijection : chaque record ci-dessus, passé une nouvelle fois par assertUnmeasuredInvariant', () => {
    const repo = makeRepo();
    const head = git(repo, ['rev-parse', 'HEAD']);
    const cases = [
      build(FULL_ARGV, { shaCheck: verifySha(repo, 'e4d8956') }),
      build(FULL_ARGV, { shaCheck: { verified: null, reason: 'git indisponible' } }),
      build(FULL_ARGV, { shaCheck: { verified: true, reason: null } }),
      build(FULL_ARGV, { findings: findingWithRef(repo, null) }),
      build(FULL_ARGV, { findings: findingWithRef('', '9f2c1ab') }),
      build(FULL_ARGV, { findings: findingWithRef(repo, head) }),
    ];
    for (const record of cases) assertUnmeasuredInvariant(record);
  });

  // -------------------------------------------------------------------------
  // Cas 12 — SCHEMA_VERSION === 5, et un record produit porte `schema: 5`.
  // -------------------------------------------------------------------------
  it('SCHEMA_VERSION vaut 5, et le record produit porte schema: 5', () => {
    expect(SCHEMA_VERSION).toBe(5);
    expect(build(FULL_ARGV).schema).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Cas 13 — le fichier ÉCRIT, relu. Sans lui, un `shaVerifiedReason:
  // undefined` passe tous les cas en mémoire (`toHaveProperty` est vrai sur
  // `undefined`) et `JSON.stringify` (`write.mjs:1474`) écrit un `false` nu
  // sur le disque : le bug livré intact, suite verte.
  // -------------------------------------------------------------------------
  it('le fichier écrit sur disque porte shaVerifiedReason en chaîne, jamais absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill103-root-'));
    tmpDirs.push(root);
    const record = build(FULL_ARGV, { shaCheck: { verified: false } });
    const written = writeRecord(root, record);
    const onDisk = JSON.parse(fs.readFileSync(written, 'utf8'));
    expect(onDisk.shaVerified).toBe(false);
    expect(typeof onDisk.shaVerifiedReason).toBe('string');
    expect(onDisk.shaVerifiedReason.length).toBeGreaterThan(0);
  });

  it('le fichier écrit sur disque porte refVerifiedReason/shaReachableFromBranchReason dans le finding, jamais à la racine', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill103-root-2'));
    tmpDirs.push(root);
    const repo = makeRepo();
    const findings = findingWithRef(repo, KNOWN_ABSENT_SHA);
    const record = build(FULL_ARGV, { findings });
    const written = writeRecord(root, record);
    const onDisk = JSON.parse(fs.readFileSync(written, 'utf8'));
    expect(onDisk.findings[0].refVerifiedReason).toMatch(/absent/);
    expect(onDisk.findings[0].shaReachableFromBranchReason).toMatch(/ref non existant/i);
    expect(onDisk).not.toHaveProperty('refVerifiedReason');
    expect(onDisk).not.toHaveProperty('shaReachableFromBranchReason');
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-29 — recordPath', () => {
  const BASE = {
    date: '2026-08-19',
    ticket: 'SKILL-29',
    session: { id: 'a334e39e-a56d-482b-8ff6-3704ae845b66' },
    spawnIndex: 3,
  };

  // ⚠️ Mutation : changer le format (mois retiré, session complète, rang non
  // paddé) → rougit.
  it('cas nominal -> cycles/2026-08/2026-08-19-SKILL-29-a334e39e-s03.json', () => {
    expect(recordPath(BASE)).toBe('cycles/2026-08/2026-08-19-SKILL-29-a334e39e-s03.json');
  });

  // ⚠️ Mutation : formater `null` en `s00` → rougit (un rang inconnu se lirait
  // « premier lancement de la session »).
  it('spawnIndex null -> suffixe -sxx', () => {
    expect(recordPath({ ...BASE, spawnIndex: null })).toMatch(/-sxx\.json$/);
    expect(recordPath({ ...BASE, spawnIndex: null })).not.toMatch(/-s00\.json$/);
  });

  // ⚠️ Mutation : laisser un segment vide → rougit (le nom deviendrait
  // impossible à reparser).
  it('session id absente -> un segment de remplacement stable, pas une chaîne vide', () => {
    const p = recordPath({ ...BASE, session: { id: null } });
    expect(p).not.toContain('--');
    expect(p).toBe('cycles/2026-08/2026-08-19-SKILL-29-nosession-s03.json');
    expect(recordPath({ ...BASE, session: {} })).toBe(p);
  });

  // ⚠️ Mutation : retirer l'assainissement → rougit. Les caractères nommés ici
  // sont `/`, `\`, `:` et `..` — un `../` non assaini ferait écrire HORS de la
  // racine du dépôt de mesures.
  it('identifiant de ticket hostile au système de fichiers -> assaini', () => {
    const p = recordPath({ ...BASE, ticket: '../SKILL:29/..\\evil' });
    expect(p).not.toContain('..');
    expect(p).not.toContain('/SKILL');
    expect(p).not.toContain(':');
    expect(p).not.toContain('\\');
    expect(p).toBe('cycles/2026-08/2026-08-19-___SKILL_29____evil-a334e39e-s03.json');
  });

  // ⚠️ Mutation : dériver le mois de l'horloge → rougit.
  it('le mois vient de la date de l’enregistrement', () => {
    expect(recordPath({ ...BASE, date: '2026-01-05' })).toBe(
      'cycles/2026-01/2026-01-05-SKILL-29-a334e39e-s03.json'
    );
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-29 — writeRecord', () => {
  const tmpDirs = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function makeRoot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill29-root-'));
    tmpDirs.push(dir);
    return dir;
  }

  const RECORD = {
    schema: 1,
    ticket: 'SKILL-29',
    date: '2026-08-19',
    session: { id: 'a334e39e-a56d-482b-8ff6-3704ae845b66' },
    spawnIndex: 3,
    unmeasured: [],
  };

  // ⚠️ Mutation : écrire à plat (sans `cycles/<AAAA-MM>/`) → rougit.
  it('cible inexistante -> répertoires créés SOUS la racine, chemin absolu rendu', () => {
    const root = makeRoot();
    const written = writeRecord(root, RECORD);
    expect(path.isAbsolute(written)).toBe(true);
    expect(path.resolve(written).startsWith(path.resolve(root))).toBe(true);
    expect(fs.existsSync(written)).toBe(true);
    expect(written.replace(/\\/g, '/')).toContain('cycles/2026-08/');
  });

  // ⚠️ Mutation : `mkdirSync` sur un chemin construit hors de `root` → rougit.
  it('les répertoires créés le sont sous la racine du dépôt UNIQUEMENT', () => {
    const created = [];
    const fakeFs = {
      mkdirSync(p) {
        created.push(String(p));
      },
      writeFileSync() {},
    };
    writeRecord('C:/racine', { ...RECORD, ticket: '../evil' }, { fs: fakeFs });
    expect(created).toHaveLength(1);
    for (const p of created) {
      expect(path.resolve(p).startsWith(path.resolve('C:/racine'))).toBe(true);
    }
  });

  // ⚠️ Mutation : retirer le flag `wx` (ou la boucle de suffixe) → rougit :
  // un constat déjà écrit ne se réécrit pas.
  it('fichier déjà présent -> jamais écrasé : suffixe -2, puis -3', () => {
    const root = makeRoot();
    const first = writeRecord(root, RECORD);
    const firstContent = fs.readFileSync(first, 'utf8');

    const second = writeRecord(root, { ...RECORD, ticket: 'SKILL-29' });
    const third = writeRecord(root, { ...RECORD, ticket: 'SKILL-29' });

    expect(second).not.toBe(first);
    expect(second.endsWith('-2.json')).toBe(true);
    expect(third.endsWith('-3.json')).toBe(true);
    expect(fs.readFileSync(first, 'utf8')).toBe(firstContent);
  });

  // ⚠️ Mutation : avaler l'erreur d'écriture et rendre un chemin → rougit.
  it('échec d’écriture -> erreur remontée, aucun fichier partiel', () => {
    const fakeFs = {
      mkdirSync() {},
      writeFileSync() {
        const err = new Error('EACCES simulé');
        err.code = 'EACCES';
        throw err;
      },
    };
    expect(() => writeRecord('C:/racine', RECORD, { fs: fakeFs })).toThrow(/EACCES/);
  });

  // ⚠️ Mutation : écrire autre chose que l'enregistrement (résumé, champs
  // filtrés) → rougit.
  it('le JSON écrit se relit et est identique à l’enregistrement', () => {
    const root = makeRoot();
    const written = writeRecord(root, RECORD);
    expect(JSON.parse(fs.readFileSync(written, 'utf8'))).toEqual(RECORD);
  });
});

// ---------------------------------------------------------------------------
describe('SKILL-29 — main (orchestrateur du script)', () => {
  const tmpDirs = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  const SESSION = 'a334e39e-a56d-482b-8ff6-3704ae845b66';

  function makeHome({ metrics = true, git = true, transcript = 'write-cycle-session.jsonl' } = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill29-home-'));
    tmpDirs.push(home);
    if (metrics) {
      fs.mkdirSync(path.join(home, 'sdd-metrics'));
      if (git) fs.mkdirSync(path.join(home, 'sdd-metrics', '.git'));
    }
    const projects = path.join(home, '.claude', 'projects');
    fs.mkdirSync(path.join(projects, 'slug-quelconque'), { recursive: true });
    if (transcript) {
      fs.writeFileSync(path.join(projects, 'slug-quelconque', `${SESSION}.jsonl`), readFixture(transcript));
    }
    return home;
  }

  function runMain(argv, { home, env = { CLAUDE_CODE_SESSION_ID: SESSION }, runResult = { status: 0 } } = {}) {
    const out = [];
    const err = [];
    const gitCalls = [];
    const code = main(argv, {
      homedir: home,
      env,
      now: '2026-08-19T21:04:11.512Z',
      run: (cmd, args) => {
        gitCalls.push([cmd, ...args]);
        return typeof runResult === 'function' ? runResult(cmd, args) : runResult;
      },
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    return { code, stdout: out.join(''), stderr: err.join(''), gitCalls };
  }

  // ⚠️ Mutation : écrire le chemin sur stderr (ou ne rien écrire) → rougit :
  // l'Étape 7 du skill affiche ce chemin.
  it('chemin complet, dépôt présent -> code 0, chemin absolu sur stdout, fichier écrit', () => {
    const home = makeHome();
    const res = runMain(FULL_ARGV, { home });
    expect(res.code, res.stderr).toBe(0);
    const written = res.stdout.trim();
    expect(path.isAbsolute(written)).toBe(true);
    expect(fs.existsSync(written)).toBe(true);
    const record = JSON.parse(fs.readFileSync(written, 'utf8'));
    expect(record.ticket).toBe('SKILL-29');
    expect(record.spawnIndex).toBe(1);
    expect(record.session.id).toBe(SESSION);
    expect(record.tokens.output).toBe(150);
    expect(record.writtenAt).toBe('2026-08-19T21:04:11.512Z');
  });

  // ⚠️ Mutation : rendre 1 quand le dépôt manque → rougit. Le cycle ne doit pas
  // échouer parce que le dépôt de données manque (no-op de D11).
  it('dépôt absent -> code 0, motif sur stderr, stdout VIDE, aucune écriture', () => {
    const home = makeHome({ metrics: false });
    const res = runMain(FULL_ARGV, { home });
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/sdd-metrics/);
    expect(fs.existsSync(path.join(home, 'sdd-metrics'))).toBe(false);
  });

  // ⚠️ Mutation : accepter un dossier homonyme sans `.git` → rougit.
  it('dépôt sans .git -> code 0, motif sur stderr, rien d’écrit', () => {
    const home = makeHome({ git: false });
    const res = runMain(FULL_ARGV, { home });
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/\.git/);
    expect(fs.readdirSync(path.join(home, 'sdd-metrics'))).toEqual([]);
  });

  // ⚠️ Mutation : compléter l'argument manquant par une valeur par défaut →
  // rougit.
  it('argument requis manquant -> code 1, rien d’écrit', () => {
    const home = makeHome();
    const res = runMain(argvWithout('--ticket'), { home });
    expect(res.code).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('--ticket');
    expect(fs.readdirSync(path.join(home, 'sdd-metrics'))).toEqual(['.git']);
  });

  // ⚠️ Mutation : faire échouer l'écrivain quand le transcript manque → rougit.
  // L'absence de mesure est une mesure ; l'absence de fichier n'en est pas une.
  it('transcript introuvable -> code 0, fichier ÉCRIT avec spawnIndex et tokens null + motifs', () => {
    const home = makeHome({ transcript: null });
    const res = runMain(FULL_ARGV, { home });
    expect(res.code, res.stderr).toBe(0);
    const record = JSON.parse(fs.readFileSync(res.stdout.trim(), 'utf8'));
    expect(record.spawnIndex).toBeNull();
    expect(record.tokens).toBeNull();
    expect(record.session.transcript).toBeNull();
    const fields = record.unmeasured.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['spawnIndex', 'tokens', 'session.transcript']));
    for (const e of record.unmeasured) expect(e.reason.length).toBeGreaterThan(0);
  });

  // ⚠️ Mutation : deviner la session (dernier fichier modifié du dossier) →
  // rougit. Le motif doit nommer la variable d'environnement.
  it('session id absente de l’environnement injecté -> fichier écrit, motif explicite', () => {
    const home = makeHome();
    const res = runMain(FULL_ARGV, { home, env: {} });
    expect(res.code, res.stderr).toBe(0);
    const record = JSON.parse(fs.readFileSync(res.stdout.trim(), 'utf8'));
    expect(record.session.id).toBeNull();
    expect(record.session.transcript).toBeNull();
    const reason = record.unmeasured.find((e) => e.field === 'session.transcript').reason;
    expect(reason).toContain('CLAUDE_CODE_SESSION_ID');
  });

  // ⚠️ Mutation : sortir sans écrire en dosage `none` → rougit. C'est le
  // « Fini quand » de l'épic.
  it('dosage none -> un fichier est bel et bien écrit', () => {
    const home = makeHome();
    const res = runMain(
      [
        '--ticket', 'SKILL-29', '--project', 'claude-config',
        '--repo', 'C:/Users/gibou/.claude', '--mode', 'cross-repo',
        '--sha', SHA40, '--date', '2026-08-19',
        '--model', 'sonnet', '--effort', 'none', '--review', 'none',
        '--dosage', 'none',
      ],
      { home }
    );
    expect(res.code, res.stderr).toBe(0);
    const record = JSON.parse(fs.readFileSync(res.stdout.trim(), 'utf8'));
    expect(record.reviewed).toBe(false);
    expect(record.reviewers).toBe(0);
    expect(record.r).toBeNull();
  });

  // ⚠️ Mutation : ajouter un `git add`/`git commit` « pour ranger » → rougit.
  // Des commits concurrents depuis 10-15 sessions rouvriraient la classe de
  // panne (`index.lock`) que « un fichier par cycle » ferme.
  it('aucun appel git mutant (add, commit, init, checkout)', () => {
    const home = makeHome();
    const res = runMain(FULL_ARGV, { home });
    expect(res.code, res.stderr).toBe(0);
    expect(res.gitCalls.length).toBeGreaterThan(0); // la vérification du SHA a bien eu lieu
    for (const call of res.gitCalls) {
      for (const mutating of ['add', 'commit', 'init', 'checkout', 'push', 'rm']) {
        expect(call, `commande git mutante : ${call.join(' ')}`).not.toContain(mutating);
      }
    }
  });

  // ⚠️ Mutation : écraser un fichier existant en cas de relance → rougit.
  it('deux exécutions du même cycle -> deux fichiers, aucun écrasement', () => {
    const home = makeHome();
    const first = runMain(FULL_ARGV, { home }).stdout.trim();
    const second = runMain(FULL_ARGV, { home }).stdout.trim();
    expect(second).not.toBe(first);
    expect(fs.existsSync(first)).toBe(true);
    expect(fs.existsSync(second)).toBe(true);
  });

  // ⚠️ Mutation (SKILL-46) : faire échouer le cycle sur un `ref` de finding mort
  // (code de sortie non nul, ou aucune écriture) → rougit. Vérifié EN RÉEL, pas
  // déduit : le fichier est écrit, sort en 0, et porte le constat.
  it('finding `corrigé` avec un ref mort -> constat non bloquant, code 0, refVerified false', () => {
    const home = makeHome();
    const res = runMain(
      [...FULL_ARGV, '--finding', '1|A|corrigé|deadbee|un ref jamais rebasé'],
      {
        home,
        // ⚠️ `git` est MOCKÉ ici (`run` injecté) : ce test vérifie le câblage de
        // `main()` (code 0, non-bloquant, propagation du constat), pas le
        // triage réel des codes de sortie de `merge-base --is-ancestor` sur un
        // objet inconnu (128, PAS 1 — cf. le dépôt jetable RÉEL, describe
        // « SKILL-56 — cas central … », pour ce dernier). `verifyFindingRefs`
        // (SKILL-56) ne calcule `shaReachableFromBranch` par un second appel
        // git QUE si `refVerified` est déjà `true` — sur ce `ref` mort,
        // `merge-base` n'est donc jamais invoqué : `shaReachableFromBranch`
        // dérive directement de `refVerified: false`, sans dépendre du code de
        // sortie que ce mock choisirait de rendre pour `merge-base`.
        runResult: (cmd, callArgs) => {
          if (callArgs.some((a) => a.startsWith('deadbee'))) return { status: 1, stdout: '', stderr: '' };
          return { status: 0, stdout: `${SHA40}\n`, stderr: '' };
        },
      }
    );
    expect(res.code, res.stderr).toBe(0);
    const record = JSON.parse(fs.readFileSync(res.stdout.trim(), 'utf8'));
    expect(record.findings).toHaveLength(1);
    expect(record.findings[0].refVerified).toBe(false);
    // ⚠️ Mutation (SKILL-56) : rendre `shaReachableFromBranch` bloquant, ou ne
    // pas le peupler → rougit. C'est l'assertion de non-blocage exigée par le
    // § Tests de specs/skill-56.md.
    expect(record.findings[0].shaReachableFromBranch).toBe(false);
  });

  // ⚠️ Mutation : vérifier le `ref` d'un `E1`/`E2`/`E3` comme un SHA → rougit
  // (faux négatif systématique sur `E2`, dont le `ref` est un identifiant de
  // ticket). Rejoue un cycle avec escalade (E1) et un cycle avec dette
  // préexistante (E2) : aucun `ref` n'y est signalé mort à tort.
  it('E1/E2 ne produisent aucun faux ref mort', () => {
    const home = makeHome();
    const res = runMain(
      [
        ...FULL_ARGV,
        '--finding', '1|A|E1||un défaut qui exige de changer la spec',
        '--finding', '2|B|E2|SKILL-99|dette préexistante',
      ],
      { home }
    );
    expect(res.code, res.stderr).toBe(0);
    const record = JSON.parse(fs.readFileSync(res.stdout.trim(), 'utf8'));
    expect(record.findings.map((f) => f.refVerified)).toEqual([undefined, undefined]);
    // ⚠️ Mutation (SKILL-56) : vérifier `shaReachableFromBranch` sur un `ref`
    // de `E1`/`E2` → rougit (même faux négatif systématique sur `E2`).
    expect(record.findings.map((f) => f.shaReachableFromBranch)).toEqual([undefined, undefined]);
  });

  // Cas 13 (SKILL-103, gate de reprise finding nº 5) — le câblage COMPLET,
  // `argv` → `main()` → `verifySha` interne (pas un `shaCheck` fabriqué) →
  // `buildRecord` → disque. Les deux tests `writeRecord` seuls (plus haut,
  // même fichier) ne prouvent que la moitié aval (`JSON.stringify` ne jette
  // pas le champ) : celui-ci prouve que `main()` transmet bien `shaCheck` EN
  // ENTIER à `buildRecord`, pas seulement `shaCheck.verified` — un
  // appareillage qu'une normalisation future (`shaCheck: { verified: … }`,
  // le geste naturel pour qui ne croit lire qu'un booléen) romprait en
  // silence, cf. `write.mjs:1604`.
  it('main() : SHA mal formé -> shaVerifiedReason persisté sur le disque, via verifySha réel', () => {
    const home = makeHome();
    const res = runMain(argvWith({ '--sha': 'e4d8956' }), { home });
    expect(res.code, res.stderr).toBe(0);
    const record = JSON.parse(fs.readFileSync(res.stdout.trim(), 'utf8'));
    expect(record.shaVerified).toBe(false);
    expect(record.shaVerifiedReason).toMatch(/mal formé/);
    expect(record.unmeasured.map((e) => e.field)).not.toContain('shaVerified');
  });

  // Même câblage complet pour les deux champs de `findings[]` — `main()` →
  // `verifyFindingRefs` réel → `buildRecord` → disque.
  it('main() : finding avec un ref mal formé -> refVerifiedReason/shaReachableFromBranchReason persistés, dans le finding', () => {
    const home = makeHome();
    const res = runMain(
      [...FULL_ARGV, '--finding', '1|A|corrigé|not-a-sha!!|un ref mal recopié'],
      { home }
    );
    expect(res.code, res.stderr).toBe(0);
    const record = JSON.parse(fs.readFileSync(res.stdout.trim(), 'utf8'));
    expect(record.findings).toHaveLength(1);
    expect(record.findings[0].refVerified).toBe(false);
    expect(record.findings[0].refVerifiedReason).toMatch(/mal formé/);
    expect(record.findings[0].shaReachableFromBranch).toBe(false);
    expect(record.findings[0].shaReachableFromBranchReason).toMatch(/ref non existant/i);
    expect(record).not.toHaveProperty('refVerifiedReason');
    expect(record).not.toHaveProperty('shaReachableFromBranchReason');
  });
});

// ---------------------------------------------------------------------------
// specs/skill-29.md § Schéma nomme les deux champs (SKILL-56, D3) — assertion
// SCOPÉE à la sous-section, jamais satisfaite par une mention ailleurs dans le
// fichier. `~/sdd-metrics/README.md` n'a délibérément AUCUNE assertion ici :
// hors dépôt, son état dépend d'un commit de l'utilisateur (§ Vérification 5
// de specs/skill-56.md, manuelle).
describe('SKILL-56 — specs/skill-29.md § Schéma nomme refVerified et shaReachableFromBranch', () => {
  const REPO_ROOT = path.join(__dirname, '..');
  const SPEC_REL = 'specs/skill-29.md';
  const SCHEMA_HEADING_RE = /^### Schéma du fichier/;

  // ⚠️ Mutation (gate de reprise, finding nº 9) : recopier la normalisation
  // CRLF → LF au lieu d'appeler `readNormalized` (déjà importé) → rougit-sur-
  // divergence si ce helper évolue un jour (BOM, `\r` isolé) sans que cette
  // copie locale suive — c'est le finding 9 de la gate de SKILL-49 et le
  // finding 10 de celle de SKILL-53, tous deux nommément interdits par le
  // § Tests de specs/skill-56.md.
  function readSchemaSection() {
    const raw = readNormalized(REPO_ROOT, SPEC_REL);
    const body = extractSection(raw, SCHEMA_HEADING_RE);
    if (body === null) {
      throw new Error(`${SPEC_REL} : sous-section "### Schéma du fichier" introuvable.`);
    }
    return body;
  }

  // ⚠️ Mutation : retirer `refVerified` ou `shaReachableFromBranch` du bloc
  // JSON de référence (ou de la liste des champs) → rougit.
  it('le bloc JSON de référence et la liste des champs nomment les deux champs', () => {
    const section = readSchemaSection();
    expect(section).toMatch(/"refVerified"/);
    expect(section).toMatch(/"shaReachableFromBranch"/);
    expect(section).toMatch(/\*\*`refVerified`\*\*|`refVerified`/);
    expect(section).toMatch(/\*\*`shaReachableFromBranch`\*\*|`shaReachableFromBranch`/);
  });
});
