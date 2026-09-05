// SKILL-29 — écrivain de mesures : un fichier JSON par cycle de ticket dans
// `~/sdd-metrics` (specs/skill-29.md).
//
// Invoqué par l'ORCHESTRATEUR à l'Étape 6.8 de `/sdd-run-ticket`, depuis son
// propre outil shell. Lancé par un sous-agent, il mesurerait le transcript du
// sous-agent — une autre quantité, silencieusement.
//
// Trois principes, hérités de D11 et du baseline (SKILL-30) :
//
//  1. **Chemin dérivé, jamais configuré.** `<home>/sdd-metrics`, dérivé de
//     `os.homedir()`. Aucune variable d'environnement, aucun fichier de config,
//     aucun flag de sortie ; les tests injectent le home, ils ne le configurent
//     pas.
//  2. **No-op si le dépôt manque.** Absent, pas un répertoire, ou sans `.git` :
//     rien n'est écrit, le motif part sur stderr, et le code de sortie est 0 —
//     le cycle ne doit pas échouer parce que le dépôt de données manque. Ni le
//     dépôt ni son `.git` ne sont créés. ⛔ Aucun `backlog init`, jamais.
//  3. **Aucun `git` en écriture.** L'écrivain ne `git add` ni ne commite : des
//     commits concurrents depuis 10-15 sessions rouvriraient, sous forme
//     d'`index.lock`, la classe de panne que « un fichier par cycle » ferme.
//     DEUX commandes git émises, toutes deux en lecture : `rev-parse --verify`
//     (existence d'un SHA — `<sha_final>` ou un `ref` de finding) et, depuis
//     SKILL-56, `merge-base --is-ancestor` (atteignabilité d'un `ref` de
//     finding depuis `main`).
//
// Et une règle qui traverse tout le fichier : **un compteur absent n'est jamais
// un compteur nul**. `null` + un motif dans `unmeasured`, jamais `0`.
//
// Réutilisation, pas réimplémentation : `parseSession`, `extractSpawns` et
// `summarize` sont IMPORTÉES de `./baseline.mjs` — la déduplication par
// `message.id` doit exister à UN SEUL endroit ; une seconde implémentation
// dériverait et ramènerait le défaut n° 2 (compteurs gonflés d'un facteur
// variable, 1,84× sur la session de référence). `EXPECTED_PROMPT_SECTIONS`
// n'est PAS importée ici : `prompt.sections` en hérite indirectement, par
// `extractSpawns`, qui la déroule lui-même — le lien est donc réel mais
// transitif, et le grep de ce fichier ne le montre pas.
//
// Trois motifs, en revanche, sont RECOPIÉS de `baseline.mjs` faute d'y être
// exportés (et la Portée du ticket interdit d'y toucher) : les deux formes
// textuelles de `subagent_tokens`, et (SKILL-61) `IMPLEMENTER_SUBAGENT_PREFIX`
// — le prédicat qui distingue un lancement d'implémenteur d'un relecteur ou
// d'un sous-agent ordinaire, dont `localSpawnPositions` a besoin pour situer
// les lancements DANS LE MÊME espace de positions que les écritures. Leur
// non-divergence est verrouillée par un test de cohérence qui compare les
// trois littéraux aux deux fichiers, textuellement
// (`__tests__/review-log-write-coherence.test.js`, groupe « cohérence avec baseline.mjs »).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSession, extractSpawns, summarize } from './baseline.mjs';

export const SCHEMA_VERSION = 5;

/** Répertoire du dépôt de données, sous le home. Dérivé, jamais configuré. */
export const METRICS_DIR_NAME = 'sdd-metrics';

/** Énumérés FERMÉS — les seuls que cet outil valide (cf. `parseArgs`). */
export const DOSAGES = ['none', 'light', 'deep'];
export const DISPOSITIONS = ['corrigé', 'E1', 'E2', 'E3'];
export const MODES = ['same-repo', 'cross-repo'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

// Flags à valeur unique. `model`, `effort` et `review` sont enregistrés VERBATIM
// et volontairement NON validés contre un énuméré local : ces trois vocabulaires
// vivent dans l'outil backlog (`EXEC_MODELS` / `EXEC_EFFORTS` / `EXEC_REVIEWS`),
// hors de ce dépôt. Les recopier ici les ferait diverger — et une valeur
// nouvellement légitime bloquerait la MESURE, ce qui est le comble.
const STRING_FLAGS = {
  '--ticket': 'ticket',
  '--project': 'project',
  '--repo': 'repo',
  '--mode': 'mode',
  '--sha': 'sha',
  '--date': 'date',
  '--model': 'model',
  '--effort': 'effort',
  '--review': 'review',
  '--dosage': 'dosage',
};

const NUMBER_FLAGS = {
  '--reviewers': 'reviewers',
  '--r': 'r',
  '--u': 'u',
};

// `--review` est le SEUL flag de chaîne optionnel : l'Étape 2 du skill pose que
// le champ `review` du frontmatter peut légitimement être ABSENT (« les tickets
// historiques n'en ont pas »), auquel cas le dosage `light` est appliqué par
// défaut PAR LE CONSOMMATEUR. L'exiger ferait sortir l'écrivain en 1 sur ces
// tickets-là — aucun fichier, aucune mesure, pour un champ vide. Absent →
// `exec.review: null` + motif : l'enregistrement distingue alors « frontmatter
// sans review » de « review: light déclaré », ce qu'un défaut recopié perdrait.
const OPTIONAL_STRING_FLAGS = new Set(['--review']);
const REQUIRED_FLAGS = Object.keys(STRING_FLAGS).filter((f) => !OPTIONAL_STRING_FLAGS.has(f));

function fail(error) {
  return { ok: false, error };
}

/**
 * Découpe une spec de finding sur ses 4 PREMIERS séparateurs seulement : le
 * titre est en dernier précisément pour qu'une barre verticale dedans ne décale
 * rien.
 */
function splitOnFirst(spec, separator, count) {
  const parts = [];
  let rest = spec;
  for (let i = 0; i < count; i++) {
    const at = rest.indexOf(separator);
    if (at === -1) return null;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at + separator.length);
  }
  parts.push(rest);
  return parts;
}

/**
 * `"<i>|<relecteurs>|<disposition>|<ref>|<titre court>"`.
 * Findings cités par TITRE COURT (D5) : leur texte intégral n'a jamais été
 * durable et ne le devient pas.
 */
export function parseFindingSpec(spec) {
  if (typeof spec !== 'string') return fail('--finding attend une chaîne');
  const parts = splitOnFirst(spec, '|', 4);
  if (!parts) {
    return fail(
      `--finding "${spec}" : 5 champs attendus (<i>|<relecteurs>|<disposition>|<ref>|<titre>)`
    );
  }
  const [rawI, rawReviewers, rawDisposition, rawRef, rawTitle] = parts;

  // `Number('')` vaut 0 et `Number.isInteger(0)` est vrai : tester le seul
  // `Number.isInteger` laisserait un champ VIDE devenir le finding n° 0 — la
  // coercition silencieuse que cet outil refuse partout ailleurs. Un numéro de
  // registre commence à 1 : un `0` ou un négatif ne désigne aucune ligne.
  const rawIndex = rawI.trim();
  if (!/^\d+$/.test(rawIndex) || Number(rawIndex) < 1) {
    return fail(
      `--finding "${spec}" : numéro de finding invalide ("${rawIndex}") — entier ≥ 1 attendu, jamais coercé`
    );
  }
  const i = Number(rawIndex);

  const disposition = rawDisposition.trim();
  if (!DISPOSITIONS.includes(disposition)) {
    return fail(
      `--finding "${spec}" : disposition "${disposition}" hors de {${DISPOSITIONS.join(', ')}}`
    );
  }

  const reviewers = rawReviewers
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const ref = rawRef.trim();
  const title = rawTitle.trim();
  if (title.length === 0) return fail(`--finding "${spec}" : titre court vide`);

  return {
    ok: true,
    finding: { i, title, reviewers, disposition, ref: ref.length > 0 ? ref : null },
  };
}

/**
 * Lit les arguments de l'orchestrateur : ce qu'il a CALCULÉ lui-même (D6) et
 * rien d'autre. Ni les tokens ni le `spawnIndex` ne se passent — ce sont des
 * mesures, elles se lisent.
 *
 * Aucune valeur n'est inventée : un flag inconnu, une valeur hors énuméré fermé
 * ou un compteur non numérique sont des ÉCHECS, jamais une coercition
 * silencieuse en `0` (qui fabriquerait « des relecteurs ont cherché et n'ont
 * rien trouvé »).
 */
export function parseArgs(argv = []) {
  const raw = {};
  const findings = [];

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const isString = Object.prototype.hasOwnProperty.call(STRING_FLAGS, flag);
    const isNumber = Object.prototype.hasOwnProperty.call(NUMBER_FLAGS, flag);
    if (!isString && !isNumber && flag !== '--finding') {
      return fail(`flag inconnu : ${flag}`);
    }
    if (i + 1 >= argv.length) return fail(`valeur manquante pour ${flag}`);
    const value = argv[++i];

    if (flag === '--finding') {
      const parsed = parseFindingSpec(value);
      if (!parsed.ok) return fail(parsed.error);
      findings.push(parsed.finding);
      continue;
    }
    raw[flag] = value;
  }

  for (const flag of REQUIRED_FLAGS) {
    if (raw[flag] === undefined || raw[flag] === '') {
      return fail(`argument requis manquant : ${flag}`);
    }
  }

  const args = {
    ticket: raw['--ticket'],
    project: raw['--project'],
    repo: raw['--repo'],
    mode: raw['--mode'],
    sha: raw['--sha'],
    date: raw['--date'],
    exec: {
      model: raw['--model'],
      effort: raw['--effort'],
      review: raw['--review'] === undefined || raw['--review'] === '' ? null : raw['--review'],
    },
    dosage: raw['--dosage'],
    reviewers: null,
    r: null,
    u: null,
    findings,
  };

  if (!DATE_RE.test(args.date)) {
    return fail(`--date "${args.date}" : format AAAA-MM-JJ attendu (la date n'est jamais inventée)`);
  }
  if (!MODES.includes(args.mode)) {
    return fail(`--mode "${args.mode}" hors de {${MODES.join(', ')}}`);
  }
  if (!DOSAGES.includes(args.dosage)) {
    return fail(`--dosage "${args.dosage}" hors de {${DOSAGES.join(', ')}}`);
  }

  for (const [flag, field] of Object.entries(NUMBER_FLAGS)) {
    if (raw[flag] === undefined) continue;
    const n = Number(raw[flag]);
    if (raw[flag].trim() === '' || !Number.isInteger(n) || n < 0) {
      return fail(`${flag} "${raw[flag]}" : entier positif attendu (jamais coercé en 0)`);
    }
    args[field] = n;
  }

  // Dosage `none` : l'absence de `r`/`u`/`reviewers` est le cas NOMINAL (personne
  // n'a cherché). Dosage `light`/`deep` : la même absence est une OMISSION.
  if (args.dosage !== 'none') {
    for (const flag of Object.keys(NUMBER_FLAGS)) {
      if (raw[flag] === undefined) {
        return fail(`argument requis manquant : ${flag} (obligatoire en dosage \`${args.dosage}\`)`);
      }
    }
  }

  return { ok: true, args };
}

// ---------------------------------------------------------------------------
// Localisation : dépôt de mesures et transcript
// ---------------------------------------------------------------------------

/**
 * `<home>/sdd-metrics`, s'il existe, est un répertoire et porte un `.git`.
 * Sinon `null` + motif — et AUCUNE création, ni du dépôt, ni du `.git`.
 */
