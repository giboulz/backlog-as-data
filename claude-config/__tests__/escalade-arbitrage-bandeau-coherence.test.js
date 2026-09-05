// Les bandeaux posés par l'ARBITRAGE D'UNE ESCALADE — nommé d'après ce SUJET,
// jamais d'après un ticket : il survivra au prochain arbitrage, qui y ajoutera
// ses lignes dans la table `POINTS` ci-dessous (specs/skill-105.md, § Tests).
//
// SKILL-105 referme quatre escalades E1 dont l'arbitrage laisse, chacun, une
// trace CHEZ L'AMENDÉ : une spec livrée est un compte rendu daté, on ne réécrit
// pas sa section, on pose un bandeau adjacent nommant l'amendeur (convention de
// `specs/skill-81.md` § Correction attendue, appliquée depuis par SKILL-77,
// SKILL-106 et SKILL-107).
//
// ⛔ Ce fichier couvre les points QU'IL ÉNUMÈRE, et aucun bandeau existant : le
// § Hors-scope de specs/skill-105.md refuse explicitement d'écrire ici une
// politique générale de test des bandeaux d'amendement (le dépôt en teste
// certains et pas d'autres, et specs/skill-104.md § Défenses, défense B, a
// refusé de trancher ce corollaire). Ne pas rouvrir la généralisation au
// passage.
//
// ⚠️ La détection du bandeau vient du helper PARTAGÉ
// `./helpers/bandeau-amendement.js` (`portesLeBandeauDe`), ⛔ jamais d'un
// détecteur local recopié — c'est exactement le défaut que SKILL-88 documente
// pour la famille voisine des bandeaux `>` (chemins renommés). La DÉCOUPE en
// sections, elle, reste locale à ce fichier : le helper n'exporte que le motif
// et son prédicat, délibérément (cf. son en-tête).
//
// ⚠️ Ancrage par ancres LITTÉRALES (`sectionEntre`, helper partagé), pas
// `extractSection` : les points visés sont des paragraphes, des puces ou des
// lignes de tableau sous des titres `## ` comme `### `, et le helper de section
// ne borne que sur `/^##\s/`. `startAnchor` DOIT couvrir tout ce que
// `corpsIntact` doit pouvoir voir disparaître sous une mutation.
//
// ⚠️ Jusqu'à SKILL-110, AUCUNE mutation-témoin ne pouvait prouver que
// l'`amendeur` est lu PAR LIGNE : les quatre points d'alors nommaient le même
// (`SKILL-105`), ce qui en faisait une contrainte de CONCEPTION plutôt qu'une
// assertion — `SKILL-86 · E1` : une table consommée par des `it.each` câblés
// en dur sur un amendeur unique rend toute entrée suivante rouge par
// construction, pas par lecture réelle du champ. SKILL-110 ajoute un
// cinquième point dont l'`amendeur` est `SKILL-106`, distinct des quatre
// premiers : câbler l'amendeur en dur devient détectable pour la première
// fois (rouge sur ce point neuf), donc la lecture par ligne est désormais
// falsifiable. ⛔ Ne pas
// fabriquer de point témoin pour la rendre falsifiable au-delà : le seul
// candidat évident (`specs/skill-85.md` § D1, amendé par SKILL-107) est DÉJÀ
// couvert par `preflight-contract-bandeau-coherence.test.js` et n'est pas un
// bandeau d'arbitrage d'escalade — l'ajouter ferait deux textes du même
// contrôle et rouvrirait la généralisation que le § Hors-scope refuse.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized, sectionEntre, platir } from './helpers/prompt-blocks.js';
import { texteBandeau, portesLeBandeauDe } from './helpers/bandeau-amendement.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const ID_105 = 'SKILL-105';
const SPEC_105 = 'specs/skill-105.md';

const ID_106 = 'SKILL-106';
const SPEC_106 = 'specs/skill-106.md';

const SKILL_101 = 'specs/skill-101.md';
const SKILL_107 = 'specs/skill-107.md';
const SKILL_86 = 'specs/skill-86.md';
const SKILL_104 = 'specs/skill-104.md';
const SKILL_27 = 'specs/skill-27.md';

