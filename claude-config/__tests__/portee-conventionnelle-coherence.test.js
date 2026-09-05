// SKILL-104 — la règle de PORTÉE CONVENTIONNELLE : un geste que le dépôt
// prescrit sans latitude n'est pas un item de § Portée.
//
// Contexte (specs/skill-104.md § Problème) : le 2026-09-02, deux implémenteurs
// placés devant un § Portée fermé et un fichier de plus ont fait deux gestes
// opposés — l'un a escaladé (SKILL-98), l'autre a élargi sans le dire
// (SKILL-102) — et aucun critère écrit ne permettait de dire lequel des deux
// cas était lequel. Ce ticket livre le critère, pas l'énoncé seul.
//
// ⚠️ Nom du fichier (D4) : le sujet est « la règle de portée conventionnelle »,
// jamais `SKILL-104`. Le suffixe `-coherence.test.js` est OBLIGATOIRE — `T1` de
// `__tests__/test-selection-coherence.test.js` exige que tout fichier de test du
// disque soit vu par le glob `__tests__/**/*-coherence.test.{js,ts}` que joue
// l'Étape 0 de `/send`, ou soit déclaré en exception motivée. Le § Tests de la
// spec (cas 7) DÉCLARE attendre cette assertion-là ; elle EXISTE DÉJÀ chez T1 et
// n'est donc PAS réécrite ici — la renommer sans le suffixe fait rougir T1.
//
// ⚠️ NUMÉROTATION DES `describe` (gate de revue, finding 4) : seuls les six
// premiers sont indexés sur les cas 1 à 6 du § Tests de la spec. Le cas 7 du
// § Tests (« le fichier neuf est vu par le glob de /send ») N'A PAS de `describe`
// ici — il est tenu par T1, cf. ci-dessus. Les deux blocs suivants portent donc
// un LIBELLÉ, jamais un numéro : les indexer 7 et 8 ferait porter le même numéro
// à deux exigences distinctes du même ticket, et renverrait un lecteur en échec
// vers le mauvais cas du § Tests.
//
// ⚠️ D3 du dépôt : toute liste de contrôle (marqueurs, porteurs, ancres) est
// DÉCLARÉE ICI, jamais importée de ce qu'elle contrôle — un test qui lit la
// constante qu'il contrôle se valide contre lui-même.
//
// ⚠️ Chaque assertion porte en commentaire la MUTATION-TÉMOIN qui doit la faire
// rougir (convention de ce repo).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { readNormalized, platir, hasSectionHeading } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const REGLE = 'rules/maturation.md';
const IMPL_SAME = 'prompts/impl-same.md';
const IMPL_CROSS = 'prompts/impl-cross.md';
const REVIEWER = 'prompts/reviewer.md';

// Les TROIS audiences de D1 — celui qui implémente (deux modes d'emploi) et
// celui qui relit. Le relecteur est l'audience que le § Décision avait oubliée,
// et c'est pourtant lui qui a levé le finding fondateur.
const PORTEURS_PROJECTION = [IMPL_SAME, IMPL_CROSS, REVIEWER];

const readNorm = (rel) => readNormalized(REPO_ROOT, rel);

// --- Délimitation du bloc projeté ------------------------------------------
//
// Marqueurs-commentaires, sur leur PROPRE ligne (même convention que
// `<!-- APPEL:aggregator -->` dans `commands/`), et non une ancre de prose : la
// comparaison du cas 5 est une ÉGALITÉ, pas une recherche de sous-chaîne, donc
// elle a besoin de bornes que le reflow éditorial ne déplace pas.
//
// ⚠️ Le marqueur est cherché sur sa ligne `trim()`ée, jamais par `indexOf` : ce
// fichier-ci cite les deux marqueurs dans sa propre prose, et un `indexOf`
// appliqué à un porteur qui les citerait de même s'arrêterait sur la citation.
const MARQUEUR_DEBUT = '<!-- PROJECTION:portee-conventionnelle -->';
const MARQUEUR_FIN = '<!-- /PROJECTION:portee-conventionnelle -->';

function lignesMarqueur(rel, marqueur) {
  const trouvees = [];
  readNorm(rel)
    .split('\n')
    .forEach((l, i) => {
      if (l.trim() === marqueur) trouvees.push(i);
    });
  return trouvees;
}

