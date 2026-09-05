// Doctrine de frontière de session — SKILL-28 (specs/skill-28.md).
//
// L'épic a mesuré une dégradation du prompt d'implémenteur au 10ᵉ lancement
// d'une même session, causée par la RECOPIE du mode d'emploi. Cette cause est
// morte depuis SKILL-25 (le prompt d'appel ne porte plus que des variables) —
// vérifié ici par T3, qui interdit toute réintroduction de cette
// justification périmée. Ce qui reste réellement à l'attention, ce sont les
// gestes que la boucle à trois temps par ticket (Étapes 6 → 6.1-6.4 → 6.5)
// laisse à la charge de l'orchestrateur d'une session qui s'allonge — au
// premier chef l'Étape 6.8, qui écrit sur disque et dont l'erreur est
// irrattrapable et silencieuse. La doctrine (§ Décision de specs/skill-28.md)
// vit dans `commands/sdd-run-ticket.md`, § « Note sur les agents parallèles »
// (conforme à C4 de l'épic) — jamais dans le `CLAUDE.md` global, payé par tous
// les projets.
//
// ⚠️ Chaque test ci-dessous documente, en commentaire, la mutation qui doit
// le faire échouer (D3) — convention réaffirmée SKILL-04/SKILL-27. Chaque
// mutation-témoin listée a été appliquée RÉELLEMENT au fichier pendant le
// développement de ce test, le rouge constaté, puis révoquée par édition
// inverse (jamais `git checkout --`, cf. specs/skill-28.md § Comment ces
// mutations-témoins doivent être écrites).
//
// ⚠️ Gate de revue (findings 1-5, 9) — corrections apportées :
// - Toutes les assertions de contenu portent sur la SOUS-SECTION
//   « ### Doctrine de frontière de session » (`readDoctrine()`), jamais sur la
//   section entière « Note sur les agents parallèles » : celle-ci porte déjà,
//   AVANT ce ticket, un paragraphe qui mentionne l'Étape 6.8 — un test scopé à
//   la section entière peut donc rester vert quand la doctrine entière est
//   supprimée (finding 1). `readDoctrine()` échoue explicitement (throw) si la
//   sous-section est absente, ce qui fait échouer TOUTES les assertions qui en
//   dépendent — c'est le rouge attendu pour ce scénario.
// - T3 teste sur une version de la sous-section dont les retours à la ligne
//   sont collapsés en espaces (`flatten()`) : un fichier dur-wrappé à ~78
//   colonnes peut couper "perd 30 % de sa masse" sur deux lignes, ce qu'une
//   regex mono-ligne ne verrait pas (finding 9).
// - T4 ne recompare plus PLAFOND_SKILL à une taille recalculée par une copie
//   locale de `mesure()` : dupliquer cet algorithme couplait deux fichiers de
//   tickets différents sur une seule constante, au risque de la rendre
//   insatisfiable si l'un des deux évolue sans l'autre (finding 5), et
//   l'égalité stricte contredisait le choix délibéré de SKILL-27
//   (`toBeLessThanOrEqual`, D9) déjà tenu par S2 de skill-size-ceiling-coherence.test.js
//   (finding 2). T4 vérifie uniquement que le commentaire au-dessus de
//   PLAFOND_SKILL documente une re-mesure datée et attribuée — motif
//   générique (`SKILL-\d+`, pas figé sur SKILL-28), pour ne pas rougir sous le
//   prochain ticket qui re-mesure légitimement (findings 3 et 4). L'ancrage se
//   fait par `extractBetween` (bornes littérales), pas par une fenêtre
//   d'octets glissante qui peut déborder sur l'en-tête du fichier (finding 4).
//
// ⚠️ SKILL-53 (specs/skill-53.md, clôt l'escalade E1 de specs/skill-28.md) —
// T2 est réécrit : l'ancienne condition (`prompt.length`/`prompt.sections`,
// satisfaite par construction depuis SKILL-25, § Problème 1) est remplacée
// par un PRÉREQUIS DE MESURE qui nomme ce qui manque (un champ
// d'atteignabilité du `<sha_final>` depuis la branche du ticket, pas
// seulement son existence), constate que `shaVerified`/`controls` ne le
// voient pas (§ Problème 2), garde le déclencheur de retrait (« une fois ce
// champ disponible, retirer si… ») sans le fonder sur ces deux champs
// inadéquats, et renvoie vers SKILL-46 sans le fusionner. T5 porte le motif
// économique (coût par cycle, `cache_read`), ses limites (dont la
// non-monotonicité du tableau) et sa borne explicite (explique le
// *pourquoi*, jamais le *où*).
//
// ⚠️ Gate de revue de commit (findings 1-12, reprise du 2026-08-22) —
// corrections supplémentaires :
// - Finding 2/3 : la doctrine ne fige plus de POPULATION CHIFFRÉE (« 20
//   cycles », « 20/20 ») — ce compte grossit à chaque lancement, un chiffre
//   figé devient faux au fil des cycles. T2 vérifie la présence du chemin
//   `~/sdd-metrics/cycles`, jamais un nombre.
// - Finding 4 : T5 vérifie que la limite de non-monotonicité du tableau
//   `cache_read` (le rang 3 retombe sous le rang 2) est écrite.
// - Finding 5 : T5 vérifie la borne explicite « pourquoi, jamais où » entre
//   le motif économique et le chiffre 3-5.
// - Finding 7/11/12 : T2 gagne un déclencheur de retrait extrait À PART
//   (`readRetraitTrigger()`, ancré sur « Une fois ce champ disponible »), qui
//   DOIT nommer l'atteignabilité et NE DOIT PAS mentionner `shaVerified` ni
//   `controls` — sinon une reformulation qui re-fonderait le retrait sur ces
//   deux champs inadéquats (l'issue que le § Décision 1 de specs/skill-53.md
//   proscrit) resterait verte. Le champ manquant est aussi nommé
//   explicitement (`shaReachableFromBranch`), pour que « ce champ » ait un
//   antécédent concret.
// - Finding 1 : à l'origine, T2 vérifiait que la doctrine dit qu'aucun ticket
//   ouvert ne porte cette instrumentation (le renvoi croisé, alors non
//   résolu, entre specs/skill-46.md et specs/skill-53.md). SKILL-56 a depuis
//   fermé ce renvoi (il porte lui-même `shaReachableFromBranch`) : l'assertion
//   a été REMPLACÉE (elle ne cherche plus « aucun ticket ouvert », qui serait
//   désormais faux, mais que la doctrine nomme SKILL-46 et la limite du champ
//   sur `<sha_final>`, non couvert) — cf. clôture de specs/skill-28.md,
//   specs/skill-46.md et specs/skill-53.md § Escalades.
// - Finding 8 : la mutation-témoin « formule invérifiable » (exigée par
//   specs/skill-28.md § Tests, perdue dans la première passe) est réécrite.
// - Finding 9 : la 3ᵉ assertion de T5, doublon verbatim de T1, est retirée —
//   la non-régression des motifs de fidélité reste testée, UNE fois, par T1.
// - Finding 10 : `readDoctrine()` délègue à `extractSection()` du helper
//   partagé au lieu de réimplémenter sa propre découpe par `indexOf` — même
//   garde (`^##\s`, throw explicite si absent), mais ancrée en DÉBUT DE LIGNE
//   comme le fait le helper, pas par une recherche de sous-chaîne qui peut
//   s'accrocher à une mention de la section dans une prose antérieure.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { extractBetween, extractSection, readNormalized } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const SKILL_FILE = 'commands/sdd-run-ticket.md';
const CEILING_FILE = '__tests__/skill-size-ceiling-coherence.test.js';

