// SKILL-65 D2 — la garde de symétrie : liste des fichiers de test RÉELLEMENT
// jouables par vitest vs sélection du pipeline de `/send` (commands/send.md
// § Étape 0).
//
// Contexte (specs/skill-65.md § Problème) : `/send` est le SEUL exécutant de
// tests de ce dépôt (le hook Deploy est `push`, pas `deploy` — aucun `/deploy`
// derrière). Il sélectionne ses garde-fous structurels en DEUX mécanismes
// distincts, qui peuvent diverger silencieusement :
//   - DÉTECTION — un glob de fichiers : `__tests__/**/*-coherence.test.{js,ts}`
//     (le nom porte `-coherence`, AVEC LE TIRET littéral, borné à `__tests__/`) ;
//   - EXÉCUTION — un filtre vitest par nom : `npm test -- coherence`, qui cible
//     tout fichier dont le CHEMIN contient la sous-chaîne `coherence`, tiret ou
//     pas, où qu'il vive dans le dépôt.
// Un fichier nommé `coherence.test.js` (SANS tiret) satisferait la seconde
// moitié et pas la première — le cas réel documenté par specs/skill-62.md
// § Cause racine (`backlog-cli`). Cette garde attrape ce cas : elle vérifie les
// DEUX moitiés, jamais une seule (specs/skill-10.md § D1, « Les deux, ou
// rien »).
//
// ⚠️ Gate de reprise (2026-08-25, finding 4) : ce dépôt n'a pas de
// `vitest.config.*` — l'`include` par défaut de vitest est
// `**/*.{test,spec}.?(c|m)[jt]s?(x)` (vérifié :
// `node_modules/vitest/dist/config.js`), REPO ENTIER, pas seulement
// `__tests__/`, et pas seulement l'extension `.test.js`/`.test.ts`. La liste
// listée depuis le disque (`listTestFiles` ci-dessous) DOIT couvrir le même
// univers que ce que `npm test` joue réellement — sinon un fichier hors de
// `__tests__/`, ou d'extension `.mjs`/`.spec.js`, échapperait à cette garde
// tout en étant réellement joué par vitest : exactement le mode de
// dégradation silencieuse du § Problème 2 de la spec.
//
// ⚠️ D6 (specs/skill-65.md) — pourquoi ce dispositif encode l'exécution dans le
// NOM d'un fichier plutôt qu'ailleurs (un registre, un hook `settings.json`…) :
// c'est un couplage laid, et c'est le SEUL LEVIER DISPONIBLE TANT QUE /SEND
// RESTE GLOBAL — partagé par tous les projets adoptants (whereismycard,
// pathexilemarket, cockpitLean…), donc hors de portée d'un mécanisme de
// sélection scopé à ce seul dépôt (specs/skill-10.md § D3 : un hook
// `settings.json` tournerait pour un test qui ne concerne qu'ici). Le jour où
// `/send` cesse d'être partagé — ou acquiert un mécanisme de sélection par
// dépôt — cette question pourra être rouverte sans avoir à redécouvrir
// pourquoi elle a été tranchée ainsi.
//
// ⚠️ Résidu assumé, NON fermé par ce fichier (gate de reprise, finding 6) :
// le seul exécutant du pipeline de ce dépôt, `/send`, ne lance jamais qu'un
// `npm test` FILTRÉ (`commands/send.md` Étape 0 et 3.5, jamais un `npm test`
// complet — cf. `.claude/deploy.md`, `## Deploy: push`, sans `/deploy`
// derrière). Si CE fichier perd son propre suffixe `-coherence`, le filtre ne
// le sélectionne plus : ses propres assertions (dont T4 ci-dessous) ne
// tournent alors PAS dans le pipeline réel de `/send`, qui ne verrait donc
// rien — la disparition du dispositif serait silencieuse. T4 prouve
// l'invariant seulement quand quelqu'un lance `npm test` SANS filtre (à la
// main, ou via ce fichier lui-même tant qu'il porte encore `-coherence`) ;
// ce n'est pas un filet qui se referme tout seul dans le pipeline de
// livraison. C'est le prix explicite de D6 ci-dessus (« le seul levier
// disponible ») : ne pas le présenter comme plus solide qu'il ne l'est.
//
// ⚠️ La liste d'exceptions (EXCEPTIONS ci-dessous) est déclarée EN DUR, jamais
// dérivée du disque (D3 du dépôt) — un fichier hors filet doit faire rougir,
// pas disparaître silencieusement dans une liste recalculée.
//
// Style de la maison : pas d'helper partagé importé ici pour DÉCOUPER une
// section de `commands/*.md` — ce fichier liste un dossier et compare des
// motifs sur des chemins de fichiers, rien à réutiliser de
// `__tests__/helpers/prompt-blocks.js` pour ça. Il LIT en revanche
// `commands/send.md` pour ancrer ses deux regex sur le texte réel du pipeline
// (gate de reprise, finding 5) — voir « Ancrage sur commands/send.md »
// ci-dessous.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..');
const SEND_FILE = 'commands/send.md';

