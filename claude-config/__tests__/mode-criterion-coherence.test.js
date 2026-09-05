// SKILL-49 — la prose du skill et le contrat de determineMode décrivent le
// critère de mode ACTUEL (post-SKILL-44 : git dir commun), pas l'ancien
// (chemins normalisés). specs/skill-49.md § Problème 1 et 2.
//
// Pièges évités (specs/skill-49.md § Tests) :
// - pas de `.*` en mode `s` reliant deux ancres éloignées : extraction scopée
//   à la section, bornée par des délimiteurs LITTÉRAUX (pas une fenêtre
//   d'octets — trouvé en revue, gate de reprise, finding 7).
// - pas d'`includes` satisfait par un titre de section : `extractSection`
//   exclut l'en-tête (helper partagé, pas de réimplémentation locale — gate
//   de reprise, findings 8 et 9).
// - pas d'assertion satisfaite par de la prose préexistante : extraction
//   scopée à la section visée, échec explicite (`null`/absence d'ancre) si
//   elle manque.
// - texte aplati (`\s+` → un espace) avant assertion : le skill est
//   dur-wrappé, une phrase-clé peut être coupée par un retour à la ligne.
//
// ⚠️ Réutilise le helper PARTAGÉ `extractSection`/`readNormalized` de
// `__tests__/helpers/prompt-blocks.js` (promu SKILL-43) au lieu d'une copie
// locale : une découpe recopiée diverge en silence (specs/skill-43.md), et
// c'est exactement ce qui s'est produit ici en premier jet (gate de reprise,
// finding 9) — la copie locale incluait l'en-tête dans le corps, pas le
// helper partagé (finding 8).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { extractSection, readNormalized } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SKILL_FILE = 'commands/sdd-run-ticket.md';
const SKILL_13_FILE = 'specs/skill-13.md';