export function resolveMetricsRoot(homedir, deps = {}) {
  const fsx = deps.fs || fs;
  if (typeof homedir !== 'string' || homedir.length === 0) {
    return { root: null, reason: 'home introuvable — impossible de dériver le dépôt de mesures' };
  }
  const root = path.join(homedir, METRICS_DIR_NAME);

  let stat;
  try {
    stat = fsx.statSync(root);
  } catch {
    return { root: null, reason: `dépôt de mesures absent : ${root} n'existe pas (no-op)` };
  }
  if (!stat.isDirectory()) {
    return { root: null, reason: `${root} existe mais n'est pas un répertoire (no-op)` };
  }
  try {
    fsx.statSync(path.join(root, '.git'));
  } catch {
    return { root: null, reason: `${root} n'est pas un dépôt git (.git absent) (no-op)` };
  }
  return { root, reason: null };
}

/**
 * Localise `<sessionId>.jsonl` par BALAYAGE de `<projectsRoot>/<slug>/`, jamais
 * en recalculant le slug de projet : ce nom de dossier est un détail de harnais
 * non documenté, et un worktree n'a pas le même slug que son dépôt principal.
 * Plusieurs candidats → le plus récemment modifié, et le motif le dit.
 */
export function resolveTranscript(sessionId, projectsRoot, deps = {}) {
  const fsx = deps.fs || fs;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return {
      path: null,
      candidates: 0,
      reason: 'session id absente (CLAUDE_CODE_SESSION_ID non défini dans l’environnement)',
    };
  }

  let entries;
  try {
    entries = fsx.readdirSync(projectsRoot, { withFileTypes: true });
  } catch (err) {
    return { path: null, candidates: 0, reason: `racine des projets illisible (${projectsRoot}) : ${err.message}` };
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsRoot, entry.name, `${sessionId}.jsonl`);
    let stat;
    try {
      stat = fsx.statSync(candidate);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    candidates.push({ path: candidate, mtimeMs: stat.mtimeMs });
  }

  if (candidates.length === 0) {
    return { path: null, candidates: 0, reason: `transcript introuvable pour la session ${sessionId}` };
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return {
    path: candidates[0].path,
    candidates: candidates.length,
    reason:
      candidates.length > 1
        ? `${candidates.length} transcripts candidats pour cette session — retenu le plus récemment modifié`
        : null,
  };
}

// ---------------------------------------------------------------------------
// Tokens de sous-agents, par rôle (défaut n° 3)
// ---------------------------------------------------------------------------

// `subagent_tokens` n'est jamais une clé JSON : c'est du texte, sous deux formes
// (finding 2 de SKILL-30). On ne les cherche QUE dans un bloc `<usage>…</usage>` :
// constat sur le corpus réel (103 transcripts, 2026-08-19) — 988 occurrences
// dans un `<usage>`, 8 hors, et les 8 sont de la PROSE qui décrit le format.
// Relire de la prose est exactement le défaut n° 1 (sur-détection) que ce
// ticket a pour consigne de ne pas reproduire.
const USAGE_BLOCK_RE = /<usage>([\s\S]*?)<\/usage>/g;
const SUBAGENT_TOKENS_XML_RE = /<subagent_tokens>(\d+)<\/subagent_tokens>/g;
const SUBAGENT_TOKENS_PLAIN_RE = /subagent_tokens:\s*(\d+)/g;

// Identifiants portés par les deux formes réelles.
const TASK_ID_RE = /<task-id>([^<]+)<\/task-id>/;
const NOTIF_TOOL_USE_ID_RE = /<tool-use-id>([^<]+)<\/tool-use-id>/;
const AGENT_ID_RE = /agentId:\s*([A-Za-z0-9_-]+)/;

export const UNATTRIBUTED = 'unattributed';

function messageContentBlocks(message) {
  const content = message?.message?.content;
  return Array.isArray(content) ? content : [];
}

// `tool_use` -> nom de l'outil appelé, POUR TOUS LES OUTILS (pas seulement
// `Agent`). Deux usages, et le second est le plus important :
//  - un identifiant qui pointe vers un `Agent` donne le RÔLE ;
//  - un identifiant qui pointe vers un autre outil (`Bash`, `Read`…) dit que le
//    `<usage>` trouvé dans SA sortie est du TEXTE AFFICHÉ, pas une comptabilité
//    de sous-agent. Sans cette table, un `cat` de ce fichier-ci suffit à gonfler
//    la mesure — la sur-détection par relecture de prose (défaut n° 1) que ce
//    ticket a pour consigne de ne pas reproduire.
const AGENT_TOOL_NAME = 'Agent';

function toolsByUseId(messages) {
  const tools = new Map();
  for (const message of messages) {
    for (const block of messageContentBlocks(message)) {
      if (!block || block.type !== 'tool_use' || typeof block.id !== 'string') continue;
      const subagentType = typeof block.input?.subagent_type === 'string' ? block.input.subagent_type : null;
      tools.set(block.id, { name: block.name, subagentType });
    }
  }
  return tools;
}

// Récolte les chaînes de l'enregistrement ENTIER (le compte-rendu d'une tâche de
// fond vit dans un `content` racine, hors de `.message`), en gardant le
// `tool_use_id` du bloc `tool_result` qui les porte, quand il y en a un.
//
// ⚠️ La clé `toolUseResult` est SAUTÉE : c'est l'écho structuré, par le harnais,
// du `tool_result` déjà présent dans `message.content` du MÊME enregistrement.
// Elle est écrite HORS du bloc `tool_result`, donc sa copie du texte arrive sans
// `tool_use_id` — elle CONTOURNE la garde de contexte ci-dessous. Un `Bash` qui
// dépouille un transcript étranger suffit alors à faire entrer le coût d'une
// autre session dans la mesure : la copie du `tool_result` est bien écartée, pas
// celle de l'écho. Vérifié sur les 103 transcripts réels (2026-08-19) : AUCUNE
// occurrence de `<usage>` n'y existe uniquement sous `toolUseResult` — sauter
// cette clé ne perd rien.
const HARNESS_ECHO_KEY = 'toolUseResult';

function collectTexts(node, toolUseId, acc, seen) {
  if (typeof node === 'string') {
    acc.push({ text: node, toolUseId });
    return;
  }
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  let context = toolUseId;
  if (!Array.isArray(node) && node.type === 'tool_result' && typeof node.tool_use_id === 'string') {
    context = node.tool_use_id;
  }
  if (Array.isArray(node)) {
    for (const value of node) collectTexts(value, context, acc, seen);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === HARNESS_ECHO_KEY) continue;
    collectTexts(value, context, acc, seen);
  }
}

function sumSubagentTokensInUsageBlocks(text) {
  let total = 0;
  let found = false;
  for (const usage of text.matchAll(USAGE_BLOCK_RE)) {
    const body = usage[1];
    for (const m of body.matchAll(SUBAGENT_TOKENS_XML_RE)) {
      total += Number(m[1]);
      found = true;
    }
    for (const m of body.matchAll(SUBAGENT_TOKENS_PLAIN_RE)) {
      total += Number(m[1]);
      found = true;
    }
  }
  return found ? total : null;
}

/**
 * Somme des `subagent_tokens` PAR RÔLE, dédupliquée par identifiant de TÂCHE.
 *
 * Défaut n° 3, mesuré sur le corpus réel (2,13× de gonflement) : une
 * `task-notification` notifie PLUSIEURS fois pour la même `task-id` — le
 * harnais le dit lui-même (« the same task-id may notify more than once ») — et
 * chaque notification reporte le TOTAL COURANT de l'agent, pas un incrément.
 * Sommer les notifications triple donc un coût unique. Et dédupliquer par
 * `tool-use-id` ne suffit pas : chaque reprise par `SendMessage` en crée un
 * NOUVEAU, alors que la tâche, elle, est la même.
 *
 * Clé de déduplication, par ordre de préférence : `task-id` (tâche de fond) >
 * `agentId` (résultat d'outil d'un agent au premier plan, repris par
 * `SendMessage`) > identifiant d'appel. Le montant retenu est celui de la
 * DERNIÈRE occurrence (le total courant le plus récent) ; le rôle retenu est le
 * PREMIER connu (les notifications de reprise portent l'identifiant d'appel du
 * `SendMessage`, qui n'est pas un appel `Agent` et ne dit donc aucun rôle).
 *
 * Rend `{ total, byRole }` avec `byRole` seedé à `0` pour chaque rôle appelé
 * dans la session (`0` est juste : on a lu, il n'y avait rien) et un bucket
 * `unattributed` — dont la somme, réconciliation oblige, égale le total.
 *
 * ⚠️ Un bloc `<usage>` peut aussi être du TEXTE AFFICHÉ — un `Bash`, un `Read`
 * ou un rapport de relecteur qui montre un transcript (ou ce fichier-ci) en
 * produit un, indiscernable d'un vrai à la lecture du texte seul. Deux gardes
 * l'écartent, chacune instruite sur le corpus réel plutôt que décrétée : le
 * MARQUEUR d'accounting exigé, et le CONTEXTE d'outil ordinaire. Sans elles, la
 * mesure du cycle qui a écrit ce fichier était gonflée de +58 %.
 *
 * `unattributed` reste pour les occurrences qui SONT une comptabilité mais dont
 * le rôle ne se résout pas (l'appel `Agent` n'est plus dans le transcript —
 * session reprise ou compactée) : là, on ne sait pas, et on le dit.
 *
 * `rolesUniverse` (SKILL-63) — optionnel, défaut `messages` (comportement
 * inchangé pour tout appelant existant) : la liste de messages sur laquelle
 * les RÔLES SONT SEEDÉS (les clés de `byRole`), distincte de `messages`, sur
 * laquelle les OCCURRENCES SONT SOMMÉES. Nécessaire pour que `tokensAtSpawn`
 * (une TRANCHE de la session) porte EXACTEMENT le même jeu de clés que
 * `tokens` (la session entière) — D1 de specs/skill-63.md : « même forme
 * exactement, pour que la soustraction champ à champ soit évidente ». Sans
 * ça, un rôle appelé APRÈS le lancement retenu (le relecteur, à l'Étape 6.3,
 * après l'implémenteur de l'Étape 4) est absent de `tokensAtSpawn.subagentReportedTokensByRole`
 * et `tokens[...] - tokensAtSpawn[...]` vaut `NaN` pour ce rôle.
 *
 * ⚠️ **SKILL-69 — ce que la quantité rendue EXCLUT.** `amount` (donc `total` et
 * chaque valeur de `byRole`) est la somme du seul `<subagent_tokens>` du
 * compte-rendu de fin de sous-agent — `input`+`output`, RIEN d'autre. Le
 * contexte relu par le sous-agent (les deux compteurs de cache que le bloc
 * `usage` de l'ORCHESTRATEUR porte, lui, sous `cacheRead`/`cacheCreate` — cf.
 * `summarize` de `baseline.mjs`) n'est exposé par aucune source lisible du
 * transcript et n'entre dans aucune de ces sommes : c'est pourquoi l'export
 * s'appelle `subagentReportedTokensByRole` — REPORTÉ, pas MESURÉ dans son
 * ensemble — et pourquoi `tokensAt` ci-dessous porte à côté deux champs `null`
 * (`subagentCacheReadTokens`, `subagentCacheCreateTokens`) nommant ce trou.
 */
