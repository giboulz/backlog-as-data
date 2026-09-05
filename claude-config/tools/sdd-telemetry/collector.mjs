// SKILL-78 — collecteur OTLP LOCAL : le puits de la télémétrie Claude Code
// (specs/skill-78.md, D1). Amendé par SKILL-87 (D2) : chaque série porte, en plus de
// son cumul, ses incréments REÇUS horodatés — c'est ce qui permet à `read.mjs` de
// couper « avant / après » un instant donné (specs/skill-87.md).
//
// Reçoit `claude_code.token.usage` en OTLP `http/json` sur `127.0.0.1` et écrit un
// instantané JSON par `session.id` sous `~/sdd-metrics/telemetry/`. C'est le terme que
// le transcript ne porte NULLE PART : le `cache_read` des sous-agents.
//
// Trois principes hérités de `tools/review-log/write.mjs` (SKILL-29, D11) :
//
//  1. **Chemin dérivé, jamais configuré.** `<home>/sdd-metrics/telemetry`, dérivé de
//     `os.homedir()`. Aucune variable d'environnement de chemin, aucun fichier de
//     config ; les tests injectent le home, ils ne le configurent pas. Seul le PORT
//     d'écoute est un argument — c'est une adresse, pas un emplacement de données.
//  2. **No-op si le dépôt manque.** `~/sdd-metrics` absent, pas un répertoire, ou sans
//     `.git` : rien n'est écrit, le motif part sur stderr, et le code de sortie est 0.
//     Ni le dépôt ni son `.git` ne sont créés.
//  3. **Aucun `git`, jamais.** 10 à 15 sessions tournent en parallèle : un `index.lock`
//     partagé rouvrirait la panne que « un fichier par session » ferme. Ce module
//     n'importe PAS `node:child_process` et ne lance aucun processus — c'est ce que le
//     test vérifie, sur la SOURCE : un module sans lanceur n'a pas d'espion à armer, et
//     une assertion sur un espion jamais appelé serait vraie par construction.
//
// Et quatre règles propres à ce ticket :
//
//  4. **Ne bloque jamais l'appelant (D6).** La réponse HTTP est rendue AVANT toute
//     écriture disque : l'accumulation est en mémoire, le flush est armé sur un
//     minuteur, et il n'écrit QUE les seaux réellement touchés — sans ça, le débounce
//     bornerait la fréquence des écritures mais pas leur VOLUME, et un puits d'un
//     millier de sessions bloquerait la boucle d'événements à chaque tick.
//  5. **L'identité ne rentre pas dans `~/sdd-metrics` (D4).** Les métriques portent
//     `user.email`, `user.id`, `organization.id` et `terminal.type` — la doc dit que
//     ces trois premiers ne peuvent PAS être coupés à la source. Le collecteur applique
//     donc une LISTE BLANCHE (`KEPT_ATTRIBUTES`) et jette tout le reste : `~/sdd-metrics`
//     est un dépôt git, ce qu'on y écrit peut être commité par erreur.
//  6. **Un point jeté laisse une trace.** `ignored` n'est pas un silence : il part sur
//     stderr et il est PERSISTÉ (`~diagnostics.json`), parce qu'une charge dont 100 %
//     des points sont écartés produirait sinon un `200 OK`, aucun fichier, aucun indice —
//     soit exactement « l'absence de métrique indiscernable d'une métrique à zéro » que
//     ce ticket existe pour fermer.
//  7. **Un seul collecteur à la fois.** Deux collecteurs vivants partagent le puits mais
//     pas leur mémoire : le second écraserait à sa fermeture ce que le premier a
//     accumulé. Un verrou (`COLLECTOR.lock`) refuse le démarrage tant qu'un collecteur
//     vivant tient le puits ; un verrou dont le processus est mort est périmé, donc
//     repris.
//
// ---------------------------------------------------------------------------
// ⚠️ `delta`, pas `cumulative`
// ---------------------------------------------------------------------------
// `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` vaut `delta` par défaut : chaque
// envoi porte l'INCRÉMENT depuis le précédent, pas un cumul. Un collecteur qui
// garderait le dernier point rendrait un chiffre plausible et faux. On SOMME.
//
// ---------------------------------------------------------------------------
// Lancement (D1 : le collecteur ne démarre JAMAIS tout seul)
// ---------------------------------------------------------------------------
// Ni hook, ni auto-lancement : un démon spawné à chaque session est un piège
// (processus orphelins, ports pris, arrêts silencieux). Il se lance à la main :
//
//     node ~/.claude/tools/sdd-telemetry/collector.mjs --print-env   # le bloc a coller
//     node ~/.claude/tools/sdd-telemetry/collector.mjs               # ecoute
//     node ~/.claude/tools/sdd-telemetry/collector.mjs --port 4318
//
// ⚠️ `--print-env` crache sur stdout le JSON à fusionner dans `~/.claude/settings.json`.
// **Rien de ce que livre ce ticket n'allume la télémétrie** : tant que ce bloc n'y est
// pas, le collecteur tourne et ne reçoit RIEN. Il le dit à son démarrage, et `read.mjs`
// le dit aussi — c'est le premier diagnostic à poser.
//
// ---------------------------------------------------------------------------
// Configuration à recopier dans `~/.claude/settings.json` (clé `env`)
// ---------------------------------------------------------------------------
// ⚠️ `settings.json` est GITIGNORÉ et DÉ-SUIVI depuis SKILL-39 : c'est de l'état de
// poste, il ne vit que dans le checkout live `~/.claude`. Aucun ticket ne peut le
// livrer par un diff ; le bloc de référence est donc versionné ICI, dans
// `SETTINGS_ENV_BLOCK`, imprimable par `--print-env`, et se fusionne à la main. Le test
// de cohérence vérifie le bloc de référence, ET le `settings.json` du poste quand il
// est là.
//
// ⛔ CE QUI ROUVRIRAIT LE TROU — à lire avant de toucher à ce bloc :
//
//   `OTEL_LOGS_EXPORTER` et `OTEL_TRACES_EXPORTER` sont à `none` ÉCRITS, pas laissés
//   au défaut. Ce ne sont pas des réglages de volume : ce sont eux qui rendent
//   `OTEL_LOG_TOOL_DETAILS` inoffensif. Ce drapeau expose, sur les EVENTS et les SPANS,
//   le contenu du travail — `full_command` (la commande Bash entière), `file_path`,
//   `tool_input`, le message d'erreur complet. Avec logs et traces éteints, aucun event
//   n'est émis, donc rien de tout ça ne sort. **Un ticket qui rallumerait
//   `OTEL_LOGS_EXPORTER` rouvrirait tout ça d'un coup**, sans que la ligne
//   `OTEL_LOG_TOOL_DETAILS` ait bougé. `checkTelemetrySettings` ci-dessous est le
//   garde-fou mécanique de ce couplage, et le test le rejoue sur le fichier du poste.
//
//   Le puits est LOCAL, et c'est ce qui rend le reste acceptable : la doc dit que
//   `user.id`, `user.email` (« Always when available ») et `organization.id` ne
//   peuvent PAS être coupés. Pointer cet endpoint ailleurs que sur `127.0.0.1` est une
//   décision de confidentialité distincte, qu'aucun ticket n'a prise à ce jour.
//
// ⚠️ `OTEL_LOG_TOOL_DETAILS` est volontairement ABSENT du bloc. La spec (D3) le voulait
// à `1` pour dé-masquer `agent.name`. La doc, relue le 2026-08-28, dit le contraire :
// « Built-in agent names and agents from official-marketplace plugins appear verbatim.
// Other user-defined agent names are replaced with "custom". » — la redaction ne dépend
// PAS du drapeau. Nos agents (`sdd-impl-*`, `sdd-reviewer`) sont définis dans
// `~/.claude/agents/` : ils remonteront `custom` de toute façon. Le drapeau n'achète
// donc rien sur les métriques, et son seul effet résiduel est du risque. Il reste
// néanmoins verrouillé par `checkTelemetrySettings` pour le jour où quelqu'un l'écrit.
//
// ⛔ CONSÉQUENCE, à ne pas escamoter : `agent.name` vaudra TOUJOURS `custom` sur ce
// poste. La ventilation par rôle que la spec attend (« `sdd-impl-*` et `sdd-reviewer`
// séparés ») N'EST PAS ATTEIGNABLE par cet attribut. `effort` est gardé dans la liste
// blanche parce que c'est le seul discriminant documenté qui reste — mais il ne suffit
// pas : `sdd-reviewer` et `sdd-impl-high` sont TOUS DEUX à `effort: high`
// (`agents/sdd-reviewer.md`, `agents/sdd-impl-high.md`). Il sépare les paliers
// d'implémentation entre eux, pas la revue de l'implémentation. Séparer ces deux-là
// demande une autre clé : c'est une décision de spec, escaladée, pas un réglage.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { resolveMetricsRoot } from '../review-log/write.mjs';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Sous-dossier de `~/sdd-metrics` où vit la télémétrie. */
export const TELEMETRY_DIR_NAME = 'telemetry';

