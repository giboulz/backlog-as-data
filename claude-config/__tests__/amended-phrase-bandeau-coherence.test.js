// SKILL-81 — arbitrage de l'escalade E1 (finding 4) de specs/skill-77.md :
// SKILL-77 a retiré de commands/sdd-run-ticket.md la phrase « la condition de
// retrait attend une population de cycles, pas un instrument », mais deux
// specs LIVRÉES continuaient de la porter au présent (specs/skill-56.md §
// Décision 4, specs/skill-53.md § Clôture). Le geste retenu (§ Correction
// attendue, arbitrage du 2026-08-27) n'est PAS de réécrire ces phrases — une
// spec livrée est un compte rendu daté — mais de poser un bandeau
// d'amendement ADJACENT au point où la phrase est écrite (⚠️ **Amendée par
// [[SKILL-77]]**), sur le modèle de specs/skill-70.md (SKILL-74).
//
// Ce test verrouille l'INVARIANT (D3, specs/skill-81.md) : dans ces DEUX
// fichiers, et seulement ceux-là (⛔ pas de généralisation à tout `specs/`,
// c'est la mécanisation générale écartée au § Correction attendue), toute
// SECTION qui porte au présent la phrase retirée porte aussi le bandeau, OU
// est la section d'escalade déjà marquée « → Traitée par SKILL-77 ».
//
// ⚠️ Découpe LOCALE, pas `decouperEnSections` de
// `./helpers/legacy-path-policy.js` : ce helper ne scinde que sur `## `
// (deux dièses exactement — `/^##\s+/` ne matche PAS `### `), ce qui
// regrouperait ici, par exemple, TOUTE la section `## Décision` de
// specs/skill-56.md (ses quatre sous-sections `### 1.` … `### 4.`) en un seul
// bloc — trop grossier pour distinguer la sous-section 4 (qui porte la
// phrase et a besoin d'un bandeau) des trois autres (qui n'en ont pas
// besoin). Il faut ici la granularité `##` ET `###`. Pas de promotion du
// helper pour un premier appelant à ce grain (convention `prompt-blocks.js`,
// en-tête D3 : on ne promeut qu'au deuxième appelant réel) — la découpe
// reste locale à ce fichier, ⛔ pas recopiée dans `legacy-path-policy.js`.
//
// ⚠️ Reprise (finding 2 de la gate) : `decouperSections` couvre désormais
// aussi le PRÉAMBULE (tout ce qui précède le premier `##`/`###` — frontmatter,
// titre `# SKILL-NN`, chapô). La première version jetait ce texte par
// construction (comme `decouperEnSections` du helper partagé, dont l'en-tête
// documente le même défaut, fermé côté chemins par SKILL-89 finding 5) : une
// occurrence de la phrase ajoutée avant le premier `## ` n'aurait jamais été
// examinée par aucune assertion.
//
// ⚠️ La convention du bandeau elle-même, vérifiée sur le corpus
// (specs/skill-13.md, specs/skill-24.md, specs/skill-70.md, specs/skill-80.md)
// : c'est un PARAGRAPHE `⚠️ **Amendée par [[SKILL-NN]]**` séparé par des
// lignes vides, PAS un blockquote `>` — donc `bandeauxDe` de
// `legacy-path-policy.js` (qui ne détecte QUE des blocs `>` consécutifs,
// motif d'une AUTRE politique, celle des anciens chemins de fichiers de
// SKILL-72/79/88) ne s'applique pas ici. La détection du bandeau lui-même est
// une recherche littérale de `Amendée par [[SKILL-77]]` dans le corps de la
// section ; le filtrage qui l'exclut du COMPTAGE D'OCCURRENCES (ci-dessous,
// `sansParagraphesAmendement`) doit donc retirer des PARAGRAPHES qui
// commencent par ce marqueur, pas des lignes `>` — reprise (finding 1 et
// finding 3 de la gate) : une première version copiait le motif `>` de
// `sansBandeaux` (`legacy-path-bandeau-coherence.test.js`, SKILL-72), qui
// sert une convention DIFFÉRENTE (bandeau en blockquote) et ne retirait donc
// RIEN sur ce corpus-ci — les deux bandeaux posés par ce ticket, qui recitent
// la phrase amendée pour expliquer ce qui n'est plus vrai, se comptaient
// comme leur propre preuve de couverture. Nom délibérément DIFFÉRENT de
// `sansBandeaux` (pas une copie renommée par accident) : les deux fonctions
// filtrent des formes de bandeau distinctes, et une divergence de nom rend
// visible qu'il ne s'agit PAS du même dispositif — voir l'en-tête de
// `legacy-path-policy.js` (SKILL-88, point 1) pour le défaut symétrique
// (copies homonymes qui divergent en silence) que ce choix de nom évite.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized } from './helpers/prompt-blocks.js';
import { AMORCE_BANDEAU, texteBandeau, portesLeBandeauDe } from './helpers/bandeau-amendement.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const FICHIERS = ['specs/skill-53.md', 'specs/skill-56.md'];