export function subagentReportedTokensByRole(messages, rolesUniverse = messages) {
  const list = Array.isArray(messages) ? messages : [];
  const universe = Array.isArray(rolesUniverse) ? rolesUniverse : list;
  const tools = toolsByUseId(universe);

  const byRole = { [UNATTRIBUTED]: 0 };
  for (const { name, subagentType } of tools.values()) {
    if (name === AGENT_TOOL_NAME && subagentType) byRole[subagentType] = 0;
  }

  const occurrences = new Map();
  let anonymous = 0;

  for (const message of list) {
    const texts = [];
    collectTexts(message, null, texts, new Set());
    for (const { text, toolUseId } of texts) {
      const amount = sumSubagentTokensInUsageBlocks(text);
      if (amount === null) continue;

      const taskId = TASK_ID_RE.exec(text)?.[1];
      const agentId = AGENT_ID_RE.exec(text)?.[1];
      const notifToolUseId = NOTIF_TOOL_USE_ID_RE.exec(text)?.[1];

      // Marqueur d'accounting EXIGÉ. Une comptabilité de sous-agent porte
      // toujours l'un des deux marqueurs que le harnais écrit lui-même autour du
      // `<usage>` : `<task-id>` (tâche de fond) ou `agentId:` (agent au premier
      // plan, repris par `SendMessage`). Mesuré sur les 103 transcripts réels
      // (2026-08-19) : 729 occurrences portent `<task-id>`, 252 portent
      // `agentId:`, et les 10 restantes — ni l'un ni l'autre — sont TOUTES de la
      // prose (le commentaire d'en-tête de `baseline.mjs`, cité dans une sortie
      // d'outil ou recopié dans un rapport). Exiger le marqueur ferme donc la
      // sur-détection par relecture de prose (défaut n° 1) sans perdre une seule
      // mesure réelle — y compris la prose d'un message d'assistant, qu'aucun
      // `tool_use_id` ne permettrait d'écarter.
      if (!taskId && !agentId) continue;

      // Écarter le texte AFFICHÉ, et lui seul. Le critère est le bloc
      // `tool_result` QUI PORTE l'occurrence : un résultat d'outil renvoie
      // toujours à l'appel qui l'a produit, donc une comptabilité de sous-agent
      // y a forcément un `Agent` pour contexte. Un autre outil (`Bash`, `Read`,
      // `Grep`) ne peut avoir affiché ce `<usage>` que comme du texte.
      //
      // ⚠️ Le critère n'est PAS le `<tool-use-id>` d'une task-notification :
      // celui-là désigne l'appel qui a déclenché la notification, et après une
      // reprise c'est un `SendMessage`, pas un `Agent`. S'en servir pour écarter
      // jetterait la DERNIÈRE notification de chaque tâche reprise — donc le
      // total courant le plus récent, la seule valeur juste (défaut n° 3).
      const contextTool = toolUseId ? tools.get(toolUseId) : undefined;
      if (contextTool && contextTool.name !== AGENT_TOOL_NAME) continue;

      const roleToolUseId = notifToolUseId || toolUseId;
      const roleTool = roleToolUseId ? tools.get(roleToolUseId) : undefined;
      const role = roleTool && roleTool.name === AGENT_TOOL_NAME ? roleTool.subagentType : null;

      let key;
      if (taskId) key = `task:${taskId}`;
      else if (agentId) key = `agent:${agentId}`;
      else if (roleToolUseId) key = `tooluse:${roleToolUseId}`;
      else key = `anon:${anonymous++}`;

      const previous = occurrences.get(key);
      occurrences.set(key, { role: previous?.role || role, amount });
    }
  }

  let total = 0;
  for (const { role, amount } of occurrences.values()) {
    const bucket = role || UNATTRIBUTED;
    byRole[bucket] = (byRole[bucket] || 0) + amount;
    total += amount;
  }
  return { total, byRole };
}

// ---------------------------------------------------------------------------
// Mesures lues dans le transcript
// ---------------------------------------------------------------------------

/**
 * Compteurs (même forme que le bloc `tokens`) évalués sur le préfixe
 * `messages.slice(0, endIndex + 1)` — borne INCLUSIVE (SKILL-63 D2). `scope`
 * est reçu, jamais deviné : deux instants différents (`session-to-date`,
 * `session-to-spawn`) doivent porter deux étiquettes différentes.
 *
 * FACTORISE le calcul déjà présent ici pour le bloc `tokens` : une seconde
 * implémentation divergerait (c'est précisément ce que le commentaire de
 * `subagentReportedTokensByRole` prémunit pour la déduplication). `collectTranscriptMetrics`
 * appelle cette même fonction pour `tokens` (`endIndex = messages.length - 1`)
 * et pour `tokensAtSpawn` (`endIndex` = position du lancement retenu).
 *
 * `endIndex` négatif, à 0, ou au-delà de la longueur du tableau : jamais
 * d'exception — borné à `[-1, messages.length - 1]` (un `endIndex` négatif
 * rend un préfixe vide, donc `null`, jamais un bloc de zéros).
 *
 * Rend `null`, jamais un bloc de zéros, quand le préfixe ne porte aucun bloc
 * `usage` (SKILL-29 : un compteur absent n'est jamais un compteur nul).
 *
 * `subagentReportedTokensByRole` est appelée avec la liste ENTIÈRE (`list`,
 * jamais `prefix`) comme univers de seed des rôles (D1) : le préfixe borne ce
 * qui est SOMMÉ, jamais l'ensemble des CLÉS produites — sinon un rôle appelé
 * après la borne (le relecteur, typiquement, lancé après l'implémenteur)
 * serait absent de `tokensAtSpawn.subagentReportedTokensByRole` alors qu'il
 * figure dans `tokens.subagentReportedTokensByRole`, et `tokens[r] -
 * tokensAtSpawn[r]` vaudrait `NaN` pour ce rôle plutôt que son coût réel.
 *
 * `subagentCacheReadTokens` / `subagentCacheCreateTokens` (SKILL-69, D2) valent
 * toujours `null` : le compte-rendu de fin de sous-agent ne porte que
 * `input`+`output`, jamais son contexte relu. `collectTranscriptMetrics` pose
 * l'entrée `unmeasured` correspondante ; `tokensAt` ne fait que déclarer le
 * champ, elle ne connaît pas le chemin (`tokens.…` ou `tokensAtSpawn.…`) sous
 * lequel il sera lu.
 */
export function tokensAt(messages, endIndex, scope) {
  const list = Array.isArray(messages) ? messages : [];
  const requested = Number.isInteger(endIndex) ? endIndex : -1;
  const bounded = Math.min(Math.max(requested, -1), list.length - 1);
  const prefix = list.slice(0, bounded + 1);

  const [summary] = summarize([{ project: null, sessionId: null, messages: prefix }]);
  if (summary.noUsage) return null;

  const { total, byRole } = subagentReportedTokensByRole(prefix, list);
  return {
    scope,
    input: summary.tokens.input,
    output: summary.tokens.output,
    cacheRead: summary.tokens.cacheRead,
    cacheCreate: summary.tokens.cacheCreate,
    // Volontairement PAS `summary.tokens.subagentReportedTokens` : celui-là est
    // la somme naïve, gonflée par le défaut n° 3.
    subagentReportedTokens: total,
    subagentReportedTokensByRole: byRole,
    // SKILL-69, D2 : le terme manquant devient un champ `null`, jamais une
    // absence muette — cf. le commentaire au-dessus de cette fonction.
    subagentCacheReadTokens: null,
    subagentCacheCreateTokens: null,
  };
}

// Motif PARTAGÉ entre `collectConcurrency` et `collectTranscriptMetrics`
// (SKILL-63 D4, tableau des `null`) : les deux gardes constatent la MÊME
// divergence défensive (le prédicat recopié de `localSpawnPositions` aurait
// dérivé de celui d'`extractSpawns`), et doivent porter EXACTEMENT le même
// texte — jamais un troisième motif inventé pour la seconde garde.
const SPAWN_POSITION_DIVERGENCE_REASON =
  'divergence entre extractSpawns et la passe locale de positions de lancement — ' +
  'mesure abandonnée plutôt que fausse';

// Motif PARTAGÉ des quatre entrées `unmeasured` de SKILL-69 D2
// (`tokens.subagentCacheReadTokens`, `tokens.subagentCacheCreateTokens`,
// `tokensAtSpawn.subagentCacheReadTokens`, `tokensAtSpawn.subagentCacheCreateTokens`)
// — même discipline que `SPAWN_POSITION_DIVERGENCE_REASON` ci-dessus : deux
// motifs recopiés divergent, un seul recopié ne peut pas.
const SUBAGENT_CACHE_UNMEASURED_REASON =
  "le compte-rendu `<usage><subagent_tokens>` ne porte que l'`input`+`output` du sous-agent ; " +
  "son contexte relu n'est exposé par aucune source lisible — mesure produite par la " +
  'télémétrie OTEL (SKILL-78)';

// Rang, dans l'espace de `localSpawnPositions` (tool_use ordinal, tous outils
// confondus), du lancement dont la position vaut `position` -> l'INDEX DE
// MESSAGE (dans `messages`) qui le porte. Nécessaire parce que `tokensAt`
// tranche `messages` lui-même (un tableau de tours de conversation), alors que
// `localSpawnPositions`/`extractRecordWrites` vivent dans un espace de rang
// PARTAGÉ entre spawns et écritures (SKILL-61) qui ne coïncide PAS avec
// l'index de message dès qu'un tour sans `tool_use` (texte, résultat d'outil,
// notification de tâche…) s'intercale — le cas nominal d'un transcript réel.
function messageIndexForToolUsePosition(messages, position) {
  for (const entry of toolUsePositions(messages)) {
    if (entry.position === position) return entry.messageIndex;
  }
  return null;
}

// SKILL-112 — motif de l'absence d'un lancement d'IMPLÉMENTATION pour `ticket`.
// Deux régimes, deux motifs, et un SEUL exemplaire de chacun : le même fait ne
// doit pas se raconter de deux façons selon le champ qu'on dépouille, donc
// `collectTranscriptMetrics` (`spawnIndex`, `prompt`, `tokensAtSpawn`) et
// `collectConcurrency` (`reason`) passent tous les deux par ici.
//
//  - régime ORPHELIN (neuf) : le ticket n'a QUE des lancements de correction —
//    transcript tronqué, ou cycle repris à la gate seule. Dire ici « aucun
//    lancement d'implémenteur » serait MENSONGER : il en existe un, ce n'est
//    simplement pas celui qu'on mesure.
//  - régime « aucun lancement du tout » (existant) : motif INCHANGÉ, mot pour
//    mot — plusieurs tests de non-régression le comparent à l'identique.
function spawnAbsenceReason(spawns, ticket) {
  const list = Array.isArray(spawns) ? spawns : [];
  if (list.some((s) => s.ticketId === ticket && s.isCorrection)) {
    return (
      `seuls des lancements de correction pour ${ticket} dans le transcript — ` +
      `aucun lancement d'implémentation à mesurer`
    );
  }
  return `aucun lancement d'implémenteur pour ${ticket} dans le transcript`;
}