/** La seule métrique que ce collecteur retient. */
export const TOKEN_METRIC = 'claude_code.token.usage';

/**
 * Liste BLANCHE d'attributs (D4). Tout le reste est jeté à la réception :
 * `user.email`, `user.id`, `organization.id`, `terminal.type`, `app.version`…
 * ⛔ N'ajouter un attribut ici qu'après avoir vérifié qu'il ne porte aucune identité.
 * `effort` y est parce que c'est le seul discriminant de rôle qui survive à la
 * redaction de `agent.name` en `custom` (voir l'en-tête — il ne suffit pas).
 */
export const KEPT_ATTRIBUTES = ['session.id', 'type', 'query_source', 'agent.name', 'effort', 'model'];

/** Version du format d'instantané écrit sous `telemetry/`. */
export const SNAPSHOT_SCHEMA = 1;

/** Marqueur d'activation : sans lui, `read.mjs` ne peut pas distinguer les absences de D5. */
export const ACTIVATION_FILE = 'ACTIVATED.json';

/**
 * Seau des points exploitables dont le `session.id` est absent ou inutilisable.
 * ⚠️ Le `~` est DÉLIBÉRÉ : `safeSessionId` le refuse, donc aucune session ne peut
 * produire ce nom de fichier. Sans lui, un POST portant `session.id: "_unattributed"`
 * écraserait ce seau (et réciproquement), et `loadSnapshots` reclasserait au
 * redémarrage les points de cette session en « non attribués », définitivement.
 */
export const UNATTRIBUTED_FILE = '~unattributed.json';

/** Compteurs du puits — ce qui a été REÇU puis JETÉ. Même raison pour le `~`. */
export const DIAGNOSTICS_FILE = '~diagnostics.json';

/** Verrou : un seul collecteur vivant à la fois sur un puits donné. */
export const LOCK_FILE = 'COLLECTOR.lock';

