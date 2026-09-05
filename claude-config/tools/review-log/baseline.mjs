// SKILL-30 — dépouillement en lecture seule des transcripts de sessions
// (`~/.claude/projects/<slug>/*.jsonl`) pour construire la baseline « avant »
// de l'épic prompt-hors-skill (specs/skill-30.md).
//
// Ce script ne mute rien : il lit des transcripts locaux et émet un JSON
// structuré sur stdout. L'écriture dans `~/sdd-metrics` et son commit sont
// faits par l'orchestrateur, après intégration (hors-scope, cf. la spec).
//
// Fonctions exportées, testées sur des fixtures synthétiques
// (`__tests__/fixtures/review-log/`) — jamais sur des transcripts réels,
// non reproductibles et hors dépôt :
//   - parseSession(raw)        : lignes JSON -> messages, tolérant aux lignes
//                                 corrompues.
//   - extractSpawns(messages)  : détecte les lancements de ticket (prompts
//                                 implémenteur émis via l'outil `Agent`, en
//                                 excluant relecteurs et sous-agents ordinaires).
//   - extractRegistry(text)    : lit `R`/`U` d'un registre de revue si (et
//                                 seulement si) il est présent et lisible.
//   - summarize(sessions)      : agrège les compteurs `tokens` — dont
//                                 `subagentReportedTokens`, renommé par
//                                 SKILL-69 (le renommage est POSTÉRIEUR aux
//                                 deux dépouillements figés de
//                                 `~/sdd-metrics/baseline/`, qui gardent le
//                                 nom d'AVANT ce renommage et restent exacts
//                                 pour ce qu'ils contiennent) — et les appels
//                                 de sous-agents, par session.
//
// `collectRegistries`, `buildSessionRecord`, `runBaseline` et `main` composent
// ces quatre fonctions pour produire la sortie du script ; ils ne sont pas
// dans la liste « attendue » de la spec mais restent exportés pour être
// exercés par les tests (bout en bout et robustesse du lot).
//
// Toutes les hypothèses de schéma ci-dessous ont été vérifiées contre des
// transcripts RÉELS de `~/.claude/projects` (jamais commités, cf. spec) avant
// d'être figées ici — reprise SKILL-30 après relecture (findings 1-9). ⚠️
// SKILL-69 : cette affirmation reste vraie de la FORME du bloc `<usage>`
// (les regex ci-dessous matchent bien ce que les transcripts réels portent)
// et fausse de sa SÉMANTIQUE — `subagent_tokens` n'y porte que
// l'`input`+`output` du sous-agent, jamais son contexte relu (cf.
// `subagentReportedTokens` ci-dessous, et `write.mjs`, qui nomme ce trou).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Les en-têtes de section du mode d'emploi implémenteur. Une entrée absente du
// prompt est rapportée `false` — jamais déduite, jamais complétée.
//
// ⚠️ SKILL-25 : ces sections ne sont PLUS émises dans le prompt. Elles vivent
// dans `prompts/impl-same.md` / `prompts/impl-cross.md`, que le sous-agent lit
// lui-même ; ce que le skill émet (blocs `APPEL:impl-same` / `APPEL:impl-cross`
// de `commands/sdd-run-ticket.md`, ex-`TEMPLATE:same-repo` /
// `TEMPLATE:cross-repo`) n'est plus qu'un pointeur d'une quinzaine de lignes.
// Un cycle post-SKILL-25 rapporte donc légitimement TOUTES ces entrées à
// `false`, avec un `prompt.length` d'un ordre de grandeur plus petit : c'est la
// preuve mesurée que le dispositif a atterri, pas une panne du collecteur.
// La liste ci-dessous reste DÉLIBÉRÉMENT inchangée — ce champ enregistre ce qui
// a été émis, il ne le juge pas.
export const EXPECTED_PROMPT_SECTIONS = [
  '## Étape 0',
  '## Étape 0.1',
  '## Étape 0.5',
  '## Outils de fichiers',
  '## Discipline SDD',
  '## Si tu es repris avec des findings',
  '## Garde-fous génériques',
  '## Rapport final attendu',
  '## Si tu te trouves bloqué',
];

const USAGE_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
];

