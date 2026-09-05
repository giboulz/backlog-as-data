// Verrou anti-récidive de SKILL-33 — SKILL-35.
//
// SKILL-33 a remis git d'accord avec le runtime (`tools/backlog/backlog.mjs`
// est désormais identique, octet pour octet, entre le bundle commité et le
// bundle exécuté). Mais rien n'empêchait la dérive de recommencer : le trou
// est structurel, pas accidentel. Le dépôt tenait deux arêtes d'un triangle à
// trois sommets (`commands/backlog.md` ↔ `commands/sdd-run-ticket.md` via F4 ;
// `commands/backlog.md` ↔ `EFFORTS_OFFICIELS` en dur via L1), et jamais la
// troisième : `commands/backlog.md` ↔ `tools/backlog/backlog.mjs` lui-même.
// C'est cette troisième arête que ce fichier ferme. Initialement sur `effort`
// et `review` UNIQUEMENT — `model` était explicitement hors du verrou (cf.
// § Décision de specs/skill-35.md, escalade E1/E3 de SKILL-33). Cet arbitrage
// a été rendu par SKILL-40 (2026-08-21) et l'axe `model` a rejoint le verrou
// via la famille M1.5 (SKILL-41) : les trois axes sont désormais couverts.
//
// ⚠️ Chaque test ci-dessous documente, en commentaire, la mutation qui doit le
// faire rougir (convention D3 de ce dépôt, cf. commands-shape-coherence.test.js).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..');

const BACKLOG_FILE = 'commands/backlog.md';
const BUNDLE_FILE = 'tools/backlog/backlog.mjs';

// Lecture en TEXTE, jamais en ESM (cf. specs/skill-35.md, § « Lecture en
// texte, jamais en ESM ») : le bundle pèse ~656 Ko et un import ESM d'un
// .mjs CRLF fait rapporter à Vitest une fausse SyntaxError (SKILL-14). On lit
// donc en utf8 et on normalise CRLF → LF, comme le reste du dépôt
// (__tests__/helpers/prompt-blocks.js:35). `.gitattributes` porte déjà
// `tools/backlog/* text eol=lf` (posé par SKILL-33) — ne pas le reposer, la
// normalisation à la lecture protège autre chose (le working tree local d'un
// contributeur autocrlf, indépendamment de ce que git a commité).
function readNorm(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8').replace(/\r\n/g, '\n');
}

// --- Extracteurs locaux (copie délibérée, cf. specs/skill-35.md § Tests) ---
//
// F4 (SKILL-04) possède déjà `extractEnumFromUsageLine` / L1 (SKILL-27)
// possède `extractEnumFromSetNotation` — tous deux appartiennent à
// commands-shape-coherence.test.js et ne doivent pas être touchés par ce
// ticket. Copie locale, même convention que la triple copie de
// `findDeclared` documentée à F3 de ce même fichier.

// La ligne d'usage `mature` de commands/backlog.md : forme
// `--effort <low\|medium\|high\|xhigh\|max>`, le `|` d'une table markdown
// étant échappé par un backslash LITTÉRAL (pas une classe regex). `trim()`
// sur chaque valeur : un reformatage cosmétique aérant la cellule
// (`<low \| medium \| …>`) ne doit pas produire de faux négatif face aux
// valeurs du bundle (extractBundleConst ci-dessous trime déjà les siennes) —
// les deux extracteurs doivent rendre la MÊME normalisation, sinon l'égalité
// stricte de M1.2 rougit sur un espace, pas sur un vrai désaccord.
function extractUsageEnum(raw, flag) {
  const re = new RegExp('--' + flag + ' <([^>]+)>');
  const m = re.exec(raw);
  if (!m) return null;
  return m[1].split('\\|').map((s) => s.trim());
}