/**
 * Clé interne du seau non attribué.
 * ⚠️ Le `|` est hors de l'alphabet de `safeSessionId`, donc hors de portée d'un
 * `session.id` reçu. Surtout, ce n'est PAS un octet NUL : un seul U+0000 dans la
 * source ferait basculer git en mode binaire pour ce fichier — plus de `git diff`,
 * plus de `git blame`, plus de normalisation de fins de ligne.
 */
const UNATTRIBUTED_KEY = '|unattributed';

export const DEFAULT_PORT = 4318;

/** ⛔ Boucle locale UNIQUEMENT : ces métriques portent `user.email` (D4). */
export const DEFAULT_HOST = '127.0.0.1';

/** Corps HTTP au-delà duquel on refuse plutôt que de charger en mémoire. */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Délai de débounce du flush disque. La réponse HTTP ne l'attend jamais (D6). */
export const DEFAULT_FLUSH_DELAY_MS = 1000;

/**
 * Bloc `env` de référence, à fusionner dans `~/.claude/settings.json`
 * (`--print-env` l'imprime ; voir l'en-tête).
 *
 * `OTEL_METRIC_EXPORT_INTERVAL` = 10 000 ms, CHOISI et non hérité (D5). Le défaut de
 * 60 000 ms perd entièrement une session plus courte que son premier envoi ; à 10 s,
 * la perte se borne à la queue de session, pour au pire 6 POST/min/session — soit ~90
 * POST/min sur 15 sessions parallèles, négligeable sur une boucle locale, et sans
 * risque de double compte puisque chaque envoi est un `delta`.
 */
export const SETTINGS_ENV_BLOCK = Object.freeze({
  CLAUDE_CODE_ENABLE_TELEMETRY: '1',
  OTEL_METRICS_EXPORTER: 'otlp',
  // D2 — éteints EXPLICITEMENT : un défaut qui changerait de valeur en amont
  // allumerait un flux qu'on n'a pas voulu, et rouvrirait `OTEL_LOG_TOOL_DETAILS`.
  OTEL_LOGS_EXPORTER: 'none',
  OTEL_TRACES_EXPORTER: 'none',
  OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'http/json',
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `http://${DEFAULT_HOST}:${DEFAULT_PORT}/v1/metrics`,
  // D5 — écrite, pas héritée : le collecteur SOMME, il ne remplace pas.
  OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
  OTEL_METRIC_EXPORT_INTERVAL: '10000',
  // D4 — la SEULE clé de jointure avec les fiches de cycle : jamais implicite.
  OTEL_METRICS_INCLUDE_SESSION_ID: 'true',
  OTEL_METRICS_INCLUDE_ACCOUNT_UUID: 'false',
});

// ---------------------------------------------------------------------------
// Localisation du puits
// ---------------------------------------------------------------------------

/**
 * `<home>/sdd-metrics/telemetry`, si `<home>/sdd-metrics` existe, est un répertoire et
 * porte un `.git`. Sinon `null` + motif — et AUCUNE création, ni du dépôt, ni du `.git`.
 * Le sous-dossier `telemetry/`, lui, est créé au premier flush : c'est un dossier de
 * données dans un dépôt qui existe déjà, pas le dépôt.
 */
export function resolveTelemetryRoot(homedir, deps = {}) {
  const { root, reason } = resolveMetricsRoot(homedir, deps);
  if (!root) return { root: null, reason };
  return { root: path.join(root, TELEMETRY_DIR_NAME), reason: null };
}

// ---------------------------------------------------------------------------
// Lecture d'une charge OTLP `http/json`
// ---------------------------------------------------------------------------

const first = (...vals) => vals.find((v) => v !== undefined && v !== null);

/**
 * Aplatit les `KeyValue[]` d'OTLP en objet plat. Toute forme inattendue rend `{}` —
 * un collecteur qui écoute une socket ne présume rien de ce qu'il reçoit.
 */
export function attributesOf(dataPoint) {
  const list = dataPoint && Array.isArray(dataPoint.attributes) ? dataPoint.attributes : null;
  if (!list) return {};
  const out = {};
  for (const kv of list) {
    if (!kv || typeof kv.key !== 'string') continue;
    const v = kv.value;
    if (!v || typeof v !== 'object') continue;
    const raw = first(v.stringValue, v.intValue, v.doubleValue, v.boolValue);
    if (raw === undefined) continue;
    out[kv.key] = String(raw);
  }
  return out;
}

/**
 * Valeur numérique d'un point. Le mapping JSON de protobuf sérialise les `int64` en
 * CHAÎNE (`asInt: "100"`) — d'où le `Number()`. Tout ce qui n'est pas fini rend `null` :
 * un point sans valeur est ignoré, jamais compté pour zéro.
 */
export function pointValue(dataPoint) {
  if (!dataPoint || typeof dataPoint !== 'object') return null;
  const raw = first(dataPoint.asInt, dataPoint.as_int, dataPoint.asDouble, dataPoint.as_double);
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Un `session.id` devient un NOM DE FICHIER. Le collecteur écoute une socket : sans
 * cette garde, `../../evil` écrirait hors du puits.
 * ⚠️ L'alphabet exclut `~`, ce qui RÉSERVE les noms `~*.json` aux fichiers du puits
 * (`UNATTRIBUTED_FILE`, `DIAGNOSTICS_FILE`) — aucune session ne peut les revendiquer.
 */
export function safeSessionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(id) && id !== '.' && id !== '..';
}

