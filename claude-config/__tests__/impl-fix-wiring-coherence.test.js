// SKILL-111 — le câblage du CORRECTEUR : l'Étape 6.5 de `/sdd-run-ticket`
// lance un implémenteur NEUF sur le worktree du ticket, au lieu de reprendre
// l'agent de l'Étape 6 par `SendMessage`.
//
// Contexte (specs/skill-111.md § Problème) : l'Étape 6.5 était le SEUL point du
// skill dont le mécanisme n'avait qu'un verbe — `SendMessage` — et ce verbe
// n'existe pas sur la seule surface de travail réelle de l'utilisateur
// (application de bureau, Windows). Deux formes du symptôme : un refus annoncé
// (« SendMessage is disabled for this session »), et une ABSENCE MUETTE — le
// verbe n'est pas dans l'inventaire, rien à reconnaître. Le coût de l'arrêt y
// est maximal : findings constatés et non disposés, registre de l'Étape 6.6
// inécrivable, worktree orphelin.
//
// Décision (§ Décision) : INVERSER. Le correcteur neuf devient le mode nominal,
// `SendMessage` sort du skill. Pas de dispositif à deux voies — une branche
// jamais empruntée sur la seule surface réelle se dégrade sans témoin, c'est
// l'argument que le skill oppose déjà lui-même à la recopie des modes d'emploi.
//
// ⚠️ Ce fichier est nommé d'après son SUJET (le câblage du correcteur), pas
// d'après le ticket — convention de ce dépôt.
//
// ⚠️ D3 du dépôt : toute liste de contrôle (ancres, marqueurs, jetons attendus)
// est DÉCLARÉE ICI, jamais lue de la source qu'elle contrôle — un test qui lit
// la constante qu'il contrôle se valide contre lui-même.
//
// ⚠️ Chaque assertion porte en commentaire la MUTATION qui doit la faire rougir
// (convention de ce dépôt).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import {
  readNormalized,
  extractBetween,
  extractBlockAfterMarker,
  extractSection,
  platir,
  sectionEntre,
} from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const SDD_FILE = 'commands/sdd-run-ticket.md';
const IMPL_SAME = 'prompts/impl-same.md';
const IMPL_CROSS = 'prompts/impl-cross.md';
const FIX_MARKER = '<!-- APPEL:impl-fix -->';

const read = (rel) => readNormalized(REPO_ROOT, rel);
const readSkill = () => read(SDD_FILE);

// Le bloc d'appel du correcteur, extrait par le helper partagé : `null` (donc
// rouge EXPLICITE) si le marqueur manque ou n'est pas suivi d'une fence à
// quatre backticks — jamais une chaîne vide qui passerait tous les `includes`.
const blocFix = () => extractBlockAfterMarker(readSkill(), FIX_MARKER);

// ============================================================================
// Cas 1 — `SendMessage` a QUITTÉ le skill.
// ============================================================================

describe('SKILL-111 — 1. `SendMessage` ne figure plus dans le skill', () => {
  // ⚠️ Mutation-témoin : réintroduire la chaîne `SendMessage` dans l'Étape 6.5
  // (« Reprends l'implémenteur (`SendMessage` sur l'agent de l'Étape 6) ») →
  // rouge. C'est l'état d'AVANT ce ticket.
  //
  // ⚠️ Assertion sur le FICHIER ENTIER, pas sur la seule Étape 6.5 : le
  // paragraphe de l'Étape 6 qui verrouillait ce verbe (« Garde l'identifiant de
  // l'agent : tu le reprendras à l'Étape 6.5 avec `SendMessage` ») vivait
  // ailleurs dans le fichier, et c'est LUI qui rendait le repli illégitime.
  it(`${SDD_FILE} ne contient plus la chaîne "SendMessage"`, () => {
    const raw = readSkill();
    const lignes = raw
      .split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => l.includes('SendMessage'));
    expect(
      lignes,
      `${SDD_FILE} contient encore "SendMessage" (ligne(s) ` +
        `${JSON.stringify(lignes)}) — le verbe n'existe pas sur la surface de ` +
        `travail réelle, et l'Étape 6.5 est le seul point du skill dont le ` +
        `mécanisme n'a qu'un verbe.`
    ).toEqual([]);
  });
});

// ============================================================================
// Cas 2 — le bloc d'appel du correcteur existe, en bloc à quatre backticks.
// ============================================================================

describe('SKILL-111 — 2. Le bloc `APPEL:impl-fix` existe', () => {
  // ⚠️ Mutation-témoin : retirer le marqueur `<!-- APPEL:impl-fix -->` (ou le
  // détacher de sa fence à quatre backticks) → rouge, via le `null` du helper.
  it(`${FIX_MARKER} suit un marqueur sur sa propre ligne et une fence à quatre backticks`, () => {
    const bloc = blocFix();
    expect(
      bloc,
      `${SDD_FILE} : marqueur ${FIX_MARKER} introuvable, ou non suivi d'un bloc ` +
        `à quatre backticks.`
    ).not.toBeNull();
    expect(
      bloc.trim().length,
      `${SDD_FILE} : le bloc ${FIX_MARKER} est vide.`
    ).toBeGreaterThan(0);
  });

  // ⚠️ Mutation : déplacer le bloc hors de l'Étape 6.5 (dans `steps/`, ou sous
  // une autre étape) → rouge. C'est l'étape qui lance le correcteur ; un bloc
  // rangé ailleurs se lit sans son déclencheur.
  it(`${FIX_MARKER} vit dans l'Étape 6.5`, () => {
    const section = sectionEntre(readSkill(), '## Étape 6.5', '## Étape 6.6', SDD_FILE);
    expect(
      section.includes(FIX_MARKER),
      `${SDD_FILE} : le marqueur ${FIX_MARKER} n'est pas dans l'Étape 6.5.`
    ).toBe(true);
  });
});

// ============================================================================
// Cas 3 — pas d'`isolation` dans le bloc.
// ============================================================================

describe('SKILL-111 — 3. Le bloc du correcteur ne porte AUCUN `isolation`', () => {
  // ⚠️ Mutation-témoin : ajouter `isolation: "worktree"` au bloc → rouge.
  //
  // Motif : le correcteur est lancé SUR le worktree de l'implémenteur, qui
  // existe déjà et porte le commit relu. Un `isolation` y créerait un worktree
  // PARASITE, coupé du commit à corriger — l'agent y « corrigerait » un arbre
  // vierge, et la table de dispositions annoncerait des SHA introuvables dans
  // `<WORKTREE_IMPL>`.
  it(`${FIX_MARKER} ne contient pas la chaîne "isolation"`, () => {
    const bloc = blocFix();
    expect(bloc, `${FIX_MARKER} introuvable.`).not.toBeNull();
    expect(
      bloc.includes('isolation'),
      `${SDD_FILE} : le bloc ${FIX_MARKER} nomme "isolation" — le correcteur ` +
        `travaille dans le worktree DÉJÀ monté, pas dans un worktree neuf.`
    ).toBe(false);
  });
});

