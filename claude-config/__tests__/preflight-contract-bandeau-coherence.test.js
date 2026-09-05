// SKILL-106 — les sections de specs LIVRÉES qui documentent le contrat de
// `tools/sdd/preflight.mjs` portent le bandeau de leur amendeur, adjacent au
// point qu'elles rendent faux par omission (§ D4, specs/skill-106.md).
//
// Nommé d'après son SUJET (le contrat de `preflight.mjs`), pas d'après un
// ticket : SKILL-107 y ajoute son propre `describe`, SKILL-86 étend la table
// `POINTS` partagée (une entrée de plus, multi-amendeurs — finding 2, gate de
// reprise SKILL-86) et n'ajoute un `describe` que pour ses deux assertions
// spécifiques. Les deux tickets sont re-maturés dans la même passe
// (specs/skill-106.md, § Tests).
//
// ⛔ Pas dans `skill-size-ceiling-coherence.test.js` (réservé aux plafonds) ni
// dans `mode-criterion-coherence.test.js` (son sujet est le critère de mode).
//
// ⚠️ Ancrage par ancres LITTÉRALES, PAS `extractSection` : le helper partagé
// borne sur `/^##\s/`, il ne coupe pas sur `### `. Les points visés ici sont
// des puces sous des titres `## ` — et SKILL-107 puis SKILL-86, une fois livrés,
// se sont révélés viser eux aussi une ancre littérale sur de la prose/une puce,
// jamais une sous-section `### ` : la prédiction initiale (deux ancrages
// distincts pour deux formes de titre) ne s'est pas vérifiée. La technique
// unique reste la bonne pour autant : elle ne dépend pas de la nature de
// l'ancre (puce, prose ou titre), seulement de sa littéralité. On emploie donc
// la même technique pour TOUS les cas, dès ce ticket : `sectionEntre`
// (helper PARTAGÉ, `prompt-blocks.js`), pas une réimplémentation locale — c'est
// EXACTEMENT le dispositif (2) que son en-tête documente pour
// `sdd-reviewer-wiring-coherence.test.js`/`impl-templates-coherence.test.js`/
// `reviewer-spawn-shape-coherence.test.js` (découpe par ancres, gate de reprise,
// finding 5 de ce ticket : une copie locale octet pour octet, alors que le même
// commit invoque ailleurs la doctrine inverse pour `gitCwd`/`bandeau-amendement.js`).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized, sectionEntre, platir, extractBetween } from './helpers/prompt-blocks.js';
import { texteBandeau, portesLeBandeauDe } from './helpers/bandeau-amendement.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const SKILL_13_FILE = 'specs/skill-13.md';
const SKILL_85_FILE = 'specs/skill-85.md';
const SPEC_106 = 'specs/skill-106.md';
const SPEC_85 = 'specs/skill-85.md';
const ID_106 = 'SKILL-106';
const ID_85 = 'SKILL-85';
const BANDEAU_85 = texteBandeau(ID_85);

// Le bloc `guards` LITTÉRAL du § D2 de specs/skill-13.md, tel qu'il existait
// avant ce ticket — quatre champs, adjacents, sans rien entre eux. Comparé en
// SOUS-CHAÎNE EXACTE (pas une regex tolérante) : une insertion de ligne
// n'importe où À L'INTÉRIEUR du bloc (ex. `"branchFree": true,` entre
// `worktreePathFree` et `worktreeUnderTarget`, gate de reprise finding 3) casse
// l'adjacence et fait disparaître cette sous-chaîne — c'est le seul carré qui
// rougit sur CETTE mutation précise.
const BLOC_GUARDS_D2_ORIGINE =
  '"guards": {\n' +
  '    "specOnMain": true,                        // Etape 3.5 : ticket+statut mature sur main du repo cible\n' +
  '    "statusGate": "ok",                        // "ok" | "wip" | "already-shipped" | "not-matured" | "parked"\n' +
  '    "worktreePathFree": true,                  // Etape 4.5 : chemin libre\n' +
  '    "worktreeUnderTarget": false               // true = REFUS (worktree sous le repo cible)\n' +
  '  }';

