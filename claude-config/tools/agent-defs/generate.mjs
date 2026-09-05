#!/usr/bin/env node
// tools/agent-defs/generate.mjs — Générateur des agent-defs SDD par palier de
// reasoning (SKILL-22).
//
// Problème (specs/skill-22.md) : `exec.effort` (`none|think|think-hard|
// ultrathink`) était DÉCORATIF pour l'implémenteur SDD. L'outil `Agent` ne prend
// pas de paramètre d'effort ; seule une injection en prose du prompt en portait
// la trace. Le SEUL levier mécanique du reasoning d'un sous-agent est le champ
// `effort:` du frontmatter d'un `.claude/agents/*.md` (doc officielle
// code.claude.com/docs/en/sub-agents.md : `low|medium|high|xhigh|max`,
// « overrides session effort »). Il n'existe PAS de paramètre d'effort par appel
// de l'outil `Agent` — contrairement à `model`, override par appel.
//
// Décision : un jeu d'agent-defs MAIGRES, un par palier officiel
// (`agents/sdd-impl-{low,medium,high,xhigh,max}.md`). Frontmatter seul (name,
// description, tools, effort). La discipline SDD reste INLINE dans
// `/sdd-run-ticket` (prompt passé par appel) — PAS dupliquée ici. Chaque fichier
// est GÉNÉRÉ, porte un sentinel, et sa cohérence disque↔générateur est vérifiée
// par `__tests__/agent-defs-coherence.test.js` (même pattern que backlog.json /
// migrations-coherence).
//
// Ce module est PUR de tout effet de bord à l'import (Node pur, aucune
// dépendance runtime) : les fonctions exportées calculent, seul `writeAgentDefs`
// touche le disque, et il n'est appelé que sous le garde `import.meta.url ===
// process.argv[1]` (exécution directe `node tools/agent-defs/generate.mjs`).
//
// ⚠️ CRLF : ce repo tourne sous Windows avec `core.autocrlf=true`. Ce fichier et
// les `agents/sdd-impl-*.md` sont forcés `eol=lf` dans `.gitattributes` — un
// `.mjs` CRLF fait rapporter à Vitest une fausse SyntaxError (cf. le même
// verrou sur tools/sdd/preflight.mjs), et un `.md` normalisé LF garde la
// cohérence disque↔générateur stable après checkout.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- Source de vérité : paliers + shim + frontmatter partagé -----------------

// Les 5 paliers de reasoning officiels d'un agent-def (doc sub-agents.md).
export const TIERS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

// Préfixe des subagent_type générés.
export const SUBAGENT_PREFIX = 'sdd-impl-';

// Shim ancien vocabulaire (EXEC_EFFORTS : backlog-as-data) → palier officiel.
// Temporaire, jusqu'au renommage d'enum côté backlog-as-data (hors-scope, cf.
// specs/skill-22.md). `xhigh` n'est volontairement pas atteignable par l'ancien
// vocab : aucun mot d'effort historique n'y mène (normal).
export const EFFORT_TO_TIER = Object.freeze({
  none: 'low',
  think: 'medium',
  'think-hard': 'high',
  ultrathink: 'max',
});

// Sentinel « GÉNÉRÉ » porté par chaque fichier — repère falsifiable pour le test
// de cohérence et avertissement humain.
export const SENTINEL =
  '<!-- GÉNÉRÉ par tools/agent-defs/generate.mjs — NE PAS ÉDITER À LA MAIN. -->';

// Frontmatter + corps PARTAGÉS par tous les paliers (seuls `name` et `effort`
// varient). `tools:` : le sous-jeu d'outils built-in qu'un implémenteur SDD
// utilise réellement, aligné sur ce qu'un sous-agent de background conserve
// (doc sub-agents.md). Volontairement SANS `Agent` (l'implémenteur ne spawne
// jamais de relecteur — c'est l'orchestrateur qui conduit la gate) ni les outils
// d'orchestration (SendMessage, Monitor…) ni les MCP (aucun service live).
export const SHARED = Object.freeze({
  tools:
    'Read, Grep, Glob, Bash, PowerShell, Edit, Write, NotebookEdit, WebFetch, WebSearch, TodoWrite, Skill, ToolSearch',
  body: [
    SENTINEL,
    '<!-- Régénérer : node tools/agent-defs/generate.mjs',
    '     Cohérence vérifiée par __tests__/agent-defs-coherence.test.js (npm test). -->',
    '',
    'Implémenteur SDD (Spec-Driven Development).',
    '',
    'Ta tâche concrète — le ticket à implémenter, le chemin de la spec, le worktree où',
    "travailler — arrive dans le **prompt d'invocation** de `/sdd-run-ticket`, pas ici.",
    "Ce fichier ne fixe qu'un réglage : le **palier de reasoning** (`effort` du",
    "frontmatter), câblé sur le `exec.effort` du ticket maturé. Suis à la lettre le",
    'prompt reçu et la discipline SDD du projet (spec → tests → code → vérif → commit).',
    '',
  ].join('\n'),
});