// Entrées de transcript qui sont de vrais tours de conversation (par
// opposition aux enregistrements de harnais réécrits à chaque tour :
// `queue-operation`, `attachment`, `last-prompt`, `custom-title`, `ai-title`,
// `mode`, `system`… — vérifié sur transcript réel, finding 7).
const CONVERSATION_TYPES = new Set(['user', 'assistant']);

// Préfixe des `subagent_type` générés pour l'implémenteur SDD (SKILL-22,
// `tools/agent-defs/generate.mjs` : `SUBAGENT_PREFIX = 'sdd-impl-'`). Seul ce
// préfixe distingue un lancement de ticket d'un relecteur (`sdd-reviewer`) ou
// d'un sous-agent ordinaire (`general-purpose`) — finding 3.
const IMPLEMENTER_SUBAGENT_PREFIX = 'sdd-impl-';

// `description: "SDD <TICKET-ID>"` posé par `/sdd-run-ticket` à l'appel de
// l'outil `Agent` (commands/sdd-run-ticket.md, Étape 6) — lu en priorité pour
// l'identifiant de ticket, plus fiable qu'un regex sur le corps du prompt.
const TICKET_ID_FROM_DESCRIPTION_RE = /^SDD\s+(\S+)/;
const TICKET_ID_FROM_PROMPT_RE = /ticket ([A-Z][A-Z0-9]*-\d+[A-Za-z0-9]*)/;

// SKILL-112 — marqueur du lancement de CORRECTION. Depuis SKILL-111, un cycle
// dont la gate rend au moins un finding émet DEUX appels `Agent` en
// `sdd-impl-<effort>` pour le même ticket : l'implémenteur (Étape 6) et le
// correcteur (Étape 6.5). `/sdd-run-ticket` suffixe la `description` du second
// (`SDD <TICKET-ID> (correction)`) pour que les deux soient discernables.
//
// Pourquoi un SUFFIXE, et pas une description « parlante » : la regex
// ci-dessus s'arrête au PREMIER BLANC, donc le suffixe est INVISIBLE pour
// l'attribution du ticket (les deux formes rendent le même identifiant) et
// VISIBLE pour qui le cherche. Une description non reconnue rendrait
// `ticketId: null` — strictement pire, et c'est ce que SKILL-111 avait à
// raison refusé.
//
// ⛔ `TICKET_ID_FROM_DESCRIPTION_RE` reste INCHANGÉE : elle n'a rien à corriger.
export const CORRECTION_DESCRIPTION_SUFFIX = '(correction)';

// `Revue : <n> relecteur(s) · <R> remontées · <U> findings uniques après
// fusion` — cf. commands/sdd-run-ticket.md, Étape 6.6.
const REGISTRY_LINE_RE =
  /Revue\s*:\s*\S+\s+relecteur\(s\)\s*·\s*(\S+)\s+remont[ée]es?\s*·\s*(\S+)\s+findings?\s+uniques/i;

// `subagent_tokens` n'est JAMAIS une clé JSON dans les transcripts réels :
// c'est du texte, sous deux formes observées (finding 2) — dans le contenu
// d'un `task-notification` (tâche de fond) et dans le texte d'un `tool_result`
// direct :
//   <usage><subagent_tokens>43534</subagent_tokens>...</usage>
//   <usage>subagent_tokens: 33129\ntool_uses: 13...</usage>
const SUBAGENT_TOKENS_XML_RE = /<subagent_tokens>(\d+)<\/subagent_tokens>/g;
const SUBAGENT_TOKENS_PLAIN_RE = /subagent_tokens:\s*(\d+)/g;

/**
 * Parse un transcript JSONL en messages. Une ligne corrompue est ignorée sans
 * faire échouer le reste de la session ; un fichier vide (ou vide de lignes
 * non blanches) rend une session vide, jamais une exception.
 */
export function parseSession(raw) {
  const messages = [];
  if (typeof raw !== 'string' || raw.length === 0) return messages;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // Ligne corrompue : ignorée, la session continue.
    }
  }
  return messages;
}

function isConversationTurn(entry) {
  return Boolean(entry) && CONVERSATION_TYPES.has(entry.type) && entry.message && typeof entry.message === 'object';
}

