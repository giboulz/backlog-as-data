// SKILL-45 — § Dépôt du rapport de `prompts/reviewer.md` : l'outil (`Write`),
// sa raison, et la forme shell sûre si l'agent y passe malgré tout.
//
// Contexte (specs/skill-45.md, § Problème) : la gate `deep` de SKILL-28 a vu
// deux relecteurs sur trois écarter, de leur propre jugement, une consigne
// d'environnement qui leur demandait de passer par le shell — mais le mode
// d'emploi ne leur donnait aucun ARGUMENT à opposer. Ce fichier verrouille
// que ces trois éléments (outil, raison, forme sûre) restent présents dans
// le § Dépôt du rapport, scopé à lui seul.
//
// ⚠️ Convention D3 : chaque assertion porte sa mutation-témoin en commentaire.
// ⚠️ Toutes les extractions passent par le helper PARTAGÉ
// `__tests__/helpers/prompt-blocks.js` — jamais une copie locale.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized, extractSection } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const REVIEWER_FILE = 'prompts/reviewer.md';

function depotSection() {
  const raw = readNormalized(REPO_ROOT, REVIEWER_FILE);
  const section = extractSection(raw, /^## Dépôt du rapport\s*$/);
  expect(section, `${REVIEWER_FILE} : § "## Dépôt du rapport" introuvable.`).not.toBeNull();
  return section;
}

describe('SKILL-45 — § Dépôt du rapport nomme Write, sa raison, et la forme shell sûre', () => {
  // ⚠️ Mutation-témoin : retirer la mention de l'outil `Write` du § Dépôt →
  // rouge.
  it('nomme l’outil Write', () => {
    const section = depotSection();
    expect(section).toMatch(/`Write`/);
  });

  // ⚠️ Mutation-témoin : retirer la RAISON (la substitution shell sur du code
  // cité) en gardant la prescription de l'outil → rouge. C'est l'assertion
  // qui compte (specs/skill-45.md § Tests) : le défaut n'était pas l'absence
  // de consigne, c'était l'absence d'argument.
  //
  // ⚠️ Finding 1 (gate de revue) : `/substitu/i` et `/backquote|…/i` restaient
  // verts sous cette mutation-témoin — la phrase d'INTERDICTION (§ suivant)
  // porte elle aussi « substitués » et « backquotes », donc elle seule suffit
  // à satisfaire ces deux regex même après suppression de la phrase-RAISON.
  // Ancré à présent sur deux tours propres à la raison — « cite du code » et
  // « avant écriture » — absents de la phrase d'interdiction, qui parle du
  // rapport « amputé », jamais de ce qu'il CITE ni de ce qui se passe « avant
  // écriture ».
  it('donne la raison : un rapport cite du code, que le shell substitue', () => {
    const section = depotSection();
    expect(section).toMatch(/cite du code/i);
    expect(section).toMatch(/avant écriture/i);
  });

  // ⚠️ Mutation-témoin : retirer la mention du quotage de l'heredoc → rouge.
  it('nomme la forme shell sûre (heredoc quoté) si l’agent passe par le shell', () => {
    const section = depotSection();
    expect(section).toMatch(/<<'EOF'/);
  });

  // ⚠️ Mutation-témoin : retirer l'interdiction de la forme dangereuse → rouge.
  //
  // ⚠️ Finding 2 (gate de revue) : `/<<EOF/` et `/echo/i` seuls sont aveugles à
  // la POLARITÉ — un texte qui RECOMMANDERAIT ces formes les satisferait tout
  // autant qu'un texte qui les interdit. Ancré à présent sur le jeton
  // d'interdiction (`⛔ **Jamais …`) directement accolé aux deux formes.
  it('interdit explicitement la forme dangereuse (heredoc non quoté / echo)', () => {
    const section = depotSection();
    expect(section).toMatch(/⛔\s*\*\*Jamais\s+`<<EOF`[^*]*`echo/);
  });
});