function readSendMd() {
  return fs.readFileSync(path.join(REPO_ROOT, SEND_FILE), 'utf8');
}

// --- Les deux moitiés du pipeline de /send (commands/send.md § Étape 0) -----

// DÉTECTION : le glob `__tests__/**/*-coherence.test.{js,ts}` — chemin sous
// `__tests__/`, nom portant `-coherence` AVEC LE TIRET littéral, extension
// .js ou .ts SEULEMENT (c'est /send qui borne ainsi, pas vitest).
const DETECTION_PATH_RE = /^__tests__\//;
const DETECTION_NAME_RE = /-coherence\.test\.(js|ts)$/;

// EXÉCUTION : le filtre vitest `-- coherence` — sous-chaîne `coherence`
// n'importe où dans le CHEMIN (pas seulement le nom du fichier), tiret ou
// pas, où qu'il vive dans le dépôt.
const EXECUTION_RE = /coherence/;

function isDetected(relPath) {
  return DETECTION_PATH_RE.test(relPath) && DETECTION_NAME_RE.test(relPath);
}

function isExecuted(relPath) {
  return EXECUTION_RE.test(relPath);
}

// --- Ancrage sur commands/send.md — DETECTION_*/EXECUTION_RE ne sont PAS de
// simples copies indépendantes du pipeline réel (gate de reprise, finding 5).
// Ces deux assertions lient le texte SOURCE de /send à ce que les regex
// ci-dessus encodent : si `commands/send.md` change de glob ou de commande de
// filtre, l'une des deux rougit AVANT que la garde puisse certifier à tort une
// symétrie contre un pipeline qui a changé sous elle.
describe('SKILL-65 D2 — ancrage sur le pipeline réel de /send', () => {
  const sendRaw = readSendMd();

  // ⚠️ Mutation-témoin : dans commands/send.md, remplacer
  // `__tests__/**/*-coherence.test.{js,ts}` par une autre forme (point au lieu
  // du tiret, extension supplémentaire…) → rouge, AVANT de mettre à jour
  // DETECTION_PATH_RE/DETECTION_NAME_RE ci-dessus.
  it(`${SEND_FILE} déclare toujours le glob de détection que DETECTION_*_RE encode`, () => {
    expect(
      sendRaw.includes('__tests__/**/*-coherence.test.{js,ts}'),
      `${SEND_FILE} ne contient plus le glob de détection littéral ` +
        `"__tests__/**/*-coherence.test.{js,ts}" — DETECTION_PATH_RE et ` +
        `DETECTION_NAME_RE, ci-dessus, encodent une forme qui ne correspond ` +
        `peut-être plus au pipeline réel.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : remplacer la commande `npm test -- coherence
  // --passWithNoTests` par une autre forme de filtre → rouge, AVANT de
  // mettre à jour EXECUTION_RE ci-dessus.
  it(`${SEND_FILE} déclare toujours la commande d'exécution que EXECUTION_RE encode`, () => {
    expect(
      sendRaw.includes('npm test -- coherence --passWithNoTests'),
      `${SEND_FILE} ne contient plus la commande d'exécution littérale ` +
        `"npm test -- coherence --passWithNoTests" — EXECUTION_RE, ci-dessus, ` +
        `encode un filtre qui ne correspond peut-être plus au pipeline réel.`
    ).toBe(true);
  });
});

// --- Liste des fichiers RÉELLEMENT jouables par vitest -----------------------
//
// Aligné sur l'`include` PAR DÉFAUT de vitest (aucun `vitest.config.*` dans ce
// dépôt) : `**/*.{test,spec}.?(c|m)[jt]s?(x)`, REPO ENTIER — pas seulement
// `__tests__/`, pas seulement `.test.js`/`.test.ts` (gate de reprise,
// finding 4). Exclusions alignées sur le `exclude` par défaut de vitest
// (`node_modules`, `dist`, `cypress`, les dossiers pointés `.git`/`.idea`/…) :
// ce ne sont pas des choix arbitraires de ce fichier, ce sont ceux du runner
// qu'il surveille.
const TEST_FILE_RE = /\.(test|spec)\.(?:c|m)?[jt]sx?$/;
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'cypress', '.git']);

function isExcludedDir(name) {
  return EXCLUDED_DIRS.has(name) || name.startsWith('.');
}

function listTestFiles() {
  const files = [];
  function walk(absDir, relPrefix) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (isExcludedDir(entry.name)) continue;
        walk(path.join(absDir, entry.name), relPrefix ? `${relPrefix}/${entry.name}` : entry.name);
        continue;
      }
      if (!TEST_FILE_RE.test(entry.name)) continue;
      files.push(relPrefix ? `${relPrefix}/${entry.name}` : entry.name);
    }
  }
  walk(REPO_ROOT, '');
  return files.sort();
}