const DOCTRINE_HEADING = '### Doctrine de frontière de session';
const DOCTRINE_HEADING_RE = /^### Doctrine de frontière de session/;
const RETRAIT_TRIGGER_ANCHOR = 'Une fois ce champ disponible';
const ETAPE_68_HEADING = '## Étape 6.8 — Mesure (écrite, pas publiée)';
const ETAPE_68_HEADING_RE = /^## Étape 6\.8/;

function readSkill() {
  return readNormalized(REPO_ROOT, SKILL_FILE);
}

// SKILL-56 : la sous-section « Le `ref` d'un finding est relevé avant le
// rebase » vit dans l'Étape 6.8 elle-même, pas dans la sous-section
// « ### Doctrine de frontière de session » (qui parle de `<sha_final>`, pas
// des `ref` de findings) — d'où un lecteur dédié.
function readEtape68() {
  const raw = readSkill();
  const body = extractSection(raw, ETAPE_68_HEADING_RE);
  if (body === null) {
    throw new Error(`${SKILL_FILE} : section "${ETAPE_68_HEADING}" introuvable.`);
  }
  return body;
}

// Sous-section scopée AU PLUS PRÈS, via le helper partagé `extractSection`
// (même sémantique que la copie locale d'avant SKILL-53 — finding 10 de la
// gate — mais ancrée en DÉBUT DE LIGNE, pas par `indexOf`). Rend une erreur
// EXPLICITE si le titre est absent — jamais une chaîne vide, qui passerait
// trivialement tous les `.toMatch()`/`.toContain()` ci-dessous.
//
// ⚠️ Portée délibérément PLUS ÉTROITE que « Note sur les agents parallèles » :
// cette dernière porte, depuis SKILL-25/26, un paragraphe qui mentionne déjà
// l'Étape 6.8 — un test scopé à la section entière resterait vert même si la
// doctrine ajoutée par SKILL-28 disparaît intégralement (finding 1 de la gate
// SKILL-28). Scoper à `### Doctrine de frontière de session` élimine ce
// paragraphe préexistant de toute assertion ci-dessous.
function readDoctrine() {
  const raw = readSkill();
  const body = extractSection(raw, DOCTRINE_HEADING_RE);
  if (body === null) {
    throw new Error(
      `${SKILL_FILE} : sous-section "${DOCTRINE_HEADING}" introuvable — la ` +
        `doctrine de frontière de session ne peut être vérifiée nulle part.`
    );
  }
  return body;
}