// --- Relecteur SDD (SKILL-23) ------------------------------------------------
//
// Problème (specs/skill-23.md) : la gate de revue de l'Étape 6.3 spawnait les
// relecteurs vierges en `subagent_type: general-purpose` SANS `model` → ils
// héritaient du modèle ET de l'effort de la session orchestratrice. La
// puissance de la revue était donc un effet de bord d'un réglage sans rapport,
// pas une décision. Décision : un agent-def DÉDIÉ, `agents/sdd-reviewer.md`,
// épinglé à un réglage fort FIXE — `model: opus`, `effort: high` — émis par ce
// même générateur (une entrée « spéciale », hors de la liste par palier
// ci-dessus : le relecteur n'a PAS de palier, il a un seul réglage non
// négociable). Le dosage (nombre de relecteurs, `none|light|deep` → 0/1/3)
// reste porté par `commands/sdd-run-ticket.md` — indépendant de CE fichier.

export const REVIEWER = Object.freeze({
  name: 'sdd-reviewer',
  model: 'opus',
  effort: 'high',
  description:
    'Relecteur SDD vierge (spec→diff→rapport), épinglé à un réglage fort fixe ' +
    '(model opus, effort high) indépendant du modèle/effort de la session ' +
    "orchestratrice. Généré ; invoqué par l'Étape 6.3 de /sdd-run-ticket via " +
    'subagent_type.',
});

// Frontmatter + corps du relecteur — SÉPARÉS de SHARED (le corps de
// l'implémenteur parle d'« implémenteur SDD » et de son `exec.effort` par
// ticket ; le relecteur n'a ni l'un ni l'autre : son réglage est fixe, sa
// tâche concrète — spec, diff, worktree — arrive par le prompt d'invocation de
// l'Étape 6.3, jamais ici).
//
// SKILL-25 : ce prompt d'invocation ne porte plus que des VARIABLES ; le reste
// de la conduite du relecteur (interdictions, axes, format de sortie) vit dans
// `prompts/reviewer.md`, que le relecteur lit lui-même. Ne pas laisser cet
// agent-def annoncer des axes « dans le prompt d'invocation » : le relecteur
// les y chercherait, ne les trouverait pas, et conclurait à un prompt tronqué —
// alors que son mode d'emploi lui interdit d'en improviser.
export const REVIEWER_SHARED = Object.freeze({
  tools: SHARED.tools,
  body: [
    SENTINEL,
    '<!-- Régénérer : node tools/agent-defs/generate.mjs',
    '     Cohérence vérifiée par __tests__/agent-defs-coherence.test.js (npm test). -->',
    '',
    'Relecteur SDD vierge (Spec-Driven Development).',
    '',
    'Ta tâche concrète — le ticket à relire, la spec de référence, le worktree à',
    "lire — arrive dans le **prompt d'invocation** de l'Étape 6.3 de",
    "`/sdd-run-ticket`, pas ici. Ce prompt ne porte que ces variables : il te",
    "pointe vers ton mode d'emploi (`prompts/reviewer.md`), qui porte tout le",
    'reste — interdictions, axes, format de sortie imposé. Lis-le en entier avant',
    "de relire quoi que ce soit. Ce fichier-ci ne fixe qu'un réglage :",
    'le modèle et le palier de reasoning (`model` / `effort` du frontmatter),',
    'épinglés fixes — `opus` / `high` — indépendamment du modèle et de l’effort',
    'de la session orchestratrice qui te spawne. Suis à la lettre le prompt reçu :',
    'tu rapportes, tu ne corriges rien, tu n’écris aucun fichier du dépôt relu.',
    '',
  ].join('\n'),
});