function messageContentBlocks(message) {
  const content = message?.message?.content;
  return Array.isArray(content) ? content : [];
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Une section est présente si son en-tête littéral apparaît, à condition de
// ne pas être le PRÉFIXE d'un en-tête plus long (`## Étape 0` ne doit pas
// matcher `## Étape 0.1` ni `## Étape 0.5` — finding 9). Le caractère suivant
// l'en-tête, s'il existe, ne peut donc être ni un chiffre ni un point.
function sectionPresent(prompt, section) {
  const re = new RegExp(`${escapeRegExp(section)}(?![\\w.])`, 'u');
  return re.test(prompt);
}

function sectionsPresence(prompt) {
  const sections = {};
  for (const section of EXPECTED_PROMPT_SECTIONS) {
    sections[section] = sectionPresent(prompt, section);
  }
  return sections;
}

function extractTicketId(description, prompt) {
  const fromDescription = TICKET_ID_FROM_DESCRIPTION_RE.exec(description);
  if (fromDescription) return fromDescription[1];
  const fromPrompt = TICKET_ID_FROM_PROMPT_RE.exec(prompt);
  return fromPrompt ? fromPrompt[1] : null;
}

// SKILL-112 — un lancement est une CORRECTION si (et seulement si) sa
// `description` se termine par le marqueur. Dérivé de la SEULE `description`,
// jamais du corps du prompt : celui-ci est de la prose que les tickets de skill
// réécrivent, et l'y chercher rendrait ce parseur dépendant d'un texte
// mouvant. Rend TOUJOURS un booléen — y compris quand la description est vide
// ou non reconnue (ticket alors tiré du prompt) : un consommateur qui écrit
// `!spawn.isCorrection` ne doit pas dépendre du régime d'attribution.
function isCorrectionDescription(description) {
  return typeof description === 'string' && description.trimEnd().endsWith(CORRECTION_DESCRIPTION_SUFFIX);
}

/**
 * Détecte les lancements de TICKET (implémenteur) dans une session : un appel
 * `Agent` dont `subagent_type` porte le préfixe `sdd-impl-` (SKILL-22). Un
 * relecteur (`sdd-reviewer`) ou un sous-agent ordinaire (`general-purpose`,
 * exploration…) n'est PAS un lancement de ticket, même si son prompt cite « le
 * ticket <ID> » (cas du relecteur — finding 3). Rend, dans l'ordre
 * d'apparition PARMI LES SEULS LANCEMENTS retenus, le rang (`spawnIndex`), la
 * taille en caractères du prompt, la présence/absence de chacune des sections
 * attendues, et (SKILL-112) si ce lancement est un CORRECTEUR (Étape 6.5).
 *
 * ⚠️ SKILL-112 — les correcteurs sont RENDUS (leur exclusion appartient aux
 * consommateurs, et `localSpawnPositions` de `write.mjs` doit rester alignée
 * une-pour-une avec cette liste) mais ne sont PAS NUMÉROTÉS : leur
 * `spawnIndex` est `null`, et le rang des lancements d'implémentation reste
 * consécutif. Sans cela, l'insertion d'un correcteur par cycle décalerait le
 * rang de tous les tickets suivants de la session, et le rang enregistré
 * cesserait d'être comparable à celui d'avant SKILL-111 — or c'est sur lui que
 * repose la doctrine de frontière de session de `commands/sdd-run-ticket.md`.
 */
export function extractSpawns(messages) {
  const spawns = [];
  let spawnIndex = 0;
  for (const message of messages) {
    for (const block of messageContentBlocks(message)) {
      if (!block || block.type !== 'tool_use' || block.name !== 'Agent') continue;
      const subagentType = typeof block.input?.subagent_type === 'string' ? block.input.subagent_type : '';
      if (!subagentType.startsWith(IMPLEMENTER_SUBAGENT_PREFIX)) continue;
      const prompt = typeof block.input?.prompt === 'string' ? block.input.prompt : '';
      const description = typeof block.input?.description === 'string' ? block.input.description : '';
      const isCorrection = isCorrectionDescription(description);
      spawns.push({
        spawnIndex: isCorrection ? null : spawnIndex,
        promptLength: prompt.length,
        ticketId: extractTicketId(description, prompt),
        isCorrection,
        sections: sectionsPresence(prompt),
      });
      if (!isCorrection) spawnIndex += 1;
    }
  }
  return spawns;
}

/**
 * Lit `R`/`U` d'un registre de revue (Étape 6.6 du skill) dans un texte de
 * message. Trois issues, jamais une quatrième :
 *  - registre bien formé  -> { r, u }
 *  - registre absent      -> { r: null, u: null, reason }
 *  - compteurs illisibles -> { r: null, u: null, reason } (jamais 0)
 */
export function extractRegistry(text) {
  if (typeof text !== 'string' || !text.includes('Revue')) {
    return { r: null, u: null, reason: 'registre absent' };
  }
  const match = REGISTRY_LINE_RE.exec(text);
  if (!match) {
    return { r: null, u: null, reason: 'registre absent' };
  }
  const r = Number(match[1]);
  const u = Number(match[2]);
  if (!Number.isFinite(r) || !Number.isFinite(u)) {
    return { r: null, u: null, reason: 'compteurs illisibles' };
  }
  return { r, u };
}

// Somme les 4 champs `usage`, en dédupliquant par `message.id` (finding 1) :
// un même tour d'assistant est réécrit sur PLUSIEURS lignes du transcript
// (une par bloc de contenu — thinking, tool_use…), chacune répétant le MÊME
// objet `usage`. Sans déduplication, la somme est gonflée d'un facteur
// variable selon le nombre de blocs du tour.
function sumUsage(messages) {
  const totals = Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0]));
  let sawUsage = false;
  const seenMessageIds = new Set();
  for (const message of messages) {
    const usage = message?.message?.usage;
    if (!usage || typeof usage !== 'object') continue;
    const messageId = message?.message?.id;
    if (typeof messageId === 'string') {
      if (seenMessageIds.has(messageId)) continue; // même tour déjà compté
      seenMessageIds.add(messageId);
    }
    sawUsage = true;
    for (const field of USAGE_FIELDS) {
      if (typeof usage[field] === 'number') totals[field] += usage[field];
    }
  }
  return { totals, sawUsage };
}