// Le tableau littéral affecté à une constante du bundle : motif
// `NAME = [ ... ]`. Vise l'AFFECTATION explicitement — pas la ligne
// `var A, B, EXEC_EFFORTS, …;` (l'entête de hoisting d'esbuild, sans `=`), ni
// l'usage `enum(EXEC_EFFORTS)` (sans `=` non plus) : le `=\s*\[` exclut les
// deux par construction.
//
// `\b` de part et d'autre du nom : le bundle porte des paires
// `LEGACY_<NOM>` / `<NOM>` pour l'axe model (tools/backlog/backlog.mjs:
// 15274-15275, cf. M1.5 plus bas). Un motif non ancré matcherait la PREMIÈRE
// affectation dont l'identifiant *se termine* par `name` — ici la variante
// `LEGACY_`, qui
// n'est pas la constante canonique. `\b` est un point sûr : underscore et
// lettres sont tous deux `\w`, donc un motif `\b<NAME>\b` ne matche JAMAIS à
// l'intérieur d'un mot contigu `LEGACY_<NAME>` (aucune frontière \w/\W entre
// le `_` final de `LEGACY_` et le premier caractère de `<NAME>`).
function extractBundleConst(raw, name) {
  const re = new RegExp('\\b' + name + '\\b\\s*=\\s*\\[([^\\]]*)\\]');
  const m = re.exec(raw);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0);
}

// Hissées au niveau module — lues UNE fois chacune, jamais rappelées dans les
// `it` individuels (le bundle pèse ~656 Ko ; le relire dans chaque test qui
// en a besoin en multiplierait le coût, exactement ce que specs/skill-35.md
// §« Lecture en texte » invoque pour justifier de ne pas l'importer).
const backlogRaw = readNorm(BACKLOG_FILE);
const bundleRaw = readNorm(BUNDLE_FILE);

describe('M1.1 (SKILL-35) — les deux sources existent et sont lisibles', () => {
  // Le bundle est un artefact COMMITÉ, jamais une dépendance optionnelle :
  // absent, c'est un dépôt cassé, pas un cas à sauter en silence (cf.
  // specs/skill-35.md, § « Le fichier lu est celui du working tree »).
  //
  // ⚠️ Mutation D3 : renommer/supprimer tools/backlog/backlog.mjs → rouge.
  it(`${BUNDLE_FILE} est présent`, () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, BUNDLE_FILE)),
      `${BUNDLE_FILE} est absent — c'est un artefact COMMITÉ (copié depuis ` +
        `backlog-cli), sa présence n'est jamais optionnelle. Un dépôt sans lui ` +
        `est cassé.`
    ).toBe(true);
  });

  // ⚠️ Mutation D3 : retirer entièrement le `--effort <...>` littéral de la
  // ligne `mature` de commands/backlog.md → rouge.
  it(`${BACKLOG_FILE} cite un --effort <...> littéral et non vide`, () => {
    const values = extractUsageEnum(backlogRaw, 'effort');
    expect(values, `${BACKLOG_FILE} ne contient aucun --effort <...> littéral.`).not.toBeNull();
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v, `${BACKLOG_FILE} : valeur vide dans --effort <...>.`).not.toEqual('');
    }
  });

  // ⚠️ Mutation D3 : retirer entièrement le `--review <...>` littéral de la
  // ligne `mature` de commands/backlog.md → rouge.
  it(`${BACKLOG_FILE} cite un --review <...> littéral et non vide`, () => {
    const values = extractUsageEnum(backlogRaw, 'review');
    expect(values, `${BACKLOG_FILE} ne contient aucun --review <...> littéral.`).not.toBeNull();
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v, `${BACKLOG_FILE} : valeur vide dans --review <...>.`).not.toEqual('');
    }
  });

  // ⚠️ Mutation D3 : remplacer le motif d'extraction par un motif qui ne
  // matche jamais (ex. renommer EXEC_EFFORTS dans le bundle sans mettre à
  // jour l'extracteur, ou casser la forme `NAME = [...]`) → cette assertion
  // doit rougir avec un message explicite — jamais rendre un tableau vide qui
  // passerait trivialement les égalités de M1.2 (piège documenté dans
  // specs/skill-35.md § M1.1).
  it(`${BUNDLE_FILE} : EXEC_EFFORTS est extractible`, () => {
    const values = extractBundleConst(bundleRaw, 'EXEC_EFFORTS');
    expect(
      values,
      `${BUNDLE_FILE} : EXEC_EFFORTS n'a pas pu être extrait — la forme du ` +
        `bundle a changé (esbuild régénéré différemment ?). Le verrou doit ` +
        `hurler, pas se désarmer en silence.`
    ).not.toBeNull();
    expect(values.length).toBeGreaterThan(0);
  });

  // ⚠️ Mutation D3 : idem, sur EXEC_REVIEWS.
  it(`${BUNDLE_FILE} : EXEC_REVIEWS est extractible`, () => {
    const values = extractBundleConst(bundleRaw, 'EXEC_REVIEWS');
    expect(
      values,
      `${BUNDLE_FILE} : EXEC_REVIEWS n'a pas pu être extrait — la forme du ` +
        `bundle a changé (esbuild régénéré différemment ?). Le verrou doit ` +
        `hurler, pas se désarmer en silence.`
    ).not.toBeNull();
    expect(values.length).toBeGreaterThan(0);
  });
});