// --- Liste d'exceptions, déclarée EN DUR, chaque entrée MOTIVÉE -------------
//
// D3 (SKILL-65) : critère d'éligibilité de l'Étape 0 de /send — rapide, sans DB
// ni dev server, sans dépendance à un état externe NON VERSIONNÉ (transcripts
// de session, contenu de ~/sdd-metrics, réseau). Vérifié fichier par fichier
// sur les 17 candidats hors filet trouvés le 2026-08-25 (specs/skill-65.md
// § D3) : AUCUN n'en dépend — tous utilisent des fixtures SYNTHÉTIQUES
// versionnées (`__tests__/fixtures/review-log/`) et des répertoires temporaires
// jetables (`fs.mkdtempSync(os.tmpdir())`), y compris les deux candidats
// *suspectés* par la spec (`review-log-baseline`, `sdd-push`/`sdd-push-wiring`)
// — vérifié, pas supposé : ni l'un ni l'autre ne lit de transcript réel ni
// n'émet de requête réseau réelle. Tous les 17 ont donc été renommés
// `-coherence` plutôt que déclarés ici. La liste est vide aujourd'hui ; elle
// existe pour qu'un futur fichier hors filet ait un endroit où se déclarer,
// motif à l'appui — pas pour rester vide indéfiniment.
const EXCEPTIONS = {
  // '<fichier>': 'motif — quel état externe, pourquoi il rend le test instable hors du poste de travail.',
};

