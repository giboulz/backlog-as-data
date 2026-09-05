// SKILL-64 — l'Étape 6.6.5 fixait le CONTENU requis d'une escalade sans jamais
// dire où placer le tag E1/E3 dans le titre du `###`. `backlog escalations`
// (BLG-08, dépôt backlog-cli) reconnaît une escalade à « un `###` dont le
// titre COMMENCE PAR E1/E3/E1/E3 » : ce que le producteur ne garantissait pas,
// le lecteur l'a inféré. `specs/skill-56.md:308` (« ### Finding 2 de la gate
// — E1 ») porte le tag, mais pas en tête — invisible au lecteur, alors que
// l'escalade est réellement ouverte (specs/skill-64.md, § Problème).
//
// ⚠️ Chaque assertion porte en commentaire la MUTATION qui doit la faire
// rougir (convention de ce repo, D3). Ancres déclarées ICI, en dur.
//
// ⚠️ Reprise (revue) : PAS d'assertion `git diff` dans ce fichier. Une
// assertion qui compare le working tree à HEAD n'est verte QU'AVANT le
// commit — elle rougit à VIE dès que le geste est committé (constaté au SHA
// relu `9d275d7` : `git diff --numstat` rend `''` puisque le working tree
// EST déjà HEAD). Comparer à `main` au lieu de HEAD ne fait que déplacer la
// même panne au lendemain du merge (`main...HEAD` redevient vide dès que la
// branche EST `main`). Les invariants ci-dessous vérifient donc le RÉSULTAT
// (ancien titre absent, nouveau titre présent, nombre de lignes inchangé),
// pas la transaction git qui l'a produit — c'est un contrôle permanent, pas
// une vérification de commit à usage unique (celle-ci a été faite à la main
// avant le commit : `git diff --stat` a rendu `1 insertion, 1 suppression`).
// De même, aucune assertion « aucun marqueur → Traitée par » : ce marqueur
// est écrit plus tard, légitimement, par `backlog escalations close` — en
// faire un invariant PERMANENT casserait `npm test` au premier arbitrage de
// cette escalade, pour une raison hors du contrôle de qui écrit alors.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized, sectionEntre, platir } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SDD_FILE = 'commands/sdd-run-ticket.md';
const SKILL56_FILE = 'specs/skill-56.md';
const SKILL62_FILE = 'specs/skill-62.md';
const SKILL65_FILE = 'specs/skill-65.md';

const readSkill = () => readNormalized(REPO_ROOT, SDD_FILE);
const readSkill56 = () => readNormalized(REPO_ROOT, SKILL56_FILE);
const readSkill62 = () => readNormalized(REPO_ROOT, SKILL62_FILE);
const readSkill65 = () => readNormalized(REPO_ROOT, SKILL65_FILE);

// Même découpe que escalation-wiring-coherence.test.js (SKILL-31) : bornée à l'Étape
// 6.6.5, entre 6.6 et 6.7.
const etape665 = (raw) => sectionEntre(raw, '## Étape 6.6.5', '## Étape 6.7', SDD_FILE);

// ⚠️ Reprise (findings 3 et 4) : les trois premiers tests de ce fichier
// cherchaient leur motif dans TOUTE la section 6.6.5 — donc, entre autres,
// dans le bullet PRÉEXISTANT de SKILL-31 (« `docs(<TICKET-ID>): escalade E1`
// (ou `E3`, ou `E1/E3`) », ligne ~1118), qui contient DÉJÀ `E3` et `E1/E3`
// sans rapport avec D1. Une mutation du SEUL paragraphe ajouté par ce ticket
// pouvait donc laisser ces assertions vertes. Bornées ici au paragraphe
// AJOUTÉ par SKILL-64 lui-même, entre ses deux ancres littérales.
const paragrapheD1 = (raw) => {
  const section = etape665(raw);
  return sectionEntre(
    section,
    'Une seule contrainte de forme',
    "Le registre (6.6) et l'Étape 7 continuent de publier",
    SDD_FILE
  );
};