function dataPointsOf(metric) {
  const body = first(metric.sum, metric.gauge);
  if (!body || typeof body !== 'object') return [];
  const pts = first(body.dataPoints, body.data_points);
  return Array.isArray(pts) ? pts : [];
}

/**
 * Extrait les points exploitables d'un `ExportMetricsServiceRequest`.
 *
 * Un point n'est retenu que s'il porte une VALEUR numérique, un `type` et un
 * `query_source` : sans eux, ce n'est pas une mesure de tokens, c'est du bruit. Les
 * métriques autres que `claude_code.token.usage` sont sautées sans être comptées —
 * elles ne sont pas défectueuses, elles ne nous concernent pas.
 *
 * ⚠️ `ignored` n'est PAS un détail interne : c'est le seul signal qui distingue « rien
 * n'est arrivé » de « tout ce qui est arrivé a été jeté ». Il remonte à l'appelant, part
 * sur stderr et se persiste (`DIAGNOSTICS_FILE`).
 */
export function extractPoints(payload) {
  const points = [];
  let ignored = 0;
  const resourceMetrics = payload && Array.isArray(first(payload.resourceMetrics, payload.resource_metrics))
    ? first(payload.resourceMetrics, payload.resource_metrics)
    : [];

  for (const rm of resourceMetrics) {
    const scopeMetrics = rm && Array.isArray(first(rm.scopeMetrics, rm.scope_metrics))
      ? first(rm.scopeMetrics, rm.scope_metrics)
      : [];
    for (const sm of scopeMetrics) {
      const metrics = sm && Array.isArray(sm.metrics) ? sm.metrics : [];
      for (const metric of metrics) {
        if (!metric || metric.name !== TOKEN_METRIC) continue;
        for (const dp of dataPointsOf(metric)) {
          const value = pointValue(dp);
          const raw = attributesOf(dp);
          const attributes = {};
          for (const key of KEPT_ATTRIBUTES) {
            if (typeof raw[key] === 'string') attributes[key] = raw[key];
          }
          if (value === null || !attributes.type || !attributes.query_source) {
            ignored += 1;
            continue;
          }
          const declared = attributes['session.id'];
          const safe = safeSessionId(declared);
          points.push({
            metric: TOKEN_METRIC,
            value,
            attributes,
            sessionId: safe ? declared : null,
            rejectedSessionId: safe ? null : (typeof declared === 'string' ? declared : null),
          });
        }
      }
    }
  }
  return { points, ignored };
}

// ---------------------------------------------------------------------------
// Accumulation — `delta` SOMMÉ, jamais écrasé
// ---------------------------------------------------------------------------

export function createAccumulator() {
  return { buckets: new Map(), ignoredPoints: 0, lastIgnoredAt: null, diagnosticsDirty: false };
}

function seriesKeyOf(point) {
  const attrs = { ...point.attributes };
  delete attrs['session.id'];
  const ordered = Object.keys(attrs).sort().map((k) => `${k}=${attrs[k]}`);
  return `${point.metric}|${ordered.join('|')}|rejected=${point.rejectedSessionId ?? ''}`;
}

/**
 * SOMME les points dans l'accumulateur. C'est LA ligne qui décide entre un chiffre
 * juste et un chiffre plausible et faux : `delta` veut `+=`, pas `=`.
 *
 * Marque le seau `dirty` : le flush n'écrit QUE ce qui a bougé. Sans ce drapeau, chaque
 * tick réécrirait tout le puits — des milliers de fichiers, synchronement, sur la boucle
 * du serveur (D6, attaqué par la durée) — et un second collecteur écraserait au passage
 * ce qu'il n'avait fait que LIRE à son démarrage.
 */
export function accumulate(acc, points, now = () => new Date()) {
  let accepted = 0;
  for (const point of points) {
    const bucketKey = point.sessionId ?? UNATTRIBUTED_KEY;
    let bucket = acc.buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        sessionId: point.sessionId,
        firstSeen: now().toISOString(),
        lastSeen: null,
        series: new Map(),
        dirty: false,
      };
      acc.buckets.set(bucketKey, bucket);
    }
    const nowIso = now().toISOString();
    bucket.lastSeen = nowIso;
    bucket.dirty = true;

    const key = seriesKeyOf(point);
    let series = bucket.series.get(key);
    if (!series) {
      const attributes = { ...point.attributes };
      delete attributes['session.id'];
      series = {
        metric: point.metric,
        attributes,
        value: 0,
        points: 0,
        rejectedSessionId: point.rejectedSessionId,
        // SKILL-87 (D2) — l'incrément REÇU, horodaté, jamais recalculé depuis le cumul :
        // c'est ce qui permet à `read.mjs` de couper « avant / après » un instant donné.
        // ⚠️ `Σ history[].value === value` est l'invariant que le test de cohérence
        // épingle : les deux doivent être poussés côte à côte, jamais l'un sans l'autre.
        history: [],
        // ⛔ Une série NEUVE (jamais rechargée) a un historique COMPLET dès sa création :
        // aucun point antérieur, invisible à `history`, n'a pu contribuer à `value`.
        // `loadSnapshots` retombe ce drapeau à `false` pour une série SANS `history` sur
        // disque (format `SKILL-78`) — et il reste `false` pour toujours, même après un
        // nouveau point : sans ça, un instantané ancien réaccumulé écrirait un `history`
        // qui NE COUVRE PAS le cumul hérité, et `docOf` le rendrait indiscernable d'un
        // historique réellement complet (finding SKILL-87 #1).
        historyComplete: true,
      };
      bucket.series.set(key, series);
    }
    series.value += point.value; // ⚠️ `delta` : on somme.
    series.points += 1;
    if (series.historyComplete) series.history.push({ at: nowIso, value: point.value });
    accepted += 1;
  }
  return { accepted };
}