describe('SKILL-65 D2 — symétrie liste (disque) vs sélection (pipeline /send)', () => {
  const onDisk = listTestFiles();

  // T4 — la garde est elle-même dans le filet : son propre nom satisfait les
  // deux moitiés, sinon elle ne tournerait pas à la livraison — une garde
  // qu'on ne joue pas ne garde rien.
  // ⚠️ Mutation-témoin : renommer ce fichier sans `-coherence` → rouge SI
  // rejoué en `npm test` complet (voir avertissement en tête de fichier : le
  // pipeline réel de /send ne le fait jamais tout seul).
  it('ce fichier de garde lui-même satisfait la détection ET l’exécution', () => {
    const self = `__tests__/${path.basename(__filename)}`;
    expect(
      isDetected(self),
      `${self} ne satisfait pas le glob de détection (__tests__/**/*-coherence.test.{js,ts}).`
    ).toBe(true);
    expect(
      isExecuted(self),
      `${self} ne satisfait pas le filtre d'exécution (sous-chaîne "coherence").`
    ).toBe(true);
  });

  // T1 — symétrie liste vs sélection : chaque fichier RÉEL du disque (tout ce
  // que vitest peut jouer, pas seulement __tests__/*.test.{js,ts}) est soit
  // détecté (le glob de /send le sélectionne), soit déclaré en exception avec
  // son motif.
  // ⚠️ Mutation-témoin : ajouter un fichier de test bidon sans suffixe et hors
  // liste d'exceptions (ex. `__tests__/zzz-temoin.test.js`, ou
  // `tools/foo.test.mjs`) → rouge.
  for (const rel of onDisk) {
    it(`${rel} est détecté par le pipeline, ou déclaré en exception motivée`, () => {
      if (isDetected(rel)) return; // sélectionné : rien à déclarer.
      const motif = EXCEPTIONS[rel];
      expect(
        motif,
        `${rel} n'est ni détecté par le glob __tests__/**/*-coherence.test.{js,ts}, ` +
          `ni déclaré dans la liste EXCEPTIONS de ce fichier — il sortirait du ` +
          `filet joué à la livraison en silence (specs/skill-65.md § D2).`
      ).toBeTruthy();
    });
  }

  // T3 — une exception sans motif est refusée : la liste ne doit jamais
  // devenir une trappe (rejet silencieux déguisé).
  // ⚠️ Mutation-témoin : vider un motif (`EXCEPTIONS['x'] = ''`) → rouge.
  it('toute entrée de EXCEPTIONS porte un motif non vide', () => {
    const blank = Object.entries(EXCEPTIONS).filter(
      ([, motif]) => typeof motif !== 'string' || motif.trim().length === 0
    );
    expect(
      blank.map(([f]) => f),
      `Ces entrées de EXCEPTIONS ont un motif vide ou absent : ` +
        `${blank.map(([f]) => f).join(', ')} — une exception sans motif est un ` +
        `rejet silencieux déguisé.`
    ).toEqual([]);
  });

  // Complément de T1 : une exception qui ne correspond à AUCUN fichier réel
  // protège un fantôme et masque le jour où un vrai fichier hors filet
  // porterait, par coïncidence, le même nom sans revue.
  it('toute entrée de EXCEPTIONS correspond à un fichier présent sur le disque', () => {
    const onDiskSet = new Set(onDisk);
    const orphans = Object.keys(EXCEPTIONS).filter((f) => !onDiskSet.has(f));
    expect(
      orphans,
      `Ces entrées de EXCEPTIONS ne correspondent à aucun fichier sur le disque : ` +
        `${orphans.join(', ')}.`
    ).toEqual([]);
  });

  // Second complément de T1 (gate de reprise, finding 7) : une exception n'est
  // vraiment « hors filet » que si le pipeline réel ne la joue PAS non plus —
  // les DEUX moitiés, comme partout ailleurs dans cette garde (D2). Une
  // entrée déclarée en exception mais dont le CHEMIN contient quand même la
  // sous-chaîne `coherence` serait, en réalité, sélectionnée par
  // `npm test -- coherence` malgré sa déclaration : l'exception mentirait.
  // ⚠️ Mutation-témoin : déclarer en exception un fichier dont le nom contient
  // `coherence` sans le tiret (ex. `__tests__/foo-coherence-baseline.test.js`
  // ou plus simplement tout chemin matchant `/coherence/`) → rouge.
  it('aucune entrée de EXCEPTIONS n’est en réalité jouée par le filtre d’exécution', () => {
    const wronglyExecuted = Object.keys(EXCEPTIONS).filter((f) => isExecuted(f));
    expect(
      wronglyExecuted,
      `Ces entrées de EXCEPTIONS seraient EXÉCUTÉES quand même par ` +
        `"npm test -- coherence" (leur chemin contient "coherence") : ` +
        `${wronglyExecuted.join(', ')} — les déclarer hors filet est donc faux, ` +
        `le pipeline les joue réellement.`
    ).toEqual([]);
  });

  // T2 — les deux moitiés, jamais une seule : un nom qui satisfait le filtre
  // d'EXÉCUTION (sous-chaîne "coherence") mais PAS le glob de DÉTECTION
  // (tiret manquant) doit être rejeté par `isDetected` — sinon la garde ne
  // verrait jamais le cas réel documenté par specs/skill-62.md § Cause racine
  // (`backlog-cli` : `coherence.test.js`, sans tiret, happé par le filtre
  // d'exécution mais jamais vu par le glob de détection).
  // ⚠️ Mutation-témoin : n'asserter que la sous-chaîne `coherence` (remplacer
  // `isDetected` par `isExecuted` dans ce test) → il doit rougir, puisque le
  // nom témoin sans tiret passerait alors à tort pour détecté.
  it('un nom satisfaisant l’exécution mais pas la détection (sans tiret) est rejeté', () => {
    const WITNESS_NO_DASH = '__tests__/coherence.test.js';
    expect(
      isExecuted(WITNESS_NO_DASH),
      `${WITNESS_NO_DASH} devrait satisfaire le filtre d'exécution (sous-chaîne ` +
        `"coherence") — sinon ce témoin ne prouve rien.`
    ).toBe(true);
    expect(
      isDetected(WITNESS_NO_DASH),
      `${WITNESS_NO_DASH} satisfait à tort le glob de détection — il lui manque ` +
        `pourtant le tiret littéral de "-coherence". La détection doit exiger le ` +
        `tiret (cf. specs/skill-62.md § Cause racine).`
    ).toBe(false);
  });

  // T5 — le fichier de SKILL-62 (D1 de specs/skill-65.md) est bien sélectionné
  // sous son nouveau nom.
  // ⚠️ Mutation-témoin : revenir à l'ancien nom
  // (`send-empty-selection.test.js`, sans `-coherence`) → rouge, par T1 (il ne
  // serait alors plus détecté ni déclaré en exception).
  it('__tests__/send-empty-selection-coherence.test.js (SKILL-62/D1) est bien détecté', () => {
    expect(onDisk).toContain('__tests__/send-empty-selection-coherence.test.js');
    expect(isDetected('__tests__/send-empty-selection-coherence.test.js')).toBe(true);
  });

  // T6 — la contrainte de D6 est ÉCRITE dans ce fichier : POURQUOI le nom
  // porte l'exécution (/send est global, D4/D6 de specs/skill-65.md), pas
  // seulement QUE c'est la règle. Assertion portée sur la SOURCE de ce fichier
  // lui-même — pas une constante recopiée, la même phrase que l'en-tête
  // ci-dessus doit porter.
  // ⚠️ Mutation-témoin : supprimer cette justification en gardant la règle
  // (D2 sans son motif) → rouge — sans elle, un futur éditeur lit la
  // contrainte comme une lubie et la retire (même raison qu'au T5 de
  // SKILL-62 : sans le motif, la contrainte ne survit pas à son premier
  // lecteur pressé).
  it('ce fichier documente POURQUOI le nom porte l’exécution (D6 — /send est global)', () => {
    // ⚠️ Scopé au bloc d'en-tête (avant le premier `import`) — jamais au
    // fichier ENTIER : les deux chaînes cherchées ci-dessous apparaissent
    // AUSSI, forcément, dans le CODE de cette assertion elle-même (elles sont
    // ses propres littéraux de recherche). Un `.includes()` sur tout le
    // fichier serait donc TOUJOURS vrai, y compris après la mutation-témoin —
    // exactement le piège qu'un test qui se valide contre lui-même reproduit
    // (D3 du dépôt). Vérifié : la mutation a d'abord été appliquée avec un
    // `.includes()` non scopé et est restée verte à tort, avant correction.
    const source = fs.readFileSync(__filename, 'utf8');
    const headerEnd = source.indexOf('\nimport ');
    const header = headerEnd === -1 ? source : source.slice(0, headerEnd);
    // Le marqueur de commentaire `//` en tête de chaque ligne doit disparaître
    // AVANT l'aplatissement, sinon une phrase à cheval sur deux lignes se
    // retrouve coupée par un `//` littéral (« …QUE /SEND // RESTE GLOBAL… ») et
    // aucune des deux mutations-témoins n'aurait jamais pu passer au vert.
    const flat = header
      .split('\n')
      .map((line) => line.replace(/^\s*\/\/\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(
      flat.includes('SEUL LEVIER DISPONIBLE TANT QUE /SEND RESTE GLOBAL'),
      `Ce fichier ne documente plus POURQUOI le nom du test porte la décision de ` +
        `l'exécuter (D6 de specs/skill-65.md : /send est global, partagé par tous ` +
        `les projets adoptants, pas scopé à ce dépôt) — un futur éditeur lirait la ` +
        `contrainte comme une lubie et la retirerait.`
    ).toBe(true);
    expect(
      flat.includes('pourra être rouverte sans avoir à redécouvrir')
    ).toBe(true);
  });
});