// Le déclencheur de retrait, extrait À PART du reste de la doctrine (finding
// 11 de la gate de reprise) : ancré sur sa propre phrase d'ouverture, borné
// au SEUL paragraphe qu'il ouvre (jusqu'à la prochaine ligne blanche, ou la
// fin de la sous-section s'il n'y en a pas). Isoler ce paragraphe permet
// d'exiger qu'IL, en particulier, ne mentionne ni `shaVerified` ni `controls`
// — sinon une reformulation qui re-fonderait le retrait sur ces deux champs
// (prouvés inadéquats par specs/skill-53.md § Problème 2) satisferait quand
// même les assertions "shaVerified"/"controls présents quelque part dans la
// doctrine".
//
// ⚠️ SKILL-77 (finding 3 de la gate de reprise) : la borne était auparavant
// « jusqu'à la fin de la sous-section » — sans effet tant que la doctrine
// finissait le fichier, mais un test qui verrouille alors « mot pour mot »
// (T-non-régression ci-dessous) fige en réalité TOUT ce qui suit le
// déclencheur, y compris un paragraphe qu'un ticket ultérieur ajouterait sans
// toucher au déclencheur lui-même. Bornée au paragraphe, la tranche ne
// verrouille plus que le déclencheur proprement dit.
function readRetraitTrigger() {
  const doctrine = readDoctrine();
  const idx = doctrine.indexOf(RETRAIT_TRIGGER_ANCHOR);
  if (idx === -1) {
    throw new Error(
      `${SKILL_FILE} : le déclencheur de retrait ("${RETRAIT_TRIGGER_ANCHOR}") ` +
        `est introuvable dans la sous-section "${DOCTRINE_HEADING}".`
    );
  }
  const rest = doctrine.slice(idx);
  const blankLine = rest.search(/\n\s*\n/);
  return blankLine === -1 ? rest : rest.slice(0, blankLine);
}

/** `contenu` avec toute suite d'espaces/retours à la ligne collapsée en UN espace. */
function flatten(contenu) {
  return contenu.replace(/\s+/g, ' ');
}

describe('T1 (SKILL-28) — la doctrine de frontière de session est présente', () => {
  // ⚠️ Mutation appliquée : retirer la phrase de maturation continue → rouge
  // constaté, puis révoquée.
  it('énonce la maturation continue, au fil de l’eau', () => {
    const doctrine = readDoctrine();
    expect(
      doctrine,
      'La règle "maturer au fil de l\'eau" doit être lisible dans la ' +
        `sous-section "${DOCTRINE_HEADING}" du skill.`
    ).toMatch(/maturation continue/i);
  });

  // ⚠️ Mutation appliquée : retirer la phrase de vague ("lancer par vagues de
  // 3 à 5") → rouge constaté, puis révoquée. C'est la mutation-témoin exigée
  // par specs/skill-28.md § Tests.
  it('énonce le lancement par vagues de 3 à 5 tickets', () => {
    const doctrine = readDoctrine();
    expect(
      doctrine,
      'La règle "lancer par vagues de 3 à 5, puis ouvrir une session neuve" ' +
        `doit être lisible dans la sous-section "${DOCTRINE_HEADING}".`
    ).toMatch(/vagues? de 3\s*(?:à|a)\s*5/i);
  });

  // ⚠️ Mutation appliquée : retirer tout le bloc `### Doctrine de frontière de
  // session` → `readDoctrine()` lève, ce qui fait échouer ce test (et tous
  // ceux de ce fichier qui en dépendent) → rouge constaté, puis révoqué. La
  // phrase cherchée ("boucle ... trois temps par ticket ci-dessus") n'existe
  // QUE dans le texte ajouté par ce ticket (le paragraphe préexistant de la
  // section-mère dit "boucle en trois temps par ticket", sans "ci-dessus") :
  // ce test ne peut donc pas être satisfait par un texte antérieur au ticket
  // (c'est précisément le défaut relevé en finding 1).
  it('justifie la règle de vagues par la boucle à trois temps et l’Étape 6.8', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).toMatch(/trois temps par ticket ci-dessus/i);
    expect(doctrine).toMatch(/6\.8/);
  });
});