// ============================================================================
// Cas 4 — le bloc POINTE vers un mode d'emploi et dit quoi faire s'il ne peut
// pas le lire.
// ============================================================================

describe('SKILL-111 — 4. Le bloc du correcteur pointe, et borde l’illisibilité', () => {
  // Trois formes acceptées, déclarées ICI (D3) : les deux noms de fichier, et
  // le placeholder qui les substitue — un SEUL bloc sert les deux modes, donc
  // le nom du fichier est nécessairement une valeur substituée.
  const FORMES_ADMISES = ['impl-same.md', 'impl-cross.md', '<mode_emploi>'];

  // ⚠️ Mutation : retirer du bloc toute mention d'un mode d'emploi → rouge.
  // Un correcteur NEUF n'a aucun contexte : sans le nom de son mode d'emploi,
  // il traiterait les findings de mémoire, sans E1/E2/E3 ni format de table.
  it(`${FIX_MARKER} nomme un mode d'emploi`, () => {
    const bloc = blocFix();
    expect(bloc, `${FIX_MARKER} introuvable.`).not.toBeNull();
    const trouvees = FORMES_ADMISES.filter((f) => bloc.includes(f));
    expect(
      trouvees.length,
      `${SDD_FILE} : le bloc ${FIX_MARKER} ne nomme aucune des formes admises ` +
        `${JSON.stringify(FORMES_ADMISES)}.`
    ).toBeGreaterThan(0);
  });

  // ⚠️ Mutation : retirer la clause d'arrêt → rouge. C'est le seul mode de
  // défaillance neuf du dispositif « le mode d'emploi est un FICHIER » : un
  // agent qui ne peut pas lire improviserait tout le SDD.
  it(`${FIX_MARKER} porte la clause d'arrêt en cas de lecture impossible`, () => {
    const bloc = blocFix();
    expect(bloc, `${FIX_MARKER} introuvable.`).not.toBeNull();
    expect(
      bloc.includes('ARRÊTE-TOI'),
      `${SDD_FILE} : le bloc ${FIX_MARKER} n'ordonne pas l'arrêt.`
    ).toBe(true);
    expect(
      /si tu ne peux pas lire/i.test(bloc),
      `${SDD_FILE} : le bloc ${FIX_MARKER} n'énonce pas le cas « lecture ` +
        `impossible ».`
    ).toBe(true);
  });
});

// ============================================================================
// Cas 5 — le préambule à DEUX RÉGIMES, ancre COMMUNE aux deux modes d'emploi.
// ============================================================================

// Ancres déclarées ici (D3), jamais lues des fichiers contrôlés.
const ANCRE_DEUX_REGIMES = 'Deux régimes de reprise';
const REGIME_CONTEXTE = 'repris en contexte';
const REGIME_NEUF = 'relancé à neuf';

const sectionFindings = (rel) => {
  const section = extractSection(read(rel), /^## Si tu es repris avec des findings\s*$/);
  expect(section, `${rel} : "## Si tu es repris avec des findings" introuvable.`).not.toBeNull();
  return section;
};

describe('SKILL-111 — 5. Les DEUX modes d’emploi distinguent les deux régimes', () => {
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    // ⚠️ Mutation-témoin : retirer le préambule d'UN SEUL des deux fichiers
    // (mode « on a corrigé A, oublié B ») → rouge sur celui-là.
    it(`${rel} § "Si tu es repris avec des findings" porte l'ancre "${ANCRE_DEUX_REGIMES}"`, () => {
      expect(
        sectionFindings(rel).includes(ANCRE_DEUX_REGIMES),
        `${rel} : la section « Si tu es repris avec des findings » ne distingue ` +
          `plus les deux régimes de reprise.`
      ).toBe(true);
    });

    // ⚠️ Mutation : nommer un seul des deux régimes → rouge. Un correcteur qui
    // ne sait pas dans lequel il est referait l'implémentation, ou chercherait
    // un contexte qu'il n'a pas.
    it(`${rel} nomme les DEUX régimes ("${REGIME_CONTEXTE}" et "${REGIME_NEUF}")`, () => {
      const section = sectionFindings(rel);
      expect(
        section.includes(REGIME_CONTEXTE),
        `${rel} : le régime « ${REGIME_CONTEXTE} » n'est plus nommé.`
      ).toBe(true);
      expect(
        section.includes(REGIME_NEUF),
        `${rel} : le régime « ${REGIME_NEUF} » n'est plus nommé.`
      ).toBe(true);
    });

    // ⚠️ Mutations, une par ancre : retirer « déjà commité », « déjà monté »,
    // « pas de rebase » ou le renvoi à `git log` → rouge. Ce sont les QUATRE
    // faits qu'un correcteur neuf n'a aucun moyen de déduire, et dont chacun,
    // manquant, produit une faute distincte : refaire l'implémentation, monter
    // un second worktree, rebaser sous le commit relu, perdre les motifs des
    // choix conservatifs déjà écrits dans les messages de commit.
    for (const [libelle, motif] of [
      ['implémentation déjà commitée', /déjà commitée/i],
      ['worktree déjà monté', /déjà monté/i],
      ['pas de rebase', /pas de rebase/i],
      ['relecture des motifs par git log', /git log/],
    ]) {
      it(`${rel} : le régime « ${REGIME_NEUF} » énonce « ${libelle} »`, () => {
        expect(
          motif.test(sectionFindings(rel)),
          `${rel} : la section « Si tu es repris avec des findings » n'énonce ` +
            `plus « ${libelle} » pour le régime « ${REGIME_NEUF} ».`
        ).toBe(true);
      });
    }
  }
});

// ============================================================================
// Cas 6 — la sonde d'isolation : ancre EXCLUSIVE au mode « même repo ».
// ============================================================================

const SONDE = '.agent_worktree_probe_';