// Récupère récursivement toute chaîne portée par un enregistrement de
// transcript, où qu'elle soit imbriquée (`content` racine des
// `queue-operation`/task-notification, texte de `tool_result`…) — nécessaire
// car `subagent_tokens` n'est jamais une clé JSON (finding 2).
function collectStrings(node, acc, seen) {
  if (typeof node === 'string') {
    acc.push(node);
    return;
  }
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  const values = Array.isArray(node) ? node : Object.values(node);
  for (const value of values) collectStrings(value, acc, seen);
}

function sumSubagentTokensInText(text) {
  let total = 0;
  for (const match of text.matchAll(SUBAGENT_TOKENS_XML_RE)) total += Number(match[1]);
  for (const match of text.matchAll(SUBAGENT_TOKENS_PLAIN_RE)) total += Number(match[1]);
  return total;
}

// Nombre d'appels de sous-agents (tout `Agent`, implémenteur ou non — à la
// différence d'`extractSpawns` qui ne retient que les lancements de ticket) et
// somme de leurs `subagent_tokens` textuels, sur l'enregistrement JSON entier
// (pas seulement `.message.content` : le compte-rendu d'une tâche de fond vit
// dans un champ `content` racine, hors de `.message` — cf. finding 2).
function subagentStats(messages) {
  let callCount = 0;
  let subagentReportedTokens = 0;
  for (const message of messages) {
    for (const block of messageContentBlocks(message)) {
      if (block?.type === 'tool_use' && block.name === 'Agent') callCount += 1;
    }
    const strings = [];
    collectStrings(message, strings, new Set());
    for (const text of strings) subagentReportedTokens += sumSubagentTokensInText(text);
  }
  return { callCount, subagentReportedTokens };
}

function timestampBounds(messages) {
  const timestamps = messages
    .map((m) => m?.timestamp)
    .filter((t) => typeof t === 'string')
    .sort();
  if (timestamps.length === 0) return { min: null, max: null };
  return { min: timestamps[0], max: timestamps[timestamps.length - 1] };
}