/** Comptabilise les points reçus puis jetés — pour que le silence laisse une trace. */
export function noteIgnored(acc, count, now = () => new Date()) {
  if (!count) return;
  acc.ignoredPoints += count;
  acc.lastIgnoredAt = now().toISOString();
  acc.diagnosticsDirty = true;
}

function fileNameFor(bucketKey) {
  return bucketKey === UNATTRIBUTED_KEY ? UNATTRIBUTED_FILE : `${bucketKey}.json`;
}

function docOf(bucket) {
  const series = [...bucket.series.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, s]) => {
      const out = {
        metric: s.metric,
        attributes: s.attributes,
        value: s.value,
        points: s.points,
      };
      // SKILL-87 (D2) — série horodatée, ⛔ écrite SEULEMENT si elle est COMPLÈTE
      // (`historyComplete`). Un instantané `SKILL-78` rechargé sans `history` reste
      // SANS ce champ pour toujours, même après un point neuf : lui fabriquer un
      // `history` partiel serait indiscernable, pour `read.mjs`, d'un historique
      // réellement complet — et rendrait un `before`/`after` FAUX plutôt qu'un
      // `null` + motif (finding SKILL-87 #1 : « zéro fabriqué au lieu de null »).
      if (s.historyComplete) out.history = Array.isArray(s.history) ? s.history : [];
      if (s.rejectedSessionId !== null && s.rejectedSessionId !== undefined) {
        out.rejectedSessionId = s.rejectedSessionId;
      }
      return out;
    });
  return {
    schema: SNAPSHOT_SCHEMA,
    sessionId: bucket.sessionId,
    firstSeen: bucket.firstSeen,
    lastSeen: bucket.lastSeen,
    series,
  };
}

function writeJson(fsx, target, doc) {
  const tmp = `${target}.tmp`;
  fsx.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  fsx.renameSync(tmp, target);
}

/**
 * Écrit les instantanés des seaux TOUCHÉS depuis le dernier flush, en `tmp` + `rename` :
 * un lecteur qui passe pendant l'écriture voit l'ancien document entier, jamais un JSON
 * tronqué.
 *
 * `{ all: true }` force l'écriture de tous les seaux — réservé aux appelants qui
 * construisent un accumulateur à la main (tests).
 * ⛔ Aucun `git` : voir le principe 3 de l'en-tête.
 */
export function writeSnapshots(root, acc, deps = {}, options = {}) {
  const fsx = deps.fs || fs;
  const all = options.all === true;
  const toWrite = [...acc.buckets.entries()].filter(([, b]) => all || b.dirty);
  const withDiagnostics = acc.diagnosticsDirty || (all && acc.ignoredPoints > 0);
  if (toWrite.length === 0 && !withDiagnostics) return [];
  fsx.mkdirSync(root, { recursive: true });

  const written = [];
  for (const [bucketKey, bucket] of toWrite) {
    const target = path.join(root, fileNameFor(bucketKey));
    writeJson(fsx, target, docOf(bucket));
    bucket.dirty = false;
    written.push(target);
  }
  if (withDiagnostics) {
    const target = path.join(root, DIAGNOSTICS_FILE);
    writeJson(fsx, target, {
      schema: SNAPSHOT_SCHEMA,
      ignoredPoints: acc.ignoredPoints,
      lastIgnoredAt: acc.lastIgnoredAt,
    });
    acc.diagnosticsDirty = false;
    written.push(target);
  }
  return written;
}

/**
 * Recharge en mémoire les instantanés déjà sur le disque. Sans ça, un collecteur
 * redémarré écraserait le total accumulé avant lui par les seuls points reçus depuis
 * son démarrage — une perte silencieuse.
 *
 * ⚠️ Les seaux rechargés sont PROPRES (`dirty: false`) : tant qu'aucun point neuf ne les
 * touche, ils ne sont jamais réécrits. C'est ce qui rend inoffensif un second collecteur
 * qui se ferme après avoir seulement lu.
 */