describe('T6 (SKILL-56) — l’Étape 6.8 dit que le ref d’un finding est relevé avant le rebase', () => {
  // ⚠️ Mutation appliquée : retirer la phrase (specs/skill-56.md § Décision 2)
  // → rouge constaté, puis révoquée. Mutation-témoin exigée nommément par le
  // § Tests de specs/skill-56.md.
  it('dit que le ref vient du registre de l’Étape 6.6, donc d’avant le rebase de /send', () => {
    const etape = flatten(readEtape68());
    expect(etape).toMatch(/relevé(e)? avant le rebase/i);
    expect(
      etape,
      'Le motif doit être explicite : `ref` vient du registre de l\'Étape 6.6, ' +
        'donc d\'AVANT l\'intégration de l\'Étape 6.7 (à la différence de ' +
        '`<sha_final>`, relevé APRÈS).'
    ).toMatch(/registre de l.Étape 6\.6/i);
    expect(etape).toMatch(/shaReachableFromBranch/);
  });

  // ⚠️ Mutation appliquée : réécrire la phrase en prescrivant un re-mapping
  // manuel des SHA pré/post-rebase → rouge constaté, puis révoquée.
  // L'arbitrage de SKILL-46 (§ Problème 2 de specs/skill-56.md) tient : c'est
  // l'écrivain qui signale, jamais l'orchestrateur qui re-mappe à la main.
  it('ne prescrit pas de re-mapping manuel des SHA pré/post-rebase', () => {
    const etape = flatten(readEtape68());
    expect(etape).not.toMatch(/re-mapp/i);
  });
});