/**
 * Ce que le transcript de la session dit du cycle, à l'INSTANT de l'écriture :
 *
 *  - `spawnIndex` — rang du lancement d'implémenteur, compté MÉCANIQUEMENT par
 *    `extractSpawns` (jamais déclaré par l'orchestrateur, qui ne sait pas
 *    compter ses propres lancements de façon fiable). Ticket lancé deux fois :
 *    on retient le DERNIER rang, c'est le cycle qu'on enregistre — mais
 *    SEULEMENT parmi les lancements d'IMPLÉMENTATION (SKILL-112). Depuis
 *    SKILL-111, un cycle nominal dont la gate rend au moins un finding en émet
 *    DEUX pour le même ticket : l'implémenteur (Étape 6) puis le correcteur
 *    (Étape 6.5, `description` suffixée). Ce second-là n'est PAS une relance
 *    mais la suite du même cycle ; il est retiré de la population avant le
 *    choix du dernier, et `spawnIndex`, `prompt` et `tokensAtSpawn` désignent
 *    donc tous trois l'IMPLÉMENTEUR. `tokens − tokensAtSpawn` reste par
 *    conséquent le coût de conduite du cycle ENTIER (implémentation, gate,
 *    correction, `/send`) — jamais celui de la seule phase de correction. La
 *    règle « le DERNIER rang » ne vaut plus que des vraies relances, celles
 *    que D2 de `specs/skill-61.md` a envisagées.
 *  - `prompt` — longueur et présence des sections attendues, repris
 *    d'`extractSpawns` sans réinterprétation.
 *  - `tokens` — cumulatif de la session (`scope: "session-to-date"`), pas un
 *    delta de cycle : le coût propre à un cycle est la différence entre deux
 *    enregistrements consécutifs de la même session, et c'est l'analyse — hors
 *    scope — qui la calcule.
 *  - `tokensAtSpawn` (SKILL-63) — mêmes compteurs, mais à l'INSTANT du
 *    lancement retenu (`scope: "session-to-spawn"`), borne INCLUSE (D2). Un
 *    seul enregistrement porte donc deux instants : `tokens − tokensAtSpawn`
 *    est ce qui s'est passé APRÈS l'émission du lancement (gate de revue,
 *    `/send`), sans dépendre du cycle précédent.
 *
 * Un transcript introuvable, vide ou illisible ne fait JAMAIS échouer l'écrivain :
 * il produit des `null` avec motifs. L'absence de mesure est une mesure.
 */
export function collectTranscriptMetrics({ raw, ticket, reason } = {}) {
  const unmeasured = [];
  const messages = parseSession(typeof raw === 'string' ? raw : '');

  if (messages.length === 0) {
    const why = reason || 'transcript vide ou illisible';
    for (const field of [
      'spawnIndex',
      'prompt',
      'tokens',
      'tokensAtSpawn',
      'session.messageCount',
      'concurrentCycles',
    ]) {
      unmeasured.push({ field, reason: why });
    }
    return {
      spawnIndex: null,
      prompt: null,
      tokens: null,
      tokensAtSpawn: null,
      messageCount: null,
      concurrentCycles: null,
      unmeasured,
    };
  }

  // Dernier lancement d'IMPLÉMENTATION dont le ticket correspond (SKILL-112 :
  // les correcteurs de l'Étape 6.5 sont retirés de la population AVANT le choix
  // du dernier — D2 de specs/skill-61.md, « une relance remplace le cycle
  // précédent », reste appliquée telle quelle aux VRAIES relances).
  const spawns = extractSpawns(messages);
  const matching = spawns.filter((s) => s.ticketId === ticket && !s.isCorrection);
  const spawn = matching.length > 0 ? matching[matching.length - 1] : null;
  const noSpawnReason = spawnAbsenceReason(spawns, ticket);
  if (!spawn) {
    unmeasured.push({ field: 'spawnIndex', reason: noSpawnReason });
    unmeasured.push({ field: 'prompt', reason: noSpawnReason });
  }

  const [summary] = summarize([{ project: null, sessionId: null, messages }]);
  const tokens = tokensAt(messages, messages.length - 1, 'session-to-date');
  if (tokens === null) {
    unmeasured.push({ field: 'tokens', reason: 'aucun bloc `usage` dans le transcript' });
  } else {
    // SKILL-69, D2 : `tokens` est mesuré — le trou qu'il porte (le contexte
    // relu des sous-agents) reçoit sa propre entrée. Un `tokens: null` porte
    // déjà l'entrée `tokens` ci-dessus ; en ajouter une seconde pour ce
    // qu'il exclut déclarerait deux fois la même absence.
    unmeasured.push({ field: 'tokens.subagentCacheReadTokens', reason: SUBAGENT_CACHE_UNMEASURED_REASON });
    unmeasured.push({ field: 'tokens.subagentCacheCreateTokens', reason: SUBAGENT_CACHE_UNMEASURED_REASON });
  }

  // tokensAtSpawn (D4) : même lancement retenu que `spawnIndex`, sa position
  // résolue via `localSpawnPositions` — aucune sélection nouvelle.
  let tokensAtSpawn = null;
  if (!spawn) {
    unmeasured.push({ field: 'tokensAtSpawn', reason: noSpawnReason });
  } else {
    const positions = localSpawnPositions(messages);
    if (positions.length !== spawns.length) {
      unmeasured.push({ field: 'tokensAtSpawn', reason: SPAWN_POSITION_DIVERGENCE_REASON });
    } else {
      const spawnRank = spawns.indexOf(spawn);
      const position = positions[spawnRank];
      const messageIndex = messageIndexForToolUsePosition(messages, position);
      tokensAtSpawn = tokensAt(messages, messageIndex, 'session-to-spawn');
      if (tokensAtSpawn === null) {
        unmeasured.push({ field: 'tokensAtSpawn', reason: 'aucun bloc usage avant le lancement' });
      } else {
        // SKILL-69, D2 : même geste que pour `tokens` ci-dessus, à l'instant
        // du lancement plutôt qu'à celui de l'écriture.
        unmeasured.push({ field: 'tokensAtSpawn.subagentCacheReadTokens', reason: SUBAGENT_CACHE_UNMEASURED_REASON });
        unmeasured.push({ field: 'tokensAtSpawn.subagentCacheCreateTokens', reason: SUBAGENT_CACHE_UNMEASURED_REASON });
      }
    }
  }

  const concurrency = collectConcurrency(messages, ticket);
  if (concurrency.concurrentCycles === null) {
    unmeasured.push({ field: 'concurrentCycles', reason: concurrency.reason });
  }

  return {
    spawnIndex: spawn ? spawn.spawnIndex : null,
    prompt: spawn ? { length: spawn.promptLength, sections: spawn.sections } : null,
    tokens,
    tokensAtSpawn,
    messageCount: summary.messageCount,
    concurrentCycles: concurrency.concurrentCycles,
    unmeasured,
  };
}

// ---------------------------------------------------------------------------
// Concurrence (SKILL-61) — un delta contaminé par un lancement chevauchant
// n'était identifiable par AUCUN champ de l'enregistrement. Ce champ le rend
// visible, compté dans le transcript par l'écrivain lui-même (D2 : jamais
// déclaré par l'orchestrateur — même tranchage que `spawnIndex`).
//
// Deux séries d'événements, une seule notion de POSITION partagée entre elles
// (`toolUsePositions` ci-dessous) : le rang, dans l'ordre du transcript, de
// CHAQUE bloc `tool_use` rencontré — spawn, écriture, ou autre outil. C'est
// cette position commune, et elle seule, qui rend comparables « quand j'ai été
// lancé » et « quand tel autre ticket a été écrit ».
// ---------------------------------------------------------------------------

