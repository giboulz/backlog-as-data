// SKILL-78 — lecteur de la télémétrie OTEL (specs/skill-78.md, D5).
//
// Pour un `session.id`, rend la ventilation `cacheRead` / `cacheCreation` des
// `query_source: subagent`, par `agent.name` — ou un `null` AVEC SON MOTIF.
//
// Amendé par SKILL-87 (D3, D4) : une coupe « avant / après » un instant donné, sur les
// séries `subagent` horodatées par le collecteur (voir plus bas, § SKILL-87).
//
// ---------------------------------------------------------------------------
// L'invariant du dossier, appliqué au flux neuf
// ---------------------------------------------------------------------------
// **Une absence de mesure reste une absence, jamais un zéro.** Les états, et le geste
// que chacun appelle — c'est pour ça qu'ils ne se confondent pas :
//
//   | État | Ce qu'on rend | Ce qu'on fait ensuite |
//   |---|---|---|
//   | `captured`, sous-agents à 0 | `0` | rien : c'est un fait mesuré |
//   | `not-configured` | `null` + motif | fusionner le bloc `env` (`collector.mjs --print-env`) |
//   | `not-captured` | `null` + motif | relancer le collecteur |
//   | `before-activation` | `null` + motif | rien à faire, c'est du passé |
//   | `undetermined` | `null` + motif | on ne sait pas, et on ne le maquille pas |
//
// ⛔ Un `0` rendu pour une session non captée reproduirait, dans l'instrument neuf, le
// défaut exact que SKILL-69 vient de corriger dans l'ancien.
//
// ⚠️ `not-configured` est distinct de `not-captured`, et ce n'est pas un raffinement :
// le marqueur `ACTIVATED.json` date le premier démarrage du COLLECTEUR, pas l'activation
// de la TÉLÉMÉTRIE dans `settings.json`. Sans cette distinction, un poste où le bloc
// `env` n'a jamais été posé se voit répondre « relancer le collecteur », indéfiniment,
// alors que le collecteur n'est pour rien dans le trou.
//
// ⚠️ `undetermined` couvre trois causes, toutes nommées dans le motif : session
// indatable (pas de transcript), instantané illisible, ou séries écartées. Ce dernier
// cas est le plus vicieux : si TOUTES les séries d'une session portent un `type` que ce
// lecteur ne connaît pas (Claude Code renomme `cacheRead`…), les totaux vaudraient `0`
// et seraient estampillés `captured` — « mesuré, et nul ». C'est le zéro silencieux, en
// pire. On rend `undetermined`, et le motif dit quels `type` ont été vus.
//
// ---------------------------------------------------------------------------
// ⛔ Ce que la ventilation par rôle peut, et ce qu'elle ne peut pas
// ---------------------------------------------------------------------------
// `agent.name` vaut `custom` pour TOUT agent défini par l'utilisateur (doc, relue le
// 2026-08-28 ; `OTEL_LOG_TOOL_DETAILS` n'y change rien). Nos `sdd-impl-*` et
// `sdd-reviewer` vivent dans `~/.claude/agents/` : sur ce poste, `byAgent` n'aura donc
// qu'une seule clé, `custom`. `byRole` ajoute l'`effort` à la clé — ce qui sépare les
// paliers d'implémentation entre eux, mais PAS `sdd-reviewer` de `sdd-impl-high` :
// les deux sont à `effort: high`. La ventilation impl / revue que la spec attend
// n'est donc pas atteignable en l'état ; c'est escaladé, pas contourné.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveTranscript } from '../review-log/write.mjs';
import {
  ACTIVATION_FILE,
  DIAGNOSTICS_FILE,
  SNAPSHOT_SCHEMA,
  checkTelemetrySettings,
  readLiveSettings,
  resolveTelemetryRoot,
  safeSessionId,
} from './collector.mjs';

// ---------------------------------------------------------------------------
// États et motifs
// ---------------------------------------------------------------------------

export const STATE_CAPTURED = 'captured';
export const STATE_NOT_CONFIGURED = 'not-configured';
export const STATE_NOT_CAPTURED = 'not-captured';
export const STATE_BEFORE_ACTIVATION = 'before-activation';
export const STATE_UNDETERMINED = 'undetermined';