export function loadSnapshots(root, acc, deps = {}) {
  const fsx = deps.fs || fs;
  let names;
  try {
    names = fsx.readdirSync(root);
  } catch {
    return { loaded: 0, skipped: 0 };
  }
  let loaded = 0;
  let skipped = 0;
  for (const name of names) {
    if (!name.endsWith('.json') || name === ACTIVATION_FILE) continue;

    let doc;
    try {
      doc = JSON.parse(fsx.readFileSync(path.join(root, name), 'utf8'));
    } catch {
      skipped += 1;
      continue;
    }
    if (!doc || doc.schema !== SNAPSHOT_SCHEMA) {
      skipped += 1;
      continue;
    }

    if (name === DIAGNOSTICS_FILE) {
      acc.ignoredPoints = typeof doc.ignoredPoints === 'number' ? doc.ignoredPoints : 0;
      acc.lastIgnoredAt = typeof doc.lastIgnoredAt === 'string' ? doc.lastIgnoredAt : null;
      acc.diagnosticsDirty = false;
      continue;
    }
    if (!Array.isArray(doc.series)) {
      skipped += 1;
      continue;
    }

    const isUnattributed = name === UNATTRIBUTED_FILE;
    const base = name.slice(0, -'.json'.length);
    if (!isUnattributed && !safeSessionId(base)) {
      skipped += 1;
      continue;
    }
    const bucketKey = isUnattributed ? UNATTRIBUTED_KEY : base;
    const bucket = {
      sessionId: isUnattributed ? null : base,
      firstSeen: doc.firstSeen ?? null,
      lastSeen: doc.lastSeen ?? null,
      series: new Map(),
      dirty: false,
    };
    for (const s of doc.series) {
      if (!s || typeof s.value !== 'number') continue;
      const point = {
        metric: s.metric,
        attributes: s.attributes || {},
        rejectedSessionId: s.rejectedSessionId ?? null,
      };
      // SKILL-87 (D2) — `historyComplete` retombe à `false` dès que la série sur
      // disque n'a PAS de `history` (format `SKILL-78`, ou série neuve mais déjà
      // contaminée par un rechargement antérieur) : `accumulate` refusera alors de
      // lui ajouter des incréments, et `docOf` refusera de l'écrire — POUR TOUJOURS,
      // même si `value` continue de grossir. Sans cette poursuite, un point neuf sur
      // une série ancienne écrirait un `history` PARTIEL indiscernable d'un
      // historique complet (finding SKILL-87 #1).
      const historyComplete = Array.isArray(s.history);
      bucket.series.set(seriesKeyOf(point), {
        metric: s.metric,
        attributes: s.attributes || {},
        value: s.value,
        points: typeof s.points === 'number' ? s.points : 0,
        rejectedSessionId: s.rejectedSessionId ?? null,
        history: historyComplete
          ? s.history.filter((h) => h && typeof h.value === 'number' && typeof h.at === 'string')
          : [],
        historyComplete,
      });
    }
    acc.buckets.set(bucketKey, bucket);
    loaded += 1;
  }
  return { loaded, skipped };
}

/**
 * Traite un corps HTTP brut. Ne jette JAMAIS : un collecteur qui meurt sur une entrée
 * hostile laisse la session suivante sans interlocuteur, et son absence de mesure est
 * indiscernable d'un zéro.
 */
export function handlePayload(acc, rawBody, now) {
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return { status: 400, accepted: 0, ignored: 0, reason: `JSON invalide : ${err.message}` };
  }
  let extracted;
  try {
    extracted = extractPoints(payload);
  } catch (err) {
    return { status: 400, accepted: 0, ignored: 0, reason: `charge illisible : ${err.message}` };
  }
  const { accepted } = accumulate(acc, extracted.points, now);
  noteIgnored(acc, extracted.ignored, now);
  return { status: 200, accepted, ignored: extracted.ignored, reason: null };
}

// ---------------------------------------------------------------------------
// Garde d'origine — un endpoint LOCAL n'est pas un endpoint PRIVÉ
// ---------------------------------------------------------------------------

/**
 * Écouter sur `127.0.0.1` exclut le réseau, PAS le navigateur de la machine. Une page
 * ouverte peut poster en `no-cors` sur ce port ; la donnée produite étant le
 * DÉNOMINATEUR de l'arbitrage de dosage, un chiffre falsifiable en écriture est aussi
 * inutilisable qu'un chiffre absent.
 *
 * Trois gardes, toutes gratuites, qui ferment la requête « simple » au sens CORS :
 *  - `content-type: application/json` EXIGÉ — une requête simple ne peut porter que
 *    `text/plain`, `application/x-www-form-urlencoded` ou `multipart/form-data` ; toute
 *    autre valeur déclenche un préflight `OPTIONS`, auquel ce serveur ne répond pas ;
 *  - un en-tête `Origin` → la requête vient d'un contexte web, jamais d'un exporteur ;
 *  - un en-tête `Sec-Fetch-*` → même chose, posé par le navigateur et non falsifiable
 *    par la page.
 *
 * Rend `null` si la requête peut passer, sinon le motif du refus.
 */
export function browserGuard(headers = {}) {
  const get = (k) => {
    const v = headers[k];
    return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
  };
  if (get('origin') !== undefined) return 'en-tête `Origin` présent : requête d’un contexte web';
  if (get('sec-fetch-mode') !== undefined || get('sec-fetch-site') !== undefined) {
    return 'en-tête `Sec-Fetch-*` présent : requête émise par un navigateur';
  }
  const ct = (get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') {
    return `\`content-type\` attendu \`application/json\`, reçu ${JSON.stringify(ct || null)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cohérence de la configuration — le couplage D2 ↔ D3
// ---------------------------------------------------------------------------

/**
 * Lit un objet `settings.json` déjà parsé et rend `{ configured, violations }`.
 *
 * `configured` répond à la question que D1 exige qu'on sache poser : « y a-t-il de la
 * télémétrie pour cette session ? ». `violations` porte le garde-fou du ticket : le
 * drapeau `OTEL_LOG_TOOL_DETAILS` n'est sûr QUE si logs ET traces sont éteints.
 */
export function checkTelemetrySettings(settings) {
  const env =
    settings && typeof settings === 'object' && settings.env && typeof settings.env === 'object'
      ? settings.env
      : {};
  const configured = env.CLAUDE_CODE_ENABLE_TELEMETRY === '1';
  const violations = [];

  if (env.OTEL_LOG_TOOL_DETAILS === '1') {
    for (const key of ['OTEL_LOGS_EXPORTER', 'OTEL_TRACES_EXPORTER']) {
      if (env[key] !== 'none') {
        violations.push(
          `couplage D2 ↔ D3 rompu : \`OTEL_LOG_TOOL_DETAILS=1\` exige \`${key}=none\` ` +
            `(vaut ${JSON.stringify(env[key] ?? null)}). Rallumer ce flux ré-expose le CONTENU ` +
            `du travail (commandes Bash, chemins, arguments d'outils, messages d'erreur).`
        );
      }
    }
  }

  if (configured && env.OTEL_METRICS_INCLUDE_SESSION_ID !== 'true') {
    violations.push(
      "`OTEL_METRICS_INCLUDE_SESSION_ID` doit être écrit et valoir \"true\" : c'est la SEULE " +
        `clé de jointure avec les fiches de cycle (vaut ${JSON.stringify(env.OTEL_METRICS_INCLUDE_SESSION_ID ?? null)}).`
    );
  }

  return { configured, violations };
}