// Construit l'agent-def du relecteur, en mémoire. Fonction PURE de ses
// entrées → idempotente (même contrat que buildAgentDefs).
export function buildReviewerDef(shared = REVIEWER_SHARED) {
  const content =
    '---\n' +
    `name: ${REVIEWER.name}\n` +
    `description: ${REVIEWER.description}\n` +
    `tools: ${shared.tools}\n` +
    `model: ${REVIEWER.model}\n` +
    `effort: ${REVIEWER.effort}\n` +
    '---\n' +
    '\n' +
    shared.body +
    '\n';
  return { name: REVIEWER.name, filename: `${REVIEWER.name}.md`, content };
}

// --- Fonctions pures ---------------------------------------------------------

// Shim ancien vocab → palier officiel. Valeur inconnue → erreur explicite
// (jamais de fallback silencieux : un effort non mappé est un frontmatter à
// corriger, pas à deviner).
export function mapEffortToTier(effort) {
  const tier = Object.prototype.hasOwnProperty.call(EFFORT_TO_TIER, effort)
    ? EFFORT_TO_TIER[effort]
    : undefined;
  if (!tier) {
    throw new Error(
      `effort inconnu : ${JSON.stringify(effort)} — attendu ${Object.keys(EFFORT_TO_TIER).join(' | ')}`
    );
  }
  return tier;
}

// Palier officiel → subagent_type (nom de l'agent-def). Palier inconnu → erreur.
export function tierToSubagentType(tier) {
  if (!TIERS.includes(tier)) {
    throw new Error(
      `palier inconnu : ${JSON.stringify(tier)} — attendu ${TIERS.join(' | ')}`
    );
  }
  return SUBAGENT_PREFIX + tier;
}

// Construit les agent-defs en mémoire : un objet par palier
// { tier, name, filename, content }. Fonction PURE de ses entrées → idempotente.
export function buildAgentDefs(tiers = TIERS, shared = SHARED) {
  return tiers.map((tier) => {
    const name = SUBAGENT_PREFIX + tier;
    const description =
      `Implémenteur SDD (spec→tests→code→vérif→commit) au palier de reasoning ` +
      `« ${tier} ». Généré ; invoqué par /sdd-run-ticket via subagent_type.`;
    const content =
      '---\n' +
      `name: ${name}\n` +
      `description: ${description}\n` +
      `tools: ${shared.tools}\n` +
      `effort: ${tier}\n` +
      '---\n' +
      '\n' +
      shared.body +
      '\n';
    return { tier, name, filename: `${name}.md`, content };
  });
}

// --- Écriture (effet de bord, garde CLI uniquement) --------------------------

// Dossier cible par défaut des agent-defs = <racine-repo>/agents, soit deux
// niveaux au-dessus de ce fichier (tools/agent-defs/). Exporté pour être
// falsifiable en test : un `'..'` en moins ferait écrire dans tools/agents/,
// sans que le test de cohérence (qui relit des fichiers déjà committés) ne le
// voie — d'où l'assertion dédiée dans effort-mapping-coherence.test.js.
export const AGENTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'agents'
);

// Écrit chaque agent-def sur disque en LF (Node n'altère pas les \n ; le LF est
// verrouillé par .gitattributes). Retourne les defs écrits.
export function writeAgentDefs(dir = AGENTS_DIR, tiers = TIERS, shared = SHARED) {
  fs.mkdirSync(dir, { recursive: true });
  const defs = buildAgentDefs(tiers, shared);
  for (const def of defs) {
    fs.writeFileSync(path.join(dir, def.filename), def.content);
  }
  return defs;
}

// Écrit l'agent-def du relecteur sur disque (même contrat que writeAgentDefs :
// écriture LF, mkdir -p, dir/shared explicites pour rester falsifiable en
// test). SÉPARÉ de writeAgentDefs — le relecteur n'est pas un palier parmi
// d'autres, écrire les deux ensemble ferait dépendre le test de cohérence de
// l'implémenteur (qui compare disque == buildAgentDefs()) d'un fichier qu'il
// ne produit pas.
export function writeReviewerDef(dir = AGENTS_DIR, shared = REVIEWER_SHARED) {
  fs.mkdirSync(dir, { recursive: true });
  const def = buildReviewerDef(shared);
  fs.writeFileSync(path.join(dir, def.filename), def.content);
  return def;
}

// Exécution directe : `node tools/agent-defs/generate.mjs` régénère les fichiers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const defs = writeAgentDefs();
  for (const def of defs) {
    process.stdout.write(`écrit agents/${def.filename}\n`);
  }
  const reviewerDef = writeReviewerDef();
  process.stdout.write(`écrit agents/${reviewerDef.filename}\n`);
}