// Table des points amendés par un arbitrage d'escalade. Chaque ligne porte son
// PROPRE `amendeur` et son PROPRE `specRenvoi` : ce n'est pas un mécanisme
// mono-amendeur câblé en dur (leçon de `SKILL-86 · E1`, qui a coûté une
// escalade). Un futur arbitrage ajoute SON entrée ici.
const POINTS = [
  {
    nom: 'specs/skill-101.md § Portée — tableau des trois fichiers (compte des familles neuves)',
    fichier: SKILL_101,
    amendeur: ID_105,
    specRenvoi: SPEC_105,
    startAnchor: '**Trois fichiers, aucun neuf.**',
    endAnchor: '⛔ **Les ids des familles neuves ne sont PAS figés ici.**',
    // La sonde inclut le NOM DE LA LIGNE amendée : c'est le point dont
    // l'adjacence est la plus dégradée (l'ancre est une ligne de TABLEAU, et un
    // bandeau est un paragraphe — il ne peut pas se poser dedans), donc le seul
    // à avoir besoin d'un contrôle de compensation.
    sonde: (bandeau) =>
      /\bsix\b/.test(bandeau) && bandeau.includes('mature-skill-coherence.test.js'),
    sondeLibelle: '« six » familles neuves ET le nom de la ligne amendée',
    corpsIntact: (tranche) =>
      platir(tranche).includes(
        '`MAT15`, `MAT19`, `MAT25` et `MAT26` amendés ; **cinq familles neuves** ' +
          '(§ Tests, cas 2, 4, 5, 8 et 9)'
      ),
  },
  {
    nom: "specs/skill-107.md § Correction attendue, D1 — le ⚠️ d'ordonnancement `ssh://…:22/…`",
    fichier: SKILL_107,
    amendeur: ID_105,
    specRenvoi: SPEC_105,
    startAnchor: '⚠️ **Le cas `ssh://…:22/…` est la raison de découper sur `/` D',
    endAnchor: '⛔ **Deux précisions écartées',
    sonde: (bandeau) => /commutatives/.test(bandeau),
    sondeLibelle: 'les deux passes sont « commutatives »',
    corpsIntact: (tranche) =>
      platir(tranche).includes(
        "Inverser l'ordre des deux passes rendrait `22/ns/repo`"
      ),
  },
  {
    nom: 'specs/skill-86.md § Portée, ✅ Autorisation écrite — deux amendements',
    fichier: SKILL_86,
    amendeur: ID_105,
    specRenvoi: SPEC_105,
    startAnchor: '### ✅ Autorisation écrite',
    endAnchor: '**Commit scopé, obligatoire**',
    // DEUX amendements sur la même section, et c'est délibéré : ses deux
    // clauses sont fausses chacune à sa façon (specs/skill-105.md § D3).
    sonde: (bandeau) =>
      /s'excluent/.test(bandeau) && bandeau.includes("bandeau d'**amendement**"),
    sondeLibelle:
      'les DEUX amendements — les clauses « s’excluent », et le cas du bandeau d’amendement',
    corpsIntact: (tranche) => {
      const plat = platir(tranche);
      return (
        plat.includes('Aucune de ses assertions existantes ne change') &&
        plat.includes(
          'La ligne `specs/skill-13.md` du tableau est donc **descriptive**'
        )
      );
    },
  },
  {
    nom: 'specs/skill-104.md § Portée, D2 — l’énoncé « ne s’escalade pas »',
    fichier: SKILL_104,
    amendeur: ID_105,
    specRenvoi: SPEC_105,
    startAnchor: '**Énoncé** : un geste que le dépôt **prescrit sans latitude**',
    endAnchor: '**Le critère — trois conditions cumulatives**',
    sonde: (bandeau) =>
      bandeau.includes('au titre de la portée') && bandeau.includes('`escaladé — E1`'),
    sondeLibelle: 'la précision « au titre de la portée » ET la cellule `escaladé — E1`',
    corpsIntact: (tranche) =>
      platir(tranche).includes(
        "Il ne figure pas dans un § Portée fermé, ne s'escalade pas, et sa " +
          "présence dans un diff n'est pas un dépassement."
      ),
  },
  {
    nom: "specs/skill-27.md § Tests, L1.6 — puce Étape 4.5 (titre d'it transcrit)",
    fichier: SKILL_27,
    amendeur: ID_106,
    specRenvoi: SPEC_106,
    startAnchor: '- L\'Étape 4.5 garde ses deux assertions de garde-fou',
    endAnchor: "- L'Étape 6.1 garde l'impératif",
    sonde: (bandeau) => /\btrois\b/.test(bandeau) && bandeau.includes('renommé'),
    sondeLibelle: 'le renommage du titre ET le nouveau compte (« trois »)',
    corpsIntact: (tranche) =>
      platir(tranche).includes(
        "L'Étape 4.5 garde ses deux assertions de garde-fou, " +
          '`guards.worktreeUnderTarget` et `guards.worktreePathFree`. ' +
          '*Même mutation, même raison.*'
      ),
  },
];