// Nombre de vrais TOURS de conversation, pas de lignes du fichier : les
// enregistrements de harnais (`queue-operation`, `attachment`,
// `last-prompt`…) sont réécrits à chaque tour et n'ont pas de contrepartie
// « message » — les compter fausserait toute comparaison inter-session
// (finding 7).
function countConversationTurns(messages) {
  return messages.filter(isConversationTurn).length;
}

/**
 * Agrège, par session, les compteurs `tokens` (nommage aligné sur le README
 * de `~/sdd-metrics` — finding 6), les horodatages min/max, le nombre de vrais
 * tours de conversation et les compteurs de sous-agents. Une session sans
 * aucun bloc `usage` rend des zéros ET `noUsage: true` — un compteur nul et
 * une mesure absente ne sont pas la même information.
 */
export function summarize(sessions) {
  return sessions.map(({ project, sessionId, messages }) => {
    const { totals, sawUsage } = sumUsage(messages);
    const { min, max } = timestampBounds(messages);
    const { callCount, subagentReportedTokens } = subagentStats(messages);
    return {
      project,
      sessionId,
      timestampMin: min,
      timestampMax: max,
      messageCount: countConversationTurns(messages),
      tokens: {
        input: totals.input_tokens,
        output: totals.output_tokens,
        cacheRead: totals.cache_read_input_tokens,
        cacheCreate: totals.cache_creation_input_tokens,
        subagentReportedTokens,
      },
      noUsage: !sawUsage,
      subagentCallCount: callCount,
    };
  });
}

/**
 * Registres de revue trouvés dans une session. Ne scanne QUE les blocs texte
 * des messages `assistant` (c'est l'orchestrateur qui rédige et publie le
 * registre dans sa propre réponse — Étape 6.6, « rédigé par TOI »). Ignorer
 * ce filtre matchait aussi le TEXTE DU GABARIT (non substitué) présent dans le
 * corps même du skill dès qu'il est cité/lu dans la session — un relecteur
 * fantôme, symétrique du défaut que la spec interdit (finding 4).
 */
export function collectRegistries(messages) {
  const registries = [];
  for (const message of messages) {
    if (message?.type !== 'assistant') continue;
    for (const block of messageContentBlocks(message)) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue;
      if (block.text.includes('Revue')) {
        registries.push(extractRegistry(block.text));
      }
    }
  }
  return registries;
}

/** Compose les fonctions ci-dessus pour un fichier de transcript. */
export function buildSessionRecord(project, sessionId, raw) {
  const messages = parseSession(raw);
  const spawns = extractSpawns(messages);
  const registries = collectRegistries(messages);
  const [summary] = summarize([{ project, sessionId, messages }]);
  return { ...summary, spawns, registries };
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Parcourt `<root>/<projet>/*.jsonl` (défaut `~/.claude/projects`) et rend
 * `{ generatedAt, sessions }`, ou `{ error }` si `root` lui-même est
 * illisible. Lecture seule — aucune écriture, nulle part. Un dossier de
 * projet illisible, un fichier illisible, ou une session dont le
 * dépouillement échoue n'interrompent PAS le lot : ils sont sautés,
 * silencieusement, et le reste du lot continue.
 */
export function runBaseline(root) {
  const sessions = [];

  let projectDirs;
  try {
    projectDirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (err) {
    return { error: `Impossible de lire ${root} : ${err.message}` };
  }

  for (const dir of projectDirs) {
    const projectPath = path.join(root, dir.name);
    let files;
    try {
      files = fs.readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue; // dossier de projet illisible : n'interrompt pas le lot
    }
    for (const file of files) {
      const raw = readFileSafe(path.join(projectPath, file));
      if (raw === null) continue; // fichier illisible : n'interrompt pas le lot
      try {
        const sessionId = file.replace(/\.jsonl$/, '');
        sessions.push(buildSessionRecord(dir.name, sessionId, raw));
      } catch {
        continue; // session illisible : n'interrompt pas le lot
      }
    }
  }

  return { generatedAt: new Date().toISOString(), sessions };
}

/** Point d'entrée CLI : appelle `runBaseline` et écrit le JSON sur stdout. */
export function main(argv = process.argv.slice(2)) {
  const root = argv[0] || path.join(os.homedir(), '.claude', 'projects');
  const result = runBaseline(root);
  if (result.error) {
    process.stderr.write(`${result.error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