const MARQUEUR_TRAITEE = '→ Traitée par SKILL-77';
const BANDEAU_TEXTE = texteBandeau('SKILL-77');
// AMORCE_BANDEAU (helper partagé, SKILL-106) — volontairement plus large que
// `BANDEAU_TEXTE` (qui nomme SKILL-77 précisément) : un bandeau posé par un
// AUTRE ticket, sur une autre section de ces deux fichiers, doit être exclu
// du comptage d'occurrences tout autant, même s'il ne couvre pas CETTE
// phrase-ci.

// La phrase retirée par SKILL-77, sous ses deux formes de gras rencontrées
// dans le corpus (« **population de cycles** » à specs/skill-53.md, «
// **population** de cycles » à specs/skill-56.md) : les `**` sont retirés
// avant le test, la forme du gras n'étant pas significative.
function portePhraseRetiree(texte) {
  return /population\s+de\s+cycles/i.test(texte.replace(/\*\*/g, ''));
}

// Retire les PARAGRAPHES de bandeau (séparés par une ligne vide, amorcés par
// `⚠️ **Amendée par [[…`) avant toute détection d'occurrence — même motif que
// `sansBandeaux` de `legacy-path-bandeau-coherence.test.js` (ne pas laisser
// le bandeau se compter comme sa propre preuve, § Tests point 3 de
// specs/skill-81.md), appliqué à la forme RÉELLE du bandeau de ce dépôt (un
// paragraphe, pas un bloc `>` — voir l'en-tête de ce fichier).
function sansParagraphesAmendement(corps) {
  return corps
    .split(/\n\s*\n/)
    .filter((paragraphe) => !AMORCE_BANDEAU.test(paragraphe))
    .join('\n\n');
}