/** Aplatit les retours à la ligne du wrap dur en un seul espace. */
function aplatir(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Extrait le texte entre deux ancres LITTÉRALES (jamais une fenêtre d'octets
 * de taille fixe — piège n°4 de specs/skill-49.md § Tests). Échec explicite
 * si l'une ou l'autre est absente.
 */
function extractBetweenAnchors(contenu, startAnchor, endAnchor) {
  const startIdx = contenu.indexOf(startAnchor);
  if (startIdx === -1) {
    throw new Error(`Ancre de début absente : "${startAnchor}"`);
  }
  const afterStart = contenu.slice(startIdx);
  const endIdx = afterStart.indexOf(endAnchor);
  if (endIdx === -1) {
    throw new Error(`Ancre de fin absente : "${endAnchor}" (après "${startAnchor}")`);
  }
  return afterStart.slice(0, endIdx);
}

describe('SKILL-49 — commands/sdd-run-ticket.md décrit le critère de mode actuel', () => {
  const contenu = readNormalized(REPO_ROOT, SKILL_FILE);

  it("Étape 1.1 : un ticket trouvé dans $HOME/.claude ne bascule plus mécaniquement en cross-repo", () => {
    const section = extractSection(contenu, /^##\s*Étape 1\.1\b/);
    expect(section, `${SKILL_FILE} n'a plus de section "## Étape 1.1".`).not.toBeNull();
    const aplati = aplatir(section);
    expect(
      aplati,
      "L'ancienne formulation liait le mode au seul emplacement du ticket ; " +
        'SKILL-44 a rendu ça faux dès que la session travaille déjà dans un ' +
        'worktree de claude-config.'
    ).not.toMatch(/trouvé dans `\$HOME\/\.claude` → `targetRoot` du JSON pointe là et `mode` vaut `cross-repo`/);
    expect(
      aplati,
      'La section doit désormais renvoyer au critère réel (git dir commun).'
    ).toMatch(/git dir/i);
  });

  it('Étape 1.2 : le mode est tranché sur le git dir commun, pas sur une comparaison de racines de chemin', () => {
    const section = extractSection(contenu, /^##\s*Étape 1\.2\b/);
    expect(section, `${SKILL_FILE} n'a plus de section "## Étape 1.2".`).not.toBeNull();
    expect(
      aplatir(section),
      'Le critère décrit doit nommer le dépôt git commun (SKILL-44), pas une ' +
        'simple comparaison de racines de chemin.'
    ).toMatch(/d[ée]p[ôo]t git commun|git dir/i);
  });

  it("Étape 1.2 : le `-C` n'est JAMAIS présenté comme un no-op, même en mode « même repo » — mutation-témoin", () => {
    // Mutation-témoin : réintroduire « le `-C` est un no-op » → rouge. C'est
    // l'assertion qui compte : un orchestrateur qui croit ce no-op saute le
    // `-C` en same-repo et peut lire l'arbre d'un mauvais worktree quand
    // targetRoot ≠ sessionRoot (specs/skill-49.md § Problème/1, le cas
    // "le plus dangereux").
    const section = extractSection(contenu, /^##\s*Étape 1\.2\b/);
    expect(section, `${SKILL_FILE} n'a plus de section "## Étape 1.2".`).not.toBeNull();
    const aplati = aplatir(section);
    expect(aplati).not.toMatch(/le `-C` est un no-op/);
    expect(
      aplati,
      'Le texte doit affirmer explicitement que le `-C` reste obligatoire ' +
        'dans les deux modes.'
    ).toMatch(/obligatoire dans les deux modes/);
  });

  // ⚠️ Mutation : réintroduire « en cross-repo » comme SEUL cas où le fichier
  // testé peut être le mauvais → rouge (gate de reprise, finding 2).
  it("Étape 3 : le test de la spec n'attribue plus le risque au seul cross-repo", () => {
    const section = extractSection(contenu, /^##\s*Étape 3\b(?!\.5)/);
    expect(section, `${SKILL_FILE} n'a plus de section "## Étape 3".`).not.toBeNull();
    const aplati = aplatir(section);
    expect(aplati).not.toMatch(/qui, en\s*cross-repo, n'existe pas/);
    expect(
      aplati,
      'Le risque doit être posé pour les deux modes : `<racine_cible>` peut ' +
        'différer de la racine de session même en same-repo.'
    ).toMatch(/même en `same-repo`/);
  });

  // ⚠️ Mutation : réintroduire « en cross-repo » comme seule justification du
  // chemin absolu → rouge (gate de reprise, finding 3).
  it("Étape 6 : la justification d'`<ABSOLUTE_SPEC_PATH>` n'attribue plus le risque au seul cross-repo", () => {
    const section = extractSection(contenu, /^##\s*Étape 6\b(?!\.\d)/);
    expect(section, `${SKILL_FILE} n'a plus de section "## Étape 6".`).not.toBeNull();
    const aplati = aplatir(section);
    expect(aplati).not.toMatch(/chemin construit sur le repo de la session\s*:\s*en cross-repo/);
    expect(aplati).toMatch(/même en `same-repo`/);
  });

  // ⚠️ Mutation : laisser le préambule réaffirmer le lien mécanique
  // « ticket dans claude-config ⇒ cross-repo » → rouge (gate de reprise,
  // finding 6 : contradiction directe avec l'Étape 1.1 réécrite).
  it('Préambule « Pré-requis de repo » : ne réaffirme plus le lien mécanique avec cross-repo', () => {
    const debut = contenu.indexOf('**Pré-requis de repo (critique)**');
    expect(debut, 'Le préambule "Pré-requis de repo (critique)" est introuvable.').toBeGreaterThan(-1);
    const fin = contenu.indexOf('**Portabilité**', debut);
    expect(fin, 'La section suivante ("Portabilité") est introuvable après le préambule.').toBeGreaterThan(-1);
    const aplati = aplatir(contenu.slice(debut, fin));
    expect(
      aplati,
      'Le préambule ne doit plus dire que vivre dans claude-config bascule ' +
        "MÉCANIQUEMENT en cross-repo — l'Étape 1.1 dit maintenant le contraire."
    ).not.toMatch(
      /vit dans `claude-config`, même lancé depuis une session ouverte\s*ailleurs\.\s*Dans ce cas `isolation: "worktree"` est \*\*inutilisable\*\*/
    );
    expect(aplati).toMatch(/pas mécaniquement/);
  });
});

// ⚠️ SKILL-50 (2026-08-22) a déplacé le corps de la note d'amendement vers
// `specs/skill-44.md` (l'amendeur — convention specs/skill-03.md:50, que la
// version SKILL-49 appliquait à l'envers : « Ce ticket amende [[SKILL-44]] »
// dans skill-13.md faisait résoudre « ce ticket » sur SKILL-13, inversant qui
// amende qui). `specs/skill-13.md` ne porte plus qu'un renvoi.
describe("SKILL-49/SKILL-50 — l'amendement de la D3 (determineMode) vit chez l'amendeur", () => {
  const contenu13 = readNormalized(REPO_ROOT, SKILL_13_FILE);
  const SKILL_44_FILE = 'specs/skill-44.md';
  const contenu44 = readNormalized(REPO_ROOT, SKILL_44_FILE);
  const END_ANCHOR = "- **`deriveWorktreePath(targetRoot, id)`**";

  it("specs/skill-13.md ne recopie plus la déixis inversée, et renvoie vers specs/skill-44.md à la suite de la D3", () => {
    // Mutation-témoin : réintroduire « Ce ticket amende [[SKILL-44]] » dans
    // skill-13.md fait à nouveau résoudre « ce ticket » sur SKILL-13,
    // l'inversion corrigée par SKILL-50 (specs/skill-50.md § Problème/1).
    expect(contenu13).not.toContain('Ce ticket amende [[SKILL-44]]');
    const startIdx = contenu13.indexOf("- **`determineMode(targetRoot, sessionRoot)`**");
    expect(startIdx, 'La D3 de determineMode est introuvable.').toBeGreaterThan(-1);
    const note = extractBetweenAnchors(contenu13.slice(startIdx), 'Amendée par [[SKILL-44]]', END_ANCHOR);
    expect(note).toMatch(/specs\/skill-44\.md/);
  });

  it("la D3 d'origine (cas b) reste lisible telle quelle, non réécrite", () => {
    // ⛔ Ne pas réécrire la D3 comme si elle avait toujours dit ça : la trace
    // du contrat au moment où le code a été écrit doit rester lisible.
    expect(aplatir(contenu13)).toMatch(/\(b\) différentes → cross-repo/);
  });

  // ⚠️ specs/skill-50.md § Tests interdit le test de forme sur la rédaction des
  // notes (« une formule verrouillée empêche sa propre correction »). Ce test
  // ne borne donc PAS de section par un titre précis (fragile à un simple
  // renommage éditorial) : il vérifie seulement que specs/skill-44.md reste le
  // fichier qui documente le critère `git dir` (SKILL-50 déplace la note ici,
  // ne la supprime pas) et qu'une attribution à SKILL-50 y figure quelque part.
  it("specs/skill-44.md reste le contrat de référence pour le critère git dir, et porte une attribution à SKILL-50", () => {
    expect(contenu44).toMatch(/git dir/i);
    expect(contenu44).toMatch(/repli/i);
    expect(contenu44).toMatch(/specs\/skill-13\.md/);
    expect(contenu44, 'SKILL-50 doit apparaître comme auteur de l\'amendement').toMatch(/SKILL-50/);
  });
});