// Table PARTAGÉE, multi-amendeurs : chaque entrée porte son PROPRE `id`
// (l'amendeur qui l'a signalée) et son PROPRE `specRenvoi` (la spec vers
// laquelle son bandeau renvoie) — ce n'est plus un mécanisme mono-amendeur
// câblé sur SKILL-106. Un futur amendeur d'une section du contrat de
// `preflight.mjs` ajoute son entrée ICI (avec son `id`/`specRenvoi` à lui),
// pas un `describe` séparé qui recopierait les trois assertions génériques
// (finding 2, gate de reprise SKILL-86).
//
// Les quatre premiers points sont ceux amendés par SKILL-106 (§ D4,
// specs/skill-106.md), le cinquième par SKILL-85 (§ D1/D2, specs/skill-86.md).
// Chacun est borné par l'ancre littérale de son ouverture et l'ancre littérale
// du point suivant (ou de la section suivante). `startAnchor` DOIT couvrir
// tout ce que `corpsIntact` doit pouvoir voir disparaître sous une mutation —
// pas seulement la dernière ligne du point (gate de reprise, finding 3).
const POINTS = [
  {
    nom: 'specs/skill-13.md § D2 — bloc `guards` (quatre champs d\'origine)',
    fichier: SKILL_13_FILE,
    id: ID_106,
    specRenvoi: SPEC_106,
    startAnchor: '"guards": {',
    endAnchor: '## D3 — Fonctions exportées',
    corpsIntact: (tranche) => tranche.includes(BLOC_GUARDS_D2_ORIGINE),
  },
  {
    nom: "specs/skill-13.md § D3 — puce `main(argv)` (cas (a)…(d))",
    fichier: SKILL_13_FILE,
    id: ID_106,
    specRenvoi: SPEC_106,
    startAnchor: "- **`main(argv)`** (CLI)",
    endAnchor: '## D4 — Rewiring du skill',
    corpsIntact: (tranche) => /\(d\) `--repo` invalide → erreur\./.test(tranche),
  },
  {
    nom: 'specs/skill-13.md § D4 — puce Étape 4.5 (`worktreeUnderTarget`/`worktreePathFree`)',
    fichier: SKILL_13_FILE,
    id: ID_106,
    specRenvoi: SPEC_106,
    startAnchor: '- Étape 4.5 : `worktreePath`/`branch` lus du JSON',
    endAnchor: '⛔ **Hors du rewiring**',
    corpsIntact: (tranche) => /`worktreeUnderTarget`\/`worktreePathFree` lues de `guards`/.test(tranche),
  },
  {
    nom: 'specs/skill-85.md § D2 — clause « continue de refuser un chemin occupé »',
    fichier: SKILL_85_FILE,
    id: ID_106,
    specRenvoi: SPEC_106,
    startAnchor: 'Ce que (d) coûte à retirer',
    endAnchor: '### D3 — Compatibilité',
    corpsIntact: (tranche) => /guards\.worktreePathFree.* continue de refuser un chemin occupé/.test(tranche),
  },
  {
    nom: "specs/skill-13.md § D3 — puce `deriveWorktreePath(targetRoot, id)` (cas (a)…(d))",
    fichier: SKILL_13_FILE,
    id: ID_85,
    specRenvoi: SPEC_85,
    startAnchor: "- **`deriveWorktreePath(targetRoot, id)`**",
    endAnchor: "- **`checkSpecOnMain(targetRoot, specPath)`**",
    // Locution enroulée sur deux lignes dans la prose source (finding 5,
    // gate SKILL-107) : comparaison en sous-chaîne exacte APRÈS `platir`, pas
    // une regex tolérante sur la tranche brute.
    // ⚠️ Deux sous-chaînes distinctes vérifiées séparément (finding 1, gate de
    // reprise SKILL-86) : la locution des cas (c)…(d) NE couvre PAS la ligne
    // « Convention `$HOME/claude-config-wt/<id-minuscule>` **hors**
    // arborescence cible » qui ouvre la puce — sans elle, une mutation qui ne
    // réécrit QUE cette ligne (`$HOME/<slug>-wt`) passait inaperçue.
    // ⚠️ Ne PAS tester la présence de `claude-config-wt` sur la tranche
    // entière : le bandeau lui-même la cite (« la racine n'est plus
    // `$HOME/claude-config-wt/` en dur »), donc une telle assertion resterait
    // vraie par construction même après réécriture de la ligne d'origine.
    // La sous-chaîne vérifiée ici est celle de la ligne D'ORIGINE, absente du
    // texte du bandeau.
    corpsIntact: (tranche) => {
      const plat = platir(tranche);
      return (
        plat.includes(
          '(c) suffixe = ID **en minuscules** ; (d) racine des worktrees lue sur un worktree ' +
            'hors-arborescence **existant** du repo cible si présent, sinon convention par défaut.'
        ) &&
        plat.includes(
          'Convention `$HOME/claude-config-wt/<id-minuscule>` **hors** arborescence cible'
        )
      );
    },
  },
];