describe('SKILL-64 — D1 : le titre du `###` d’escalade commence par son tag', () => {
  // ⚠️ Mutation-témoin : retirer la phrase prescrivant que le titre COMMENCE
  // par le tag → rouge. Sans elle, la position du tag reste indéterminée, et
  // un lecteur mécanique comme `backlog escalations` (BLG-08) continue
  // d'inférer une convention que le producteur ne garantit pas.
  it('le paragraphe D1 prescrit que le titre du `###` commence par le tag E1/E3', () => {
    const p = paragrapheD1(readSkill());
    expect(
      /titre du\s*\n?\s*`###`[\s\S]{0,40}commence par son tag/.test(p),
      `${SDD_FILE} § 6.6.5 ne prescrit plus explicitement, dans le paragraphe ` +
        `D1, que le titre du \`###\` d'une escalade COMMENCE PAR son tag.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer l'exemple de titre conforme (le bloc de code
  // montrant un `###` dont le tag est en tête) → rouge.
  it('le paragraphe D1 porte un exemple de titre conforme, tag en tête', () => {
    const p = paragrapheD1(readSkill());
    expect(
      /```[^`]*###\s+E1[^`]*```/.test(p),
      `${SDD_FILE} § 6.6.5 ne porte plus d'exemple de titre \`###\` dont le ` +
        `tag E1 est en tête, dans le paragraphe D1.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer, DANS LE PARAGRAPHE D1, le désaveu tolérant
  // au retour à la ligne (« pas de gabarit\n  littéral ») → rouge. Portée
  // corrigée (finding 4) : l'ancienne regex `/pas de gabarit littéral/`
  // matchait trivialement le bullet PRÉEXISTANT de SKILL-31 (« Contenu
  // requis, pas de gabarit littéral »), jamais coupé par un retour à la
  // ligne — une mutation du désaveu ajouté par CE ticket (qui, lui, EST
  // coupé par un retour à la ligne dans le texte livré) laissait donc ce
  // test vert. Cherché ici dans le paragraphe D1 seul, avec une regex
  // tolérante au wrap.
  it('le paragraphe D1 précise que seule la position du tag est prescrite, rien d’autre', () => {
    const p = paragrapheD1(readSkill());
    expect(
      /pas de gabarit\s*\n?\s*littéral/.test(p) && /préfixe verrouillé/.test(p),
      `${SDD_FILE} § 6.6.5 : le paragraphe D1 ne précise plus explicitement ` +
        `que seule la POSITION du tag (un préfixe) est prescrite, le reste ` +
        `du titre et le contenu restant libres.`
    ).toBe(true);
  });
});

describe('SKILL-64 — D1 : les trois tags acceptés et la suffixation', () => {
  // ⚠️ Mutation-témoin : retirer l'un des trois tags (`E1`, `E3`, `E1/E3`) DU
  // PARAGRAPHE D1 → rouge. Portée corrigée (finding 3) : bornée au paragraphe
  // D1 — `E3` et `E1/E3` existaient déjà ailleurs dans la section (bullet
  // SKILL-31), donc une assertion non bornée restait verte même après avoir
  // retiré ces deux tags de l'énumération D1 elle-même.
  it('le paragraphe D1 nomme les trois tags acceptés E1, E3 et E1/E3', () => {
    const p = paragrapheD1(readSkill());
    expect(p.includes('`E1`'), `${SDD_FILE} : le paragraphe D1 ne nomme plus \`E1\`.`).toBe(true);
    expect(p.includes('`E3`'), `${SDD_FILE} : le paragraphe D1 ne nomme plus \`E3\`.`).toBe(true);
    expect(p.includes('E1/E3'), `${SDD_FILE} : le paragraphe D1 ne nomme plus \`E1/E3\`.`).toBe(
      true
    );
  });

  // ⚠️ Mutation-témoin : retirer la mention de la suffixation (ex. `E1-a`,
  // `E1.b`, `E1 (finding 2)`) du paragraphe D1 → rouge. Sans elle, un titre
  // suffixé (le cas réel de `specs/skill-56.md`, réparé par ce même ticket)
  // resterait dans une zone grise non couverte par la prescription.
  it('le paragraphe D1 mentionne explicitement la suffixation du tag', () => {
    const p = paragrapheD1(readSkill());
    expect(
      /suffix/i.test(p),
      `${SDD_FILE} § 6.6.5 : le paragraphe D1 ne mentionne plus la ` +
        `possibilité de suffixer le tag (ex. \`E1-a\`, \`E1 (finding 2)\`).`
    ).toBe(true);
  });
});

// SKILL-105 (D1, tag) — la TROISIÈME source de l'Étape 6.6.5 (le constat que
// l'orchestrateur forme lui-même à l'Étape 6.6) est elle aussi taguée `E1`,
// JAMAIS `E3` : un constat conteste le *quoi*, il n'a aucun test à faire
// rougir. Sa forme de suffixe est celle DÉJÀ EN USAGE dans le corpus —
// `E1 (constat d'Étape 6.6)`, portée par specs/skill-102.md, specs/skill-107.md
// et specs/skill-86.md — pour que les trois entrées existantes restent lisibles
// par `backlog escalations` (BLG-08), qui ne reconnaît que le PRÉFIXE.
describe('SKILL-105 — D1 : la troisième source est taguée `E1`, avec sa forme de suffixe', () => {
  // ⛔ Assertions bornées à la PHRASE de la troisième source à l'intérieur de
  // `paragrapheD1`, jamais à la puce entière : `E3` et `E1/E3` y figurent déjà
  // légitimement pour les autres sources, et une assertion large resterait
  // verte sous sa propre mutation — le finding 3 de SKILL-64 est exactement ce
  // piège, et ce fichier en porte déjà la trace deux fois.
  const phraseTroisiemeSource = (raw) =>
    sectionEntre(
      platir(paragrapheD1(raw)),
      "Une escalade de source « constat d'orchestrateur »",
      'Un lecteur mécanique',
      SDD_FILE
    );

  // ⚠️ Mutation : autoriser `E3` pour cette source (« taguée `E1` ou `E3` ») →
  // rouge sur la seconde assertion.
  it('la phrase de la troisième source impose `E1`, et n’ouvre PAS `E3`', () => {
    const p = phraseTroisiemeSource(readSkill());
    expect(
      p.includes('`E1`'),
      `${SDD_FILE} § 6.6.5 : la phrase de la troisième source ne prescrit plus ` +
        `le tag \`E1\`.`
    ).toBe(true);
    expect(
      /E3/.test(p),
      `${SDD_FILE} § 6.6.5 : la phrase de la troisième source nomme \`E3\` — ` +
        `un constat conteste le *quoi*, il n'a aucun test à faire rougir.`
    ).toBe(false);
  });

  // ⚠️ Mutation : retirer `(constat d'Étape 6.6)` → rouge. C'est la forme DÉJÀ
  // en usage : en changer garderait les trois entrées existantes lisibles par
  // le préfixe, mais perdrait la continuité de lecture du corpus.
  it("la phrase cite la forme de suffixe en usage, `E1 (constat d'Étape 6.6)`", () => {
    const p = phraseTroisiemeSource(readSkill());
    expect(
      p.includes("(constat d'Étape 6.6)"),
      `${SDD_FILE} § 6.6.5 : la phrase de la troisième source ne cite plus la ` +
        `forme de suffixe déjà en usage, \`E1 (constat d'Étape 6.6)\`.`
    ).toBe(true);
  });

  // ⛔ NON-RÉGRESSION à constater, pas à ré-assertionner : l'assertion existante
  // bornée à 40 caractères (premier `it()` de ce fichier) reste verte. Si elle
  // rougit, c'est l'insertion qui est au mauvais endroit de la puce, pas elle.
});

describe('SKILL-64 — D1 bis : la profondeur du titre (`###`) est elle aussi prescrite', () => {
  // ⚠️ Mutation-témoin : retirer la phrase fixant la profondeur (niveau 3,
  // jamais `##` ni `####`) → rouge. Sans elle, la position du tag est fixée
  // mais la profondeur du titre reste inférée par le lecteur BLG-08 — le même
  // trou que celui que D1 ferme pour la position, déplacé vers la profondeur
  // (revue, finding 6).
  it('la section 6.6.5 prescrit que chaque escalade est un titre de niveau 3 (`###`)', () => {
    const section = etape665(readSkill());
    expect(
      /niveau 3 \(`###`\)/.test(section),
      `${SDD_FILE} § 6.6.5 ne prescrit plus explicitement que chaque ` +
        `escalade est un titre de niveau 3 (\`###\`) sous le conteneur.`
    ).toBe(true);
  });
});

describe('SKILL-64 — D3 : specs/skill-56.md réparé, uniquement le titre', () => {
  // ⚠️ Mutation-témoin : restaurer `### Finding 2 de la gate — E1` (tag en
  // queue) → rouge. C'est exactement le titre invisible au lecteur BLG-08
  // mesuré dans specs/skill-64.md, § Problème.
  it('specs/skill-56.md : l’ancien titre non conforme (tag en queue) a disparu', () => {
    const raw = readSkill56();
    expect(
      raw.includes('### Finding 2 de la gate — E1'),
      `${SKILL56_FILE} porte encore l'ancien titre non conforme (tag en ` +
        `queue) — la réparation D3 a été défaite.`
    ).toBe(false);
  });

  // ⚠️ Mutation-témoin (finding 7) : localise le titre par le CONTENU
  // (paragraphe « Les trois relecteurs… », unique dans le fichier), pas par
  // position (« le premier `###` après le conteneur ») — l'ancienne version
  // ne testait QUE le premier `###` rencontré, donc une future entrée
  // ajoutée AVANT celle-ci (append légitime, § Étape 6.6.5 : « si elle existe
  // déjà, ajoute une entrée dedans ») serait passée sous silence sans jamais
  // faire rougir ce test. Grammaire élargie aux trois tags et à la
  // suffixation (D1), pas seulement `E1` littéral.
  it('specs/skill-56.md : le titre de l’escalade "Finding 2 de la gate" commence par son tag', () => {
    const raw = readSkill56();
    const containerIdx = raw.indexOf('## Escalades (D10)');
    expect(
      containerIdx,
      `${SKILL56_FILE} : "## Escalades (D10)" introuvable.`
    ).not.toBe(-1);
    const tail = raw.slice(containerIdx);
    const marker = 'Les trois relecteurs ont remonté la même contradiction';
    const markerIdx = tail.indexOf(marker);
    expect(
      markerIdx,
      `${SKILL56_FILE} : le paragraphe identifiant l'escalade "Finding 2 de ` +
        `la gate" est introuvable sous "## Escalades (D10)".`
    ).not.toBe(-1);
    const before = tail.slice(0, markerIdx).split('\n');
    let titleLine;
    for (let i = before.length - 1; i >= 0; i--) {
      if (before[i].startsWith('### ')) {
        titleLine = before[i];
        break;
      }
    }
    expect(
      titleLine,
      `${SKILL56_FILE} : aucun \`###\` trouvé avant le paragraphe qui ` +
        `identifie l'escalade "Finding 2 de la gate".`
    ).not.toBeUndefined();
    expect(
      /^###\s+(E1|E3|E1\/E3)(?![A-Za-z0-9])/.test(titleLine),
      `${SKILL56_FILE} : le titre "${titleLine}" ne commence pas par un tag ` +
        `conforme à D1 (\`E1\`, \`E3\` ou \`E1/E3\`, éventuellement suffixé) ` +
        `— la grammaire attendue par \`backlog escalations\` (BLG-08) exige ` +
        `le tag en tête.`
    ).toBe(true);
  });

  // SKILL-71 (reprise, finding 1 : le motif retiré ailleurs dans ce fichier
  // survivait ici intact) : cette assertion sur un compte de lignes en dur
  // vivait ici et rougissait au premier arbitrage légitime de l'escalade
  // `specs/skill-56.md:308` (« E1 — Finding 2 de la gate »), OUVERTE à ce
  // jour. `closeEscalation` (`insertClosureMarker`, `tools/backlog/
  // backlog.mjs`) insère son marqueur exactement dans le paragraphe de
  // l'escalade close, donc `node tools/backlog/backlog.mjs escalations close
  // SKILL-56 --by <TICKET> --date <jour>` aurait fait passer ce fichier à 359
  // lignes, sans aucun geste légal pour remettre `npm test` au vert — le §
  // Tests point 1 de specs/skill-71.md (« le fichier ne contient plus AUCUNE
  // assertion […] sur un compte de lignes en dur ») ne distingue d'ailleurs
  // pas cette occurrence des deux autres, RETIRÉES ci-dessus (describe
  // SKILL-67). Ce que cette batterie prétendait garantir — « la réparation
  // D3 (SKILL-64) n'a touché que la ligne du titre » — est un contrôle de
  // LIVRAISON, déjà attesté ailleurs (registre de revue, `git diff --stat`
  // du cycle SKILL-64), pas un invariant permanent. Le titre non conforme
  // (test ci-dessus) et sa grammaire restent, eux, couverts.
});

// SKILL-67 — SKILL-64 n'a réparé que specs/skill-56.md (sa portée déclarée) :
// quatre titres préexistants, dans specs/skill-62.md et specs/skill-65.md,
// portaient déjà leur tag E1 au milieu du titre (`### Finding N (E1) — …`) et
// restaient donc invisibles à `backlog escalations` (BLG-08), qui ne reconnaît
// une escalade qu'à un titre COMMENÇANT par son tag. Dette de corpus, pas un
// défaut du producteur (specs/skill-67.md, § Cause racine).

// Grammaire du tag, alignée LITTÉRALEMENT sur `GRAMMAR_TAG_RE`
// (`tools/backlog/backlog.mjs`, `lib/backlog/escalations.ts`) : un préfixe
// (`E1`, `E3` ou `E1/E3`, éventuellement suffixé), jamais une phrase entière
// verrouillée. Reprise (finding 6) : les assertions « commence par son tag »
// ci-dessous testaient une égalité littérale sur le TITRE COMPLET — D1 de
// SKILL-64 ne verrouille que la position du tag, pas le libellé qui suit.
const GRAMMAR_TAG_RE = /^(E1\/E3|E1|E3)(-[A-Za-z0-9]+|\.[A-Za-z0-9]+|\s+\([^)]*\))?(?![A-Za-z0-9])/;

// Retrouve la ligne `###` qui contient `libelle` (la queue du titre après le
// tag, unique dans le fichier par construction) et la rend telle quelle.
function ligneDuTitre(raw, libelle, fichier) {
  const idx = raw.indexOf(libelle);
  expect(idx, `${fichier} : libellé "${libelle}" introuvable.`).not.toBe(-1);
  const lineStart = raw.lastIndexOf('\n', idx) + 1;
  const lineEndIdx = raw.indexOf('\n', idx);
  return raw.slice(lineStart, lineEndIdx === -1 ? raw.length : lineEndIdx);
}

// Isole le corps d'une escalade : tout ce qui suit son titre jusqu'au
// PROCHAIN titre `##` ou `###` (celui qui suit dans CE fichier), ou la fin du
// fichier s'il n'y en a pas. Reprise (finding 3) : l'ancien bornage
// s'arrêtait UNIQUEMENT sur un `### ` suivant, donc courait jusqu'à EOF pour
// la dernière escalade d'un fichier — un `### ` ajouté PLUS TARD par un
// ticket futur (append légitime, § Étape 6.6.5) atterrirait alors DANS le
// corps mesuré ici, et un marqueur de clôture posé sur cette entrée neuve
// ferait rougir à tort l'assertion de l'entrée existante.
function corpsDeLEscalade(raw, titleLine, titleIdx) {
  const afterTitle = raw.slice(titleIdx + titleLine.length);
  const bodyLines = [];
  for (const line of afterTitle.split('\n')) {
    if (/^#{2,3}\s/.test(line)) break;
    bodyLines.push(line);
  }
  return bodyLines.join('\n');
}

// Table des quatre titres corrigés par ce ticket, un enregistrement par
// fichier. Reprise (finding 7) : les deux `describe` (un déroulé à la main
// pour specs/skill-62.md, un piloté par tableau pour specs/skill-65.md)
// étaient la MÊME batterie écrite deux fois — et avait déjà divergé sur le
// bornage du corps (finding 3). Une seule batterie, paramétrée par cette
// table, joue désormais les quatre mêmes assertions pour les deux fichiers.
const CIBLES_SKILL67 = [
  {
    file: SKILL62_FILE,
    read: readSkill62,
    entries: [
      {
        ancien:
          '### Finding 2 (E1) — la contrainte de nommage du § Tests rend le garde-fou inexécutable dans le pipeline de ce dépôt',
        libelle:
          'la contrainte de nommage du § Tests rend le garde-fou inexécutable dans le pipeline de ce dépôt',
      },
    ],
  },
  {
    file: SKILL65_FILE,
    read: readSkill65,
    entries: [
      {
        ancien: '### Finding 3 (E1) — D1 et la Vérification 4 se contredisent sur `specs/skill-62.md`',
        libelle: 'D1 et la Vérification 4 se contredisent sur `specs/skill-62.md`',
      },
      {
        ancien:
          '### Finding 10 (E1) — le ticket rend faux un énoncé de `/send` que D4 interdit de corriger',
        libelle: 'le ticket rend faux un énoncé de `/send` que D4 interdit de corriger',
      },
      {
        ancien:
          '### Finding 11 (E1) — mécaniser le contrôle des références pendantes, mais pas avant le finding 3',
        libelle: 'mécaniser le contrôle des références pendantes, mais pas avant le finding 3',
      },
    ],
  },
];

describe.each(CIBLES_SKILL67)(
  'SKILL-67 — D3 étendu : $file réparé, uniquement les titres',
  ({ file, read, entries }) => {
    // ⚠️ Mutation-témoin : restaurer L'UN des anciens titres (tag au milieu)
    // → rouge. C'est exactement la forme invisible à `backlog escalations`
    // mesurée dans specs/skill-67.md, § Symptôme.
    it(`${file} : les anciens titres non conformes (tag au milieu) ont disparu`, () => {
      const raw = read();
      for (const { ancien } of entries) {
        expect(
          raw.includes(ancien),
          `${file} porte encore l'ancien titre non conforme (tag au milieu) ` +
            `: "${ancien}" — la réparation D3 a été défaite.`
        ).toBe(false);
      }
    });

    // ⚠️ Mutation-témoin : remplacer, sur l'UN des titres corrigés, la
    // position du tag par une forme non conforme (queue, absent) → rouge.
    // Grammaire vérifiée par PRÉFIXE (`GRAMMAR_TAG_RE`), pas par égalité sur
    // le libellé entier — finding 6.
    it(`${file} : chaque titre corrigé commence par son tag, selon la grammaire D1`, () => {
      const raw = read();
      for (const { libelle } of entries) {
        const titleLine = ligneDuTitre(raw, libelle, file);
        expect(
          titleLine.startsWith('### '),
          `${file} : "${titleLine}" n'est pas un titre de niveau 3 (\`###\`).`
        ).toBe(true);
        expect(
          GRAMMAR_TAG_RE.test(titleLine.slice('### '.length)),
          `${file} : le titre "${titleLine}" ne commence pas par un tag ` +
            `conforme à D1 (\`E1\`, \`E3\` ou \`E1/E3\`, éventuellement suffixé).`
        ).toBe(true);
      }
    });

    // SKILL-71 (E1 de specs/skill-67.md, arbitrée par l'utilisateur le
    // 2026-08-25 en faveur du retrait) : les deux batteries d'assertions qui
    // vivaient ici — « le nombre de lignes du fichier n'a pas changé » et
    // « aucune des escalades visées ne porte de marqueur → Traitée par » —
    // ont été RETIRÉES en tant que tests permanents. `closeEscalation`
    // (`insertClosureMarker`, `tools/backlog/backlog.mjs`) insère le marqueur
    // exactement dans le paragraphe de l'escalade qu'il clôt : les deux
    // batteries rougissaient donc ensemble au premier arbitrage légitime
    // d'une des entrées visées — mesuré réellement le 2026-08-25 quand
    // l'escalade de specs/skill-62.md a été close (caduque, traitée de fait
    // par SKILL-65), sans qu'aucun geste légal n'existe pour remettre la
    // suite au vert.
    //
    // Ce que ces deux batteries prétendaient garantir — « ce ticket (SKILL-67)
    // n'a rien arbitré au passage » — est un contrôle de LIVRAISON, pas un
    // invariant : un test permanent ne sait pas dire « à la date de
    // livraison ». L'attestation existe déjà ailleurs : le registre de revue
    // du cycle SKILL-67 et le `git diff --stat` de son § Vérification.
    // L'en-tête de ce fichier (écrit par SKILL-64) l'annonçait déjà pour le
    // marqueur seul ; SKILL-67 l'a réintroduit sous une forme équivalente
    // (compte de lignes) que le même raisonnement condamne. Voir la preuve
    // ci-dessous (describe SKILL-71) : sur une copie jetable du corpus où un
    // marqueur de clôture est inséré, ce qui RESTE de cette batterie — titre
    // absent, grammaire du tag — demeure vert.
    //
    // ⚠️ SKILL-72 (finding 8 de la gate) : la preuve SKILL-71 ci-dessous
    // ciblait une escalade codée EN DUR (« Finding 3 », puis « Finding 10 »
    // après une première reprise) — exactement la dépendance à un état
    // mutable que ce paragraphe dénonce pour les DEUX batteries retirées.
    // `escalations close` sur cette cible-là aurait cassé son sanity check au
    // prochain arbitrage légitime, pour la même raison. La preuve choisit
    // désormais sa cible DYNAMIQUEMENT, à l'exécution, parmi les entrées de
    // `CIBLES_SKILL67` (skill-65) : la première dont le corps ne porte pas
    // encore de marqueur de clôture.
  }
);

// SKILL-71 — reproduit localement le geste de `insertClosureMarker`
// (`tools/backlog/backlog.mjs`) : insère `markerText` en tant que NOUVELLE
// ligne, juste après `titleLine`. Reproduit ici plutôt qu'importé : le fichier
// source est un artefact bundlé qui exécute `main()` à l'import (pas de
// fonctions exportées) — voir le commentaire d'alignement plus haut sur
// `GRAMMAR_TAG_RE`/`CONTAINER_RE`/`FENCE_RE`, même précédent.
function fermerLocalement(raw, titleLine, markerText) {
  const titleIdx = raw.indexOf(titleLine);
  const afterTitleLine = titleIdx + titleLine.length;
  const insertAt = raw.indexOf('\n', afterTitleLine) + 1;
  return raw.slice(0, insertAt) + markerText + '\n' + raw.slice(insertAt);
}

describe('SKILL-71 — preuve que le motif est fermé, pas déplacé', () => {
  // SKILL-71 (reprise, finding 2 : la preuve initiale ciblait
  // specs/skill-62.md, dont l'escalade visée porte DÉJÀ, avant toute
  // mutation, un marqueur → Traitée par SKILL-65 (2026-08-25) — le § Symptôme
  // du ticket le dit explicitement. `bodyMutated.includes('→ Traitée par')`
  // y était donc vrai QUE la mutation s'applique ou non, un `fermerLocalement`
  // cassé (ex. `return raw`) restait invisible.
  //
  // ⚠️ SKILL-72 (finding 8 de la gate) : deux ciblages successifs codés EN DUR
  // (« Finding 3 », puis « Finding 10 ») ont chacun cassé au premier
  // `escalations close` légitime de l'entrée visée. SKILL-75 (finding 3 de sa
  // propre reprise) a ensuite montré que même un ciblage DYNAMIQUE sur le
  // corpus réel reste condamné : `CIBLES_SKILL67` est figé en dur, donc dès
  // que ses trois entrées sont closes (ce qui a fini par arriver), plus aucune
  // n'est OUVERTE — le test se serait retrouvé skippé pour toujours, et
  // `fermerLocalement` n'aurait plus jamais été exercé par personne (finding 3).
  // SKILL-75 (finding 2 de la même reprise) a aussi montré qu'un calcul fait à
  // la COLLECTE du module, qui appelle un helper qui `expect(...).not.toBe(-1)`
  // sur un libellé introuvable, fait tomber les 13 AUTRES tests de ce fichier
  // au premier renommage de titre dans le corpus — pas seulement celui-ci.
  //
  // Résolution retenue : une fixture SYNTHÉTIQUE, écrite ici, jamais lue depuis
  // le disque. Elle exerce EXACTEMENT la même mécanique (`ligneDuTitre`,
  // `corpsDeLEscalade`, `fermerLocalement`, `GRAMMAR_TAG_RE`) sur un texte que
  // ce test contrôle intégralement — ni le renommage d'un titre du corpus
  // (finding 2), ni la clôture de la dernière escalade ouverte du corpus
  // (finding 3) ne peuvent plus l'atteindre. Le prix : cette preuve ne dit
  // plus rien sur `specs/skill-65.md` en particulier — mais ce n'était déjà
  // plus son rôle (le describe.each ci-dessus couvre le corpus réel) ; son
  // rôle propre est de garder la géométrie de `fermerLocalement` seule.
  const SYNTHETIC_FILE = 'fixture synthétique (SKILL-75, sans dépendance au corpus)';
  const SYNTHETIC_LIBELLE = 'preuve synthétique de la géométrie du marqueur de clôture';
  const SYNTHETIC_TITLE_LINE = `### E1 (finding 999) — ${SYNTHETIC_LIBELLE}`;
  // Forme non conforme (tag au milieu) qu'on s'assure de ne jamais produire —
  // jamais présente dans la fixture, donc l'assertion sur son absence est un
  // simple filet de non-régression sur `fermerLocalement` (il ne doit pas
  // réécrire le titre), pas une preuve sur un historique réel.
  const SYNTHETIC_ANCIEN = `### Finding 999 (E1) — ${SYNTHETIC_LIBELLE}`;
  const SYNTHETIC_RAW = [
    '## Escalades (D10)',
    '',
    SYNTHETIC_TITLE_LINE,
    '',
    'Corps synthétique de démonstration, sans marqueur de clôture.',
    '',
    '### Section suivante (sentinelle de bornage)',
    'Ne doit jamais être incluse dans le corps mesuré ci-dessus.',
    '',
  ].join('\n');

  it('une fixture synthétique, avec un marqueur de clôture inséré (+1 ligne), reste conforme à ce qui reste de la batterie SKILL-67', () => {
    const titleLine = ligneDuTitre(SYNTHETIC_RAW, SYNTHETIC_LIBELLE, SYNTHETIC_FILE);
    const titleIdx = SYNTHETIC_RAW.indexOf(titleLine);
    const bodyAvant = corpsDeLEscalade(SYNTHETIC_RAW, titleLine, titleIdx);

    // Sanity check de la fixture elle-même : l'escalade synthétique doit
    // démarrer OUVERTE — sinon la vérification suivante (marqueur présent
    // après mutation) ne prouve rien.
    expect(
      bodyAvant.includes('→ Traitée par'),
      'la fixture synthétique doit démarrer sans marqueur de clôture.'
    ).toBe(false);

    const avant = (SYNTHETIC_RAW.match(/\n/g) || []).length;
    const mutated = fermerLocalement(SYNTHETIC_RAW, titleLine, '→ Traitée par SKILL-99 (2026-09-01).');

    // Sanity check de la mutation elle-même : elle doit bien ajouter une
    // ligne et poser le marqueur dans le corps de CETTE escalade — sinon la
    // preuve ne démontre rien.
    const apres = (mutated.match(/\n/g) || []).length;
    expect(apres, 'la mutation-témoin devait ajouter exactement une ligne.').toBe(avant + 1);
    const titleIdxMutated = mutated.indexOf(titleLine);
    const bodyMutated = corpsDeLEscalade(mutated, titleLine, titleIdxMutated);
    expect(
      bodyMutated.includes('→ Traitée par'),
      'la mutation-témoin devait poser le marqueur dans le corps de l’escalade visée.'
    ).toBe(true);

    // Ce qui RESTE de la batterie SKILL-67 (titre corrigé absent de l'ancien
    // libellé, grammaire du tag) doit demeurer vert sur cette copie mutée —
    // c'est ce qui atteste que le motif est fermé, pas déplacé vers une autre
    // assertion équivalente.
    expect(
      mutated.includes(SYNTHETIC_ANCIEN),
      'la copie mutée ne devrait pas faire réapparaître un ancien titre non conforme.'
    ).toBe(false);
    const titleLineMutated = ligneDuTitre(mutated, SYNTHETIC_LIBELLE, SYNTHETIC_FILE);
    expect(
      GRAMMAR_TAG_RE.test(titleLineMutated.slice('### '.length)),
      'la clôture ne devrait pas altérer la grammaire du tag du titre.'
    ).toBe(true);
  });
});

describe('SKILL-67 — balayage du corpus : aucun `###` sous "## Escalades (D10)" ne contient un token E1/E3 sans commencer par lui', () => {
  // Détection alignée sur `scanFile` (tools/backlog/backlog.mjs,
  // `lib/backlog/escalations.ts`), pas sur un `indexOf` de sous-chaîne
  // (finding 1) : le conteneur et les titres sont reconnus par des TITRES de
  // niveau 2/3 en DÉBUT DE LIGNE, et un bloc de code (```) est ignoré comme
  // dans `scanFile` (`FENCE_RE`), pas compté comme du texte (finding 5).
  // Sans ces deux corrections, un fichier qui CITE "## Escalades (D10)" en
  // prose ou en exemple avant sa vraie section (specs/skill-64.md § Portée,
  // specs/skill-67.md § Symptôme et § Cause racine, tous deux dans le corpus)
  // fait dérailler le balayage vers la mauvaise fenêtre — ou pire, un exemple
  // de titre non conforme cité DANS un bloc de code (specs/skill-64.md,
  // l. 70-72, l'exemple canonique de D1) se ferait compter comme une
  // véritable escalade non conforme.
  const CONTAINER_RE = /^Escalades \(D10\)/;
  const FENCE_RE = /^\s*```/;
  const TOKEN_RE = /(?<![A-Za-z0-9])(E1|E3)(?![A-Za-z0-9])/;

  // ⚠️ Mutation-témoin : réintroduire, dans N'IMPORTE QUEL specs/*.md sous
  // "## Escalades (D10)", un `###` dont le titre contient `E1` ou `E3` sans
  // commencer par ce tag (ex. remettre `### Finding 2 (E1) — …` dans
  // specs/skill-62.md) → rouge. C'est ce balayage — et lui seul — qui attrape
  // un CINQUIÈME cas déposé demain : les assertions ciblées ci-dessus ne
  // couvrent que les quatre titres connus au moment de l'écriture de ce
  // ticket (specs/skill-67.md, § Tests point 2).
  it('tout specs/*.md : sous "## Escalades (D10)", tout `###` portant un token E1/E3 commence par lui', () => {
    const specsDir = path.join(REPO_ROOT, 'specs');
    const filenames = fs.readdirSync(specsDir).filter((f) => f.endsWith('.md'));
    const offenders = [];

    for (const filename of filenames) {
      const raw = readNormalized(REPO_ROOT, `specs/${filename}`);
      let inSection = false;
      let inFence = false;
      for (const line of raw.split('\n')) {
        if (FENCE_RE.test(line)) {
          inFence = !inFence;
          continue;
        }
        if (inFence) continue;
        const h2 = /^##\s+(.*)$/.exec(line);
        if (h2) {
          inSection = CONTAINER_RE.test(h2[1]);
          continue;
        }
        if (!inSection) continue;
        const h3 = /^###\s+(.*)$/.exec(line);
        if (!h3) continue;
        const title = h3[1];
        if (!TOKEN_RE.test(title)) continue; // pas d'escalade E1/E3 (ex. "### Leçon…")
        if (!GRAMMAR_TAG_RE.test(title)) offenders.push(`${filename} : "${line}"`);
      }
    }

    expect(
      offenders,
      `Titres d'escalade contenant un token E1/E3 sans commencer par lui ` +
        `(invisibles à \`backlog escalations\`, BLG-08) :\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