describe('M1.2 (SKILL-35) — la doc prescrit exactement ce que le bundle accepte', () => {
  // Égalité STRICTE (valeurs ET ordre), pas une inclusion. `LEGACY_EFFORT_ALIASES`
  // (none|think|think-hard|ultrathink) n'entre PAS dans la comparaison : ce
  // sont des alias normalisés À L'ÉCRITURE, que L1 interdit déjà de citer dans
  // commands/backlog.md. Comparer à l'ensemble ACCEPTÉ EN ENTRÉE plutôt qu'à
  // l'ensemble CANONIQUE (EXEC_EFFORTS) autoriserait la doc à republier le
  // vocabulaire d'avant BLG-01 sans que ce test le voie.
  //
  // ⚠️ Mutation D3 : remplacer `xhigh` par `ultra` dans la ligne 49 de
  // commands/backlog.md, sans toucher au bundle → rouge (« la doc dérive »).
  it(`${BACKLOG_FILE} --effort == ${BUNDLE_FILE} EXEC_EFFORTS (valeurs et ordre)`, () => {
    const docValues = extractUsageEnum(backlogRaw, 'effort');
    const bundleValues = extractBundleConst(bundleRaw, 'EXEC_EFFORTS');
    expect(
      docValues,
      `${docValues} vs ${JSON.stringify(bundleValues)} : ${BACKLOG_FILE} ` +
        `prescrit --effort <${(docValues || []).join('|')}>, mais ` +
        `${BUNDLE_FILE} n'accepte en écriture que EXEC_EFFORTS = ` +
        `${JSON.stringify(bundleValues)}. Aligne l'un sur l'autre.`
    ).toEqual(bundleValues);
  });

  // ⚠️ Mutation D3 : remplacer "deep" par "heavy" dans EXEC_REVIEWS du bundle,
  // sans toucher la doc → rouge (« l'outil dérive » — c'est le sens que
  // SKILL-33 a subi et qu'aucun test existant ne voyait).
  it(`${BACKLOG_FILE} --review == ${BUNDLE_FILE} EXEC_REVIEWS (valeurs et ordre)`, () => {
    const docValues = extractUsageEnum(backlogRaw, 'review');
    const bundleValues = extractBundleConst(bundleRaw, 'EXEC_REVIEWS');
    expect(
      docValues,
      `${docValues} vs ${JSON.stringify(bundleValues)} : ${BACKLOG_FILE} ` +
        `prescrit --review <${(docValues || []).join('|')}>, mais ` +
        `${BUNDLE_FILE} n'accepte en écriture que EXEC_REVIEWS = ` +
        `${JSON.stringify(bundleValues)}. Aligne l'un sur l'autre.`
    ).toEqual(bundleValues);
  });

  // ⚠️ Mutation D3 : réordonner l'un des deux énumérés sans changer les
  // valeurs (ex. ["medium","low","high","xhigh","max"]) → rouge : l'ordre
  // porte du sens (c'est l'échelle de dosage), `toEqual` sur un array est
  // déjà sensible à l'ordre — ce test le couvre par construction des deux
  // tests ci-dessus, documenté ici pour mémoire.
});