/** ⛔ Ces motifs ne doivent JAMAIS se confondre : ils n'appellent pas le même geste. */
export const REASON_NOT_CONFIGURED =
  'la télémétrie n’est pas activée dans `settings.json` : aucune session n’exporte quoi que ce soit ' +
  '(le collecteur n’y est pour rien — fusionner le bloc rendu par `collector.mjs --print-env`)';
export const REASON_NOT_CAPTURED =
  'collecteur éteint ou injoignable pendant cette session : aucun point reçu (absence, jamais un zéro)';
export const REASON_BEFORE_ACTIVATION =
  'session antérieure à l’activation de la télémétrie : elle n’a jamais pu être captée (go-forward)';
export const REASON_UNDETERMINED =
  'impossible de conclure sur cette session : on ne peut pas dire laquelle des absences c’est';

/** Un sous-agent dont le `agent.name` est absent — un rôle à part, jamais fondu. */
export const AGENT_UNNAMED = '(agent.name absent)';

// ---------------------------------------------------------------------------
// SKILL-87 — la coupe « avant / après » un instant (D3, D4)
// ---------------------------------------------------------------------------
// `tokensAtSpawn` (SKILL-63) porte l'instant du lancement de l'implémenteur : c'est LA
// frontière. `read.mjs` ne la devine pas — elle lui est PASSÉE (D5, jointure à la main) —
// et se contente de sommer, par type, les incréments horodatés d'un seul côté ou de
// l'autre. ⛔ Une coupe impossible rend `null` + motif, JAMAIS un `0` ni un `before`
// égal au total (l'invariant du dossier, déjà posé par D3 de `read.mjs` lui-même).

/** ⛔ Ces trois motifs ne doivent JAMAIS se confondre : une coupe impossible a UNE cause. */
export const REASON_CUT_NO_HISTORY =
  'instantané sans série horodatée : format antérieur à SKILL-87 — aucune coupe possible, ' +
  'seul le total (non coupé) reste fiable';
export const REASON_CUT_BAD_INSTANT =
  'borne de coupe illisible : attendu un instant UTC strict `AAAA-MM-JJThh:mm:ss.sssZ` ' +
  '(la forme EXACTE de `history[].at`) — un autre format comparerait deux représentations ' +
  'différentes du temps, silencieusement';

/** D4 — attribution EXPLICITE, jamais tacite : ce que chaque côté de la coupe contient. */
export const CUT_LABEL_BEFORE = 'implémentation';
export const CUT_LABEL_AFTER =
  'gate de revue — inclut toute passe de correction de l’implémenteur déclenchée par les ' +
  'findings (elle a lieu après la borne, D4)';