describe('Bandeaux d\'amendement du contrat de preflight.mjs sur les specs livrées (table POINTS, multi-amendeurs)', () => {
  const contenus = {
    [SKILL_13_FILE]: readNormalized(REPO_ROOT, SKILL_13_FILE),
    [SKILL_85_FILE]: readNormalized(REPO_ROOT, SKILL_85_FILE),
  };

  // Un `it` par point (pas une assertion pour tous) : le message dit
  // PRÉCISÉMENT lequel manque. Chaque point porte son PROPRE `id` : ce n'est
  // plus câblé sur un seul amendeur (finding 2, gate de reprise SKILL-86).
  // ⚠️ Mutation-témoin : n'en poser que trois sur les quatre de SKILL-106 →
  // rouge, et le message dit lequel manque.
  // ⚠️ Mutation-témoin : poser le bandeau en tête de `## D4` au lieu de la
  // puce → rouge (l'ancre de début est la puce elle-même, pas le titre de
  // section).
  it.each(POINTS)('$nom : porte le bandeau « Amendée par [[$id]] », adjacent', (point) => {
    const contenu = contenus[point.fichier];
    const tranche = sectionEntre(contenu, point.startAnchor, point.endAnchor, point.fichier);
    expect(
      portesLeBandeauDe(tranche, point.id),
      `${point.fichier} : le point "${point.nom}" ne porte pas le bandeau « ${texteBandeau(point.id)} » ` +
        `de manière ADJACENTE (entre son ancre d'ouverture et l'ancre suivante).`
    ).toBe(true);
  });

  // Le corps d'origine reste lisible tel quel — une spec livrée est un
  // compte rendu daté (§ D4, specs/skill-106.md).
  // ⚠️ Mutation-témoin : corriger l'une des sections sur place → rouge.
  it.each(POINTS)('$nom : le corps d\'origine reste lisible tel quel (non réécrit)', (point) => {
    const contenu = contenus[point.fichier];
    const tranche = sectionEntre(contenu, point.startAnchor, point.endAnchor, point.fichier);
    expect(
      point.corpsIntact(tranche),
      `${point.fichier} : le point "${point.nom}" a été réécrit — le corps d'origine ` +
        `n'est plus reconnaissable tel quel.`
    ).toBe(true);
  });

  // Chaque bandeau renvoie vers la spec de son amendeur (`point.specRenvoi`).
  // ⚠️ Mutation-témoin : un bandeau sans renvoi → rouge.
  it.each(POINTS)('$nom : le bandeau renvoie vers $specRenvoi', (point) => {
    const contenu = contenus[point.fichier];
    const tranche = sectionEntre(contenu, point.startAnchor, point.endAnchor, point.fichier);
    expect(
      portesLeBandeauDe(tranche, point.id),
      `${point.fichier} : bandeau absent pour "${point.nom}".`
    ).toBe(true);
    const debutBandeau = tranche.indexOf(texteBandeau(point.id));
    const apresBandeau = tranche.slice(debutBandeau);
    expect(
      apresBandeau,
      `${point.fichier} : le bandeau de "${point.nom}" ne renvoie pas vers ${point.specRenvoi}.`
    ).toContain(point.specRenvoi);
  });

  // La déixis n'est pas inversée (SKILL-50, mode-criterion-coherence.test.js:163).
  // ⚠️ Mutation-témoin : écrire la forme inversée → rouge.
  it("ni specs/skill-13.md ni specs/skill-85.md ne contiennent la déixis inversée « Ce ticket amende [[SKILL-106]] »", () => {
    expect(contenus[SKILL_13_FILE]).not.toContain('Ce ticket amende [[SKILL-106]]');
    expect(contenus[SKILL_85_FILE]).not.toContain('Ce ticket amende [[SKILL-106]]');
  });

  // Idem pour SKILL-85, l'amendeur du cinquième point (SKILL-86).
  // ⚠️ Mutation-témoin : écrire la forme inversée → rouge.
  it("specs/skill-13.md ne contient pas la déixis inversée « Ce ticket amende [[SKILL-85]] »", () => {
    expect(contenus[SKILL_13_FILE]).not.toContain('Ce ticket amende [[SKILL-85]]');
  });
});