describe('T2 (SKILL-53) — la condition de retrait est un prérequis de mesure', () => {
  // SKILL-53 (specs/skill-53.md, § Problème 1-2) : l'ancienne condition
  // portait sur `prompt.length`/`prompt.sections`, constants par construction
  // depuis SKILL-25 — satisfaite dès le premier enregistrement, pour un motif
  // que la doctrine elle-même déclare mort. Sa correction évidente
  // (`shaVerified`/`controls`) est fausse aussi : vérifiée sur les cycles
  // réels enregistrés, elle serait déjà satisfaite sur la quasi-totalité,
  // alors que ces deux champs ne peuvent PAS voir le défaut invoqué (un
  // `<sha_final>` emprunté au ticket voisin passe les deux). La condition
  // devient donc un prérequis de mesure : elle nomme ce qui MANQUE, pas un
  // champ existant mal choisi.
  //
  // ⚠️ Mutation appliquée : remplacer le paragraphe entier par l'ancienne
  // condition ("indépendants de `spawnIndex`", `prompt.length`,
  // `prompt.sections`) → rouge constaté sur les assertions ci-dessous, puis
  // révoquée.
  it('constate que shaVerified et controls existent mais ne peuvent pas voir le défaut', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).toMatch(/shaVerified/);
    expect(doctrine).toMatch(/controls/);
    expect(
      doctrine,
      'Le constat doit se faire sur les fichiers de cycle du disque ' +
        '(`~/sdd-metrics/cycles`), jamais sur une POPULATION CHIFFRÉE figée ' +
        'dans le skill — ce compte grossit à chaque lancement (finding 2/3 ' +
        'de la gate de reprise).'
    ).toMatch(/sdd-metrics\/cycles/);
  });

  // ⚠️ Mutation appliquée : retirer la phrase expliquant que `controls`
  // confond un contrôle réussi et un contrôle jamais exécuté → rouge
  // constaté, puis révoquée. Un second argument d'inadéquation, distinct de
  // « ne vérifie que la provenance » (déjà couvert ci-dessus).
  it('explique que controls confond un contrôle réussi et un contrôle jamais exécuté', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).toMatch(/confond.{0,40}(contrôle réussi|jamais exécuté)/i);
  });

  it('nomme la mesure manquante : un champ d’atteignabilité du sha_final depuis la branche du ticket', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).toMatch(/atteignable depuis la branche/i);
    expect(
      doctrine,
      'La phrase doit avoir un antécédent NOMMÉ (ex. `shaReachableFromBranch`), ' +
        'pas une prose sans identifiant (finding 12 de la gate de reprise).'
    ).toMatch(/shaReachableFromBranch/);
  });

  // ⚠️ SKILL-56 : le champ existe désormais (`shaReachableFromBranch`,
  // `tools/review-log/write.mjs`) — le prérequis de mesure ne dit plus qu'il
  // manque, cf. specs/skill-56.md § Décision 4. Mutation appliquée : remettre
  // « Ce champ n'existe pas encore dans les fichiers de cycle. » → rouge
  // constaté, puis révoquée (mutation-témoin exigée par le § Tests du ticket).
  it('dit que le champ shaReachableFromBranch existe désormais', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).not.toMatch(/n'existe pas encore/i);
    expect(doctrine).toMatch(/existe désormais/i);
  });

  // ⚠️ SKILL-77 (specs/skill-77.md, clôt l'escalade E1 de specs/skill-56.md,
  // issue 3) : « le champ existe » et « la condition de retrait est
  // applicable » sont deux affirmations distinctes — SKILL-56 avait écrit la
  // seconde à tort (« attend une population de cycles, pas un instrument »),
  // alors que `shaReachableFromBranch` ne porte que sur les `ref` de
  // findings, jamais sur `<sha_final>` (ce que le déclencheur, resté intact,
  // exige). Mutation-témoin : réintroduire la promesse retirée → rouge.
  it('ne promet plus que la condition de retrait attend une population de cycles', () => {
    const doctrine = flatten(readDoctrine());
    expect(
      doctrine,
      'Cette promesse suppose que la mesure disponible (les `ref` de ' +
        'findings) fonde le déclencheur (`<sha_final>`) — c\'est faux, et ' +
        "c'est exactement la contradiction que SKILL-77 corrige."
    ).not.toMatch(/attend une \*{0,2}population de cycles\*{0,2}, pas un instrument/i);
  });

  // ⚠️ SKILL-77 : le § doit dire, noir sur blanc, que la condition de retrait
  // n'est PAS applicable aujourd'hui, ET pourquoi elle ne pourra pas l'être
  // par ce moyen — pas seulement le constat seul, sans quoi un futur lecteur
  // rouvrirait la question en croyant combler un simple oubli d'instrument.
  // Mutation-témoin : garder « n'est pas applicable » mais retirer la
  // justification (l'atteignabilité ne discrimine pas un `<sha_final>`
  // emprunté, le SHA du voisin étant lui aussi ancêtre de `main`) → rouge.
  it('énonce que la condition de retrait n’est pas applicable, et pourquoi (atteignabilité non discriminante ni depuis main ni depuis la branche)', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).toMatch(/n'est pas applicable/i);
    expect(
      doctrine,
      'La justification doit relier les DEUX quantités en jeu : une branche ' +
        'de ticket se coupe depuis `main`, donc un SHA déjà fusionné dans ' +
        '`main` (dont un `<sha_final>` emprunté au voisin) est trivialement ' +
        "atteignable depuis n'importe quelle branche coupée ensuite — pas " +
        'seulement depuis `main` (finding 5 de la gate de reprise : ' +
        'l\'ancienne formulation ne parlait que de `main`, jamais de la ' +
        'branche que le déclencheur nomme réellement).'
    ).toMatch(/branche de ticket est coupée depuis le .main./i);
    expect(doctrine).toMatch(/emprunté (au|à un) ticket voisin/i);
    expect(
      doctrine,
      "La conclusion doit couvrir explicitement les DEUX mesures possibles " +
        "(`main` et la branche du ticket), sans quoi la justification ne " +
        "couvre pas la quantité que le déclencheur nomme réellement."
    ).toMatch(/ni depuis .main., ni depuis la branche du ticket/i);
  });

  // ⚠️ SKILL-77 (finding 7/8 de la gate de reprise) : la justification
  // n'existe plus qu'UNE fois dans le paragraphe — l'ancienne version la
  // répétait mot pour mot à quelques lignes d'écart (une fois pour décrire
  // `shaReachableFromBranch` lui-même, une fois pour conclure sur le
  // déclencheur), ce que `PLAFOND_SKILL` payait sans le dire. Mutation-témoin :
  // dupliquer à nouveau la phrase de conclusion → rouge.
  it('ne répète pas deux fois la même justification dans le paragraphe', () => {
    const doctrine = flatten(readDoctrine());
    const occurrences = (doctrine.match(/est lui aussi ancêtre de .main./gi) || []).length;
    expect(
      occurrences,
      'La phrase "... est lui aussi ancêtre de `main`" ne doit apparaître ' +
        "qu'une seule fois : au-delà, c'est la redite que la gate de " +
        'reprise a trouvée (findings 7 et 8).'
    ).toBe(0);
  });

  // ⚠️ SKILL-77 (finding 1 de la gate de reprise) : le § Symptôme du ticket
  // décrit un opérateur qui lit « ce champ existe désormais » puis applique
  // le déclencheur qui suit comme une procédure exécutable — exactement le
  // défaut que ce ticket doit fermer. Une clause DOIT désigner le paragraphe
  // suivant comme non exécutable, SANS toucher à son texte (⛔ du § Correction
  // attendue). Mutation-témoin : retirer cette clause en gardant le reste →
  // rouge.
  it('désigne explicitement le déclencheur qui suit comme non exécutable en l’état', () => {
    const doctrine = flatten(readDoctrine());
    expect(
      doctrine,
      'Sans cette clause, un lecteur qui vient de lire "shaReachableFromBranch ' +
        'existe désormais" lit le déclencheur suivant comme une procédure à ' +
        'jouer (§ Symptôme de specs/skill-77.md) — c\'est le défaut même que ' +
        'ce ticket ferme.'
    ).toMatch(/déclencheur qui suit.{0,60}non exécutable en l.état/i);
  });

  // ⚠️ SKILL-56 : `shaReachableFromBranch` ne couvre PAS `<sha_final>` lui-même
  // (specs/skill-56.md § Décision 1, § Hors-scope) — la doctrine doit le dire,
  // sous peine de laisser croire que ce défaut est fermé.
  it('SKILL-46 est nommé, et la limite sur le sha_final (non couvert) est écrite', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).toMatch(/SKILL-46/);
    expect(
      doctrine,
      'La doctrine doit dire que `shaReachableFromBranch` ne discrimine pas un ' +
        '`<sha_final>` emprunté au ticket voisin.'
    ).toMatch(/ne couvre pas.*sha_final|sha_final.*lui-même/i);
  });

  // ⚠️ SKILL-77 (finding 2 de la gate de reprise) : l'ancienne phrase « ce
  // défaut-là reste ouvert, sans ticket aujourd'hui » présentait l'absence de
  // mesure comme un manque à combler — l'exact contraire de la conclusion du
  // paragraphe (« ce n'est pas un instrument qui manque »). Une session de
  // maturation qui la lirait ouvrirait le ticket que specs/skill-77.md ferme
  // (§ Cause racine : « un tel champ serait toujours vert, donc une preuve
  // inventée »). Mutation-témoin : la réintroduire → rouge.
  it('ne présente plus le sha_final non couvert comme un manque ouvert à ticketer', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).not.toMatch(/reste ouvert, sans ticket aujourd'hui/i);
  });

  // ⚠️ Mutation appliquée : réintroduire `prompt.length` / `prompt.sections`
  // dans la sous-section → rouge constaté (ces deux champs, invalidés par le
  // § Problème de specs/skill-53.md, ne doivent plus y figurer), puis
  // révoquée.
  it('ne se fonde plus sur prompt.length / prompt.sections (satisfaits par construction)', () => {
    const doctrine = readDoctrine();
    expect(doctrine).not.toMatch(/prompt\.length/);
    expect(doctrine).not.toMatch(/prompt\.sections/);
  });

  // ⚠️ Mutation appliquée : remplacer la condition par "quand la cause aura
  // disparu" → rouge constaté, puis révoquée. Mutation-témoin exigée
  // nommément par specs/skill-28.md § Tests (« la remplacer par une formule
  // invérifiable ») — perdue dans une première passe de ce test, réintroduite
  // ici (finding 8 de la gate de reprise).
  it('ne se réduit pas à une formule invérifiable ("quand la cause aura disparu")', () => {
    const doctrine = readDoctrine();
    expect(
      doctrine,
      'Une condition de retrait qui dirait "quand la cause aura disparu" ne ' +
        'serait vérifiable par personne — elle doit nommer des champs mesurés.'
    ).not.toMatch(/quand la cause aura disparu/i);
  });

  describe('le déclencheur de retrait (isolé du reste du prérequis)', () => {
    // ⚠️ Mutation appliquée : retirer tout le paragraphe "Une fois ce champ
    // disponible…" → `readRetraitTrigger()` lève → rouge constaté (finding 7
    // de la gate de reprise : la doctrine n'énonçait plus AUCUN déclencheur),
    // puis révoquée.
    it('existe et nomme l’atteignabilité comme condition du retrait', () => {
      const trigger = flatten(readRetraitTrigger());
      expect(trigger).toMatch(/retirer la doctrine/i);
      expect(trigger).toMatch(/atteignable depuis la branche/i);
    });

    // ⚠️ Mutation appliquée : réécrire le déclencheur en "retirer cette
    // doctrine quand `shaVerified` et `controls` restent verts…, le
    // `<sha_final>` étant par ailleurs atteignable depuis la branche" → rouge
    // constaté ici (alors que les quatre assertions non scopées de T2
    // resteraient vertes, cf. finding 11 de la gate de reprise) — c'est
    // exactement la reformulation que specs/skill-53.md § Décision 1
    // interdit ("Ne pas reformuler la condition sur shaVerified/controls"),
    // et que cette assertion, scopée au SEUL déclencheur, attrape.
    it('ne re-fonde pas le retrait sur shaVerified/controls', () => {
      const trigger = flatten(readRetraitTrigger());
      expect(
        trigger,
        'Le déclencheur de retrait proprement dit ne doit pas mentionner ' +
          '`shaVerified` ni `controls` : ces deux champs sont déjà déclarés ' +
          'inadéquats plus haut dans le prérequis — les y refaire figurer ' +
          'comme base du retrait reproduirait le défaut fermé par ' +
          "l'escalade E1 de specs/skill-28.md."
      ).not.toMatch(/shaVerified|controls/);
    });

    // ⚠️ SKILL-77 (specs/skill-77.md § Portée, ⛔ « ne pas toucher au
    // déclencheur ») : non-régression, mot pour mot — arbitré par SKILL-53,
    // non rouvert par ce ticket. Mutation-témoin : reformuler ne serait-ce
    // qu'un mot du déclencheur (ex. "aussi souvent" → "tout aussi souvent")
    // → rouge.
    it('reste mot pour mot celui livré par SKILL-53 (non-régression SKILL-77)', () => {
      const trigger = flatten(readRetraitTrigger()).trim();
      expect(trigger).toBe(
        flatten(
          'Une fois ce champ disponible : retirer la doctrine si, sur une population de\n' +
            "cycles à `spawnIndex` élevé, le `<sha_final>` reste atteignable depuis la\n" +
            "branche du ticket concerné aussi souvent en fin de session qu'en début. Ce\n" +
            'constat se fait sur les fichiers de cycle, pas de mémoire.'
        ).trim()
      );
    });
  });
});