// Les bornes du bloc, avec la garde d'UNICITÉ (gate de revue, finding 7).
//
// ⛔ Un `findIndex` seul ne borne que la PREMIÈRE paire de marqueurs : une
// seconde copie du bloc dans le même fichier ne serait alors ni comparée, ni
// interdite, ni signalée — deux copies d'un même texte divergeraient en silence
// dans un SEUL fichier, exactement le risque que le cas 5 déclare fermer entre
// fichiers. On exige donc EXACTEMENT une ouverture et EXACTEMENT une fermeture.
//
// ⚠️ Mutation : coller une seconde copie du bloc ailleurs dans `impl-same.md`
// (par exemple sous `## Discipline SDD`) → rouge. Avec l'ancienne version à
// `findIndex` : vert.
function bornesBloc(rel) {
  const ouvertures = lignesMarqueur(rel, MARQUEUR_DEBUT);
  const fermetures = lignesMarqueur(rel, MARQUEUR_FIN);
  expect(
    ouvertures.length,
    `${rel} : ${ouvertures.length} marqueur(s) d'ouverture "${MARQUEUR_DEBUT}" ` +
      `— il en faut EXACTEMENT un. Zéro : le bloc de portée conventionnelle a ` +
      `disparu. Deux ou plus : seule la première copie serait comparée au texte ` +
      `canonique, les suivantes divergeraient sans rougir.`
  ).toBe(1);
  expect(
    fermetures.length,
    `${rel} : ${fermetures.length} marqueur(s) de fermeture "${MARQUEUR_FIN}" — ` +
      `il en faut EXACTEMENT un.`
  ).toBe(1);
  expect(
    fermetures[0],
    `${rel} : le marqueur de fermeture précède son ouverture — bloc jamais ` +
      `refermé, l'extraction n'aurait rien de borné.`
  ).toBeGreaterThan(ouvertures[0]);
  return { debut: ouvertures[0], fin: fermetures[0] };
}

function blocProjection(rel) {
  const { debut, fin } = bornesBloc(rel);
  const corps = readNorm(rel).split('\n').slice(debut + 1, fin).join('\n').trim();
  // ⛔ Jamais une chaîne vide rendue en silence : elle passerait trivialement
  // toutes les assertions de contenu, et l'égalité du cas 5 serait vraie entre
  // quatre blocs vides.
  expect(
    corps.length,
    `${rel} : le bloc de portée conventionnelle est VIDE entre ses deux marqueurs.`
  ).toBeGreaterThan(0);
  return corps;
}