// ============================================================================
// SKILL-107 — le § D1 de specs/skill-85.md (chaîne de trois règles du slug +
// énumération des valeurs inutilisables) reçoit lui aussi son bandeau
// d'amendement, ADJACENT au point amendé (§ D3, specs/skill-107.md).
// ============================================================================

const ID_107 = 'SKILL-107';
const BANDEAU_107 = texteBandeau(ID_107);

const POINT_107 = {
  nom: 'specs/skill-85.md § D1 — chaîne de trois règles + énumération des valeurs inutilisables',
  fichier: SKILL_85_FILE,
  startAnchor: '`<slug>` se résout par une chaîne de trois règles',
  endAnchor: '⚠️ **Pourquoi le distant AVANT le basename',
  // `platir` (SKILL-94) APLATIT les blancs avant l'assertion : la locution
  // observée est enroulée à ~78 colonnes dans la prose source, et un simple
  // reflow futur (ajout de mots à la ligne précédente) déplacerait le saut de
  // ligne sans rien changer au sens — une regex appliquée à la tranche BRUTE
  // romprait sur ce reflow (finding de revue SKILL-107).
  corpsIntact: (tranche) =>
    /vaut `\.` ou `\.\.`, ou contient un séparateur de chemin \(`\/` ou `\\`\)\./.test(
      platir(tranche)
    ),
};

describe('SKILL-107 — bandeau du § D1 (chaîne de règles du slug) sur specs/skill-85.md', () => {
  const contenu = readNormalized(REPO_ROOT, POINT_107.fichier);

  // ⚠️ Mutation-témoin : retirer le bandeau → rouge.
  // ⚠️ Mutation-témoin : le poser en tête de `## Correction attendue` au lieu
  // du point amendé → rouge (l'ancre de début est le point lui-même).
  it(`${POINT_107.nom} : porte le bandeau « ${BANDEAU_107} », adjacent`, () => {
    const tranche = sectionEntre(contenu, POINT_107.startAnchor, POINT_107.endAnchor, POINT_107.fichier);
    expect(
      portesLeBandeauDe(tranche, ID_107),
      `${POINT_107.fichier} : le point "${POINT_107.nom}" ne porte pas le bandeau « ${BANDEAU_107} » ` +
        `de manière ADJACENTE (entre son ancre d'ouverture et l'ancre suivante).`
    ).toBe(true);
  });

  // Le corps d'origine reste lisible tel quel — une spec livrée est un
  // compte rendu daté.
  // ⚠️ Mutation-témoin : corriger l'énumération sur place → rouge.
  it(`${POINT_107.nom} : le corps d'origine reste lisible tel quel (non réécrit)`, () => {
    const tranche = sectionEntre(contenu, POINT_107.startAnchor, POINT_107.endAnchor, POINT_107.fichier);
    expect(
      POINT_107.corpsIntact(tranche),
      `${POINT_107.fichier} : le point "${POINT_107.nom}" a été réécrit — le corps d'origine ` +
        `n'est plus reconnaissable tel quel.`
    ).toBe(true);
  });

  // Le bandeau renvoie vers specs/skill-107.md.
  // ⚠️ Mutation-témoin : un bandeau sans renvoi → rouge.
  it(`${POINT_107.nom} : le bandeau renvoie vers specs/skill-107.md`, () => {
    const tranche = sectionEntre(contenu, POINT_107.startAnchor, POINT_107.endAnchor, POINT_107.fichier);
    expect(
      portesLeBandeauDe(tranche, ID_107),
      `${POINT_107.fichier} : bandeau absent pour "${POINT_107.nom}".`
    ).toBe(true);
    const debutBandeau = tranche.indexOf(BANDEAU_107);
    const apresBandeau = tranche.slice(debutBandeau);
    expect(
      apresBandeau,
      `${POINT_107.fichier} : le bandeau de "${POINT_107.nom}" ne renvoie pas vers specs/skill-107.md.`
    ).toMatch(/specs\/skill-107\.md/);
  });

  // La déixis n'est pas inversée.
  // ⚠️ Mutation-témoin : écrire la forme inversée → rouge.
  it("specs/skill-85.md ne contient pas la déixis inversée « Ce ticket amende [[SKILL-107]] »", () => {
    expect(contenu).not.toContain('Ce ticket amende [[SKILL-107]]');
  });
});