// Un ticket est couramment `SCOPE-NN`, parfois suivi d'un suffixe alphanumérique
// (cf. `TICKET_ID_FROM_PROMPT_RE` de baseline.mjs) — le même vocabulaire de
// caractères que `sanitizeSegment` autorise pour un identifiant de ticket.
const RECORD_WRITE_TICKET_FLAG_RE = /--ticket[= ]+["']?([A-Za-z0-9][A-Za-z0-9_-]*)["']?/;

// `node` en tant que MOT, jamais un fragment d'un autre mot (`nodejs-tool`,
// `unnoded`) : bordé par un caractère non alphanumérique (ou le début/la fin de
// la commande), et tolérant à `node.exe` (PowerShell, Windows).
const NODE_WORD_RE = /(?:^|[^A-Za-z0-9_])node(?:\.exe)?(?:$|[^A-Za-z0-9_])/i;

// Un chemin qui SE TERMINE par `write.mjs` — la mention nue du fichier (le
// piège mesuré : `grep -n "shaVerified" tools/review-log/write.mjs`) matche
// aussi cette forme ; c'est précisément pourquoi ce critère ne suffit jamais
// seul (cf. `invokesWriter` ci-dessous, qui exige aussi `NODE_WORD_RE`).
const WRITE_MJS_PATH_RE = /[^\s"'`]*write\.mjs\b/;

function invokesWriter(command) {
  return NODE_WORD_RE.test(command) && WRITE_MJS_PATH_RE.test(command);
}

// Recopié de `baseline.mjs` (non exporté là-bas) — même remarque qu'en
// en-tête de fichier pour les deux formes textuelles de `subagent_tokens` :
// une seconde implémentation dériverait, une constante recopiée ne peut pas.
const IMPLEMENTER_SUBAGENT_PREFIX = 'sdd-impl-';

// Rang, dans l'ordre du transcript, de CHAQUE bloc `tool_use` rencontré — tous
// outils confondus, spawns et écritures compris. C'est cette position UNIQUE
// et PARTAGÉE qui permet de comparer un lancement (`Agent`) à une écriture
// (`Bash`/`PowerShell`), deux familles d'événements que `spawnIndex` seul (un
// rang parmi les seuls lancements d'implémenteur) ne permet pas de situer l'une
// par rapport à l'autre.
function toolUsePositions(messages) {
  const list = [];
  let position = 0;
  const arr = Array.isArray(messages) ? messages : [];
  for (let messageIndex = 0; messageIndex < arr.length; messageIndex++) {
    for (const block of messageContentBlocks(arr[messageIndex])) {
      if (!block || block.type !== 'tool_use') continue;
      // `messageIndex` — SKILL-63 : l'INDEX du message porteur dans `messages`,
      // à distinguer de `position` (rang PARTAGÉ entre spawns et écritures,
      // SKILL-61). `messageIndexForToolUsePosition` en a besoin pour trancher
      // `messages` lui-même ; `position` reste seul utilisé par
      // `localSpawnPositions`/`extractRecordWrites`, inchangé.
      list.push({ block, position, messageIndex });
      position += 1;
    }
  }
  return list;
}

/**
 * Invocations de l'écrivain (`write.mjs`) relevées dans le transcript, en
 * ordre. Trois critères EXIGÉS ENSEMBLE sur la `command` d'un `tool_use`
 * `Bash` ou `PowerShell` : le mot `node`, un chemin se terminant par
 * `write.mjs`, et un `--ticket <ID>` — précisément pour écarter la mention
 * nue mesurée au § Problème (`grep -n "shaVerified" …/write.mjs`), qui porte
 * le chemin sans invoquer quoi que ce soit.
 */
export function extractRecordWrites(messages) {
  const writes = [];
  for (const { block, position } of toolUsePositions(messages)) {
    if (block.name !== 'Bash' && block.name !== 'PowerShell') continue;
    const command = typeof block.input?.command === 'string' ? block.input.command : '';
    if (!command || !invokesWriter(command)) continue;
    const match = RECORD_WRITE_TICKET_FLAG_RE.exec(command);
    if (!match) continue;
    writes.push({ ticketId: match[1], at: position });
  }
  return writes;
}

// Position, dans le transcript, de chaque lancement d'implémenteur — MÊME
// critère qu'`extractSpawns` (`Agent` + `subagent_type` préfixé `sdd-impl-`),
// jamais redéfini : cette passe locale ne relève QUE la position, l'identité
// (ticket, rang) vient d'`extractSpawns`. Les deux parcourent la même liste de
// blocs `tool_use`, dans le même ordre, avec le même prédicat : leurs comptes
// et leur ordre d'apparition coïncident par construction (invariant testé).
/**
 * Position (au sens de `toolUsePositions`) de chaque lancement d'implémenteur
 * — MÊME critère qu'`extractSpawns` (`Agent` + `subagent_type` préfixé
 * `sdd-impl-`), jamais redéfini : cette passe locale ne relève QUE la
 * position, l'identité (ticket, rang) vient d'`extractSpawns`. Exportée pour
 * que l'invariant « autant de positions ici que d'entrées `extractSpawns` »
 * (specs/skill-61.md § Tests) soit un test DIRECT, sur des fixtures qui
 * mélangent vraiment relecteurs et implémenteurs — pas une déduction depuis le
 * comportement de `collectConcurrency`, que la divergence pourrait laisser
 * verte (gate de reprise, finding nº 2).
 */
export function localSpawnPositions(messages) {
  const positions = [];
  for (const { block, position } of toolUsePositions(messages)) {
    if (block.name !== 'Agent') continue;
    const subagentType = typeof block.input?.subagent_type === 'string' ? block.input.subagent_type : '';
    if (!subagentType.startsWith(IMPLEMENTER_SUBAGENT_PREFIX)) continue;
    positions.push(position);
  }
  return positions;
}

/**
 * Cycles concurrents du lancement de `ticket` : chevauchement CLASSIQUE
 * d'intervalles, symétrique par construction, entre l'intervalle de « moi »
 * (le DERNIER lancement dont le ticket correspond à `ticket` — même règle que
 * `spawnIndex` : une relance remplace le cycle précédent) et celui de chaque
 * AUTRE lancement `j` (identifié par `extractSpawns`) :
 *
 *   overlap(moi, j) ⟺ lancement(moi) < écriture(j) ET lancement(j) < écriture(moi)
 *
 * où `écriture(X)` est la PREMIÈRE invocation de l'écrivain portant le ticket
 * de `X` après SA position de lancement (`closureOf`) — Infinity (intervalle
 * ENCORE OUVERT) si aucune n'existe, jamais une invocation antérieure au
 * lancement de X (specs/skill-61.md § D2).
 *
 * ⚠️ `écriture(moi)` suit EXACTEMENT la même règle que `écriture(j)` — ce
 * n'est PAS toujours « l'instant courant » traité comme +Infinity : si le
 * transcript donné porte DÉJÀ une écriture pour `ticket` après mon propre
 * lancement (rejeu hors ligne sur un transcript complet, ou seconde exécution
 * de l'Étape 6.8 pour un cycle déjà refermé), c'est CETTE position, réelle et
 * finie, qui borne mon intervalle — pas l'infini. Sans cette symétrie, un
 * lancement lointain et sans rapport, situé après « moi » dans un transcript
 * complet, satisferait toujours `écriture(j) > lancement(moi)` par pure
 * construction (son écriture, quelle qu'elle soit, arrive nécessairement
 * après son propre lancement, lui-même après le mien) — sur-déclaration
 * mesurée en réel (gate de reprise, finding nº 5) sur `d493aa1f` :
 * `SKILL-36`/`SKILL-43` déclareraient à tort des cycles qui ne les chevauchent
 * pas.
 *
 * PRÉCONDITION (non vérifiable ici, documentée) : `messages` doit refléter le
 * transcript **tel qu'il existe à l'instant de CETTE écriture** — c'est ce que
 * `main()` garantit en production (lecture live, jamais d'événement futur
 * possible), jamais un rejeu sur un transcript COMPLET portant des cycles
 * lancés bien après celui-ci (cf. specs/skill-61.md § Vérification, point 3 :
 * le contrôle manuel doit tronquer le transcript à l'écriture de CHAQUE ticket
 * rejoué, pas l'appeler tel quel sur le fichier entier).
 *
 * `j ≠ moi` compare l'OBJET du lancement, jamais son ticket : une relance
 * antérieure ABANDONNÉE (jamais écrite) du MÊME ticket que `moi` reste un
 * candidat à part entière et se déclare concurrente si son intervalle
 * chevauche — c'est le biais D2 (« un cycle jamais écrit reste concurrent de
 * tous les cycles suivants ») appliqué à mon propre ticket, pas seulement aux
 * autres (gate de reprise, finding nº 1).
 *
 * ⚠️ SKILL-112 — l'exclusion par identité d'objet ne suffit plus depuis
 * SKILL-111 : le CORRECTEUR de l'Étape 6.5 est un second lancement du même
 * ticket, et il n'est pas une relance mais la SUITE du même cycle. D2 n'est
 * pas rouverte pour autant : sa sémantique reste entière pour les vraies
 * relances, qui n'ont jamais le marqueur.
 *
 * ⚠️ SKILL-114 — quatre règles, qui se lisent ENSEMBLE : R1 dit qui je suis,
 * R2 qui est balayé, R3 ce qui subsiste au plus une fois, R4 dans quel ordre.
 *
 *  - R1 — DEUX populations, pas une. « Moi » reste le DERNIER lancement
 *    NON-CORRECTION de `ticket` : un correcteur n'est jamais le lancement
 *    qu'on mesure. La population des VOISINS balayés, elle, est celle de R2.
 *    Sans cette séparation, un correcteur redevenu candidat pourrait devenir
 *    « moi », et le régime ORPHELIN (`spawnAbsenceReason`, un ticket n'ayant
 *    QUE des correcteurs) rendrait `[]` + `reason: null` au lieu de `null` +
 *    motif — le compteur faussement nul que D1 interdit.
 *  - R2 — un correcteur sort de la population des voisins SELON SON TICKET,
 *    jamais par une règle unique. Correcteur du ticket COURANT : exclu
 *    inconditionnellement, son cycle est déjà porté par « moi » (sans quoi le
 *    cycle se déclarerait concurrent de lui-même). Correcteur d'un AUTRE
 *    ticket : exclu si et seulement s'il est COUVERT — s'il existe une
 *    implémentation du même ticket (identifié, donc `ticketId !== null` :
 *    deux lancements que `extractTicketId` n'a pas su nommer ne sont pas « le
 *    même ticket ») lancée avant lui et pas encore refermée à sa position.
 *    Sinon il porte un cycle que RIEN d'autre ne porte — le cas d'un voisin
 *    repris à la GATE SEULE, son implémentation ayant tourné dans une session
 *    antérieure — et il reste voisin candidat.
 *  - R3 — au plus UNE entrée `null` par voisin NOMMÉ : un rang entier déjà
 *    présent pour ce ticket absorbe ses entrées `null`, sinon elles sont
 *    réduites à une seule. Deux bornes : `ticket: null` est HORS de R3 (même
 *    motif que R2), et jamais de déduplication par ticket tout court — deux
 *    relances d'un même voisin ont chacune leur rang pour se distinguer.
 *  - R4 — les rangs connus d'abord et croissants, les `null` en fin dans
 *    l'ordre d'insertion (donc de position, le tri étant stable depuis ES2019).
 *
 * ⚠️ Un `spawnIndex: null` dans une entrée est un CONSTAT, pas une mesure
 * ratée : `extractSpawns` ne numérote pas les correcteurs (SKILL-112), et leur
 * donner le rang d'un voisin d'implémentation fabriquerait un rang au lieu de
 * constater son absence.
 *
 * Rend `{ concurrentCycles: null, reason }` si mon propre lancement est
 * introuvable, ou si le transcript est vide/illisible — JAMAIS `[]` dans ces
 * cas : `[]` signifie « mesuré, rien trouvé », pas « rien à mesurer ».
 */
export function collectConcurrency(messages, ticket) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) {
    return { concurrentCycles: null, reason: 'transcript vide ou illisible' };
  }

  const spawns = extractSpawns(list);
  const positions = localSpawnPositions(list);
  if (positions.length !== spawns.length) {
    // Défense en profondeur (gate de reprise, finding nº 2) : si le prédicat
    // recopié ici divergeait un jour de celui d'`extractSpawns` (constante
    // renommée d'un côté, pas de l'autre), `positions[i]` deviendrait
    // `undefined` pour un ou plusieurs lancements — et une comparaison contre
    // `undefined` est TOUJOURS fausse, ce qui rendrait silencieusement `[]`
    // (« mesuré, rien trouvé ») au lieu de `null` + motif. Cette divergence ne
    // doit jamais produire un compteur faussement nul (D1).
    return {
      concurrentCycles: null,
      reason: SPAWN_POSITION_DIVERGENCE_REASON,
    };
  }
  const withPositions = spawns.map((spawn, i) => ({ ...spawn, position: positions[i] }));

  // R1 (SKILL-114) — PREMIÈRE population : celle où se choisit « moi ». Les
  // lancements NON-CORRECTION de MON ticket, et rien d'autre — un correcteur
  // n'est jamais le lancement qu'on mesure. C'est cette filtration-ci qui
  // préserve le régime ORPHELIN : un ticket n'ayant QUE des correcteurs sort
  // par `spawnAbsenceReason` (`null` + motif), jamais par un `[]` menteur.
  //
  // ⚠️ Le filtre porte sur la POPULATION, pas sur `withPositions` lui-même :
  // l'alignement une-pour-une avec `localSpawnPositions` (garde de divergence
  // ci-dessus) se calcule sur la liste COMPLÈTE d'`extractSpawns`.
  const mine = withPositions.filter((s) => !s.isCorrection && s.ticketId === ticket);
  if (mine.length === 0) {
    return {
      concurrentCycles: null,
      reason: spawnAbsenceReason(spawns, ticket),
    };
  }
  const moi = mine[mine.length - 1];

  // `closureOf` est définie AVANT la population des voisins : son second étage
  // en a besoin. Elle est reprise TELLE QUELLE — SKILL-114 ne touche ni à sa
  // définition ni au modèle d'intervalle de D2 (specs/skill-61.md).
  const writes = extractRecordWrites(list);
  function closureOf(spawn) {
    let earliest = Infinity;
    for (const w of writes) {
      if (w.ticketId !== spawn.ticketId || w.at <= spawn.position) continue;
      if (w.at < earliest) earliest = w.at;
    }
    return earliest;
  }

  // R2 (SKILL-114) — SECONDE population : les VOISINS balayés. Un correcteur
  // en sort selon SON ticket, jamais par une règle unique.
  //
  //  1. correcteur de MON ticket -> exclu inconditionnellement. Son cycle est
  //     déjà porté par « moi » ; c'est l'intuition juste de SKILL-112, et le
  //     seul rempart contre un cycle qui se déclare concurrent de LUI-MÊME.
  //     ⚠️ Cet étage ne touche PAS les vraies RELANCES d'implémentation de mon
  //     ticket, qui n'ont jamais le marqueur et restent candidates (D2).
  //  2. correcteur d'un AUTRE ticket -> exclu SEULEMENT s'il est couvert par
  //     une implémentation du même ticket, encore ouverte à sa position. Sinon
  //     il porte un cycle que rien d'autre ne porte (voisin repris à la GATE
  //     SEULE, implémentation dans une session antérieure) et il reste voisin.
  //     ⚠️ Note honnête : cet étage-ci n'est pas OBSERVABLE seul depuis l'API
  //     publique, mesuré — le neutraliser ne fait rougir aucun test. Couvrir un
  //     correcteur suppose qu'aucune écriture ne le sépare de son
  //     implémentation, donc les deux ont la MÊME fermeture ; un correcteur
  //     couvert qui chevauche « moi » implique alors que son implémentation le
  //     chevauche aussi, et R3 absorbe son entrée `null` au profit du rang
  //     entier. Il reste écrit ici parce que c'est l'endroit où le motif
  //     s'applique : la variante « filtrer à la sortie » construirait une
  //     entrée pour la jeter (SKILL-114, § Décision, arbitrage D).
  //
  // ⛔ Le premier étage n'est PAS un cas particulier du second : sur
  // `correcteur B1 · impl B1` ou `impl B1 · write B1 · correcteur B1 · relance
  // impl B1`, aucune implémentation ne couvre le correcteur, et le seul
  // prédicat rendrait `[{ SKILL-B1, null }]` — le défaut d'origine de
  // SKILL-112, réintroduit par le ticket censé le garder fermé.
  function couvertParSonImplementation(correcteur) {
    // `null === null` ne fait pas « le même ticket » : sans cette borne, un
    // correcteur non identifié serait exclu au titre d'une implémentation
    // elle-même non identifiée, donc sans rapport connu avec lui.
    if (correcteur.ticketId === null) return false;
    return withPositions.some(
      (impl) =>
        !impl.isCorrection &&
        impl.ticketId === correcteur.ticketId &&
        impl.position < correcteur.position &&
        closureOf(impl) > correcteur.position
    );
  }
  const voisins = withPositions.filter((s) => {
    if (!s.isCorrection) return true;
    if (s.ticketId === ticket) return false;
    return !couvertParSonImplementation(s);
  });

  const moiClosure = closureOf(moi);

  const concurrentCycles = [];
  for (const spawn of voisins) {
    if (spawn === moi) continue; // jamais moi-même — une relance ANTÉRIEURE reste candidate
    const overlaps = moi.position < closureOf(spawn) && spawn.position < moiClosure;
    if (overlaps) {
      concurrentCycles.push({ ticket: spawn.ticketId, spawnIndex: spawn.spawnIndex });
    }
  }

  // R3 (SKILL-114) — invariant de sortie, AVANT le tri (c'est l'ordre
  // d'INSERTION que la règle voit) : au plus une entrée `null` par voisin
  // NOMMÉ. Un rang entier déjà présent pour ce ticket absorbe ses entrées
  // `null` ; à défaut de rang, elles sont réduites à une seule. Ferme les deux
  // formes que le seul prédicat de R2 laissait ouvertes — la double reprise à
  // la gate (deux entrées strictement indiscernables) et le correcteur
  // POSTÉRIEUR à l'écriture de son voisin (`impl D2 · write D2 · correcteur
  // D2`), qui est le cas NOMINAL d'une gate de reprise vu l'ordre « 6.5
  // correcteur -> 6.8 écriture » de `/sdd-run-ticket`.
  //
  // ⛔ Deux bornes, chacune contre un défaut mesuré : `ticket: null` est HORS
  // de R3 (deux lancements non identifiés ne sont pas « le même ticket » —
  // c'est la borne que R2 vient de poser, et R3 la renierait) ; et JAMAIS de
  // déduplication par ticket tout court — deux implémentations distinctes d'un
  // même voisin (relance antérieure abandonnée) restent DEUX entrées, elles
  // ont un rang pour se distinguer.
  const parTicket = new Map();
  for (const entree of concurrentCycles) {
    if (entree.ticket === null) continue;
    if (!parTicket.has(entree.ticket)) parTicket.set(entree.ticket, { rangConnu: false, sansRang: [] });
    const groupe = parTicket.get(entree.ticket);
    if (Number.isInteger(entree.spawnIndex)) groupe.rangConnu = true;
    else groupe.sansRang.push(entree);
  }
  const aRetirer = new Set();
  for (const groupe of parTicket.values()) {
    for (const entree of groupe.rangConnu ? groupe.sansRang : groupe.sansRang.slice(1)) {
      aRetirer.add(entree);
    }
  }
  const retenus = concurrentCycles.filter((entree) => !aRetirer.has(entree));

  // R4 (SKILL-114) — les rangs connus d'abord, croissants ; les `null` en fin,
  // dans l'ordre d'insertion (donc de position, `Array.prototype.sort` étant
  // stable depuis ES2019). Le comparateur trie sur un RANG DE CLASSE (`null`
  // => classe 1) avant de soustraire, et ne soustrait QUE des entiers : sans
  // lui, `null - 1 === -1` rangerait un `null` à la place d'un rang 0, ordre
  // accidentel au lieu d'intentionnel.
  //
  // ⚠️ Note honnête, mesurée (gate de SKILL-114, finding nº 4 ; reprend celle
  // que portait le `.sort()` d'avant ce ticket) : seule la PARTITION
  // entiers/`null` est falsifiable. Les entrées à rang ENTIER sont poussées
  // dans l'ordre de `voisins`, qui garde celui de `withPositions`, lui-même
  // celui d'`extractSpawns` — qui numérote les non-correcteurs dans l'ordre
  // d'apparition (`baseline.mjs`) —, et R3 n'est qu'un `filter`, qui préserve
  // l'ordre : elles sont donc DÉJÀ croissantes à l'insertion. Remplacer
  // `a.spawnIndex - b.spawnIndex` par `return 0` laisse la suite entière verte
  // (35 fichiers, 1596 tests, 2026-09-05). Cette ligne est défensive, gardée
  // pour ne pas dépendre silencieusement de cet ordre d'itération si la boucle
  // ci-dessus change un jour ; le `return 0` de la classe 1 l'est de même
  // (`null - null === 0`). Ce que le cas 11 du § Tests garde, c'est la
  // partition, pas la comparaison des rangs entre eux.
  retenus.sort((a, b) => {
    const classeA = Number.isInteger(a.spawnIndex) ? 0 : 1;
    const classeB = Number.isInteger(b.spawnIndex) ? 0 : 1;
    if (classeA !== classeB) return classeA - classeB;
    if (classeA === 1) return 0;
    return a.spawnIndex - b.spawnIndex;
  });

  return { concurrentCycles: retenus, reason: null };
}