describe('T5 (SKILL-53) — le motif économique complète les motifs de fidélité', () => {
  // ⚠️ Mutation appliquée : retirer le paragraphe économique (le tableau
  // cache_read et sa phrase d'intro) → rouge constaté, puis révoquée.
  it('porte le coût par cycle, chiffré (cache_read), comme tendance et non comme loi', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).toMatch(/cache_read/);
    expect(doctrine).toMatch(/tend(?:e|ent)? à croître avec (son|le) rang/i);
  });

  // ⚠️ Mutation appliquée : retirer la mention de non-monotonicité (« le rang
  // 3 retombe sous le rang 2 ») en gardant le reste des limites → rouge
  // constaté, puis révoquée. Le tableau lui-même dément une croissance
  // stricte (rang 3 = 15,4 M < rang 2 = 17,6 M) : la réserve doit être
  // écrite, pas seulement les trois autres limites (finding 4 de la gate de
  // reprise).
  it('écrit que la progression n’est pas monotone (contredite par sa propre ligne 4)', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).toMatch(/pas monotone/i);
  });

  // ⚠️ Mutation appliquée : retirer le paragraphe de limites ("session-to-date"
  // notamment) en gardant le tableau → rouge constaté, puis révoquée. Un
  // chiffre sans ses réserves est ce que la gate de ce dépôt attrape
  // (specs/skill-53.md § Décision 2).
  it('écrit les limites de la mesure (session-to-date, deltas à la main)', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).toMatch(/session-to-date/);
  });

  // ⚠️ Mutation appliquée : retirer la phrase « ce motif explique pourquoi
  // découper, jamais où couper » → rouge constaté, puis révoquée. Sans cette
  // borne explicite, le motif économique — inséré juste au-dessus du chiffre
  // 3-5 — laisse croire qu'il pourrait resserrer ce chiffre (specs/skill-53.md
  // § Décision 2, finding 5 de la gate de reprise).
  it('borne explicitement le motif économique au "pourquoi", jamais au "où couper"', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).toMatch(/pourquoi.{0,20}découper.{0,40}jamais.{0,20}où.{0,20}couper/i);
  });
});