// ============================================================================
// SKILL-86 — la puce `deriveWorktreePath` de specs/skill-13.md § D3 reçoit elle
// aussi son bandeau d'amendement, ADJACENT au point amendé (§ D1/D2,
// specs/skill-86.md), sans réécrire le corps de la puce ni nommer SKILL-107
// (D2, ⛔ — signalé chez specs/skill-85.md § D1, posé par SKILL-107 lui-même).
//
// Les trois assertions génériques (bandeau adjacent, corps intact, renvoi)
// sont déjà couvertes par la table `POINTS` ci-dessus (dernière entrée,
// `id: ID_85`) : pas de troisième copie ici (finding 2, gate de reprise
// SKILL-86). Ne restent, sous ce titre, que les deux assertions SPÉCIFIQUES à
// ce point (absence de SKILL-107, non-régression de l'ancre SKILL-44).
// ============================================================================

const POINT_85 = POINTS.find((p) => p.id === ID_85);

describe('SKILL-86 — bandeau de la puce `deriveWorktreePath` sur specs/skill-13.md — assertions spécifiques', () => {
  const contenu13 = readNormalized(REPO_ROOT, POINT_85.fichier);

  // ⛔ D2 : le bandeau ne nomme PAS SKILL-107 — sa signalisation vit chez
  // specs/skill-85.md § D1, posée par SKILL-107 lui-même (specs/skill-86.md,
  // § D2, ⛔).
  it("le bandeau de la puce `deriveWorktreePath` ne nomme pas [[SKILL-107]]", () => {
    const tranche = sectionEntre(contenu13, POINT_85.startAnchor, POINT_85.endAnchor, POINT_85.fichier);
    expect(tranche).not.toContain('[[SKILL-107]]');
  });

  // Non-régression : l'`END_ANCHOR` de `mode-criterion-coherence.test.js`
  // (la ligne d'ouverture de CETTE puce) borne toujours, pour la note de
  // SKILL-44, une tranche qui ne contient PAS le bandeau de SKILL-85 —
  // seul oracle réel que l'insertion n'a rien cassé côté SKILL-44/SKILL-50.
  // ⚠️ Cette assertion vit ICI (sujet : le contrat de `preflight.mjs`), pas
  // dans `mode-criterion-coherence.test.js`, dont aucune ligne ne change.
  // ⚠️ Mutation-témoin : insérer le bandeau AVANT la puce `deriveWorktreePath`
  // → il entre dans la tranche de SKILL-44 → rouge.
  it("l'END_ANCHOR de mode-criterion-coherence.test.js (ouverture de la puce `deriveWorktreePath`) borne une tranche SKILL-44 sans le bandeau SKILL-85", () => {
    const startIdx = contenu13.indexOf("- **`determineMode(targetRoot, sessionRoot)`**");
    expect(startIdx, 'La D3 de determineMode est introuvable.').toBeGreaterThan(-1);
    const note = extractBetween(
      contenu13.slice(startIdx),
      'Amendée par [[SKILL-44]]',
      POINT_85.startAnchor
    );
    expect(note, "la tranche SKILL-44 → deriveWorktreePath est introuvable.").not.toBeNull();
    expect(note).not.toContain(BANDEAU_85);
  });
});