/** Lit et parse `<home>/.claude/settings.json`. Rend `null` + motif s'il est illisible. */
export function readLiveSettings(homedir, deps = {}) {
  const fsx = deps.fs || fs;
  const file = path.join(homedir, '.claude', 'settings.json');
  try {
    return { settings: JSON.parse(fsx.readFileSync(file, 'utf8')), file, reason: null };
  } catch (err) {
    return { settings: null, file, reason: `${file} illisible (${err.code || err.message})` };
  }
}

// ---------------------------------------------------------------------------
// Verrou — un seul collecteur vivant par puits
// ---------------------------------------------------------------------------

/** `true` si le processus existe encore. `process.kill(pid, 0)` ne tue rien : il teste. */
export function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Prend le verrou du puits, ou explique pourquoi il ne peut pas.
 *
 * Deux collecteurs vivants partagent le puits mais pas leur mémoire : celui qui ferme en
 * dernier réécrirait avec SON état ce que l'autre a accumulé. Un verrou dont le
 * processus est mort est périmé — on le reprend, sinon un `kill -9` condamnerait le
 * puits pour toujours.
 */
export function acquireLock(root, { pid, port, now, fs: fsx = fs, isAlive = defaultIsAlive } = {}) {
  const file = path.join(root, LOCK_FILE);
  let held = null;
  try {
    held = JSON.parse(fsx.readFileSync(file, 'utf8'));
  } catch {
    held = null;
  }
  if (held && typeof held.pid === 'number' && isAlive(held.pid)) {
    return {
      ok: false,
      reason:
        `un collecteur tourne déjà sur ce puits (pid ${held.pid}, port ${held.port ?? '?'}, ` +
        `depuis ${held.since ?? '?'}) — deux collecteurs se réécrivent l'un l'autre. ` +
        `L'arrêter, ou supprimer ${file} s'il est périmé.`,
    };
  }
  fsx.writeFileSync(
    file,
    `${JSON.stringify({ pid, port, since: (now ? now() : new Date()).toISOString() }, null, 2)}\n`,
    'utf8'
  );
  return { ok: true, reason: held ? `verrou périmé repris (pid ${held.pid} mort)` : null };
}

export function releaseLock(root, deps = {}) {
  const fsx = deps.fs || fs;
  try {
    fsx.rmSync(path.join(root, LOCK_FILE), { force: true });
  } catch {
    /* le verrou sera repris comme périmé au prochain démarrage : jamais bloquant */
  }
}

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

/**
 * Démarre le collecteur. Le `root` doit exister (l'appelant a fait le no-op de D1).
 *
 * D6, mécaniquement : le gestionnaire accumule EN MÉMOIRE, répond, PUIS arme un
 * minuteur de flush qui n'écrit que les seaux touchés. Aucune écriture disque ne se
 * trouve entre la requête et sa réponse, et le volume écrit ne dépend pas de la taille
 * du puits.
 */