// Découpe locale par titres `## ` OU `### `, PRÉAMBULE compris (le texte
// avant le tout premier titre — frontmatter, `# SKILL-NN`, chapô — devient sa
// propre section plutôt que d'être jeté). Voir l'en-tête de ce fichier pour
// le pourquoi des deux écarts avec `decouperEnSections`.
function decouperSections(raw) {
  const lignes = raw.split('\n');
  const sections = [];
  let courante = { debut: 0, titre: '(préambule)', corps: [] };
  lignes.forEach((ligne, i) => {
    if (/^#{2,3}\s+/.test(ligne)) {
      courante.fin = i;
      sections.push(courante);
      courante = { debut: i, titre: ligne.replace(/^#{2,3}\s+/, '').trim(), corps: [] };
    } else {
      courante.corps.push(ligne);
    }
  });
  courante.fin = lignes.length;
  sections.push(courante);
  return sections.map((s) => ({ ...s, corps: s.corps.join('\n') }));
}

describe('SKILL-81 — bandeau Amendée par [[SKILL-77]] sur les deux specs livrées qui portent la phrase retirée', () => {
  const fichiersAvecSections = FICHIERS.map((f) => ({
    fichier: f,
    sections: decouperSections(readNormalized(REPO_ROOT, f)),
  }));

  const sectionsAvecPhrase = fichiersAvecSections.flatMap(({ fichier, sections }) =>
    sections
      .filter((s) => portePhraseRetiree(sansParagraphesAmendement(s.corps)))
      .map((s) => ({ fichier, ...s }))
  );

  // Sanity check (§ Tests, point 2 de specs/skill-81.md) : sans occurrence
  // détectée, la batterie ne garantit plus rien — une reformulation future de
  // la phrase rendrait ce test vert en ne cherchant plus rien.
  // ⚠️ Mutation-témoin (rejouée à la main avant commit) : réduire le motif de
  // `portePhraseRetiree` à une chaîne absente du corpus (ex.
  // `zzz-jamais-present`) → rouge.
  it('la détection trouve au moins une occurrence de la phrase retirée dans ces deux fichiers', () => {
    expect(
      sectionsAvecPhrase.length,
      `Aucune occurrence de « population … de cycles » détectée dans ${FICHIERS.join(
        ', '
      )} — soit les deux sites ont été réécrits (⛔ interdit, § Correction attendue ` +
        `de specs/skill-81.md), soit la détection est cassée.`
    ).toBeGreaterThan(0);
  });

  // Couverture (§ Tests, point 1 de specs/skill-81.md) : chaque section qui
  // porte la phrase au présent porte aussi le bandeau qui nomme SKILL-77, ou
  // est la section d'escalade déjà marquée « → Traitée par SKILL-77 »
  // (l'exemption D1 de specs/skill-81.md — ce sont des citations dans le
  // récit d'une escalade close, pas des consignes au présent).
  // ⚠️ Mutation-témoin (rejouée à la main avant commit) : retirer l'un des
  // deux bandeaux posés par ce ticket (specs/skill-53.md § Clôture ou
  // specs/skill-56.md § Décision 4) → rouge.
  it.each(sectionsAvecPhrase.map((s) => ({ ...s, nom: `${s.fichier} § ${s.titre}` })))(
    `$nom : porte le bandeau « ${BANDEAU_TEXTE} », ou est l'escalade déjà traitée`,
    (section) => {
      const porteLeBandeau = portesLeBandeauDe(section.corps, 'SKILL-77');
      const estEscaladeTraitee = section.corps.includes(MARQUEUR_TRAITEE);
      expect(
        porteLeBandeau || estEscaladeTraitee,
        `${section.fichier} § "${section.titre}" porte au présent la phrase retirée par ` +
          `SKILL-77 sans porter le bandeau « ${BANDEAU_TEXTE} » ni être l'escalade déjà ` +
          `marquée « ${MARQUEUR_TRAITEE} ».`
      ).toBe(true);
    }
  );

  // Le bandeau ne se compte pas lui-même (§ Tests, point 3 de
  // specs/skill-81.md) : un fragment synthétique où la phrase ne vit QUE dans
  // le paragraphe de bandeau (la forme RÉELLE posée par ce ticket, pas un
  // bloc `>` — reprise finding 1 de la gate) ne doit produire AUCUNE
  // occurrence détectée hors bandeau — sinon une section qui ne ferait que
  // CITER la phrase dans son propre bandeau se compterait comme sa propre
  // preuve de couverture.
  // ⚠️ Mutation-témoin (rejouée à la main avant commit) : appeler
  // `portePhraseRetiree(fragment)` directement (sans passer par
  // `sansParagraphesAmendement`) sur le fragment ci-dessous → passe à `true`,
  // et ce test ne peut plus rougir au retrait du bandeau.
  it("le bandeau ne se compte pas lui-même : une occurrence uniquement dans le paragraphe de bandeau n'est pas détectée", () => {
    const fragment = [
      'Texte normal, sans la phrase litigieuse.',
      '',
      '⚠️ **Amendée par [[SKILL-77]] (2026-08-27)** — cette phrase citée pour ' +
        'mémoire (« population de cycles ») n\'est plus vraie.',
      '',
      'Suite du texte normal.',
    ].join('\n');
    expect(portePhraseRetiree(sansParagraphesAmendement(fragment))).toBe(false);
    // Contrôle positif du fragment lui-même (garde ce test honnête : sans
    // lui, `sansParagraphesAmendement` pourrait retirer TOUT le fragment par
    // accident et le `false` ci-dessus serait vrai pour une mauvaise raison).
    expect(portePhraseRetiree(fragment)).toBe(true);
  });
});