describe('T3 (SKILL-28) — la doctrine ne se justifie plus par le mécanisme mort', () => {
  // ⚠️ Mutation appliquée : réintroduire "30 % du prompt perdu au 10ᵉ spawn"
  // dans la sous-section, SUR UNE SEULE LIGNE → rouge constaté. Puis variante
  // : la même phrase réécrite sur DEUX lignes (wrap normal du fichier, ex.
  // "perd\nune part de sa masse") → restait VERTE avant correction (finding
  // 9), car les gardes étaient des regex mono-ligne sans tolérance au wrap.
  // `flatten()` collapse tout `\s+` en un espace AVANT de tester : les deux
  // variantes (une ligne, deux lignes) sont désormais détectées de façon
  // identique. Rouge constaté sur les deux formes, puis révoqué.
  //
  // La sous-section testée (`readDoctrine()`), pas le fichier entier : le
  // § Problème de specs/skill-28.md cite légitimement ces chiffres pour les
  // enterrer, mais ce n'est pas ce texte-là que ce test contrôle.
  it('ne mentionne pas la perte de masse du prompt recopié (mécanisme mort depuis SKILL-25)', () => {
    const doctrine = flatten(readDoctrine());
    expect(doctrine).not.toMatch(/30 ?%/);
    expect(doctrine).not.toMatch(/10ᵉ spawn/);
    expect(doctrine).not.toMatch(/perd.*masse/i);
  });
});