export function startCollector({
  homedir,
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  flushDelayMs = DEFAULT_FLUSH_DELAY_MS,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  lock = true,
  deps = {},
} = {}) {
  const fsx = deps.fs || fs;
  const now = deps.now || (() => new Date());
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  const isAlive = deps.isAlive || defaultIsAlive;

  const { root, reason } = resolveTelemetryRoot(homedir, { fs: fsx });
  if (!root) return Promise.reject(new Error(reason));

  fsx.mkdirSync(root, { recursive: true });

  if (lock) {
    const taken = acquireLock(root, { pid: process.pid, port, now, fs: fsx, isAlive });
    if (!taken.ok) return Promise.reject(new Error(taken.reason));
    if (taken.reason) stderr(`${taken.reason}\n`);
  }

  // Marqueur d'activation : posé une fois, JAMAIS réécrit — sa date est ce qui permet
  // à `read.mjs` de distinguer « collecteur éteint » de « session d'avant » (D5).
  const marker = path.join(root, ACTIVATION_FILE);
  try {
    fsx.statSync(marker);
  } catch {
    fsx.writeFileSync(marker, `${JSON.stringify({ since: now().toISOString() }, null, 2)}\n`, 'utf8');
  }

  const acc = createAccumulator();
  loadSnapshots(root, acc, { fs: fsx });

  let timer = null;
  const stats = { received: 0, accepted: 0, ignored: 0, rejected: 0 };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      return writeSnapshots(root, acc, { fs: fsx });
    } catch (err) {
      stderr(`flush impossible : ${err.message}\n`);
      return [];
    }
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushDelayMs);
    if (typeof timer.unref === 'function') timer.unref();
  };

  const server = http.createServer((req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method !== 'POST' || !String(req.url || '').split('?')[0].endsWith('/v1/metrics')) {
      reply(404, { error: 'seul POST /v1/metrics est servi' });
      return;
    }
    const forbidden = browserGuard(req.headers);
    if (forbidden) {
      stats.rejected += 1;
      stderr(`requête refusée : ${forbidden}\n`);
      reply(403, { error: forbidden });
      return;
    }

    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        aborted = true;
        stats.rejected += 1;
        reply(413, { error: `corps au-delà de ${maxBodyBytes} octets` });
        // Drainé, pas détruit : détruire la requête coupe la socket avant que le
        // client ait lu son 413, et il verrait un ECONNRESET au lieu du refus.
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => {
      aborted = true;
    });
    req.on('end', () => {
      if (aborted) return;
      stats.received += 1;
      const out = handlePayload(acc, Buffer.concat(chunks).toString('utf8'), now);
      stats.accepted += out.accepted;
      stats.ignored += out.ignored;
      if (out.status !== 200) {
        stats.rejected += 1;
        stderr(`charge refusée : ${out.reason}\n`);
        reply(out.status, { error: out.reason });
        return;
      }
      // Un point jeté n'est pas un silence : il se dit, et il se persiste.
      if (out.ignored > 0) {
        stderr(
          `${out.ignored} point(s) reçu(s) puis JETÉ(S) — ni \`type\` ni \`query_source\` exploitable, ` +
            `ou valeur non numérique. Total sur ce puits : ${acc.ignoredPoints}. ` +
            `Si ce compteur monte alors que rien n'est mesuré, les noms d'attributs ont bougé.\n`
        );
      }
      // Réponse D'ABORD, disque ENSUITE : la session n'attend jamais le flush (D6).
      reply(200, { partialSuccess: {} });
      if (out.accepted > 0 || out.ignored > 0) scheduleFlush();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (lock) releaseLock(root, { fs: fsx });
      reject(err);
    });
    server.listen(port, host, () => {
      server.removeAllListeners('error');
      resolve({
        root,
        host,
        port: server.address().port,
        stats,
        flush,
        close: () =>
          new Promise((done) => {
            flush();
            if (lock) releaseLock(root, { fs: fsx });
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * ⚠️ Invariant du dépôt : un drapeau inconnu, un drapeau valué sans valeur ou un
 * positionnel superflu font ÉCHOUER la commande — jamais de valeur inventée ni de
 * token avalé en silence.
 */
export function parseArgs(argv) {
  const out = { port: DEFAULT_PORT, printEnv: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--print-env') {
      out.printEnv = true;
      continue;
    }
    if (token === '--port') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { ok: false, error: '`--port` attend une valeur' };
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 65535) return { ok: false, error: `port invalide : ${value}` };
      out.port = n;
      i += 1;
      continue;
    }
    if (token.startsWith('--')) return { ok: false, error: `drapeau inconnu : ${token}` };
    return { ok: false, error: `argument positionnel superflu : ${token}` };
  }
  return { ok: true, args: out };
}

/**
 * Codes de sortie :
 *   0 — collecteur démarré, bloc imprimé, ou no-op (`~/sdd-metrics` absent ou sans `.git`)
 *   1 — argument invalide, port déjà pris, ou puits déjà tenu par un collecteur vivant
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const fsx = deps.fs || fs;
  const homedir = deps.homedir || os.homedir();
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr(`${parsed.error}\n`);
    return 1;
  }

  // AVANT tout le reste : `--print-env` doit marcher même sans dépôt de mesures — c'est
  // la commande qu'on lance pour ALLUMER la télémétrie, donc forcément la première.
  if (parsed.args.printEnv) {
    stdout(`${JSON.stringify({ env: SETTINGS_ENV_BLOCK }, null, 2)}\n`);
    stderr(
      `↑ à FUSIONNER dans ${path.join(homedir, '.claude', 'settings.json')} — ne rien écraser, ` +
        `ce fichier porte déjà d'autres clés. Tant que ce bloc n'y est pas, le collecteur ne reçoit RIEN.\n`
    );
    return 0;
  }

  // No-op AVANT d'ouvrir une socket : inutile d'écouter pour n'avoir nulle part où écrire.
  const { root, reason } = resolveTelemetryRoot(homedir, { fs: fsx });
  if (!root) {
    stderr(`${reason}\n`);
    return 0;
  }

  // D1 : savoir dire « pas de télémétrie pour cette session ».
  const live = readLiveSettings(homedir, { fs: fsx });
  if (live.reason) {
    stderr(`${live.reason} — impossible de dire si la télémétrie est allumée.\n`);
  } else {
    const check = checkTelemetrySettings(live.settings);
    stderr(
      check.configured
        ? `télémétrie activée dans ${live.file}.\n`
        : `⚠️ AUCUNE télémétrie configurée dans ${live.file} : ce collecteur ne recevra RIEN. ` +
            `Relancer avec \`--print-env\` et fusionner le bloc rendu dans ce fichier.\n`
    );
    for (const v of check.violations) stderr(`⛔ ${v}\n`);
  }

  let collector;
  try {
    collector = await startCollector({ homedir, port: parsed.args.port, deps: { fs: fsx, stderr } });
  } catch (err) {
    stderr(`impossible de démarrer le collecteur : ${err.message}\n`);
    return 1;
  }

  stdout(`collecteur OTLP à l'écoute sur http://${collector.host}:${collector.port}/v1/metrics\n`);
  stdout(`instantanés écrits sous ${collector.root}\n`);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      collector.close().then(() => process.exit(0));
    });
  }
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => {
    if (code !== 0) process.exitCode = code;
  });
}