// ---------------------------------------------------------------------------
// Vérification du SHA
// ---------------------------------------------------------------------------

function defaultRun(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8' });
}

// Lance `git -C <repo> <...args>` et absorbe l'exception ou l'erreur de spawn
// éventuelle — la portion RÉELLEMENT identique entre `runRevParseVerify` et
// `runIsAncestor` (SKILL-56, gate de reprise finding nº 6 : après le premier
// partage, SKILL-46, finding de gate nº 6, deux triages `status → true/false/
// null` avaient quand même fini par diverger, l'un rangeant en `false` un fait
// que l'autre rangeait en `null`). Le TRIAGE, en revanche, n'est PAS partagé
// ici : `rev-parse --verify` et `merge-base --is-ancestor` n'utilisent pas le
// même code de sortie pour dire « objet inconnu » (1 contre 128 — cf.
// `runIsAncestor`), donc une interprétation commune du code serait fausse pour
// l'une des deux commandes. Ce que ce helper couvre est borné à ce qui NE PEUT
// PAS diverger : la garde `repo`, le `try/catch`, l'absorption de `res.error`.
//
// Lecture seule, et le dépôt est nommé dans la commande (`-C`) : un `git` nu
// viserait le repo de la session (défaut SKILL-32).
function runGit(repo, args, run) {
  if (typeof repo !== 'string' || repo.length === 0) {
    return { status: null, stderr: '', reason: 'dépôt inconnu — non vérifié' };
  }
  let res;
  try {
    res = run('git', ['-C', repo, ...args]);
  } catch (err) {
    return { status: null, stderr: '', reason: `git indisponible : ${err.message}` };
  }
  if (!res || res.error) {
    return { status: null, stderr: '', reason: `git indisponible : ${res?.error?.message ?? 'aucun résultat'}` };
  }
  return { status: res.status, stderr: res.stderr || '', reason: null };
}

// Trie le résultat de `git rev-parse --verify --quiet <rev>^{commit}` en
// `true` / `false` / `null` — jamais autre chose, jamais une exception qui
// remonte. Partagé par `verifySha` et `verifyRef` (SKILL-46, finding de gate
// nº 6) : les deux vérifient la MÊME chose (« ce SHA désigne-t-il un commit du
// dépôt ? ») et ne doivent JAMAIS diverger sur le triage — seul le
// pré-contrôle de FORMAT diffère entre les deux appelants (40 caractères
// stricts pour `<sha_final>` ; 4 à 40, un SHA couramment abrégé, pour un `ref`
// de finding).
function runRevParseVerify(repo, rev, run) {
  const g = runGit(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], run);
  if (g.status === null) return { verified: null, reason: g.reason };
  if (g.status === 0) return { verified: true, reason: null };
  // `rev-parse --verify --quiet` sort en 1 pour une révision inconnue et en 128
  // pour une erreur fatale (chemin qui n'est pas un dépôt, par exemple).
  if (g.status === 1) return { verified: false, reason: `absent du dépôt ${repo}` };
  return {
    verified: null,
    reason: `git en erreur (code ${g.status}) : ${g.stderr.trim() || 'sans message'}`,
  };
}

/**
 * Contrôle mécanique bon marché contre le mode de défaillance déjà vécu : un SHA
 * retranscrit à 39 caractères (Étape 6.1 du skill). `true` / `false` / `null` —
 * « pas vérifié » n'est PAS « faux ». Le SHA reçu est conservé tel quel dans
 * l'enregistrement, jamais réparé.
 */
export function verifySha(repo, sha, run = defaultRun) {
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) {
    const length = typeof sha === 'string' ? sha.length : 0;
    return {
      verified: false,
      reason: `SHA mal formé : ${length} caractères, 40 hexadécimaux attendus`,
    };
  }
  const check = runRevParseVerify(repo, sha, run);
  if (check.verified === false) return { verified: false, reason: `SHA ${check.reason}` };
  if (check.verified === null && check.reason.startsWith('dépôt inconnu')) {
    return { verified: null, reason: 'dépôt inconnu — SHA non vérifié' };
  }
  return check;
}

// ---------------------------------------------------------------------------
// Vérification des `ref` de findings (SKILL-46) et de leur atteignabilité
// depuis `main` (SKILL-56)
// ---------------------------------------------------------------------------

// Un `ref` de finding est un SHA de commit couramment ABRÉGÉ (7 caractères par
// défaut chez git) — contrairement à `<sha_final>` (`--sha`), toujours relevé
// EN ENTIER par `git rev-parse HEAD`. La longueur n'est donc pas un contrôle
// pertinent ici, à la différence de `verifySha` : c'est git lui-même, via
// `rev-parse --verify`, qui dit si le `ref` existe.
const REF_HEX_RE = /^[0-9a-f]{4,40}$/i;

/**
 * Vérifie qu'un `ref` de finding existe dans le dépôt. Même doctrine que
 * `verifySha` — `true` / `false` / `null`, jamais bloquant, jamais réparé —
 * tolérante à un SHA abrégé. Un `ref` ABSENT (chaîne vide ou non-chaîne) rend
 * `null`, jamais `false` : cette fonction, prise seule, ne sait pas si
 * l'absence est LÉGITIME (`E1`/`E3`, qui n'appellent jamais cette fonction —
 * cf. `verifyFindingRefs`) ou fautive (un `corrigé` sans SHA, que
 * `verifyFindingRefs` traite en amont, AVANT d'atteindre cette branche).
 */
export function verifyRef(repo, ref, run = defaultRun) {
  if (typeof ref !== 'string' || ref.length === 0) {
    return { verified: null, reason: 'ref absent — rien à vérifier' };
  }
  if (!REF_HEX_RE.test(ref)) {
    return { verified: false, reason: `ref mal formé : "${ref}" n'est pas un SHA hexadécimal` };
  }
  const check = runRevParseVerify(repo, ref, run);
  if (check.verified === false) return { verified: false, reason: `ref ${check.reason}` };
  if (check.verified === null && check.reason.startsWith('dépôt inconnu')) {
    return { verified: null, reason: 'dépôt inconnu — ref non vérifié' };
  }
  return check;
}

// `verifyRef` répond « ce `ref` existe-t-il dans la base d'objets ? ». Un
// commit rendu orphelin par `git rebase` (protégé par le reflog) y répond
// `true` alors qu'il n'a jamais été livré — SKILL-46, gate de revue, finding 8,
// reproduit en réel. La seconde question, distincte, est celle-ci : « ce `ref`
// désigne-t-il quelque chose qui A ÉTÉ LIVRÉ ? ». `main` répond, parce que
// l'Étape 6.8 s'exécute APRÈS le fast-forward de `/send` (Étape 6.7) : les
// commits réellement livrés SONT ancêtres de `main` au moment où l'écrivain
// tourne, un `ref` pré-rebase ne l'est pas.
//
// ⛔ Ne s'applique JAMAIS à `<sha_final>` (`--sha`) : deux raisons, cf.
// specs/skill-56.md § Décision 1. `<sha_final>` est déjà relevé APRÈS le
// rebase (SKILL-46), donc atteignable par construction ; et l'atteignabilité
// ne discrimine pas le défaut redouté pour lui (« un `<sha_final>` emprunté au
// ticket voisin passe tous les contrôles » — le SHA du voisin est lui aussi
// ancêtre de `main`). Ce défaut-là reste ouvert, sans ticket aujourd'hui.