describe('Bandeaux d’amendement posés par l’arbitrage d’une escalade (table POINTS)', () => {
  const contenus = Object.fromEntries(
    [...new Set(POINTS.map((p) => p.fichier))].map((f) => [
      f,
      readNormalized(REPO_ROOT, f),
    ])
  );

  const trancheDe = (point) =>
    sectionEntre(contenus[point.fichier], point.startAnchor, point.endAnchor, point.fichier);

  // ⛔ Un bandeau est UN PARAGRAPHE, pas la queue de la tranche. Borner à
  // `tranche.slice(i)` rendrait tout ce qui suit le marqueur jusqu'à l'ancre de
  // fin du point — et les familles qui en dépendent (`renvoie vers`, `porte sa
  // substance`, déixis) valideraient alors du texte qui n'est PAS le bandeau.
  // Le fichier se déclare extensible (« Un futur arbitrage ajoute SON entrée
  // ici ») : qu'un arbitrage ultérieur pose un SECOND bandeau sous le premier,
  // dans la même tranche, et la mutation-témoin « vider un bandeau de sa
  // substance en gardant le marqueur et le renvoi » deviendrait VERTE — la
  // sonde du point ancien serait satisfaite par la substance du voisin, et son
  // `specRenvoi` par le renvoi du voisin. C'est exactement le défaut que
  // l'objection 20 du § Challenge a fait fermer (« quatre bandeaux vides
  // passent le test »). On remonte donc à la ligne vide qui OUVRE le paragraphe
  // et on s'arrête à celle qui le FERME.
  const bandeauDe = (point) => {
    const tranche = trancheDe(point);
    const i = tranche.indexOf(texteBandeau(point.amendeur));
    if (i === -1) return null;
    const ouverture = tranche.lastIndexOf('\n\n', i);
    const fermeture = tranche.indexOf('\n\n', i);
    return platir(
      tranche.slice(
        ouverture === -1 ? 0 : ouverture + 2,
        fermeture === -1 ? tranche.length : fermeture
      )
    );
  };

  // Un `it` par point (jamais une assertion pour tous) : le message dit
  // PRÉCISÉMENT lequel manque.
  // ⚠️ Mutations : retirer un bandeau → rouge sur ce point seul ; le poser hors
  // de sa section (ex. en tête du fichier) → rouge, l'ancre de début étant le
  // point amendé lui-même.
  it.each(POINTS)('$nom : porte le bandeau « Amendée par [[$amendeur]] », adjacent', (point) => {
    expect(
      portesLeBandeauDe(trancheDe(point), point.amendeur),
      `${point.fichier} : le point "${point.nom}" ne porte pas le bandeau ` +
        `« ${texteBandeau(point.amendeur)} » de manière ADJACENTE (entre son ` +
        `ancre d'ouverture et l'ancre suivante).`
    ).toBe(true);
  });

  // Le corps de l'amendement reste chez l'amendeur (convention SKILL-50) : le
  // bandeau en donne la substance en une à trois lignes ET le renvoi.
  // ⚠️ Mutation : un bandeau sans renvoi → rouge.
  it.each(POINTS)('$nom : le bandeau renvoie vers $specRenvoi', (point) => {
    const bandeau = bandeauDe(point);
    expect(bandeau, `${point.fichier} : bandeau absent pour "${point.nom}".`).not.toBeNull();
    expect(
      bandeau,
      `${point.fichier} : le bandeau de "${point.nom}" ne renvoie pas vers ` +
        `${point.specRenvoi} — le lecteur n'a aucun moyen d'aller chercher le ` +
        `corps de l'amendement.`
    ).toContain(point.specRenvoi);
  });

  // ⛔ Sans la SONDE, cinq bandeaux VIDES passeraient ce test et le
  // § Vérification 5 de specs/skill-105.md (un `grep -c` du seul marqueur).
  // ⚠️ Mutation : vider un bandeau de sa substance en gardant le marqueur et le
  // renvoi → rouge sur la sonde de ce point seul.
  it.each(POINTS)('$nom : le bandeau porte sa substance ($sondeLibelle)', (point) => {
    const bandeau = bandeauDe(point);
    expect(bandeau, `${point.fichier} : bandeau absent pour "${point.nom}".`).not.toBeNull();
    expect(
      point.sonde(bandeau),
      `${point.fichier} : le bandeau de "${point.nom}" ne porte pas sa ` +
        `substance (${point.sondeLibelle}) — un bandeau vide dit qu'un ` +
        `arbitrage a eu lieu sans dire lequel.`
    ).toBe(true);
  });

  // Une spec livrée est un compte rendu daté : le corps amendé reste lisible
  // tel quel, aucune ligne supprimée, aucune reformulation.
  // ⚠️ Mutation : réécrire le corps amendé au lieu d'ajouter le bandeau → rouge.
  it.each(POINTS)('$nom : le corps amendé reste lisible tel quel (non réécrit)', (point) => {
    expect(
      point.corpsIntact(trancheDe(point)),
      `${point.fichier} : le point "${point.nom}" a été RÉÉCRIT — le corps ` +
        `d'origine n'est plus reconnaissable tel quel. Une spec livrée ne se ` +
        `corrige pas sur place : on pose un bandeau adjacent.`
    ).toBe(true);
  });

  // Déixis : le bandeau vit chez l'amendé, donc il NOMME l'amendeur et n'écrit
  // jamais « ce ticket amende … » — inversion corrigée par SKILL-50.
  //
  // ⛔ La locution cherchée est NUE et insensible à la casse, et l'assertion est
  // bornée AU BANDEAU. Une déixis inversée écrite chez l'amendé désigne
  // l'amendé, jamais l'amendeur : la forme réellement produite est « ce ticket
  // amende la ligne ci-dessus » ou « ce ticket amende `specs/skill-101.md` ».
  // Chercher `Ce ticket amende [[<amendeur>]]` — « ce ticket » désignant
  // l'amendeur, suivi du nom de l'amendeur — serait sémantiquement impossible :
  // personne ne l'écrira jamais, donc aucune mutation cohérente ne pourrait
  // faire rougir l'assertion (specs/skill-105.md, § Tests, cas 10 : « aucun
  // « ce ticket amende » »).
  // ⚠️ Mutation : écrire « ce ticket amende la ligne ci-dessus » DANS l'un des
  // cinq bandeaux, marqueur et renvoi conservés → rouge sur ce point seul.
  it.each(POINTS)('$nom : la déixis n’est pas inversée', (point) => {
    const bandeau = bandeauDe(point);
    expect(bandeau, `${point.fichier} : bandeau absent pour "${point.nom}".`).not.toBeNull();
    expect(
      /ce ticket amende/i.test(bandeau),
      `${point.fichier} : déixis INVERSÉE dans le bandeau de "${point.nom}" — ` +
        `il vit chez l'amendé, il nomme l'amendeur ` +
        `(« ${texteBandeau(point.amendeur)} »), il ne dit jamais ` +
        `« ce ticket amende … ».`
    ).toBe(false);
  });
});