// La prose PROPRE au porteur : du marqueur de fermeture jusqu'au prochain titre
// `## `. C'est là que vivent l'attribution du domicile canonique, le
// rattachement à l'axe 1 et la désambiguïsation des deux « bandeaux ».
//
// ⛔ Bornée ainsi, et NON au fichier entier privé de son bloc (gate de revue,
// findings 2 et 9). Deux raisons, chacune vécue :
//   - une recherche sur tout le fichier est servie par de la prose ANTÉRIEURE au
//     ticket — `prompts/reviewer.md` dit « étiqueté « axe 1 » par un relecteur »
//     ~40 lignes plus haut, ce qui rendait `/axe 1/i` trivialement vrai et
//     l'assertion du cas 6 incapable de rougir ;
//   - la version précédente retombait EN SILENCE sur le fichier entier quand un
//     marqueur manquait (`return readNorm(rel)`), c'est-à-dire codait l'inverse
//     de ce que son propre commentaire interdisait. Ici, pas de repli : la garde
//     d'unicité de `bornesBloc` rougit d'abord.
function proseApresBloc(rel) {
  const { fin } = bornesBloc(rel);
  const lignes = readNorm(rel).split('\n');
  const out = [];
  for (let i = fin + 1; i < lignes.length; i++) {
    if (/^##\s/.test(lignes[i])) break;
    out.push(lignes[i]);
  }
  const prose = out.join('\n').trim();
  expect(
    prose.length,
    `${rel} : aucune prose entre le marqueur de fermeture et le titre "## " ` +
      `suivant — le porteur ne dit plus rien de la projection qu'il porte, et ` +
      `les assertions ci-dessous n'auraient RIEN à lire.`
  ).toBeGreaterThan(0);
  return prose;
}

// --- Cas 1 — l'énoncé existe dans son domicile canonique --------------------

describe('SKILL-104 — 1. L’énoncé vit dans son domicile canonique', () => {
  // ⚠️ Mutation : retirer la section de `rules/maturation.md` → rouge.
  it(`${REGLE} porte la section "### Portée conventionnelle"`, () => {
    expect(
      hasSectionHeading(readNorm(REGLE), '### Portée conventionnelle'),
      `${REGLE} ne porte pas de section "### Portée conventionnelle" — la règle ` +
        `a perdu son domicile canonique (D1/D5). Rappel D5 : une SECTION propre, ` +
        `jamais un huitième item de la liste numérotée de "### Méthode de ` +
        `maturation" (qui casserait L1.4c, L1.4d et la plage « 1 à N »).`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer l'énoncé du bloc canonique → rouge.
  it(`${REGLE} énonce qu’un geste prescrit sans latitude n’est pas une décision de portée`, () => {
    const bloc = platir(blocProjection(REGLE));
    expect(
      bloc.includes('prescrit sans latitude'),
      `${REGLE} : le bloc canonique ne dit plus « prescrit sans latitude » — ` +
        `l'énoncé a disparu de son domicile.`
    ).toBe(true);
    expect(
      bloc.includes("n'est pas une décision de portée"),
      `${REGLE} : le bloc canonique ne conclut plus « n'est pas une décision de ` +
        `portée » — il ne dit plus ce qu'un § Portée fermé n'a pas à énumérer.`
    ).toBe(true);
  });
});

// --- Cas 2 — les TROIS conditions du critère, une assertion par condition ----
//
// ⛔ Trois `it()` distincts, jamais une assertion unique : c'est leur
// CONJONCTION qui borne la règle, et une assertion unique en laisserait
// disparaître une sans rougir. La condition 3 est celle qui exclut le
// rehaussement de plafond — la retirer rouvrirait exactement ce que
// `SKILL-94 · E1 (finding 5)` avait fermé à raison.
describe('SKILL-104 — 2. Le critère porte ses TROIS conditions cumulatives', () => {
  const CONDITIONS = [
    [
      '1 — convention nommée et citable par l’exécutant',
      ['convention nommée', "citable par l'exécutant"],
      `sans elle, « le dépôt le prescrit quelque part » suffirait, y compris ` +
        `dans un fichier que l'exécutant ne lit pas.`,
    ],
    [
      '2 — déclencheur déterminé',
      ['déclencheur', 'déterminé'],
      `sans elle, une convention au déclenchement flou passerait pour prescrite.`,
    ],
    [
      '3 — aucune alternative légitime',
      ['aucune alternative légitime'],
      `⛔ c'est ELLE qui exclut le rehaussement de plafond (scinder, réduire, ` +
        `escalader sont des alternatives réelles) : la retirer rouvre SKILL-94.`,
    ],
  ];

  // ⚠️ Mutation, une par entrée : supprimer cette condition du bloc canonique
  // → rouge, celle-là seule.
  for (const [label, ancres, pourquoi] of CONDITIONS) {
    it(`${REGLE} : le critère écrit la condition ${label}`, () => {
      const bloc = platir(blocProjection(REGLE));
      for (const ancre of ancres) {
        expect(
          bloc.includes(ancre),
          `${REGLE} : la condition ${label} ne dit plus « ${ancre} » — ${pourquoi}`
        ).toBe(true);
      }
    });
  }

  // ⚠️ Mutation : écrire les trois conditions en alternatives (« l'une des
  // trois ») → rouge. Trois conditions dont une suffirait ne borneraient rien.
  it(`${REGLE} : les trois conditions sont déclarées CUMULATIVES`, () => {
    expect(
      /cumulatives/i.test(platir(blocProjection(REGLE))),
      `${REGLE} : le bloc canonique ne dit plus que les trois conditions sont ` +
        `cumulatives — une seule suffirait, et la formulation large (« tout ` +
        `geste conventionnel échappe au § Portée ») serait de retour.`
    ).toBe(true);
  });
});

// --- Cas 3 — les exclusions nommées ----------------------------------------
//
// Le § Tests de la spec en exige DEUX — les deux cas RÉELS du dépôt :
// `SKILL-94 · E1 (finding 5)` (un fichier de trop, DEUX constantes rehaussées)
// et `SKILL-98 · E1 (finding 10)` (une phrase reformulée dans un cinquième
// fichier, escalade justifiée). Le tableau de D2 en écrit QUATRE, sous un
// « ⛔ Ce qui reste DEHORS, et doit être écrit comme tel » : les deux autres
// échouent à la CONDITION 1. Les quatre sont donc gardées ici (gate de revue,
// finding 5) — une liste d'exclusions qui ne recenserait que des échecs de
// condition 3 laisserait conclure, à tort, qu'un geste sans convention nommée
// mais sans alternative est couvert par la règle.
describe('SKILL-104 — 3. Les exclusions nommées restent DANS le § Portée', () => {
  const EXCLUSIONS = [
    [
      'rehausser un plafond de taille (condition 3)',
      'rehausser un plafond de taille',
      `cas SKILL-94 · E1 (finding 5) — des alternatives légitimes existent ` +
        `(scinder le fichier, réduire le contenu, escalader).`,
    ],
    [
      'reformuler une clause d’une spec livrée (condition 3)',
      'reformuler une clause',
      `cas SKILL-98 · E1 (finding 10) — des issues concurrentes existent ` +
        `(corriger hors ticket, élargir la portée, amender les clauses).`,
    ],
    [
      'toucher un fichier qu’aucune convention ne désigne (condition 1)',
      "toucher un fichier qu'aucune convention nommée ne désigne",
      `troisième ligne du tableau de D2 — sans elle, un geste que le dépôt ` +
        `impose « de fait » mais que rien ne prescrit par écrit passerait le ` +
        `critère sur la seule condition 3.`,
    ],
    [
      'appliquer une convention illisible pour l’exécutant (condition 1)',
      "appliquer une convention que l'exécutant ne peut pas lire",
      `quatrième ligne du tableau de D2 — c'est la raison d'être de la ` +
        `projection elle-même (D1) : une convention qu'on ne peut pas citer ne ` +
        `qualifie pas.`,
    ],
  ];

  // ⚠️ Mutations : retirer l'une QUELCONQUE des quatre lignes d'exclusion →
  // rouge, une par ligne (quatre `it()` distincts, jamais une assertion unique).
  for (const [label, ancre, pourquoi] of EXCLUSIONS) {
    it(`${REGLE} : « ${label} » reste un item de § Portée`, () => {
      expect(
        platir(blocProjection(REGLE)).includes(ancre),
        `${REGLE} : le bloc canonique ne nomme plus l'exclusion « ${ancre} » — ` +
          `${pourquoi}`
      ).toBe(true);
    });
  }

  // ⚠️ Mutation : transformer les exclusions en simples exemples (retirer
  // « Restent dans le § Portée ») → rouge. Une exclusion qui ne dit pas où le
  // geste retombe n'exclut rien.
  it(`${REGLE} : les exclusions disent que ces gestes RESTENT dans le § Portée`, () => {
    expect(
      /restent \*\*dans\*\* le § portée/i.test(platir(blocProjection(REGLE))),
      `${REGLE} : le bloc canonique n'écrit plus où retombent les gestes exclus ` +
        `— « Restent **dans** le § Portée » a disparu.`
    ).toBe(true);
  });
});

// --- Cas 4 — les TROIS audiences portent leur PROJECTION ---------------------
//
// ⛔ SIX `it()`, pas quatre : trois fichiers × deux assertions (le fichier porte
// le bloc projeté, ET il nomme `rules/maturation.md` comme domicile canonique).
// Avec une seule assertion de renvoi pour trois fichiers, en retirer un des deux
// autres laisserait la suite verte — le défaut même que le cas 2 invoque.
describe('SKILL-104 — 4. Les trois audiences portent la projection', () => {
  for (const rel of PORTEURS_PROJECTION) {
    // ⚠️ Mutations : retirer la projection de `prompts/reviewer.md` (l'audience
    // que le § Décision avait oubliée) → rouge ; retirer celle de
    // `prompts/impl-cross.md` en la gardant dans les deux autres → rouge.
    it(`${rel} porte le bloc projeté, avec le critère`, () => {
      const bloc = platir(blocProjection(rel));
      expect(
        bloc.includes('prescrit sans latitude'),
        `${rel} : le bloc projeté ne porte plus l'énoncé.`
      ).toBe(true);
      expect(
        bloc.includes('aucune alternative légitime'),
        `${rel} : le bloc projeté ne porte plus la condition 3 — un pointeur ` +
          `SANS le critère, exactement ce que D1 refuse (un renvoi ne livre le ` +
          `critère à personne : les deux prompts et le relecteur ont des listes ` +
          `de lecture FERMÉES qui n'incluent pas ${REGLE}).`
      ).toBe(true);
    });

    // ⚠️ Mutation : retirer la ligne d'attribution d'UN SEUL des trois fichiers
    // → rouge, celui-là seul. Cherchée dans la prose qui SUIT le bloc : dans le
    // bloc, elle serait identique partout et n'attesterait rien du porteur.
    it(`${rel} nomme ${REGLE} comme domicile canonique, dans le dépôt claude-config`, () => {
      const prose = platir(proseApresBloc(rel));
      expect(
        prose.includes(REGLE),
        `${rel} : la prose qui suit le bloc ne nomme plus ${REGLE} — le lecteur ` +
          `ne sait plus que ce bloc est une PROJECTION, ni où vit l'énoncé ` +
          `canonique qu'un amendement devrait modifier.`
      ).toBe(true);
      // ⛔ Le chemin est RELATIF, et ces trois fichiers sont lus par des agents
      // qui travaillent dans le worktree d'un AUTRE dépôt (gate de revue,
      // findings 3 et 10) : `<worktree>/rules/maturation.md` n'existe pas.
      // Le porteur doit donc nommer le dépôt et couper court à la recherche.
      expect(
        prose.includes('claude-config'),
        `${rel} : la prose qui suit le bloc cite ${REGLE} sans nommer le dépôt ` +
          `où ce fichier vit. En cross-repo, l'agent le cherche sous son propre ` +
          `worktree et ne l'y trouve pas — c'est le constat 2 de D1 (« un chemin ` +
          `relatif n'y résout rien »), reconduit dans la projection elle-même.`
      ).toBe(true);
      expect(
        /pas dans ton worktree/i.test(prose),
        `${rel} : la prose qui suit le bloc n'écarte plus la recherche du ` +
          `fichier canonique. Sans elle, l'agent cross-repo part le chercher, ` +
          `échoue, et ne sait pas si la projection qu'on lui donne fait autorité.`
      ).toBe(true);
    });
  }
});

// --- Cas 5 — la projection est IDENTIQUE à son original ---------------------
//
// Sur le modèle de L1.4d (SKILL-100, `commands-shape-coherence.test.js`) : le
// texte est extrait de son domicile canonique et comparé À CE QUE PORTENT les
// trois `prompts/` — `toEqual`, jamais une recherche de sous-chaîne. C'est ce
// qui remplace l'interdit de recopie : la divergence est fermée MÉCANIQUEMENT,
// pas par une interdiction que personne ne peut tenir.
//
// ⛔ Volontairement PAS d'assertion d'absence (« les trois conditions
// n'apparaissent que dans rules/maturation.md ») : elle n'est pas écrivable de
// façon déterministe — sa chaîne de recherche serait inventée après coup, donc
// validée contre elle-même — et sa portée n'étant pas bornée, elle rougirait sur
// `commands/mature.md` § Étape 5, que le § Hors-scope interdit de toucher
// (specs/skill-104.md § Tests, cas 5).
describe('SKILL-104 — 5. La projection est identique à son original', () => {
  // ⚠️ Mutation : reformuler la projection dans UN SEUL des trois fichiers
  // (ex. « prescrit sans marge de choix ») → rouge. C'est ce test, et non un
  // `grep` de vocabulaire, qui porte le contrôle « aucune divergence entre les
  // porteurs » (§ Vérification 5) : un `grep` de formulation littérale rendrait
  // zéro ligne sur une reformulation correcte, et l'absence de sortie ressemble
  // exactement à « aucune divergence ».
  for (const rel of PORTEURS_PROJECTION) {
    it(`${rel} : le bloc projeté est MOT POUR MOT celui de ${REGLE}`, () => {
      const canonique = blocProjection(REGLE);
      const projete = blocProjection(rel);
      expect(
        projete,
        `${rel} : le bloc projeté diverge du texte canonique de ${REGLE}. Deux ` +
          `copies d'un même texte divergent en silence — c'est le risque que ce ` +
          `test existe pour attraper. Amende ${REGLE} d'abord, puis reporte le ` +
          `texte À L'IDENTIQUE dans les trois porteurs.`
      ).toEqual(canonique);
    });
  }
});

// --- Cas 6 — chez le relecteur, l'exception est BORNÉE à son axe 1 -----------

describe('SKILL-104 — 6. Chez le relecteur, la règle est rattachée à l’axe 1', () => {
  // ⚠️ Mutation : élargir en « ne signale jamais un fichier hors § Portée » —
  // c'est-à-dire retirer le rattachement à l'axe 1 et la réserve qui le borne
  // → rouge, LES DEUX assertions. L'axe 1 est « Conformité à la spec — ni plus
  // ni moins » : c'est exactement lui qu'un fichier hors § Portée déclenche, et
  // c'est LUI SEUL que cette règle borne.
  //
  // ⛔ Lu sur `proseApresBloc`, pas sur le fichier entier (gate de revue,
  // finding 2) : `prompts/reviewer.md` porte « étiqueté « axe 1 » par un
  // relecteur » dans son § Axes de relecture, AVANT le bloc et depuis
  // SKILL-25 — un `/axe 1/i` non borné était servi par cette ligne-là, donc
  // vert quoi qu'il advienne de la prose neuve. Mutation qui restait verte et
  // qui rougit désormais : réécrire la prose d'après-bloc en « … reste un
  // finding, à rapporter comme tel. » (le rattachement à l'axe disparaît).
  it(`${REVIEWER} : la projection est rattachée à l’axe 1, et à lui seul`, () => {
    const prose = platir(proseApresBloc(REVIEWER));
    expect(
      /axe 1/i.test(prose),
      `${REVIEWER} : la prose qui suit la projection ne nomme plus l'axe 1 — la ` +
        `règle flotte au lieu de borner l'axe qui attrape un fichier hors ` +
        `§ Portée (« Conformité à la spec … ni plus ni moins »).`
    ).toBe(true);
    expect(
      /reste un finding/i.test(prose),
      `${REVIEWER} : la réserve a disparu — un fichier hors § Portée qui ne ` +
        `remplit PAS les trois conditions doit rester un finding d'axe 1. Sans ` +
        `elle, la projection se lit comme une dispense générale de signaler un ` +
        `fichier hors portée, ce qu'elle n'est pas.`
    ).toBe(true);
  });
});

// --- Hors-scope : désambiguïsation des deux « bandeaux » côté implémenteur ---
//
// ⚠️ Pas de numéro (cf. l'en-tête) : cette exigence vient du § Hors-scope de
// specs/skill-104.md, pas de son § Tests. Le bandeau de CHEMIN RENOMMÉ
// (`prompts/impl-*.md` § Discipline SDD, point 1 — SKILL-79 durci par SKILL-89)
// n'est PAS qualifié par le critère : son application suppose un jugement sur ce
// que le renvoi désigne. Deux notions de « bandeau » cohabitent donc dans les
// deux modes d'emploi implémenteur, et la projection DOIT les désambiguïser
// nommément, faute de quoi le lecteur étendra le critère à la mauvaise.
describe('SKILL-104 — Hors-scope : les deux notions de « bandeau » sont désambiguïsées', () => {
  // ⚠️ Mutation : retirer la phrase de désambiguïsation d'UN SEUL des deux
  // modes d'emploi → rouge, celui-là seul.
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    it(`${rel} distingue le bandeau de supersession de celui du chemin renommé`, () => {
      const prose = platir(proseApresBloc(rel));
      // ⛔ Lu APRÈS le bloc, et sur les DEUX notions à la fois : le seul mot
      // « bandeau » serait trivialement vrai (le § Discipline SDD, point 1, en
      // parle depuis SKILL-79), et le seul titre « Discipline SDD » aussi
      // (c'est une section de ce fichier). C'est leur MISE EN REGARD qui
      // désambiguïse, donc c'est elle qu'on assertionne.
      expect(
        prose.includes('bandeau de supersession') &&
          prose.includes('Discipline SDD, point 1'),
        `${rel} : la prose qui suit le bloc ne met plus en regard le bandeau de ` +
          `supersession et celui du § Discipline SDD, point 1 (chemin cité puis ` +
          `renommé) — le lecteur étendra le critère à la mauvaise convention.`
      ).toBe(true);
      expect(
        /suppose un jugement/i.test(prose),
        `${rel} : le motif de l'exclusion a disparu — le bandeau de chemin ` +
          `renommé suppose un JUGEMENT sur ce que le renvoi désigne (SKILL-89), ` +
          `donc échoue à la condition 3 et reste un item de § Portée.`
      ).toBe(true);
    });
  }
});

// --- SKILL-105 (D2a) — « ne s'escalade pas » est PRÉCISÉ, pas retiré ---------
//
// `SKILL-104 · E1 (finding 1)` : la phrase « ne s'escalade pas » laissait un
// finding levé sur un geste de portée conventionnelle SANS aucune cellule de
// disposition, alors que `commands/sdd-run-ticket.md` § Étape 6.6 en impose une
// à toute ligne du registre. Le geste retenu n'ouvre AUCUNE quatrième
// disposition : la phrase gagne trois mots, et l'Étape 6.6 nomme la cellule qui
// existait déjà (`escaladé — E1`).
describe('SKILL-105 — D2a : le bloc canonique précise « au titre de la portée »', () => {
  // ⚠️ Mutation : rétablir « ne s'escalade pas, » nu → rouge.
  //
  // ⛔ PAS d'assertion neuve sur les trois projections : le cas 5 ci-dessus
  // (identité mot pour mot) est le garde de propagation, et il rougit déjà si
  // un exemplaire est oublié. En écrire une seconde ferait deux textes du même
  // contrôle.
  it(`${REGLE} : la phrase dit « ne s’escalade pas **au titre de la portée** »`, () => {
    const bloc = platir(blocProjection(REGLE));
    expect(
      bloc.includes("ne s'escalade pas **au titre de la portée**"),
      `${REGLE} : le bloc canonique ne précise plus que le geste ne s'escalade ` +
        `pas AU TITRE DE LA PORTÉE. Sans ces trois mots, la phrase se lit comme ` +
        `« un finding levé dessus n'a pas de disposition » — ce qui n'a aucune ` +
        `cellule dans l'énuméré fermé de l'Étape 6.6.`
    ).toBe(true);
    expect(
      /ne s'escalade pas, et sa présence/.test(bloc),
      `${REGLE} : l'ANCIENNE forme (« ne s'escalade pas, et sa présence … ») ` +
        `subsiste dans le bloc canonique.`
    ).toBe(false);
  });
});

// --- SKILL-105 (D2c) — la conduite en reprise, chez l'implémenteur SEUL ------
//
// La cellule nommée par D2b s'écrit dans `commands/sdd-run-ticket.md`, que
// l'implémenteur ne lit jamais : sans cette phrase, il applique sa table
// « trois exceptions fermées » et retombe sur « TOUT finding est corrigé »
// (objection 9 du challenge de specs/skill-105.md).
describe('SKILL-105 — D2c : les deux ajouts vivent dans les deux prompts/impl-*.md, et nulle part ailleurs', () => {
  const SONDE_CONDUITE = 'levé malgré tout sur un tel geste';

  // ⚠️ Mutations : retirer la phrase d'UN SEUL des deux modes d'emploi → rouge,
  // celui-là seul ; la placer DANS le bloc projeté → rouge sur le cas 5
  // (identité mot pour mot), puisque `rules/maturation.md` ne la porte pas.
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    it(`${rel} : la conduite en reprise est écrite HORS du bloc projeté`, () => {
      const prose = platir(proseApresBloc(rel));
      expect(
        prose.includes(SONDE_CONDUITE),
        `${rel} : la prose qui suit le bloc ne dit plus ce que devient un ` +
          `finding levé MALGRÉ TOUT sur un geste de portée conventionnelle. ` +
          `Sans elle, l'implémenteur applique sa table « trois exceptions ` +
          `fermées » et le corrige — le défaut que D2b ferme côté orchestrateur.`
      ).toBe(true);
      expect(
        /ligne \*\*E1\*\* de la table de tri/.test(prose),
        `${rel} : la conduite en reprise ne renvoie plus vers la ligne E1 de ` +
          `la table de tri d'en dessous — elle dirait qu'il se passe quelque ` +
          `chose sans dire quoi.`
      ).toBe(true);
    });

    // ⚠️ Mutation : laisser « Deux « bandeaux » cohabitent » → rouge. Avec D3,
    // le bandeau d'AMENDEMENT est une troisième famille : sans ce geste, ce
    // ticket livre le défaut exact de `SKILL-104 · E1 (finding 8)` — une
    // énumération rendue incomplète par le ticket qui l'a rendue incomplète.
    it(`${rel} : l’énumération des « bandeaux » cohabitants compte TROIS familles`, () => {
      const prose = platir(proseApresBloc(rel));
      expect(
        /Trois « bandeaux » cohabitent/.test(prose),
        `${rel} : l'énumération des « bandeaux » ne compte pas TROIS familles.`
      ).toBe(true);
      expect(
        /Deux « bandeaux » cohabitent/.test(prose),
        `${rel} : l'énumération compte encore DEUX « bandeaux » — le bandeau ` +
          `d'amendement (\`⚠️ **Amendée par [[SKILL-NN]]**\`), troisième ` +
          `famille, y manque.`
      ).toBe(false);
      expect(
        prose.includes("bandeau d'**amendement**"),
        `${rel} : la troisième famille n'est pas NOMMÉE — « trois » sans le ` +
          `bandeau d'amendement ne dit pas lequel a été ajouté.`
      ).toBe(true);
    });
  }

  // ⚠️ Mutation : ajouter la conduite en reprise chez le relecteur → rouge.
  // Elle ne s'adresse pas à lui : il ne dispose aucun finding, il en lève.
  it(`${REVIEWER} : la conduite en reprise en est ABSENTE (fichier entier)`, () => {
    expect(
      platir(readNorm(REVIEWER)).includes(SONDE_CONDUITE),
      `${REVIEWER} porte la conduite en reprise de D2c — elle est écrite pour ` +
        `l'implémenteur repris avec des findings, un rôle que le relecteur ` +
        `n'a jamais.`
    ).toBe(false);
  });
});

// --- Non-régression : ne pas fabriquer de faux « titre de contrôle » ---------
//
// ⚠️ Pas de numéro non plus (cf. l'en-tête) : garde neuve, née de la gate de
// revue (finding 6), sans cas correspondant au § Tests de la spec.
//
// `titresDeControle()` de `__tests__/mature-skill-coherence.test.js` (MAT4)
// extrait les titres des contrôles de la méthode en appliquant ce motif au
// fichier ENTIER, pas à la seule section `### Méthode de maturation`. Toute
// ligne « numéro + gras » écrite AILLEURS dans `rules/maturation.md` y entre
// donc comme un contrôle de la méthode — et le jour où `commands/mature.md`
// écrit la même chaîne, MAT4 rougit en accusant une recopie de contrôle pour
// une ligne qui n'est pas un contrôle.
//
// Constaté sur le premier jet de ce ticket : la condition 3, écrite
// `3. **aucune alternative légitime** …`, faisait rendre à `titresDeControle()`
// une septième entrée « aucune alternative légitime ». Réécrite en
// `3. il ne subsiste **aucune alternative légitime** …`, elle n'entre plus.
//
// ⛔ Le motif est RECOPIÉ ici, jamais importé de MAT4 (D3) — un test qui lit la
// constante qu'il contrôle se valide contre lui-même. Ce test ne garde PAS
// l'extraction de MAT4 (elle reste ce qu'elle est, et ce fichier n'est pas
// habilité à la réécrire) : il garde l'OPÉRANDE que ce ticket lui donne.
describe('SKILL-104 — non-régression MAT4 : aucun faux titre de contrôle', () => {
  const MAT4_TITRE_RE = /^\d+\.\s+\*\*(.+?)\*\*/gm;
  const METHODE_HEADING = '### Méthode de maturation';

  // ⚠️ Mutation : réécrire la condition 3 en `3. **aucune alternative légitime**
  // …` (le premier jet de ce ticket) → rouge, avec la ligne fautive nommée.
  it(`${REGLE} : toute ligne « numéro + gras » vit sous "${METHODE_HEADING}"`, () => {
    const raw = readNorm(REGLE);
    const debut = raw.indexOf(METHODE_HEADING);
    expect(
      debut,
      `${REGLE} : "${METHODE_HEADING}" introuvable — ce test n'a RIEN vérifié.`
    ).toBeGreaterThanOrEqual(0);
    const suite = raw.slice(debut + METHODE_HEADING.length);
    const prochainTitre = /^###\s/m.exec(suite);
    const fin = prochainTitre
      ? debut + METHODE_HEADING.length + prochainTitre.index
      : raw.length;

    const dedans = [];
    const dehors = [];
    const re = new RegExp(MAT4_TITRE_RE.source, 'gm');
    let m;
    while ((m = re.exec(raw)) !== null) {
      const ligne = raw.slice(0, m.index).split('\n').length;
      (m.index >= debut && m.index < fin ? dedans : dehors).push(`${ligne}: ${m[1]}`);
    }
    expect(
      dedans.length,
      `${REGLE} : le motif de MAT4 ne matche AUCUNE ligne sous ` +
        `"${METHODE_HEADING}" — ce test n'a RIEN vérifié (l'opérande est vide ` +
        `des deux côtés, donc « rien dehors » est trivialement vrai).`
    ).toBeGreaterThan(0);
    expect(
      dehors,
      `${REGLE} : ligne(s) « numéro + gras » HORS de "${METHODE_HEADING}" : ` +
        `${dehors.join(' | ')}. MAT4 les compte comme des titres de contrôle de ` +
        `la méthode de maturation. Écris la ligne autrement (texte avant le ` +
        `gras) plutôt que de la laisser polluer une liste à laquelle elle ` +
        `n'appartient pas.`
    ).toEqual([]);
  });
});