describe('SKILL-111 — 6. La sonde d’isolation est neutralisée, et seulement côté « même repo »', () => {
  // ⚠️ Mutation-témoin : retirer la clause de `impl-same.md` → rouge. C'est le
  // fait faux que le contournement de NAV-14 avait dû neutraliser à la main :
  // le correcteur est lancé SANS `isolation`, la sonde ne trouverait rien, et
  // l'Étape 0 conclurait « isolation mismatch » sur un worktree parfaitement
  // correct.
  it(`${IMPL_SAME} dit que la sonde ne s'applique PAS au régime « ${REGIME_NEUF} »`, () => {
    const section = sectionFindings(IMPL_SAME);
    expect(
      section.includes(SONDE),
      `${IMPL_SAME} : la section « Si tu es repris avec des findings » ne nomme ` +
        `plus la sonde ${SONDE} — rien ne dit au correcteur neuf que l'Étape 0 ` +
        `ne s'applique pas à lui.`
    ).toBe(true);
    expect(
      section.includes(REGIME_NEUF),
      `${IMPL_SAME} : la clause de sonde ne rattache plus la neutralisation au ` +
        `régime « ${REGIME_NEUF} ».`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : écrire la même clause dans `impl-cross.md` → rouge
  // ici, ET rouge dans `impl-templates-coherence.test.js` § 4 (ancres propres au
  // mode « même repo », ABSENTES du cross-repo). Le recouvrement est VOULU :
  // `impl-cross.md` ne porte aucune isolation, donc aucune sonde à neutraliser
  // — l'y écrire est la signature d'un copier-coller entre les deux modes.
  it(`${IMPL_CROSS} ne contient PAS "${SONDE}"`, () => {
    expect(
      read(IMPL_CROSS).includes(SONDE),
      `${IMPL_CROSS} contient "${SONDE}" — ancre du mode « même repo » trouvée ` +
        `dans le mode cross-repo.`
    ).toBe(false);
  });
});

// ============================================================================
// Cas 7 — la rubrique « arbitrages délibérés », et le régime de correction au
// registre de l'Étape 6.6.
// ============================================================================

const RUBRIQUE_ARBITRAGES = /arbitrages délibérés/i;

describe('SKILL-111 — 7a. La rubrique « arbitrages délibérés » du rapport final', () => {
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    // ⚠️ Mutation-témoin : retirer la rubrique d'UN SEUL des deux fichiers →
    // rouge sur celui-là. C'est l'angle mort que l'inversion ouvre : un
    // arbitrage délibéré qui ne relève NI d'une spec ambiguë (→ message de
    // commit) NI d'une spec contradictoire (→ § Escalade de spec) arriverait
    // au correcteur sans son motif.
    it(`${rel} § "Rapport final attendu" porte la rubrique « arbitrages délibérés »`, () => {
      const section = extractSection(read(rel), /^## Rapport final attendu\s*$/);
      expect(section, `${rel} : "## Rapport final attendu" introuvable.`).not.toBeNull();
      expect(
        RUBRIQUE_ARBITRAGES.test(section),
        `${rel} : le § « Rapport final attendu » ne porte plus la rubrique ` +
          `« arbitrages délibérés ».`
      ).toBe(true);
    });

    // ⚠️ Mutation : rendre la rubrique OBLIGATOIRE (retirer « optionnelle » /
    // « absente si ») → rouge. Une rubrique obligatoire se remplit de prose
    // inventée quand il n'y a rien à déclarer — exactement ce que le défaut
    // explicite des lignes du registre existe pour éviter.
    it(`${rel} : la rubrique « arbitrages délibérés » est déclarée OPTIONNELLE`, () => {
      const section = extractSection(read(rel), /^## Rapport final attendu\s*$/);
      const bullet = section
        .split(/\n(?=- )/)
        .find((b) => RUBRIQUE_ARBITRAGES.test(b));
      expect(
        bullet,
        `${rel} : aucun bullet du § « Rapport final attendu » ne porte la ` +
          `rubrique « arbitrages délibérés ».`
      ).not.toBeUndefined();
      expect(
        /optionnelle/i.test(bullet),
        `${rel} : la rubrique « arbitrages délibérés » n'est plus déclarée ` +
          `optionnelle.`
      ).toBe(true);
    });

    // ⚠️ Mutation : ne plus nommer les deux canaux existants → rouge. Sans eux,
    // la rubrique devient un troisième canal REDONDANT, et le même arbitrage
    // se déclare à deux endroits (ou à aucun).
    it(`${rel} : la rubrique se DÉMARQUE des deux canaux existants`, () => {
      const section = extractSection(read(rel), /^## Rapport final attendu\s*$/);
      const bullet = section
        .split(/\n(?=- )/)
        .find((b) => RUBRIQUE_ARBITRAGES.test(b));
      expect(bullet).not.toBeUndefined();
      expect(
        /ambigu/i.test(bullet) && /commit/i.test(bullet),
        `${rel} : la rubrique ne renvoie plus la spec AMBIGUË au message de ` +
          `commit — le premier des deux canaux existants.`
      ).toBe(true);
      expect(
        /contradictoire/i.test(bullet),
        `${rel} : la rubrique ne renvoie plus la spec CONTRADICTOIRE au ` +
          `§ « Escalade de spec (première passe) » — le second canal existant.`
      ).toBe(true);
    });
  }
});

describe('SKILL-111 — 7c. La rubrique est REPASSÉE au correcteur, sinon elle n’a aucun lecteur', () => {
  // C'est la moitié qui ferme réellement l'angle mort : une rubrique écrite au
  // rapport de première passe et jamais relue par personne ne ferme rien. Le
  // rapport de l'Étape 6, l'orchestrateur le détient déjà.
  //
  // ⚠️ Mutation-témoin : retirer la ligne du bloc → rouge. La rubrique du § 7a
  // resterait écrite, et perdue.
  it(`${FIX_MARKER} porte les arbitrages délibérés de la première passe`, () => {
    const bloc = blocFix();
    expect(bloc, `${FIX_MARKER} introuvable.`).not.toBeNull();
    expect(
      RUBRIQUE_ARBITRAGES.test(bloc),
      `${SDD_FILE} : le bloc ${FIX_MARKER} ne repasse pas les arbitrages ` +
        `délibérés du rapport de première passe — la rubrique s'écrirait sans ` +
        `aucun lecteur.`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer la levée d'ambiguïté → rouge. Un orchestrateur qui
  // lit « sans attribution ni comptage » juste en dessous pourrait conclure que
  // cette ligne perce la barrière, et la laisser vide par prudence.
  it(`${SDD_FILE} § 6.5 dit que cette ligne ne perce PAS l'interdit d'attribution`, () => {
    const section = sectionEntre(readSkill(), '## Étape 6.5', '## Étape 6.6', SDD_FILE);
    const puce = section
      .split(/\n(?=- )/)
      .find((b) => /^- /.test(b) && /attribution ni comptage/i.test(b));
    expect(
      puce,
      `${SDD_FILE} § 6.5 : la puce « Sans attribution ni comptage » est introuvable.`
    ).not.toBeUndefined();
    expect(
      /<ARBITRAGES_PASSE_1>/.test(puce) && /relecteur/i.test(puce),
      `${SDD_FILE} § 6.5 : la puce « Sans attribution ni comptage » ne lève ` +
        `plus l'ambiguïté sur \`<ARBITRAGES_PASSE_1>\` — l'interdit porte sur ` +
        `les relecteurs, pas sur le propre rapport de l'implémenteur.`
    ).toBe(true);
  });
});

describe('SKILL-111 — 7b. Le registre de l’Étape 6.6 atteste le régime de correction', () => {
  const etape66 = () =>
    sectionEntre(readSkill(), '## Étape 6.6 — Registre de revue', '## Étape 6.6.5', SDD_FILE);

  // ⚠️ Mutation-témoin : retirer la ligne du gabarit → rouge. Sans elle,
  // l'inversion reste invisible dans les artefacts du cycle — c'est le défaut
  // constaté au § Problème (≥ 4 cycles menés au bout par un correcteur neuf,
  // aucun registre n'en porte trace).
  it(`${SDD_FILE} § 6.6 : le gabarit de registre porte une ligne « Régime de correction »`, () => {
    expect(
      /Régime de correction\s*:/.test(etape66()),
      `${SDD_FILE} § 6.6 : le gabarit du registre ne porte plus de ligne ` +
        `« Régime de correction » — le régime employé n'est attesté nulle part.`
    ).toBe(true);
  });

  // ⚠️ Mutation : nommer la ligne dans le gabarit sans jamais dire ce qu'on y
  // écrit → rouge. Une ligne de gabarit sans prescription se remplit de tête.
  it(`${SDD_FILE} § 6.6 : la ligne « Régime de correction » nomme le correcteur neuf`, () => {
    const section = etape66();
    const ligne = section
      .split('\n')
      .find((l) => /Régime de correction\s*:/.test(l));
    expect(ligne, `${SDD_FILE} § 6.6 : ligne « Régime de correction » introuvable.`).not.toBeUndefined();
    expect(
      /neuf/i.test(ligne),
      `${SDD_FILE} § 6.6 : la ligne « Régime de correction » du gabarit ne ` +
        `nomme pas le correcteur neuf — l'orchestrateur ne sait pas quoi y ` +
        `écrire. Ligne lue : ${JSON.stringify(ligne)}`
    ).toBe(true);
  });

  // ⚠️ Mutation : écrire la nouvelle puce en réutilisant la locution « hors
  // équation » → rouge ICI (l'assertion ci-dessous) ET rouge dans
  // `escalation-wiring-coherence.test.js` (« EXACTEMENT une puce de la section
  // 6.6 porte la locution "hors équation" »). Le recouvrement est VOULU : cette
  // locution isole UNE puce précise, deux consommateurs en dépendent.
  it(`${SDD_FILE} § 6.6 : la prescription de la nouvelle ligne ne réutilise pas « hors équation »`, () => {
    const section = etape66();
    const puces = section
      .split(/\n(?=- )/)
      .filter((b) => /^- /.test(b))
      .filter((b) => /Régime de correction/.test(b));
    expect(
      puces.length,
      `${SDD_FILE} § 6.6 : ${puces.length} puce(s) prescrivent la ligne ` +
        `« Régime de correction », 1 attendue.`
    ).toBe(1);
    expect(
      /hors équation/i.test(puces[0]),
      `${SDD_FILE} § 6.6 : la puce de « Régime de correction » porte la ` +
        `locution « hors équation », réservée à la puce des DEUX lignes ` +
        `d'escalade — l'unicité dont dépendent deux consommateurs serait rompue.`
    ).toBe(false);
  });
});

// ############################################################################
// Cas 8 à 13 — gate de revue de SKILL-111. Chacun ferme un finding NOMMÉ ; le
// commentaire de chaque famille dit lequel, pour que la mutation-témoin se lise
// contre le défaut réel et non contre une intention reconstituée.
// ############################################################################

// ============================================================================
// Cas 8 (finding 6) — les deux blocs COMMUNS sont identiques MOT POUR MOT.
// ============================================================================
//
// Les cas 5 et 7a ne contrôlent que la PRÉSENCE d'ancres, fichier par fichier :
// un ticket ultérieur qui reformule le préambule dans `impl-same.md` seulement
// les laisse tous verts, et les correcteurs cross-repo appliquent l'ancien
// texte sans que rien ne le signale. Le dépôt possède déjà ce contrôle pour du
// texte commun à CES DEUX fichiers (`portee-conventionnelle-coherence.test.js`,
// cas 5) ; il lui faut un couple de marqueurs pour délimiter la copie.
//
// ⚠️ Marqueurs volontairement DISTINCTS de `<!-- PROJECTION:… -->` : une
// projection a un domicile canonique (`rules/maturation.md`) dont les porteurs
// sont des copies. Ici il n'y en a pas — les deux copies sont à égalité, et
// l'assertion est une égalité SYMÉTRIQUE entre elles, pas une conformité à un
// original.
const COMMUN_DEBUT = '<!-- COMMUN:regimes-de-reprise -->';
const COMMUN_FIN = '<!-- /COMMUN:regimes-de-reprise -->';

const blocCommun = (rel) => {
  const bloc = extractBetween(read(rel), COMMUN_DEBUT, COMMUN_FIN);
  expect(
    bloc,
    `${rel} : bloc délimité par ${COMMUN_DEBUT} … ${COMMUN_FIN} introuvable ` +
      `(marqueur manquant, ou les deux dans le mauvais ordre).`
  ).not.toBeNull();
  return bloc;
};

// La rubrique « arbitrages délibérés » du § Rapport final attendu, réduite à
// SON paragraphe : le `split(/\n(?=- )/)` du cas 7a rend le dernier bullet
// SUIVI de la prose de fin de section, qui n'est pas commune aux deux fichiers
// (le code d'accusé de lecture y diffère). `split('\n\n')[0]` referme le bullet
// sur lui-même.
const rubriqueArbitrages = (rel) => {
  const section = extractSection(read(rel), /^## Rapport final attendu\s*$/);
  expect(section, `${rel} : "## Rapport final attendu" introuvable.`).not.toBeNull();
  const bullet = section.split(/\n(?=- )/).find((b) => RUBRIQUE_ARBITRAGES.test(b));
  expect(
    bullet,
    `${rel} : aucun bullet du § « Rapport final attendu » ne porte la rubrique ` +
      `« arbitrages délibérés ».`
  ).not.toBeUndefined();
  return bullet.split('\n\n')[0];
};

describe('SKILL-111 — 8. Les blocs communs aux deux modes d’emploi sont identiques', () => {
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    // ⚠️ Mutation : retirer un marqueur d'un seul fichier → rouge. Sans les
    // deux bornes, l'égalité ci-dessous n'a plus d'opérande.
    it(`${rel} porte les DEUX marqueurs du bloc commun, une fois chacun`, () => {
      const lignes = read(rel).split('\n');
      for (const marqueur of [COMMUN_DEBUT, COMMUN_FIN]) {
        const n = lignes.filter((l) => l.trim() === marqueur).length;
        expect(
          n,
          `${rel} : ${marqueur} apparaît ${n} fois sur sa propre ligne, 1 attendue.`
        ).toBe(1);
      }
    });
  }

  // ⚠️ Mutation-témoin : ajouter un 6ᵉ fait au régime « relancé à neuf », ou
  // reformuler le fait 4, dans `impl-same.md` SEULEMENT → rouge ici, et vert
  // partout ailleurs (les quatre ancres du cas 5 restent présentes des deux
  // côtés). C'est très exactement la divergence silencieuse que ce test existe
  // pour attraper.
  it(`le préambule à deux régimes est MOT POUR MOT le même dans les deux modes d'emploi`, () => {
    expect(
      blocCommun(IMPL_SAME),
      `${IMPL_SAME} et ${IMPL_CROSS} portent deux versions différentes du ` +
        `préambule à deux régimes. Deux copies d'un même texte divergent en ` +
        `silence : reporte la modification À L'IDENTIQUE dans les deux.`
    ).toEqual(blocCommun(IMPL_CROSS));
  });

  // ⚠️ Mutation : reformuler la rubrique dans un seul des deux fichiers →
  // rouge. Le cas 7a resterait vert : il ne cherche que « optionnelle »,
  // « ambigu », « commit » et « contradictoire ».
  it(`la rubrique « arbitrages délibérés » est MOT POUR MOT la même dans les deux modes d'emploi`, () => {
    expect(
      rubriqueArbitrages(IMPL_SAME),
      `${IMPL_SAME} et ${IMPL_CROSS} portent deux versions différentes de la ` +
        `rubrique « arbitrages délibérés ».`
    ).toEqual(rubriqueArbitrages(IMPL_CROSS));
  });
});

// ============================================================================
// Cas 9 (finding 5) — le prompt de REPRISE porte des lignes que le §
// « Substitutions » de l'appel initial ne déclare pas.
// ============================================================================
//
// Le bloc `APPEL:impl-fix` fournit CINQ lignes valuées ; le § « Substitutions »
// d'`impl-same.md` n'en déclare que trois, et celui d'`impl-cross.md` ne
// connaît pas non plus la ligne « Arbitrages délibérés ». Un correcteur qui lit
// son mode d'emploi en entier n'y trouve donc pas à quelle ligne lire la valeur
// dont tout son régime dépend. La famille 10 d'`impl-templates-coherence`
// (« recevoir une valeur qu'aucune consigne n'utilise ») ne peut pas fermer ce
// trou : elle exige une ÉGALITÉ de jetons, impossible pour un bloc unique qui
// sert deux modes d'emploi.

const LIGNE_WORKTREE = 'Worktree';
const LIGNE_ARBITRAGES = 'Arbitrages délibérés de la première passe';

describe('SKILL-111 — 9. Le préambule déclare les lignes du prompt de reprise', () => {
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    // ⚠️ Mutation : retirer l'énumération des lignes → rouge. Le correcteur
    // reçoit alors une ligne « Arbitrages délibérés de la première passe » que
    // rien, dans le fichier qui fait autorité sur sa conduite, ne lui dit de
    // lire.
    it(`${rel} : le régime « ${REGIME_NEUF} » énumère les lignes de son prompt`, () => {
      const bloc = platir(blocCommun(rel));
      for (const ligne of [LIGNE_WORKTREE, LIGNE_ARBITRAGES]) {
        expect(
          bloc.includes(ligne),
          `${rel} : le préambule à deux régimes ne nomme pas la ligne ` +
            `« ${ligne} » du prompt de reprise.`
        ).toBe(true);
      }
    });

    // ⚠️ Mutation : énumérer les lignes sans dire que le § « Substitutions »
    // en tête du fichier porte sur l'appel INITIAL → rouge. Le correcteur
    // lirait deux listes contradictoires (trois jetons là-haut, cinq lignes
    // ici) sans savoir laquelle est la sienne.
    it(`${rel} : le préambule dit que le § « Substitutions » décrit l'appel INITIAL`, () => {
      const bloc = platir(blocCommun(rel));
      expect(
        /Substitutions/.test(bloc) && /initial/i.test(bloc),
        `${rel} : le préambule à deux régimes ne démarque plus les lignes du ` +
          `prompt de reprise de celles que le § « Substitutions » déclare pour ` +
          `l'appel initial.`
      ).toBe(true);
    });
  }
});

// ============================================================================
// Cas 10 (finding 1) — sans `isolation`, les chemins RELATIFS deviennent le
// mode de défaillance le plus coûteux du mode « même repo ».
// ============================================================================
//
// `impl-same.md` § « Outils de fichiers » prescrit « Travaille en chemins
// RELATIFS » et, pire, « si un outil refuse un chemin absolu → repasse en
// relatif » : deux consignes qui ne tiennent que sous l'`isolation` du harnais.
// L'Étape 6.5 lance le correcteur SANS `isolation` — un `Edit("commands/…")`
// atterrit alors dans le répertoire de la session orchestratrice, c'est-à-dire
// potentiellement le checkout LIVE. `impl-cross.md` porte déjà cet
// avertissement (§ « Outils de fichiers ») ; `impl-same.md` ne l'avait pas,
// parce qu'il présumait l'isolation que ce ticket lui retire.

const ANCRE_ABSOLUS = 'chemins ABSOLUS';

describe('SKILL-111 — 10. Le régime « relancé à neuf » impose les chemins ABSOLUS, côté « même repo »', () => {
  // ⚠️ Mutation-témoin : retirer la clause → rouge. C'est le seul garde-fou
  // entre un correcteur same-repo et le checkout live de son propre dépôt.
  it(`${IMPL_SAME} : le régime « ${REGIME_NEUF} » prescrit les ${ANCRE_ABSOLUS}`, () => {
    const section = platir(sectionFindings(IMPL_SAME));
    expect(
      section.includes(ANCRE_ABSOLUS),
      `${IMPL_SAME} : la section « Si tu es repris avec des findings » ne ` +
        `prescrit pas les ${ANCRE_ABSOLUS} — sans isolation, un chemin relatif ` +
        `écrit dans le répertoire de la session orchestratrice.`
    ).toBe(true);
  });

  // ⚠️ Mutation : prescrire l'absolu sans neutraliser NOMMÉMENT le § « Outils
  // de fichiers » → rouge. Deux consignes contradictoires dans le même
  // fichier, dont la plus ancienne dit explicitement « repasse en relatif » :
  // le correcteur n'a aucun moyen de savoir laquelle prime.
  it(`${IMPL_SAME} : la clause neutralise NOMMÉMENT le § « Outils de fichiers »`, () => {
    const section = platir(sectionFindings(IMPL_SAME));
    expect(
      /Outils de fichiers/.test(section) && /relatif/i.test(section),
      `${IMPL_SAME} : la clause des chemins absolus ne nomme plus le ` +
        `§ « Outils de fichiers » et sa consigne de repli en relatif — celle-ci ` +
        `reste applicable telle quelle par un correcteur non isolé.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : écrire cette clause DANS le bloc commun → rouge ici.
  // Elle est propre au mode « même repo » : `impl-cross.md` prescrit déjà
  // l'absolu partout, et l'y projeter dirait à son lecteur qu'un régime lui
  // impose ce que son § « Outils de fichiers » lui impose déjà toujours.
  it(`la clause des ${ANCRE_ABSOLUS} reste HORS du bloc commun`, () => {
    expect(
      blocCommun(IMPL_SAME).includes(ANCRE_ABSOLUS),
      `${IMPL_SAME} : la clause des ${ANCRE_ABSOLUS} est dans le bloc commun ` +
        `— le cas 8 la propagerait à ${IMPL_CROSS}, dont le régime de chemins ` +
        `ne dépend pas de l'isolation.`
    ).toBe(false);
  });
});

// ============================================================================
// Cas 11 (finding 4) — « pas de rebase » et « amende ton commit » se
// contredisaient dans la même section.
// ============================================================================
//
// Le préambule justifie « pas de rebase » par « périmerait les SHA que le
// registre de revue va vérifier » ; le point 2 du tri, deux paragraphes plus
// bas, prescrit « Amende ton commit ou ajoute un commit `fix(…)` » — et
// `git commit --amend` périme exactement le même SHA. Le correcteur neuf, lui,
// n'a aucun moyen de savoir que le commit qu'il écrase est celui qui a été relu.

describe('SKILL-111 — 11. Le régime « relancé à neuf » ferme l’amend comme le rebase', () => {
  for (const rel of [IMPL_SAME, IMPL_CROSS]) {
    // ⚠️ Mutation-témoin : retirer la mention de l'amend du préambule → rouge.
    // Le point 2 du tri redevient applicable tel quel, et le SHA relevé à
    // l'Étape 6.1 disparaît du worktree.
    it(`${rel} : le préambule ferme l'AMEND, pas seulement le rebase`, () => {
      const bloc = platir(blocCommun(rel));
      expect(
        /pas de rebase/i.test(bloc),
        `${rel} : le préambule ne porte plus « pas de rebase ».`
      ).toBe(true);
      expect(
        /amend/i.test(bloc),
        `${rel} : le préambule interdit le rebase mais laisse le point 2 du ` +
          `tri autoriser l'amend, qui périme le MÊME SHA.`
      ).toBe(true);
    });

    // ⚠️ Mutation : fermer l'amend sans nommer la branche qui reste ouverte →
    // rouge. Un interdit sans issue laisse le correcteur sans geste de commit.
    it(`${rel} : le préambule nomme la branche qui reste ouverte (commit \`fix(…)\`)`, () => {
      const bloc = platir(blocCommun(rel));
      expect(
        /fix\(/.test(bloc),
        `${rel} : le préambule ferme l'amend sans nommer le commit ` +
          `\`fix(<TICKET-ID>): …\` qui reste la seule issue.`
      ).toBe(true);
    });
  }
});

// ============================================================================
// Cas 12 (findings 8, 9, 10) — le GESTE « reprendre l'implémenteur » a quitté
// le skill, pas seulement le verbe `SendMessage`.
// ============================================================================
//
// Le cas 1 ne cherche qu'une chaîne : `SendMessage`. Toutes les clauses qui
// prescrivent le GESTE sans nommer le verbe avaient survécu — dont le titre de
// l'Étape 6.5 (qui contredit son propre corps), le récapitulatif « Procéder ? »
// que l'utilisateur lit avant de valider, et la puce de l'Étape 6.6 qui ordonne
// « une reprise de plus » que plus aucune étape ne décrit.

// Locutions déclarées ICI (D3), jamais lues du skill. L'apostrophe est une
// classe : ce dépôt mêle `'` et `’` selon les lignes.
const LOCUTIONS_PERIMEES = [
  /reprends l['’]implémenteur/i,
  // La forme NÉGATIVE compte autant que l'affirmative : « ne reprends pas
  // l'implémenteur » (arrêt de l'Étape 6.4) interdit un geste qui n'existe
  // plus, donc laisse croire qu'il existe hors de cet arrêt.
  /reprends pas l['’]implémenteur/i,
  /reprendre l['’]implémenteur/i,
  /reprise de l['’]implémenteur/i,
  /le reprendre avec les findings/i,
  /findings à l['’]implémenteur/i,
  /implémenteur repris/i,
];

describe('SKILL-111 — 12. Le geste « reprendre l’implémenteur » a quitté le skill', () => {
  // ⚠️ Mutation-témoin : réécrire l'étape 8 du récapitulatif en « Le reprendre
  // avec les findings bruts » → rouge. C'est le seul texte que l'utilisateur
  // lit avant de valider, et il annonçait un dispositif que ce ticket supprime.
  for (const motif of LOCUTIONS_PERIMEES) {
    it(`${SDD_FILE} ne prescrit plus le geste « ${motif.source} »`, () => {
      const lignes = readSkill()
        .split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => motif.test(l));
      expect(
        lignes,
        `${SDD_FILE} prescrit encore la reprise de l'implémenteur (ligne(s) ` +
          `${JSON.stringify(lignes)}) — le skill ne porte plus aucun mécanisme ` +
          `pour l'accomplir.`
      ).toEqual([]);
    });
  }

  // ⚠️ Mutation-témoin : rétablir « ## Étape 6.5 — Reprise de l'implémenteur
  // avec les findings bruts » → rouge. Le titre est la première ligne que lit
  // l'orchestrateur qui saute ici depuis `steps/review-deep.md` ; il annonçait
  // l'inverse de son propre corps (« Lance un correcteur NEUF ») et de
  // l'Étape 6 (« Tu ne reprends PAS cet agent-ci »).
  it(`${SDD_FILE} : le titre de l'Étape 6.5 nomme le CORRECTEUR`, () => {
    const titre = readSkill()
      .split('\n')
      .find((l) => /^##\s*Étape 6\.5\b/.test(l));
    expect(titre, `${SDD_FILE} : titre de l'Étape 6.5 introuvable.`).not.toBeUndefined();
    expect(
      /correcteur/i.test(titre),
      `${SDD_FILE} : le titre de l'Étape 6.5 ne nomme pas le correcteur. ` +
        `Titre lu : ${JSON.stringify(titre)}`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : rendre à la puce sa parenthèse « une reprise de plus
  // est permise pour ça » → rouge. Elle ordonnait un geste dont le verbe
  // (`SendMessage`) a quitté le skill : l'orchestrateur se retrouvait au point
  // mort que ce ticket existe pour supprimer, cette fois sans même un verbe à
  // essayer.
  it(`${SDD_FILE} § 6.6 : réclamer une disposition manquante passe par ${FIX_MARKER}`, () => {
    const section = sectionEntre(
      readSkill(),
      '## Étape 6.6 — Registre de revue',
      '## Étape 6.6.5',
      SDD_FILE
    );
    // ⚠️ `platir` avant la recherche : la prose de ce dépôt est enroulée à la
    // main, et « avant de les avoir obtenus » tombe de part et d'autre d'un
    // retour à la ligne — un motif lu sur le texte brut serait vert ou rouge
    // selon le point d'enroulement, jamais selon le sens.
    const puce = section
      .split(/\n(?=- )/)
      .filter((b) => /^- /.test(b))
      .map(platir)
      .find((b) => /avant de les avoir obtenus/i.test(b));
    expect(
      puce,
      `${SDD_FILE} § 6.6 : la puce « Contrôle » (dispositions manquantes) est ` +
        `introuvable.`
    ).not.toBeUndefined();
    expect(
      puce.includes(FIX_MARKER),
      `${SDD_FILE} § 6.6 : la puce des dispositions manquantes autorise une ` +
        `relance sans nommer le bloc ${FIX_MARKER} — seul mécanisme de relance ` +
        `que le skill porte encore.`
    ).toBe(true);
  });
});

// ============================================================================
// Cas 13 (finding 7) — la ligne « Régime de correction » sait décrire l'ARRÊT.
// ============================================================================
//
// L'énuméré livré était fermé à deux valeurs (`correcteur neuf`, `aucun — U =
// 0`) alors qu'une TROISIÈME branche du skill publie un registre : l'arrêt de
// l'Étape 6.4 (« un relecteur a écrit »), où `U > 0` et où aucun correcteur
// n'est lancé. Aucune des deux valeurs n'y est vraie — et c'est le cas le plus
// grave qui restait indescriptible dans une ligne censée être un CONSTAT.

describe('SKILL-111 — 13. « Régime de correction » couvre l’arrêt de l’Étape 6.4', () => {
  const etape66Bis = () =>
    sectionEntre(readSkill(), '## Étape 6.6 — Registre de revue', '## Étape 6.6.5', SDD_FILE);

  // ⚠️ Mutation-témoin : ramener la ligne du gabarit à deux valeurs → rouge.
  // L'orchestrateur qui publie le registre d'un arrêt inventerait sa troisième
  // valeur dans la ligne même qui est censée être un constat.
  it(`${SDD_FILE} § 6.6 : la ligne du gabarit offre une valeur pour l'arrêt de l'Étape 6.4`, () => {
    const ligne = etape66Bis()
      .split('\n')
      .find((l) => /Régime de correction\s*:/.test(l));
    expect(ligne, `${SDD_FILE} § 6.6 : ligne « Régime de correction » introuvable.`).not.toBeUndefined();
    expect(
      /6\.4/.test(ligne),
      `${SDD_FILE} § 6.6 : la ligne « Régime de correction » du gabarit ne ` +
        `porte aucune valeur pour l'arrêt de l'Étape 6.4 — le registre le plus ` +
        `grave est le seul qu'elle ne sait pas décrire. Ligne lue : ` +
        `${JSON.stringify(ligne)}`
    ).toBe(true);
  });

  // ⚠️ Mutation : ajouter la valeur au gabarit sans la prescrire → rouge. Une
  // valeur de gabarit sans son déclencheur écrit se choisit de tête.
  it(`${SDD_FILE} § 6.6 : la prescription rattache cette valeur à l'arrêt de l'Étape 6.4`, () => {
    const puce = etape66Bis()
      .split(/\n(?=- )/)
      .find((b) => /^- /.test(b) && /Régime de correction/.test(b));
    expect(puce, `${SDD_FILE} § 6.6 : puce « Régime de correction » introuvable.`).not.toBeUndefined();
    expect(
      /6\.4/.test(puce),
      `${SDD_FILE} § 6.6 : la puce « Régime de correction » ne dit pas quoi ` +
        `écrire quand l'Étape 6.4 a arrêté le cycle avec U > 0.`
    ).toBe(true);
  });
});

// ============================================================================
// Cas 14 (SKILL-113, escalade E1 findings 8/9 de skill-111) — le geste
// « reprendre l'implémenteur » survivait dans `steps/review-deep.md`, hors du
// grep initial de SKILL-111 (`commands/`, `prompts/`) qui ne balayait pas
// `steps/`.
// ============================================================================
//
// SKILL-111 s'était interdit d'écrire dans `steps/` (§ Tests cas 9 et
// § Vérification de sa propre spec) : les deux clauses périmées y ont donc
// survécu intactes. Ce ticket-ci les corrige et étend `LOCUTIONS_PERIMEES`
// (déjà appliquées au skill par le cas 12 ci-dessus) à ce fichier.

const STEPS_REVIEW_DEEP = 'steps/review-deep.md';
const readStepsReviewDeep = () => read(STEPS_REVIEW_DEEP);

describe('SKILL-113 — 14. Le geste « reprendre l’implémenteur » a quitté steps/review-deep.md', () => {
  // ⚠️ Mutation-témoin : réintroduire « implémenteur repris » (ou toute autre
  // locution de LOCUTIONS_PERIMEES) dans steps/review-deep.md → rouge.
  for (const motif of LOCUTIONS_PERIMEES) {
    it(`${STEPS_REVIEW_DEEP} ne prescrit plus le geste « ${motif.source} »`, () => {
      const lignes = readStepsReviewDeep()
        .split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => motif.test(l));
      expect(
        lignes,
        `${STEPS_REVIEW_DEEP} prescrit encore la reprise de l'implémenteur ` +
          `(ligne(s) ${JSON.stringify(lignes)}) — ce fichier ne porte plus ` +
          `aucun mécanisme pour l'accomplir.`
      ).toEqual([]);
    });
  }

  // ⚠️ Mutation-témoin : reformuler la clause des deux contrôles en « avant de
  // poursuivre » (satisfait le cas ci-dessus sans nommer le geste réel) →
  // rouge. Sans ce cas, la ligne pourrait cesser de dire à l'orchestrateur
  // quel geste vient après — le défaut d'origine sous une autre forme.
  // ⚠️ Prose enroulée à la main dans ce dépôt : `platir` avant la recherche,
  // sinon la clause peut tomber de part et d'autre d'un retour à la ligne.
  it(`${STEPS_REVIEW_DEEP} : la clause des deux contrôles nomme le CORRECTEUR et le verbe qui le lance`, () => {
    const paragraphe = readStepsReviewDeep()
      .split(/\n\s*\n/)
      .map(platir)
      .find((p) => /obligatoires/i.test(p) && /contrôles/i.test(p));
    expect(
      paragraphe,
      `${STEPS_REVIEW_DEEP} : paragraphe des « deux contrôles obligatoires » introuvable.`
    ).not.toBeUndefined();
    expect(
      /correcteur/i.test(paragraphe),
      `${STEPS_REVIEW_DEEP} : la clause des deux contrôles ne nomme pas le ` +
        `correcteur. Paragraphe lu : ${JSON.stringify(paragraphe)}`
    ).toBe(true);
    expect(
      /lance[rz]?\b/i.test(paragraphe),
      `${STEPS_REVIEW_DEEP} : la clause des deux contrôles ne porte aucun ` +
        `verbe de lancement. Paragraphe lu : ${JSON.stringify(paragraphe)}`
    ).toBe(true);
  });

  // Non-régression du FOND : les deux contrôles, la non-substitution de
  // l'un par l'autre, et la définition de <FINDINGS_BRUTS> restent présents.
  // ⚠️ Mutation-témoin : supprimer un des deux paragraphes de contrôle → rouge.
  // Sans ce cas, le cas ci-dessus serait satisfait en effaçant la prose au
  // lieu de la reformuler.
  it(`${STEPS_REVIEW_DEEP} : les deux contrôles obligatoires et « l'un ne remplace pas l'autre » restent présents`, () => {
    const contenu = platir(readStepsReviewDeep());
    expect(/Aucun brut perdu/i.test(contenu)).toBe(true);
    expect(/Aucun unique perdu/i.test(contenu)).toBe(true);
    expect(
      /l['’]un ne remplace pas l['’]autre/i.test(contenu),
      `${STEPS_REVIEW_DEEP} : la clause « l'un ne remplace pas l'autre » a disparu.`
    ).toBe(true);
  });

  // ⚠️ Prose enroulée à la main dans ce dépôt : `platir` avant la recherche,
  // sinon la clause peut tomber de part et d'autre d'un retour à la ligne
  // (le paragraphe de <FINDINGS_BRUTS> s'étale sur plusieurs lignes physiques).
  const trouveParagrapheFindingsBruts = () =>
    readStepsReviewDeep()
      .split(/\n\s*\n/)
      .map(platir)
      .find((p) => p.includes('<FINDINGS_BRUTS>') && /passe/i.test(p));

  it(`${STEPS_REVIEW_DEEP} : <FINDINGS_BRUTS> reste défini et nomme le CORRECTEUR comme destinataire`, () => {
    const paragraphe = trouveParagrapheFindingsBruts();
    expect(
      paragraphe,
      `${STEPS_REVIEW_DEEP} : la définition de <FINDINGS_BRUTS> (§ Substitutions) est introuvable.`
    ).not.toBeUndefined();
    expect(
      /correcteur/i.test(paragraphe),
      `${STEPS_REVIEW_DEEP} : <FINDINGS_BRUTS> ne nomme pas le correcteur comme ` +
        `destinataire. Paragraphe lu : ${JSON.stringify(paragraphe)}`
    ).toBe(true);
  });

  // Borne du point 2 de la portée : la définition de <FINDINGS_BRUTS> ne
  // remplace pas sa prose par un renvoi citant un marqueur APPEL: (ce qui
  // déclencherait le garde-fou D3 de commands-shape-coherence.test.js — ce
  // fichier porte par ailleurs, sans y toucher, la citation légitime de
  // `<!-- APPEL:aggregator -->` que ce garde-fou laisse déjà passer).
  // ⚠️ Le motif couvre aussi bien la forme commentaire (`<!-- APPEL:… -->`)
  // que la forme entre backquotes (`` `APPEL:…` ``, celle que la prose de ce
  // fichier emploie déjà pour désigner un bloc, ex. l. 16 et 24) : le
  // garde-fou D3 rougit sur `/APPEL:/` seul, sans exiger le `<!--`.
  // ⚠️ Mutation-témoin : remplacer la définition de <FINDINGS_BRUTS> par
  // « voir le bloc `APPEL:impl-fix` ci-dessous » → rouge.
  it(`${STEPS_REVIEW_DEEP} : la définition de <FINDINGS_BRUTS> ne cite aucun marqueur APPEL:`, () => {
    const paragraphe = trouveParagrapheFindingsBruts();
    expect(paragraphe).not.toBeUndefined();
    expect(
      /APPEL:/i.test(paragraphe),
      `${STEPS_REVIEW_DEEP} : la définition de <FINDINGS_BRUTS> cite un ` +
        `marqueur APPEL: — interdit (garde-fou D3). Paragraphe lu : ${JSON.stringify(paragraphe)}`
    ).toBe(false);
  });
});