describe('T4 (SKILL-28) — PLAFOND_SKILL re-mesuré, dont l’attribution est datée et générique', () => {
  // ⚠️ Ce test ne recalcule PAS la taille du skill (voir en-tête de fichier,
  // § Gate de revue) : ce contrôle-là (« ajouter un octet fait rougir ») est
  // déjà tenu par S2 de skill-size-ceiling-coherence.test.js, avec le SEUL algorithme
  // de mesure qui doit exister pour cette constante (D9 — `mesure()` de ce
  // fichier n'est pas dupliquée ici).
  //
  // ⚠️ Mutation appliquée : remplacer le commentaire de PLAFOND_SKILL par
  // "// Octets (LF) de commands/sdd-run-ticket.md.\n// Re-mesuré." (sans date
  // ni attribution) → rouge constaté, puis révoqué. Variante : supprimer
  // entièrement le commentaire (l'ancre `CEILING_START_ANCHOR` disparaît, donc
  // `extractBetween` rend `null`, donc `readCeilingCommentBlock()` lève) →
  // rouge constaté aussi, puis révoqué.
  //
  // ⚠️ Le motif recherché est générique (`SKILL-\d+`, pas `SKILL-28` figé, et
  // une date au format `AAAA-MM-JJ`, pas `2026-08-22` figée) : le prochain
  // ticket qui re-mesure légitimement (ex. SKILL-31, nommé en Hors-scope de
  // specs/skill-28.md) attribue SA mesure à SON id et SA date — ce test doit
  // rester vert pour lui aussi (findings 3 et 4 de la gate).
  const CEILING_START_ANCHOR = '// Octets (LF) de commands/sdd-run-ticket.md.';
  const CEILING_END_ANCHOR = 'const PLAFOND_SKILL';

  function readCeilingCommentBlock() {
    const raw = fs.readFileSync(path.join(REPO_ROOT, CEILING_FILE), 'utf8');
    const block = extractBetween(raw, CEILING_START_ANCHOR, CEILING_END_ANCHOR);
    if (block === null) {
      throw new Error(
        `${CEILING_FILE} : ancres "${CEILING_START_ANCHOR}" / ` +
          `"${CEILING_END_ANCHOR}" introuvables — impossible de vérifier la ` +
          `re-mesure de PLAFOND_SKILL.`
      );
    }
    return block;
  }

  it('le commentaire de PLAFOND_SKILL documente une re-mesure datée et attribuée à un ticket', () => {
    const block = readCeilingCommentBlock();
    expect(
      block,
      'Le commentaire au-dessus de PLAFOND_SKILL doit documenter une ' +
        're-mesure au format "Re-mesuré le AAAA-MM-JJ (SKILL-NN)" — chaque ' +
        'ticket qui écrit dans le skill re-mesure et attribue SA mesure (D8).'
    ).toMatch(/Re-mesuré le \d{4}-\d{2}-\d{2}[\s\S]*?\(SKILL-\d+/);
  });
});