// ⚠️ Finding SKILL-87 #2 — `Date.parse` est PERMISSIF (accepte `"Aug 28, 2026"`, un
// décalage horaire `+02:00`…) alors que la coupe compare les horodatages comme de
// simples CHAÎNES. Un format accepté par `Date.parse` mais différent de celui que
// `history[].at` écrit (`.toISOString()` : UTC, millisecondes sur 3 chiffres, `Z`
// littéral) romprait la comparaison sans qu'aucun état ne le signale — un décalage de
// fuseau ferait par exemple basculer TOUTE la coupe d'un côté. On exige donc la forme
// EXACTE, pas seulement une forme « parseable ».
const ISO_UTC_STRICT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** `true` seulement pour la forme exacte que `history[].at` porte — jamais une forme voisine. */
export function isStrictUtcInstant(value) {
  return typeof value === 'string' && ISO_UTC_STRICT_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Partitionne, par `type`, les séries `query_source: subagent` d'un instantané en
 * `before` (incréments à la borne ou avant) et `after` (strictement après).
 *
 * ⛔ Rend `null` + motif — jamais un zéro — si une série retenue n'a PAS d'historique
 * (`history` absent : format `SKILL-78`) ou si la borne n'est pas un instant UTC strict.
 * ⚠️ Comparaison LEXICOGRAPHIQUE des horodatages ISO-8601 (`Z`, même précision partout
 * dans ce puits) : pas de `Date` construit, pas de fuseau à trahir — d'où l'exigence de
 * la forme STRICTE sur `atIso` (finding SKILL-87 #2), sans laquelle cette comparaison de
 * chaînes comparerait deux formats différents en silence.
 */
export function cutSubagentAt(doc, atIso) {
  if (!isStrictUtcInstant(atIso)) {
    return { before: null, after: null, reason: `${REASON_CUT_BAD_INSTANT} : ${JSON.stringify(atIso ?? null)}` };
  }

  const relevant = (doc && Array.isArray(doc.series) ? doc.series : []).filter(
    (s) => s && s.attributes && s.attributes.query_source === 'subagent' && TYPES.includes(s.attributes.type)
  );
  const missingHistory = relevant.filter((s) => !Array.isArray(s.history));
  if (missingHistory.length > 0) {
    return {
      before: null,
      after: null,
      reason: `${REASON_CUT_NO_HISTORY} (${missingHistory.length}/${relevant.length} série(s) sans historique)`,
    };
  }

  const before = emptyBucket();
  const after = emptyBucket();
  for (const s of relevant) {
    for (const h of s.history) {
      if (!h || typeof h.value !== 'number' || typeof h.at !== 'string') continue;
      const target = h.at <= atIso ? before : after;
      target[s.attributes.type] += h.value;
    }
  }
  return { before, after, reason: null };
}

/**
 * Rend la coupe d'une session à un instant donné, en plus de sa lecture habituelle.
 *
 * Réutilise `readSession` pour le gate-keeping (D6 : les mêmes états d'absence
 * s'appliquent — une session non captée n'est pas plus coupable qu'elle n'est mesurable).
 * Seule une session `captured` peut être coupée ; au-delà, `cutSubagentAt` décide si
 * l'historique le permet.
 */
export function readSessionCut(sessionId, atIso, deps = {}) {
  const fsx = deps.fs || fs;
  const homedir = deps.homedir || os.homedir();
  const base = readSession(sessionId, deps);

  const absent = (state, reason) => ({
    sessionId,
    at: atIso,
    state,
    reason,
    before: null,
    after: null,
    label: null,
    warnings: base.warnings,
  });

  if (base.state !== STATE_CAPTURED) {
    return absent(base.state, base.reason);
  }

  const { root, reason: rootReason } = resolveTelemetryRoot(homedir, { fs: fsx });
  if (!root) return absent(STATE_UNDETERMINED, `${REASON_UNDETERMINED} — ${rootReason}`);
  const snapshot = readSnapshot(root, sessionId, { fs: fsx });
  if (!snapshot.doc) return absent(STATE_UNDETERMINED, `${REASON_UNDETERMINED} — instantané introuvable à la coupe`);

  const { before, after, reason } = cutSubagentAt(snapshot.doc, atIso);
  if (reason) return absent(STATE_UNDETERMINED, reason);

  return {
    sessionId,
    at: atIso,
    state: STATE_CAPTURED,
    reason: null,
    before,
    after,
    label: { before: CUT_LABEL_BEFORE, after: CUT_LABEL_AFTER },
    warnings: base.warnings,
  };
}

/** Les quatre `type` documentés de `claude_code.token.usage`. */
export const TYPES = ['cacheRead', 'cacheCreation', 'input', 'output'];

const emptyBucket = () => ({ cacheRead: 0, cacheCreation: 0, input: 0, output: 0 });

// ---------------------------------------------------------------------------
// Lectures élémentaires
// ---------------------------------------------------------------------------

/**
 * Date de début d'une session, lue au PREMIER horodatage de son transcript.
 * ⚠️ Pas le `mtime` du fichier : il bouge à chaque copie, l'horodatage écrit non.
 * `resolveTranscript` est IMPORTÉE de `write.mjs` — le balayage de
 * `~/.claude/projects/<slug>/` ne doit exister qu'à un seul endroit.
 */
export function sessionStartedAt(sessionId, homedir, deps = {}) {
  const fsx = deps.fs || fs;
  const projectsRoot = path.join(homedir, '.claude', 'projects');
  const found = resolveTranscript(sessionId, projectsRoot, { fs: fsx });
  if (!found.path) return { at: null, reason: found.reason };

  let raw;
  try {
    raw = fsx.readFileSync(found.path, 'utf8');
  } catch (err) {
    return { at: null, reason: `transcript illisible (${found.path}) : ${err.message}` };
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (entry && typeof entry.timestamp === 'string') return { at: entry.timestamp, reason: null };
  }
  return { at: null, reason: `aucun horodatage dans le transcript (${found.path})` };
}

/** Date d'activation, posée UNE FOIS par le collecteur à son premier démarrage. */
export function readActivation(root, deps = {}) {
  const fsx = deps.fs || fs;
  const file = path.join(root, ACTIVATION_FILE);
  let raw;
  try {
    raw = fsx.readFileSync(file, 'utf8');
  } catch (err) {
    return { at: null, reason: `marqueur d’activation absent (${file}) : ${err.code || err.message}` };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return { at: null, reason: `marqueur d’activation illisible (${file}) : ${err.message}` };
  }
  if (!doc || typeof doc.since !== 'string') {
    return { at: null, reason: `marqueur d’activation invalide (${file}) : pas de champ \`since\`` };
  }
  return { at: doc.since, reason: null };
}

/**
 * Compteur des points reçus puis JETÉS par le collecteur, à l'échelle du puits.
 * C'est le témoin qui distingue « rien n'est arrivé » de « tout a été jeté » — sans lui,
 * un renommage d'attribut en amont serait indiscernable d'un collecteur éteint.
 */
export function readDiagnostics(root, deps = {}) {
  const fsx = deps.fs || fs;
  try {
    const doc = JSON.parse(fsx.readFileSync(path.join(root, DIAGNOSTICS_FILE), 'utf8'));
    return {
      ignoredPoints: typeof doc.ignoredPoints === 'number' ? doc.ignoredPoints : 0,
      lastIgnoredAt: typeof doc.lastIgnoredAt === 'string' ? doc.lastIgnoredAt : null,
    };
  } catch {
    return { ignoredPoints: 0, lastIgnoredAt: null };
  }
}

/** Instantané d'une session. `doc: null` + motif s'il n'est pas là, ou pas lisible. */
export function readSnapshot(root, sessionId, deps = {}) {
  const fsx = deps.fs || fs;
  if (!safeSessionId(sessionId)) {
    return { doc: null, readable: false, reason: `\`session.id\` inutilisable : ${JSON.stringify(sessionId)}` };
  }
  const file = path.join(root, `${sessionId}.json`);
  let raw;
  try {
    raw = fsx.readFileSync(file, 'utf8');
  } catch {
    return { doc: null, readable: false, reason: null };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return { doc: null, readable: true, reason: `instantané illisible (${file}) : ${err.message}` };
  }
  if (!doc || doc.schema !== SNAPSHOT_SCHEMA || !Array.isArray(doc.series)) {
    return { doc: null, readable: true, reason: `instantané d’un format inattendu (${file})` };
  }
  return { doc, readable: true, reason: null };
}

// ---------------------------------------------------------------------------
// Ventilation
// ---------------------------------------------------------------------------

/**
 * Répartit les séries d'un instantané.
 *
 * ⛔ `cacheRead` et `cacheCreation` sont rendus DISTINCTEMENT, jamais additionnés
 * d'office : ils n'ont ni le même prix ni la même cause, et les fondre perdrait
 * précisément le terme que ce ticket existe pour mesurer.
 * ⛔ `main` et `auxiliary` ne sont jamais versés au total des sous-agents.
 * ⛔ `custom` est un rôle à part entière — un rôle qu'on n'a pas su nommer, pas un
 *    rôle nul : il ne se fond dans aucun autre.
 * ⛔ Une série qu'on ne sait pas lire (`type` hors des quatre documentés, ou
 *    `query_source` manquant) n'est PAS jetée en silence : elle part dans `unusable`,
 *    et l'appelant en tient compte avant de rendre un zéro.
 */
export function ventilate(doc) {
  const byQuerySource = {};
  const byAgent = {};
  const byRole = {};
  const unusable = [];

  for (const s of doc.series || []) {
    if (!s || typeof s.value !== 'number') {
      unusable.push({ attributes: (s && s.attributes) || {}, value: null, why: 'série sans valeur numérique' });
      continue;
    }
    const attrs = s.attributes || {};
    const type = attrs.type;
    if (!TYPES.includes(type)) {
      unusable.push({
        attributes: attrs,
        value: s.value,
        why: `\`type\` inconnu : ${JSON.stringify(type ?? null)} (attendus : ${TYPES.join(', ')})`,
      });
      continue;
    }
    if (typeof attrs.query_source !== 'string') {
      unusable.push({ attributes: attrs, value: s.value, why: '`query_source` absent' });
      continue;
    }

    const source = attrs.query_source;
    if (!byQuerySource[source]) byQuerySource[source] = emptyBucket();
    byQuerySource[source][type] += s.value;

    if (source !== 'subagent') continue;
    const agent = typeof attrs['agent.name'] === 'string' ? attrs['agent.name'] : AGENT_UNNAMED;
    if (!byAgent[agent]) byAgent[agent] = emptyBucket();
    byAgent[agent][type] += s.value;

    const role = typeof attrs.effort === 'string' ? `${agent} (effort ${attrs.effort})` : agent;
    if (!byRole[role]) byRole[role] = emptyBucket();
    byRole[role][type] += s.value;
  }

  const subagentTotals = byQuerySource.subagent || emptyBucket();
  return {
    subagent: { ...subagentTotals, byAgent, byRole },
    byQuerySource,
    unusable,
  };
}

// ---------------------------------------------------------------------------
// Le lecteur
// ---------------------------------------------------------------------------

/**
 * Rend l'état de la mesure pour un `session.id`. Ne jette jamais.
 *
 * `subagent` vaut `null` DÈS QUE l'état n'est pas `captured` : un chiffre n'est rendu
 * que s'il a été mesuré.
 */
export function readSession(sessionId, deps = {}) {
  const fsx = deps.fs || fs;
  const homedir = deps.homedir || os.homedir();

  const absent = (state, reason) => ({
    sessionId,
    state,
    reason,
    measuredAt: null,
    subagent: null,
    byQuerySource: null,
    warnings: [],
  });

  const { root, reason: rootReason } = resolveTelemetryRoot(homedir, { fs: fsx });
  if (!root) return absent(STATE_UNDETERMINED, `${REASON_UNDETERMINED} — ${rootReason}`);

  const diagnostics = readDiagnostics(root, { fs: fsx });
  const warnings = [];
  if (diagnostics.ignoredPoints > 0) {
    warnings.push(
      `le collecteur a reçu puis JETÉ ${diagnostics.ignoredPoints} point(s) sur ce puits ` +
        `(dernier : ${diagnostics.lastIgnoredAt}) — si rien n'est mesuré alors que ce compteur monte, ` +
        `les noms d'attributs OTEL ont bougé.`
    );
  }

  const snapshot = readSnapshot(root, sessionId, { fs: fsx });
  if (snapshot.doc) {
    const { subagent, byQuerySource, unusable } = ventilate(snapshot.doc);
    if (unusable.length > 0) {
      warnings.push(
        `${unusable.length} série(s) écartée(s) à la lecture : ` +
          unusable.map((u) => u.why).join(' ; ')
      );
    }
    // ⛔ Un total nul obtenu APRÈS avoir écarté des séries n'est pas « mesuré, et nul » :
    // c'est un trou déguisé en zéro. On refuse de l'estampiller `captured`.
    if (unusable.length > 0 && TYPES.every((t) => subagent[t] === 0)) {
      const out = absent(
        STATE_UNDETERMINED,
        `${REASON_UNDETERMINED} — total des sous-agents nul alors que ${unusable.length} série(s) ` +
          `ont été écartées : ${unusable.map((u) => u.why).join(' ; ')}`
      );
      out.warnings = warnings;
      return out;
    }
    return {
      sessionId,
      state: STATE_CAPTURED,
      reason: null,
      measuredAt: snapshot.doc.lastSeen ?? null,
      subagent,
      byQuerySource,
      warnings,
    };
  }
  if (snapshot.readable) {
    const out = absent(STATE_UNDETERMINED, `${REASON_UNDETERMINED} — ${snapshot.reason}`);
    out.warnings = warnings;
    return out;
  }

  // Aucun instantané. AVANT d'accuser le collecteur, vérifier que la télémétrie est
  // seulement allumée : `ACTIVATED.json` date le collecteur, pas `settings.json`.
  const live = readLiveSettings(homedir, { fs: fsx });
  if (live.settings !== null && !checkTelemetrySettings(live.settings).configured) {
    const out = absent(STATE_NOT_CONFIGURED, `${REASON_NOT_CONFIGURED} — lu dans ${live.file}`);
    out.warnings = warnings;
    return out;
  }

  const activation = readActivation(root, { fs: fsx });
  if (activation.at === null) {
    const out = absent(STATE_BEFORE_ACTIVATION, `${REASON_BEFORE_ACTIVATION} — ${activation.reason}`);
    out.warnings = warnings;
    return out;
  }

  const started = sessionStartedAt(sessionId, homedir, { fs: fsx });
  if (started.at === null) {
    const out = absent(
      STATE_UNDETERMINED,
      `${REASON_UNDETERMINED} — impossible de dater la session (transcript introuvable) : ${started.reason}`
    );
    out.warnings = warnings;
    return out;
  }
  const out =
    started.at < activation.at
      ? absent(
          STATE_BEFORE_ACTIVATION,
          `${REASON_BEFORE_ACTIVATION} — session démarrée le ${started.at}, télémétrie activée le ${activation.at}`
        )
      : absent(
          STATE_NOT_CAPTURED,
          `${REASON_NOT_CAPTURED} — session démarrée le ${started.at}, après l’activation du ${activation.at}`
        );
  out.warnings = warnings;
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * ⚠️ Invariant du dépôt : un drapeau inconnu, un drapeau valué sans valeur, ou un
 * positionnel superflu font ÉCHOUER la commande. Et surtout : la `session.id` ne
 * s'invente pas.
 *
 * `--at <instant ISO>` (SKILL-87, D5) : optionnel, la borne de coupe — la jointure
 * avec `tokensAtSpawn` se fait à la main, ce drapeau ne la devine pas.
 */
export function parseArgs(argv) {
  const positionals = [];
  let at = null;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--at') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, error: '`--at` attend une valeur (instant ISO)' };
      }
      at = value;
      i += 1;
      continue;
    }
    if (token.startsWith('--')) return { ok: false, error: `drapeau inconnu : ${token}` };
    positionals.push(token);
  }
  if (positionals.length === 0) {
    return { ok: false, error: 'argument requis manquant : <session.id> — il ne s’invente pas' };
  }
  if (positionals.length > 1) {
    return { ok: false, error: `arguments positionnels superflus : ${positionals.slice(1).join(', ')}` };
  }
  return { ok: true, args: { sessionId: positionals[0], at } };
}

/**
 * Codes de sortie :
 *   0 — lecture faite (y compris quand elle rend `null` + motif : une absence n'est
 *       pas une panne, D6)
 *   1 — argument invalide
 */
export function main(argv = process.argv.slice(2), deps = {}) {
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr(`${parsed.error}\n`);
    return 1;
  }

  const result = readSession(parsed.args.sessionId, deps);
  if (parsed.args.at !== null) {
    // SKILL-87 (D3) — ajoute la coupe SANS remplacer la lecture habituelle : le total
    // reste la lecture par défaut, la coupe est une dimension EN PLUS.
    result.cut = readSessionCut(parsed.args.sessionId, parsed.args.at, deps);
    if (result.cut.reason) stderr(`${result.cut.reason}\n`);
  }
  if (result.reason) stderr(`${result.reason}\n`);
  for (const w of result.warnings) stderr(`⚠️ ${w}\n`);
  stdout(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = main();
}