// `merge-base --is-ancestor <rev> <branch>` sort en 0 quand `<rev>` est
// ancêtre de `<branch>` (ou lui est identique), en 1 s'il existe mais n'est
// PAS ancêtre — et en **128**, PAS 1, quand `<rev>` lui-même n'est pas un
// objet connu du dépôt (`fatal: Not a valid object name <rev>`, mesuré en
// réel, git 2.53 ; à distinguer d'un 128 pour une autre cause, `main`
// introuvable notamment). Gate de reprise SKILL-56, finding nº 1 : un premier
// jet triait tout 128 en `null`, rangeant le cas le plus banal — un SHA de
// finding inventé ou mal recopié — en « non mesuré » alors que la doctrine
// documentée (specs/skill-56.md § Décision 1, tableau de lecture) l'attend en
// `false` : un commit absent de la base d'objets n'est atteignable de nulle
// part, ce n'est pas une mesure impossible.
const NOT_A_VALID_OBJECT_RE = /not a valid object name/i;

function runIsAncestor(repo, rev, branch, run) {
  const g = runGit(repo, ['merge-base', '--is-ancestor', rev, branch], run);
  if (g.status === null) return { verified: null, reason: g.reason };
  if (g.status === 0) return { verified: true, reason: null };
  if (g.status === 1) {
    return { verified: false, reason: `${rev} n'est pas ancêtre de ${branch} dans le dépôt ${repo}` };
  }
  if (g.status === 128 && NOT_A_VALID_OBJECT_RE.test(g.stderr)) {
    return { verified: false, reason: `${rev} n'existe pas dans le dépôt ${repo}` };
  }
  return {
    verified: null,
    reason: `git en erreur (code ${g.status}) : ${g.stderr.trim() || 'sans message'}`,
  };
}

/**
 * Vérifie qu'un `ref` de finding est atteignable depuis `main` du dépôt cible.
 * Même doctrine que `verifyRef` — `true` / `false` / `null`, jamais bloquant,
 * jamais réparé, tolérante à un SHA abrégé — pour rester lisible aux côtés de
 * `refVerified` (§ Décision 1, tableau de lecture des deux champs combinés).
 *
 * ⚠️ Fonction UTILITAIRE, appelable seule (et testée seule ci-dessous) — mais
 * `verifyFindingRefs` ne l'invoque QUE lorsque `verifyRef` a déjà constaté
 * `verified: true` sur le MÊME `ref` : le fait « ce SHA existe » est ainsi
 * établi une seule fois, jamais mesuré deux fois par deux commandes git qui
 * pourraient diverger (gate de reprise SKILL-56, finding nº 6). Le triage 128
 * ci-dessus reste une défense en profondeur pour un appelant direct.
 */
export function verifyRefReachableFromMain(repo, ref, run = defaultRun) {
  if (typeof ref !== 'string' || ref.length === 0) {
    return { verified: null, reason: 'ref absent — rien à vérifier' };
  }
  if (!REF_HEX_RE.test(ref)) {
    return { verified: false, reason: `ref mal formé : "${ref}" n'est pas un SHA hexadécimal` };
  }
  const check = runIsAncestor(repo, ref, 'main', run);
  if (check.verified === null && check.reason.startsWith('dépôt inconnu')) {
    return { verified: null, reason: 'dépôt inconnu — atteignabilité non vérifiée' };
  }
  return check;
}

/**
 * Applique `verifyRef` (existence) puis, seulement si le `ref` existe,
 * `verifyRefReachableFromMain` (atteignabilité) à chaque finding dont la
 * disposition est `corrigé` — les seules dont le `ref` est un SHA (D1 de
 * specs/skill-46.md). `E1`/`E3` n'en portent pas, `E2` porte un identifiant de
 * ticket : les vérifier comme des SHA produirait un faux négatif systématique.
 * Ces findings-là traversent INCHANGÉS, sans même le champ `refVerified`.
 *
 * Un `corrigé` SANS `ref` (champ vide — la donnée fausse la plus banale, cf.
 * gate de revue finding nº 2) est un constat NÉGATIF, `false` — pas `null` :
 * contrairement à `E1`/`E3`, la disposition `corrigé` EXIGE un SHA, donc son
 * absence ici est un défaut, jamais un cas légitime. C'est pourquoi cette
 * fonction court-circuite `verifyRef` sur ce cas précis, plutôt que de lui
 * laisser rendre son `null` générique (`ref` absent), qui n'a de sens que
 * lorsque l'absence est attendue.
 *
 * `shaReachableFromBranch` DÉRIVE de `refVerified` plutôt que d'un second
 * appel git indépendant, dans les deux cas où l'existence du `ref` est déjà
 * tranchée : `refVerified === false` (SHA inventé ou mal recopié, ou `ref`
 * mal formé) ⇒ `shaReachableFromBranch: false` SANS appeler `merge-base` — un
 * objet absent de la base d'objets n'est atteignable de nulle part, c'est un
 * fait déjà établi, pas une seconde question ; `refVerified === null` (dépôt
 * inconnu, git indisponible) ⇒ `shaReachableFromBranch: null`, pour la même
 * raison symétrique : l'existence elle-même n'a pas pu être établie, son
 * atteignabilité ne peut pas l'être non plus. Seul `refVerified === true`
 * déclenche le second appel git, `merge-base --is-ancestor` (SKILL-56, gate
 * de reprise finding nº 1 : sans ce filtrage, `merge-base` sur un `ref`
 * inconnu du dépôt sort en 128 — pas 1 — et le triage générique le rangeait en
 * `null`, masquant un constat pourtant concluant).
 *
 * `refVerifiedReason` / `shaReachableFromBranchReason` portent toujours le
 * motif du contrôle. `buildRecord` en fait deux usages disjoints, selon la
 * valeur du champ mesuré (SKILL-103, D1) : quand elle est `null`, le motif
 * peuple `unmeasured` (SKILL-46, gate de revue finding nº 1) et la clé de
 * motif est retirée du finding final ; quand elle est `false`, le motif
 * SURVIT au contraire comme champ voisin du booléen — c'est l'objet même de
 * SKILL-103, pour distinguer les modes de défaillance disjoints qu'un simple
 * `false` recouvre. Quand elle est `true`, la clé de motif (posée à `null`
 * par cette fonction) est retirée : un `null` sans entrée `unmeasured`
 * serait invisible à la bijection (`assertUnmeasuredInvariant`).
 */
export function verifyFindingRefs(findings, repo, run = defaultRun) {
  return (findings || []).map((f) => {
    if (f.disposition !== 'corrigé') return { ...f };
    if (typeof f.ref !== 'string' || f.ref.length === 0) {
      return {
        ...f,
        refVerified: false,
        refVerifiedReason: 'finding `corrigé` sans `ref` — un SHA était attendu',
        shaReachableFromBranch: false,
        shaReachableFromBranchReason: 'finding `corrigé` sans `ref` — un SHA était attendu',
      };
    }
    const check = verifyRef(repo, f.ref, run);
    let reach;
    if (check.verified === true) {
      reach = verifyRefReachableFromMain(repo, f.ref, run);
    } else if (check.verified === false) {
      reach = { verified: false, reason: `ref non existant — ${check.reason}` };
    } else {
      reach = { verified: null, reason: `existence non établie — ${check.reason}` };
    }
    return {
      ...f,
      refVerified: check.verified,
      refVerifiedReason: check.reason,
      shaReachableFromBranch: reach.verified,
      shaReachableFromBranchReason: reach.reason,
    };
  });
}

// ---------------------------------------------------------------------------
// Enregistrement
// ---------------------------------------------------------------------------

function toIso(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === 'string' && now.length > 0) return now;
  return new Date().toISOString();
}

/**
 * Assemble l'enregistrement. Fonction PURE : aucune entrée/sortie, aucune
 * horloge (l'instant d'écriture est injecté), aucun système de fichiers.
 *
 * Deux invariants portés ici :
 *  - **`reviewed` distingue « personne n'a cherché » de « on n'a rien trouvé »** :
 *    dosage `none` → `reviewed: false`, `r`/`u` à `null` AVEC motif ; dosage
 *    `light`/`deep` sans finding → `reviewed: true`, `r: 0`, `u: 0`. Un `0` en
 *    dosage `none` serait une preuve inventée.
 *  - **tout champ `null` a son entrée dans `unmeasured`**, et réciproquement.
 *    C'est ce qui rend la règle « null + motif » structurelle. `unmeasured`
 *    reste le registre des `null` — un `false`, lui, est une VALEUR mesurée
 *    (SKILL-103, D1) : son motif vit dans un champ frère du booléen
 *    (`shaVerifiedReason`, `refVerifiedReason`, `shaReachableFromBranchReason`),
 *    jamais dans `unmeasured`.
 *
 * `controls` est ce que l'écrivain CONSTATE sur ce qu'on lui donne — jamais une
 * raison de refuser d'écrire. Un contrôle faux est enregistré faux, pas corrigé
 * et pas tu.
 *
 * `findings`, s'il est fourni, REMPLACE `args.findings` — c'est le point
 * d'entrée par lequel `main` passe les findings déjà enrichis par
 * `verifyFindingRefs` (SKILL-46). `buildRecord` reste PURE : elle ne vérifie
 * rien elle-même, elle recopie ce qu'on lui donne. Absent, `args.findings` est
 * repris tel quel (rétrocompatible avec un appelant qui ne vérifie pas les
 * `ref`).
 */