describe('M1.3 (SKILL-35) — la constante lue est branchée sur le schéma', () => {
  // Lire `EXEC_EFFORTS = [...]` ne prouve pas que cette constante pilote quoi
  // que ce soit : un bundle où le schéma serait recâblé sur une autre liste
  // laisserait M1.2 vert sur une constante MORTE. On asserte donc que le
  // schéma zod utilise bien `enum(EXEC_EFFORTS)` / `enum(EXEC_REVIEWS)`
  // (tools/backlog/backlog.mjs:15330-15331).
  //
  // ⚠️ Mutation D3 : recâbler le schéma sur une liste littérale
  // (`enum(["a","b"])`) en laissant EXEC_EFFORTS intact → rouge.
  it(`${BUNDLE_FILE} : le schéma d'écriture utilise enum(EXEC_EFFORTS)`, () => {
    expect(
      /enum\(\s*EXEC_EFFORTS\s*\)/.test(bundleRaw),
      `${BUNDLE_FILE} ne contient plus "enum(EXEC_EFFORTS)" — la constante ` +
        `EXEC_EFFORTS n'est peut-être plus branchée sur le schéma d'écriture ` +
        `(cmdMature), auquel cas M1.2 validerait une constante morte.`
    ).toBe(true);
  });

  // ⚠️ Mutation D3 : idem, sur EXEC_REVIEWS.
  it(`${BUNDLE_FILE} : le schéma d'écriture utilise enum(EXEC_REVIEWS)`, () => {
    expect(
      /enum\(\s*EXEC_REVIEWS\s*\)/.test(bundleRaw),
      `${BUNDLE_FILE} ne contient plus "enum(EXEC_REVIEWS)" — la constante ` +
        `EXEC_REVIEWS n'est peut-être plus branchée sur le schéma d'écriture ` +
        `(cmdMature), auquel cas M1.2 validerait une constante morte.`
    ).toBe(true);
  });
});