export function buildRecord({ args, session = {}, metrics = {}, shaCheck = {}, findings: findingsOverride, now } = {}) {
  const unmeasured = [];
  const reviewed = args.dosage !== 'none';

  let r = null;
  let u = null;
  let reviewers = 0;
  if (reviewed) {
    r = args.r;
    u = args.u;
    reviewers = args.reviewers;
  } else {
    unmeasured.push({ field: 'r', reason: 'dosage `none` : personne n’a cherché (jamais 0)' });
    unmeasured.push({ field: 'u', reason: 'dosage `none` : personne n’a cherché (jamais 0)' });
  }
  const findings = reviewed ? (findingsOverride || args.findings) : [];

  const controls = {
    uMatchesFindings: reviewed ? u === findings.length : null,
    rAtLeastU: reviewed ? r >= u : null,
    lightRequalsU: args.dosage === 'light' ? r === u : null,
  };
  if (controls.uMatchesFindings === null) {
    unmeasured.push({ field: 'controls.uMatchesFindings', reason: 'contrôle sans objet en dosage `none`' });
  }
  if (controls.rAtLeastU === null) {
    unmeasured.push({ field: 'controls.rAtLeastU', reason: 'contrôle sans objet en dosage `none`' });
  }
  if (controls.lightRequalsU === null) {
    unmeasured.push({
      field: 'controls.lightRequalsU',
      reason: `contrôle sans objet hors dosage \`light\` (ici \`${args.dosage}\`)`,
    });
  }

  // `refVerified` (SKILL-46) et `shaReachableFromBranch` (SKILL-56) sont des
  // mesures de L'ÉCRIVAIN À L'INTÉRIEUR de `findings` — les seules. `nullPaths`
  // (test) saute `findings` en bloc parce que le RESTE du finding (titre,
  // relecteurs, disposition, `ref`) est recopié de l'orchestrateur, jamais
  // mesuré ici ; ces deux champs-là, eux, SONT mesurés ici, donc ils suivent la
  // règle générale « null ⇒ entrée dans `unmeasured` » — explicitement, puisque
  // le balayage automatique ne les voit pas.
  //
  // Trois régimes (SKILL-103, D1/D2) pour chacun des deux champs :
  //  - `null`  : entrée `unmeasured` peuplée avec le motif, puis la clé de
  //    motif (`…Reason`) est retirée — inchangé depuis SKILL-46/SKILL-56.
  //  - `false` : la clé de motif SURVIT comme champ voisin du booléen, avec un
  //    repli si elle est vide — c'est l'objet du ticket : discerner les modes
  //    de défaillance disjoints qu'un simple `false` recouvre.
  //  - `true`  : la clé de motif (posée à `null` par `verifyFindingRefs`) est
  //    retirée — la garder ferait survivre un `null` sans entrée `unmeasured`,
  //    invisible à `assertUnmeasuredInvariant` (piège D1).
  //
  // ⚠️ Gate de reprise, finding nº 1 : le garde qui décide si le champ de motif
  // doit être traité NE PEUT PAS tester la PRÉSENCE de la clé `…Reason` — un
  // appelant qui pose `refVerified: false` sans jamais poser `refVerifiedReason`
  // (le repli de D2 existe précisément pour ce cas) traverserait alors la
  // fonction sans jamais recevoir son repli. Le garde teste la présence du champ
  // MESURÉ (`refVerified`, `shaReachableFromBranch`), jamais celle de son motif.
  //
  // ⚠️ Gate de reprise, finding nº 2 : le repli d'un `false` ne réutilise PAS le
  // vocabulaire du repli d'un `null` (`'ref non vérifié'`,
  // `'atteignabilité non vérifiée'`) — un `false` a été MESURÉ, contrairement à
  // un `null` ; lui faire dire « non vérifié » romprait exactement la
  // distinction que D1 pose en le sortant de `unmeasured`.
  const outputFindings = findings.map((f) => {
    let rest = f;
    if (Object.prototype.hasOwnProperty.call(rest, 'refVerified')) {
      if (rest.refVerified === null) {
        unmeasured.push({
          field: `findings[${f.i}].refVerified`,
          reason: rest.refVerifiedReason || 'ref non vérifié',
        });
      }
      if (rest.refVerified === false) {
        rest = { ...rest, refVerifiedReason: rest.refVerifiedReason || 'ref invalide (motif non transmis)' };
      } else {
        const { refVerifiedReason, ...withoutRefReason } = rest;
        rest = withoutRefReason;
      }
    }
    if (Object.prototype.hasOwnProperty.call(rest, 'shaReachableFromBranch')) {
      if (rest.shaReachableFromBranch === null) {
        unmeasured.push({
          field: `findings[${f.i}].shaReachableFromBranch`,
          reason: rest.shaReachableFromBranchReason || 'atteignabilité non vérifiée',
        });
      }
      if (rest.shaReachableFromBranch === false) {
        rest = {
          ...rest,
          shaReachableFromBranchReason:
            rest.shaReachableFromBranchReason || 'atteignabilité refusée (motif non transmis)',
        };
      } else {
        const { shaReachableFromBranchReason, ...withoutReachReason } = rest;
        rest = withoutReachReason;
      }
    }
    return rest;
  });

  if (args.exec.review === null) {
    unmeasured.push({
      field: 'exec.review',
      reason: 'le frontmatter du ticket ne porte pas de champ `review` (dosage appliqué par défaut)',
    });
  }

  const shaVerified = shaCheck.verified === undefined ? null : shaCheck.verified;
  if (shaVerified === null) {
    unmeasured.push({ field: 'shaVerified', reason: shaCheck.reason || 'SHA non vérifié' });
  }
  // SKILL-103, D1/D2 : un `false` porte son motif dans un champ frère
  // (`shaVerifiedReason`), jamais dans `unmeasured` (réservé aux `null`) —
  // pour distinguer les deux modes de défaillance disjoints qu'un simple
  // `false` recouvre (SHA mal formé · SHA absent du dépôt). Absent pour
  // `true`/`null`. Jamais `undefined` : `JSON.stringify` (`writeRecord`)
  // jetterait la clé en silence sur le disque.
  //
  // ⚠️ Gate de reprise, finding nº 2 : le repli NE réemploie PAS la chaîne du
  // repli `null` ci-dessus (`'SHA non vérifié'`) — un `false` a été mesuré,
  // `personal-hub` l'affiche verbatim (SDD-23), et « non vérifié » lu sur un
  // contrôle exécuté et concluant est exactement la confusion que ce ticket
  // ferme.
  const shaVerifiedReason =
    shaVerified === false ? shaCheck.reason || 'SHA invalide (motif non transmis)' : undefined;

  const sessionId = session.id ?? null;
  const transcript = session.transcript ?? null;
  if (sessionId === null) {
    unmeasured.push({
      field: 'session.id',
      reason: session.idReason || 'session id absente (CLAUDE_CODE_SESSION_ID non défini)',
    });
  }
  if (transcript === null) {
    unmeasured.push({
      field: 'session.transcript',
      reason: session.transcriptReason || 'transcript introuvable',
    });
  }

  for (const entry of metrics.unmeasured || []) unmeasured.push({ ...entry });

  return {
    schema: SCHEMA_VERSION,
    ticket: args.ticket,
    project: args.project,
    repo: args.repo,
    mode: args.mode,
    sha: args.sha,
    shaVerified,
    ...(shaVerifiedReason !== undefined ? { shaVerifiedReason } : {}),
    date: args.date,
    writtenAt: toIso(now),
    exec: { ...args.exec },
    dosage: args.dosage,
    reviewed,
    reviewers,
    r,
    u,
    findings: outputFindings,
    controls,
    session: {
      id: sessionId,
      transcript,
      messageCount: metrics.messageCount ?? null,
    },
    spawnIndex: metrics.spawnIndex ?? null,
    prompt: metrics.prompt ?? null,
    tokens: metrics.tokens ?? null,
    tokensAtSpawn: metrics.tokensAtSpawn ?? null,
    concurrentCycles: metrics.concurrentCycles ?? null,
    unmeasured,
  };
}

// Tout ce qui n'est ni lettre, ni chiffre, ni `_`, ni `-` est remplacé : ça
// neutralise `/`, `\`, `:` et surtout `..` — un identifiant de ticket hostile ne
// doit pas pouvoir faire écrire HORS de la racine du dépôt de mesures.
function sanitizeSegment(value) {
  return String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * `cycles/<AAAA-MM>/<AAAA-MM-JJ>-<TICKET>-<8 car. de session>-s<NN>.json`.
 * Déterministe (donc testable), unique entre sessions parallèles, rangé par mois
 * pour qu'un répertoire ne devienne pas illisible. Le mois vient de la DATE de
 * l'enregistrement, jamais de l'horloge.
 */
export function recordPath(record) {
  const date = typeof record?.date === 'string' && DATE_RE.test(record.date) ? record.date : 'date-inconnue';
  const month = date === 'date-inconnue' ? 'inconnu' : date.slice(0, 7);
  const ticket = sanitizeSegment(record?.ticket);
  const rawSessionId = record?.session?.id;
  const sessionSegment =
    typeof rawSessionId === 'string' && rawSessionId.length > 0
      ? sanitizeSegment(rawSessionId).slice(0, 8)
      : 'nosession';
  const spawn = Number.isInteger(record?.spawnIndex)
    ? String(record.spawnIndex).padStart(2, '0')
    : 'xx';
  return `cycles/${month}/${date}-${ticket}-${sessionSegment}-s${spawn}.json`;
}

/**
 * Écrit l'enregistrement sous la racine du dépôt. N'ÉCRASE JAMAIS un fichier
 * existant — un constat déjà écrit ne se réécrit pas : suffixe `-2`, `-3`… Le
 * flag `wx` porte la garantie jusque dans la course entre sessions parallèles
 * (10 à 15 tournent en même temps), là où un `existsSync` seul laisserait une
 * fenêtre.
 */
export function writeRecord(root, record, deps = {}) {
  const fsx = deps.fs || fs;
  const relative = recordPath(record);
  const directory = path.join(root, path.dirname(relative));
  const base = path.basename(relative, '.json');
  const payload = `${JSON.stringify(record, null, 2)}\n`;

  fsx.mkdirSync(directory, { recursive: true });

  for (let attempt = 1; attempt <= 1000; attempt++) {
    const name = attempt === 1 ? `${base}.json` : `${base}-${attempt}.json`;
    const target = path.join(directory, name);
    try {
      fsx.writeFileSync(target, payload, { flag: 'wx' });
      return target;
    } catch (err) {
      if (err && err.code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error(`1000 enregistrements portent déjà le nom ${base} dans ${directory}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Codes de sortie :
 *   0 — écrit (chemin absolu sur stdout)
 *   0 — no-op : `~/sdd-metrics` absent ou sans `.git` (motif sur stderr)
 *   1 — argument requis manquant, ou valeur hors énuméré fermé
 *   1 — échec d'écriture
 *
 * Un transcript introuvable ou illisible ne fait jamais échouer l'écrivain.
 */
export function main(argv = process.argv.slice(2), deps = {}) {
  const fsx = deps.fs || fs;
  const homedir = deps.homedir || os.homedir();
  const env = deps.env || process.env;
  const run = deps.run || defaultRun;
  const stdout = deps.stdout || ((s) => process.stdout.write(s));
  const stderr = deps.stderr || ((s) => process.stderr.write(s));

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr(`${parsed.error}\n`);
    return 1;
  }
  const args = parsed.args;

  // No-op AVANT tout travail : inutile de lire un transcript pour ne rien écrire.
  const { root, reason: rootReason } = resolveMetricsRoot(homedir, { fs: fsx });
  if (!root) {
    stderr(`${rootReason}\n`);
    return 0;
  }

  if (args.dosage === 'none' && args.findings.length > 0) {
    stderr(
      `dosage \`none\` : les ${args.findings.length} --finding reçus ne sont pas enregistrés ` +
        `(aucun relecteur n'a été spawné).\n`
    );
  }

  const sessionId = typeof env.CLAUDE_CODE_SESSION_ID === 'string' ? env.CLAUDE_CODE_SESSION_ID : '';
  const projectsRoot = path.join(homedir, '.claude', 'projects');
  const transcript = resolveTranscript(sessionId, projectsRoot, { fs: fsx });
  if (transcript.reason) stderr(`${transcript.reason}\n`);

  let raw = null;
  let readReason = transcript.reason;
  if (transcript.path) {
    try {
      raw = fsx.readFileSync(transcript.path, 'utf8');
    } catch (err) {
      readReason = `transcript illisible (${transcript.path}) : ${err.message}`;
      stderr(`${readReason}\n`);
    }
  }

  const metrics = collectTranscriptMetrics({ raw, ticket: args.ticket, reason: readReason });
  const shaCheck = verifySha(args.repo, args.sha, run);
  const findings = verifyFindingRefs(args.findings, args.repo, run);

  const record = buildRecord({
    args,
    session: {
      id: sessionId.length > 0 ? sessionId : null,
      transcript: transcript.path,
      transcriptReason: readReason,
    },
    metrics,
    shaCheck,
    findings,
    now: deps.now,
  });

  let written;
  try {
    written = writeRecord(root, record, { fs: fsx });
  } catch (err) {
    stderr(`échec d'écriture de la mesure : ${err.message}\n`);
    return 1;
  }
  stdout(`${written}\n`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = main();
}