describe('M1.5 (SKILL-41) — model rejoint le verrou (dérivation entière, pas seulement son premier maillon)', () => {
  // Arbitrage rendu par SKILL-40 (2026-08-21) : `commands/backlog.md:49` est
  // désormais aligné sur `<fable\|opus\|sonnet>`. La garde qui interdisait à
  // ce fichier de citer la constante d'acceptation du bundle pour l'axe
  // `model` (SKILL-35) est supprimée dans ce même ticket — c'est ce qui
  // permet à ce describe de le faire.
  //
  // La forme naïve (comparer `--model` à EXEC_MODELS, seul) reproduirait le
  // défaut que M1.3 existe pour empêcher côté effort/review : EXEC_MODELS
  // n'est branché sur AUCUN schéma, il ne sert qu'à construire
  // READ_TOLERANT_MODELS. Ce qui refuse réellement une écriture sur `model`
  // tient par TROIS maillons : EXEC_MODELS (valeurs officielles) +
  // LEGACY_EXEC_MODELS (valeurs tolérées en lecture seule, refusées une par
  // une, en dur, dans cmdMature) + le branchement enum(READ_TOLERANT_MODELS)
  // sur le schéma de lecture. M1.5.1-M1.5.4 verrouillent chacun un maillon ;
  // M1.5.5 verrouille le maillon faible (le refus en dur par valeur legacy).
  const SDD_FILE = 'commands/sdd-run-ticket.md';
  const sddRaw = readNorm(SDD_FILE);

  // Copie locale, même convention que les copies documentées en tête de
  // fichier (extractUsageEnum / extractBundleConst) : F4
  // (commands-shape-coherence.test.js) possède déjà `extractEnumFromSetNotation`
  // et ne doit pas être touché par ce ticket.
  function extractSetNotation(raw, field) {
    const re = new RegExp('`' + field + '`\\s*∈\\s*\\{([^}]+)\\}');
    const m = re.exec(raw);
    if (!m) return null;
    return m[1].split(',').map((s) => s.trim().replace(/^`|`$/g, ''));
  }

  // ⚠️ Mutation-témoin : remplacer `sonnet` par `sonar` dans le `--model` de
  // commands/backlog.md:49, sans toucher au bundle → rouge.
  it(`${BACKLOG_FILE} --model == ${BUNDLE_FILE} EXEC_MODELS (valeurs et ordre)`, () => {
    const docValues = extractUsageEnum(backlogRaw, 'model');
    const bundleValues = extractBundleConst(bundleRaw, 'EXEC_MODELS');
    expect(
      docValues,
      `${docValues} vs ${JSON.stringify(bundleValues)} : ${BACKLOG_FILE} ` +
        `prescrit --model <${(docValues || []).join('|')}>, mais ` +
        `${BUNDLE_FILE} n'accepte en écriture que EXEC_MODELS = ` +
        `${JSON.stringify(bundleValues)}. Aligne l'un sur l'autre.`
    ).toEqual(bundleValues);
  });

  // Comparaison d'ENSEMBLES, ordre indifférent : la ligne de prose de
  // sdd-run-ticket.md:224 n'a aucune raison d'être ordonnée comme une
  // constante JS.
  //
  // ⚠️ Redondance ASSUMÉE avec F4 (commands-shape-coherence.test.js, qui
  // compare cette même ligne à `--model` de backlog.md ∪
  // MODELS_TOLERES_EN_LECTURE) : F4 est un contrôle doc↔doc, celui-ci est un
  // contrôle doc↔outil. Les deux touchent la même ligne depuis deux sources
  // différentes — supprimer l'un parce que l'autre est vert rouvrirait un des
  // deux trous (cf. specs/skill-41.md § Décision 3). Ne pas « simplifier ».
  //
  // ⚠️ Mutation-témoin A : retirer `haiku` de la ligne `` `model` ∈ {...} ``
  // de commands/sdd-run-ticket.md:224 → rouge (l'outil le tolère en lecture,
  // la doc ne le déclare plus).
  // ⚠️ Mutation-témoin B : ajouter `sonar` à cette même ligne → rouge.
  it(`${SDD_FILE} "model ∈ {...}" == ${BUNDLE_FILE} READ_TOLERANT_MODELS (ensembles)`, () => {
    // READ_TOLERANT_MODELS n'est PAS un tableau littéral dans le bundle (c'est
    // une dérivation par spread, cf. M1.5.3 ci-dessous) : extractBundleConst
    // ne peut donc pas l'extraire directement. On reconstitue ses valeurs
    // RÉSOLUES à partir de ses deux opérandes, chacun un tableau littéral.
    const sddValues = extractSetNotation(sddRaw, 'model');
    const execModels = extractBundleConst(bundleRaw, 'EXEC_MODELS');
    const legacyModels = extractBundleConst(bundleRaw, 'LEGACY_EXEC_MODELS');
    expect(sddValues, `${SDD_FILE} ne déclare aucun "model ∈ {...}".`).not.toBeNull();
    expect(execModels, `${BUNDLE_FILE} : EXEC_MODELS n'a pas pu être extrait.`).not.toBeNull();
    expect(
      legacyModels,
      `${BUNDLE_FILE} : LEGACY_EXEC_MODELS n'a pas pu être extrait.`
    ).not.toBeNull();
    const bundleValues = [...execModels, ...legacyModels];
    const actual = [...new Set(sddValues)].sort();
    const expected = [...new Set(bundleValues)].sort();
    expect(
      actual,
      `${SDD_FILE} "model ∈ {...}" = ${JSON.stringify(actual)} ; attendu ` +
        `${BUNDLE_FILE} READ_TOLERANT_MODELS = ${JSON.stringify(expected)}.`
    ).toEqual(expected);
  });

  // Garde d'unicité — pendant exact de L1.3 (commands-shape-coherence.test.js)
  // pour `effort` : `extractSetNotation` (comme `extractEnumFromSetNotation`
  // de F4) prend la PREMIÈRE occurrence de `` `model` ∈ {…} ``. Sans cette
  // garde, une seconde notation ajoutée ailleurs dans sdd-run-ticket.md (par
  // exemple le message d'arrêt concret de l'Étape 2, aujourd'hui encore en
  // prose) serait invisible à M1.5.2 comme à F4 : les deux continueraient de
  // comparer la première ligne, verte, pendant que la seconde dérive sans
  // surveillance — exactement le trou que L1.3 documente pour `effort`.
  //
  // ⚠️ Mutation-témoin : ajouter une seconde occurrence de
  // `` `model` ∈ {…} `` n'importe où dans commands/sdd-run-ticket.md → rouge.
  it(`${SDD_FILE} ne contient qu'UNE notation \`model\` ∈ {…}`, () => {
    const count = (sddRaw.match(/`model` ∈ \{/g) || []).length;
    expect(
      count,
      `${SDD_FILE} porte ${count} notation(s) \`model\` ∈ {…}. Une seule doit ` +
        `exister : M1.5.2 et F4 lisent la PREMIÈRE, et compareraient alors un ` +
        `énuméré qui ne pilote rien.`
    ).toBe(1);
  });

  // La dérivation elle-même : sans cette assertion, les deux tests
  // précédents parleraient de deux listes sans rapport prouvé entre elles.
  // Tolérant aux espaces, pas au réordonnancement des deux spreads —
  // EXEC_MODELS d'abord, ce qui fait que « écriture » est un préfixe de
  // « lecture ».
  //
  // ⚠️ Mutation-témoin (vérifiée EN MÉMOIRE sur une copie du contenu lu,
  // jamais en éditant tools/backlog/backlog.mjs — ce fichier est vendorisé) :
  // simuler un bundle où READ_TOLERANT_MODELS serait une liste littérale
  // (`["fable","opus","sonnet","haiku"]`) → rouge.
  it(`${BUNDLE_FILE} : READ_TOLERANT_MODELS dérive littéralement de EXEC_MODELS et LEGACY_EXEC_MODELS`, () => {
    expect(
      /READ_TOLERANT_MODELS\s*=\s*\[\s*\.\.\.EXEC_MODELS\s*,\s*\.\.\.LEGACY_EXEC_MODELS\s*\]/.test(
        bundleRaw
      ),
      `${BUNDLE_FILE} ne contient plus la dérivation littérale ` +
        `"READ_TOLERANT_MODELS = [...EXEC_MODELS, ...LEGACY_EXEC_MODELS]" — ` +
        `sans elle, rien ne prouve que la ligne de lecture de ${SDD_FILE} et ` +
        `EXEC_MODELS parlent bien de la même dérivation.`
    ).toBe(true);
  });

  // Pendant exact des deux `it` de M1.3 : la constante lue n'est pas morte,
  // elle est branchée sur le schéma de lecture.
  //
  // ⚠️ Mutation-témoin : recâbler le schéma sur une liste littérale en
  // laissant READ_TOLERANT_MODELS intacte → rouge.
  it(`${BUNDLE_FILE} : le schéma de lecture utilise enum(READ_TOLERANT_MODELS)`, () => {
    expect(
      /enum\(\s*READ_TOLERANT_MODELS\s*\)/.test(bundleRaw),
      `${BUNDLE_FILE} ne contient plus "enum(READ_TOLERANT_MODELS)" — la ` +
        `constante n'est peut-être plus branchée sur le schéma de lecture ` +
        `(cmdMature), auquel cas M1.5.2/M1.5.3 valideraient une constante morte.`
    ).toBe(true);
  });

  // Le maillon faible : LEGACY_EXEC_MODELS est une LISTE, le refus à
  // l'écriture est un `===` sur une chaîne écrit en dur, une fois par valeur.
  // Le jour où un legacy est ajouté sans son cas particulier, cette valeur
  // devient écrivable et M1.5.1 continuerait de mentir en restant vert (il ne
  // compare que EXEC_MODELS, pas LEGACY_EXEC_MODELS).
  //
  // ⚠️ Mutation-témoin (EN MÉMOIRE, jamais en éditant le bundle) : simuler
  // LEGACY_EXEC_MODELS = ["haiku","opus-4"] sans cas particulier
  // correspondant pour "opus-4" → rouge. C'est la mutation qui prouve que ce
  // ticket vaut mieux que la forme naïve de l'escalade.
  it(`${BUNDLE_FILE} : chaque valeur de LEGACY_EXEC_MODELS a son refus explicite dans cmdMature`, () => {
    const legacy = extractBundleConst(bundleRaw, 'LEGACY_EXEC_MODELS');
    expect(legacy, `${BUNDLE_FILE} : LEGACY_EXEC_MODELS n'a pas pu être extrait.`).not.toBeNull();
    // Pas d'assertion sur legacy.length ici : une extraction CASSÉE rend déjà
    // `null` (couvert ci-dessus par `not.toBeNull()`), jamais `[]`. Le seul
    // état atteignant la boucle suivante avec `legacy` vide est un
    // LEGACY_EXEC_MODELS réellement vide (un futur BLG retirant la tolérance
    // `haiku`) — cas où cette assertion est trivialement, et légitimement,
    // satisfaite : aucun legacy à vérifier.
    for (const v of legacy) {
      const needle = `flags.model === "${v}"`;
      expect(
        bundleRaw.includes(needle),
        `${BUNDLE_FILE} : la valeur legacy "${v}" (LEGACY_EXEC_MODELS) n'a pas ` +
          `de refus explicite ("${needle}" introuvable) — elle serait ÉCRIVABLE ` +
          `via mature alors que la doc ne l'annonce pas. Si ce test rougit sans ` +
          `qu'aucun legacy n'ait été touché, c'est peut-être esbuild qui a ` +
          `changé sa façon de rendre cette comparaison (bundle re-généré) : ` +
          `c'est un faux positif acceptable et bruyant, préférable à un faux ` +
          `négatif silencieux — vérifie la forme réelle avant de conclure à ` +
          `une régression du refus.`
      ).toBe(true);
    }
  });
});
