// SKILL-79 (specs/skill-79.md) — atteste, DANS LES DEUX SENS, le prédicat
// `estCitationSpecCouverte` extrait dans `./helpers/legacy-path-policy.js`
// (ce fichier-ci en est le CONSOMMATEUR — le deuxième appelant réel du groupe
// M2 de `commands-shape-coherence.test.js`, qui a justifié l'extraction ; voir
// l'en-tête du helper pour les motifs de cette extraction). Sur une
// arborescence de fixtures écrite par ce test : c'est le seul dispositif
// possible pour le sens « rouge » — le corpus réel ne contient, par
// construction, aucune spec non livrée fautive (s'il en contenait une, M2
// serait déjà rouge) — cf. § Tests, specs/skill-79.md.
//
// Arbitrage SKILL-79 : l'exemption est portée par le MARQUEUR (bandeau ou
// renvoi sur la section qui cite), PAS par le `status` du frontmatter. Les
// cas 1 à 5 ci-dessous croisent les deux sens (couverte / non couverte) avec
// les deux régimes de statut (non livrée / livrée) pour prouver que seul le
// marqueur décide désormais. Les cas 6 et 7 (SKILL-88) croisent les deux sens
// d'un second défaut, indépendant du statut : le rattachement d'une citation
// portée par une ligne de titre `## …` à sa propre section — voir leur
// commentaire, ci-dessous. Les cas A, C et E (SKILL-89) durcissent la branche
// renvoi elle-même : un renvoi n'exempte plus qu'à condition qu'un bandeau
// nommant l'ancien chemin en cause existe RÉELLEMENT quelque part ailleurs
// dans le document (section ou préambule) — voir leur commentaire,
// ci-dessous. Pas de cas « B »/« D » distincts : les Cas 3 et 1 ci-dessus
// couvrent déjà ces deux sens (voir la note à leur sujet).
//
// ⚠️ SKILL-88 a fermé la duplication qu'une version antérieure de cet en-tête
// signalait ici comme limite connue : `decouperEnSections`/`bandeauxDe`/
// `porteUnRenvoi` n'ont plus qu'une seule définition dans le dépôt (le
// helper), et `legacy-path-bandeau-coherence.test.js` (SKILL-72) en est
// devenu le troisième appelant réel, pas une copie indépendante.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { estCitationSpecCouverte } from './helpers/legacy-path-policy.js';

const OLD_NAME = 'ancien-fichier.test.js';

let repoRoot;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-79-legacy-path-'));
  fs.mkdirSync(path.join(repoRoot, 'specs'));
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

// Écrit `specs/<name>.md` dans la fixture et retourne le numéro de ligne
// 1-based de la citation qu'un `git grep -n` réel remonterait à M2 — c'est ce
// numéro que M2 passerait à `estCitationSpecCouverte`.
//
// ⚠️ Finding 1 (gate SKILL-79) : la version précédente prenait la PREMIÈRE
// ligne contenant `OLD_NAME`, sans exclure le bandeau — dans les fixtures 1 et
// 4, cette première ligne EST la ligne du bandeau lui-même (`> Ancien chemin
// … OLD_NAME …`), pas la citation en prose qui le suit. Les deux cas censés
// attester « une citation ailleurs dans la section est couverte par le
// bandeau » n'attestaient donc que « une ligne interne au bandeau est
// couverte » — un `git grep -n` réel ne remonte de toute façon jamais une
// ligne de bandeau comme site à couvrir (le bandeau EXPLIQUE la citation, il
// n'en est pas une lui-même à couvrir), donc cette ligne n'est de toute façon
// jamais celle qu'un vrai appel de M2 passerait ici. `!l.startsWith('>')`
// exclut le bandeau de la recherche pour retomber sur la citation en prose,
// dans toutes les fixtures (1, 3, 4 ont un bandeau ou un renvoi hors bloc `>` ;
// 2 et 5 n'en ont aucun, la ligne trouvée est donc déjà la seule candidate).
function ecrireFixture(name, lignes) {
  const raw = lignes.join('\n');
  fs.writeFileSync(path.join(repoRoot, 'specs', `${name}.md`), raw, 'utf8');
  const ligneIdx = lignes.findIndex((l) => l.includes(OLD_NAME) && !l.startsWith('>'));
  expect(ligneIdx, `fixture ${name} : aucune ligne (hors bandeau) ne cite ${OLD_NAME}.`).toBeGreaterThanOrEqual(0);
  return { file: `specs/${name}.md`, ligne1Based: ligneIdx + 1 };
}

describe('estCitationSpecCouverte (SKILL-79) — l\'exemption est portée par le marqueur, pas par le statut', () => {
  // Cas 1 — le déblocage que ce ticket achète : une spec NON LIVRÉE, section
  // avec bandeau, doit être couverte.
  it('status: maturing, section avec bandeau qui nomme l\'ancien chemin → couverte', () => {
    const { file, ligne1Based } = ecrireFixture('fixture-1-maturing-bandeau', [
      '---',
      'id: FIX-1',
      'status: maturing',
      '---',
      '',
      '## Section',
      '',
      `> Ancien chemin cité délibérément : ${OLD_NAME} (renommé par SKILL-99).`,
      '',
      `Voir ${OLD_NAME} pour le contexte.`,
    ]);
    expect(estCitationSpecCouverte(repoRoot, file, ligne1Based, OLD_NAME)).toBe(true);
  });

  // Cas 2 — la prise qu'on refuse de perdre : la même section, sans AUCUN
  // marqueur, reste rouge même en statut non livré.
  it('status: maturing, section sans bandeau ni renvoi → non couverte', () => {
    const { file, ligne1Based } = ecrireFixture('fixture-2-maturing-nu', [
      '---',
      'id: FIX-2',
      'status: maturing',
      '---',
      '',
      '## Section',
      '',
      `Voir ${OLD_NAME} pour le contexte.`,
    ]);
    expect(estCitationSpecCouverte(repoRoot, file, ligne1Based, OLD_NAME)).toBe(false);
  });

  // Cas 3 — seconde branche du prédicat (renvoi), que rien d'autre
  // n'exercerait hors statut livré.
  //
  // ⚠️ Fixture retouchée par [[SKILL-89]] (specs/skill-89.md § Tests, point 2) :
  // la version d'origine (mot « bandeau » seul, aucune section-cible réelle
  // dans la fixture) est EXACTEMENT le trou que SKILL-89 ferme — sous le
  // durcissement de `porteUnRenvoi` (§ Correction attendue, arbitrage D1),
  // elle rougirait nécessairement (c'est ce que le nouveau cas A ci-dessous
  // atteste explicitement, sur la même fixture). Aucune variante de
  // l'implémentation de D1 ne peut la laisser verte SANS retouche : la
  // garder inchangée contredirait la Correction attendue elle-même, que la
  // spec exige d'implémenter (« si l'un d'eux doit être modifié POUR PASSER,
  // c'est que le durcissement a débordé » — ici le blocage n'est pas un
  // débordement, c'est l'exercice même du prédicat qu'on durcit). Le
  // correctif est MINIMAL et préserve l'intention d'origine (« la seconde
  // branche, seule, doit couvrir ») : ajouter la section-cible que le renvoi
  // nommait déjà en toutes lettres, avec son bandeau — un renvoi qui se
  // résout réellement, ce que cette fixture prétendait déjà tester.
  it('status: maturing, section avec un renvoi qui se résout vers le bandeau d\'une autre section → couverte', () => {
    const { file, ligne1Based } = ecrireFixture('fixture-3-maturing-renvoi', [
      '---',
      'id: FIX-3',
      'status: maturing',
      '---',
      '',
      '## Section',
      '',
      `Voir ${OLD_NAME} — bandeau porté par la section "§ Autre section" ci-dessous.`,
      '',
      '## Autre section',
      '',
      `> Ancien chemin cité délibérément : ${OLD_NAME} (renommé par SKILL-99).`,
    ]);
    expect(estCitationSpecCouverte(repoRoot, file, ligne1Based, OLD_NAME)).toBe(true);
  });

  // Cas 4 — non-régression du cas SKILL-72 : spec livrée, section avec
  // bandeau, reste couverte.
  it('status: shipped, section avec bandeau → couverte', () => {
    const { file, ligne1Based } = ecrireFixture('fixture-4-shipped-bandeau', [
      '---',
      'id: FIX-4',
      'status: shipped',
      '---',
      '',
      '## Section',
      '',
      `> Ancien chemin cité délibérément : ${OLD_NAME} (renommé par SKILL-99).`,
      '',
      `Voir ${OLD_NAME} pour le contexte.`,
    ]);
    expect(estCitationSpecCouverte(repoRoot, file, ligne1Based, OLD_NAME)).toBe(true);
  });

  // Cas 5 — non-régression du finding 3 de la gate SKILL-73 : spec livrée,
  // sans marqueur, reste rouge — le statut seul ne suffit plus.
  it('status: shipped, section sans bandeau ni renvoi → non couverte', () => {
    const { file, ligne1Based } = ecrireFixture('fixture-5-shipped-nu', [
      '---',
      'id: FIX-5',
      'status: shipped',
      '---',
      '',
      '## Section',
      '',
      `Voir ${OLD_NAME} pour le contexte.`,
    ]);
    expect(estCitationSpecCouverte(repoRoot, file, ligne1Based, OLD_NAME)).toBe(false);
  });

  // ⚠️ Mutation-témoin (§ Tests, specs/skill-79.md) : remettre la lecture du
  // `status` dans `estCitationSpecCouverte` (ex. `if (!['merged',
  // 'shipped'].includes(statut)) return false;` avant le calcul de section)
  // → les cas 1 et 3 (status: maturing, marqueur présent) rougissent, les cas
  // 2/4/5 restent verts. Sans cette mutation-témoin, ce fichier ne prouve pas
  // qu'il garde la correction de ce ticket. Résultat mesuré en § Vérification
  // du rapport final de SKILL-79.

  // Cas 6/7 (SKILL-88, point 2 — rattachement d'une ligne de titre) : une
  // citation portée PAR une ligne `## …` elle-même (pas par son corps) doit
  // être jugée sur le bandeau/renvoi de SA PROPRE section, jamais sur celui
  // de la section qui la précède. Avant ce ticket, `decouperEnSections`
  // posait `fin` à l'index du titre suivant et le test d'appartenance était
  // inclusif sur `fin` (`ligneIdx > s.debut && ligneIdx <= s.fin`) — la ligne
  // de titre appartenait donc à la section PRÉCÉDENTE. Les deux cas
  // ci-dessous croisent les deux sens, car le défaut se manifeste dans les
  // deux sens (une section précédente sans rapport ne doit plus exempter à
  // tort ; une section qui pose correctement son bandeau sous son propre
  // titre doit être reconnue).

  // Cas 6 — sens « faux positif » : la section A (précédente) porte un
  // bandeau qui nomme OLD_NAME, la section B cite OLD_NAME DANS SON TITRE et
  // ne porte elle-même ni bandeau ni renvoi → non couverte (avant ce ticket :
  // couverte à tort par le bandeau de A).
  it('citation portée par un titre "## ", section précédente avec bandeau sans rapport, section elle-même nue → non couverte', () => {
    const { file, ligne1Based } = ecrireFixture('fixture-6-titre-non-couverte', [
      '---',
      'id: FIX-6',
      'status: maturing',
      '---',
      '',
      '## Section A',
      '',
      `> Ancien chemin cité délibérément : ${OLD_NAME} (renommé par SKILL-99).`,
      '',
      `## Section B cite ${OLD_NAME} dans son titre`,
      '',
      'Corps de la section B, nu.',
    ]);
    expect(estCitationSpecCouverte(repoRoot, file, ligne1Based, OLD_NAME)).toBe(false);
  });

  // Cas 7 — sens « faux négatif » : la section A (précédente) est nue, la
  // section B cite OLD_NAME dans son titre ET porte son propre bandeau juste
  // sous ce titre → couverte (avant ce ticket : non couverte à tort, le
  // titre étant jugé sur la section A).
  it('citation portée par un titre "## ", section elle-même avec son propre bandeau sous le titre → couverte', () => {
    const { file, ligne1Based } = ecrireFixture('fixture-7-titre-couverte', [
      '---',
      'id: FIX-7',
      'status: maturing',
      '---',
      '',
      '## Section A',
      '',
      'Corps de la section A, sans marqueur.',
      '',
      `## Section B cite ${OLD_NAME} dans son titre`,
      '',
      `> Ancien chemin cité délibérément : ${OLD_NAME} (renommé par SKILL-99).`,
    ]);
    expect(estCitationSpecCouverte(repoRoot, file, ligne1Based, OLD_NAME)).toBe(true);
  });

  // ⚠️ Mutation-témoin, cas 6/7 : rétablir le test d'appartenance en
  // `ligneIdx > s.debut && ligneIdx <= s.fin` (au lieu de `>= s.debut &&
  // < s.fin`) → les cas 6 ET 7 rougissent (6 devient `true` à tort, 7 reste
  // `false` à tort). Deux cas, parce que le défaut se manifeste dans les deux
  // sens — un seul n'attesterait que la moitié.

  // Cas A, C, E ([[SKILL-89]], specs/skill-89.md § Correction attendue,
  // arbitrage D1, variante (a) « approximation par document ») : avant ce
  // ticket, `porteUnRenvoi` exemptait une section dès qu'une de ses lignes,
  // hors bandeau, contenait le mot « bandeau » — sans jamais vérifier qu'un
  // bandeau nommant CE chemin précis existe quelque part. Durci : le renvoi
  // n'exempte plus que si un bandeau nommant cet ancien chemin existe
  // RÉELLEMENT quelque part ailleurs dans le même document.
  //
  // ⚠️ Pas de cas « B » ni « D » distincts (gate SKILL-89, finding 4) : le
  // sens « renvoi qui se résout vers un bandeau réel → couverte » est déjà
  // exercé par le Cas 3 ci-dessus (retouché par ce même ticket pour rester
  // un renvoi VALIDE), et le sens « bandeau local, branche 1, non-régression »
  // est déjà exercé par le Cas 1 — deux fixtures numérotées « B »/« D » qui
  // dupliquaient ces cas ligne à ligne, sans rien discriminer de plus,
  // faisaient croire à une couverture de non-régression qu'elles n'apportaient
  // pas.

  // Cas A — le trou que ce ticket ferme : mot « bandeau » présent, mais
  // AUCUNE section du document ne nomme l'ancien chemin → non couverte
  // (avant ce ticket : couverte à tort, sur la seule présence du mot).
  it('renvoi (mot "bandeau") mais aucune section du document ne nomme le chemin → non couverte', () => {
    const { file, ligne1Based } = ecrireFixture('fixture-a-renvoi-sans-cible', [
      '---',
      'id: FIX-A',
      'status: maturing',
      '---',
      '',
      '## Section',
      '',
      `Voir ${OLD_NAME} — bandeau porté par la section "§ Autre section" ci-dessous.`,
      '',
      '## Autre section',
      '',
      'Corps sans bandeau ni mention de cet ancien chemin.',
    ]);
    expect(estCitationSpecCouverte(repoRoot, file, ligne1Based, OLD_NAME)).toBe(false);
  });

  // Cas C — le renvoi ne vaut que pour LE chemin qu'il explique : mot
  // « bandeau » présent, une autre section porte un bandeau, mais qui nomme
  // un AUTRE chemin → non couverte.
  it('renvoi (mot "bandeau") et une autre section porte un bandeau, mais pour un autre chemin → non couverte', () => {
    const AUTRE_NAME = 'autre-fichier.test.js';
    const { file, ligne1Based } = ecrireFixture('fixture-c-renvoi-mauvaise-cible', [
      '---',
      'id: FIX-C',
      'status: maturing',
      '---',
      '',
      '## Section',
      '',
      `Voir ${OLD_NAME} — bandeau porté par la section "§ Autre section" ci-dessous.`,
      '',
      '## Autre section',
      '',
      `> Ancien chemin cité délibérément : ${AUTRE_NAME} (renommé par SKILL-99).`,
    ]);
    expect(estCitationSpecCouverte(repoRoot, file, ligne1Based, OLD_NAME)).toBe(false);
  });

  // Cas E (gate SKILL-89, finding 5) : le bandeau-cible n'est pas dans une
  // section au sens de `decouperEnSections` — il est dans le PRÉAMBULE, avant
  // le premier `## `, l'idiome dominant du dépôt pour les blocs `>`
  // d'ouverture (ex. specs/skill-89.md:18-26). Avant ce correctif,
  // `porteUnRenvoi` ne cherchait le bandeau-cible que dans `sections`, qui
  // jette le préambule par construction — ce bandeau réel était donc
  // invisible, en silence, et la section aurait rougi malgré un bandeau
  // effectivement présent dans le document.
  it('renvoi (mot "bandeau") et le bandeau du chemin est dans le PRÉAMBULE (avant le premier "## ") → couverte', () => {
    const { file, ligne1Based } = ecrireFixture('fixture-e-renvoi-vers-preambule', [
      '---',
      'id: FIX-E',
      'status: maturing',
      '---',
      '',
      `> Ancien chemin cité dans ce fichier : ${OLD_NAME} (renommé par SKILL-99).`,
      '',
      '## Section',
      '',
      `Voir ${OLD_NAME} — bandeau en tête de fichier.`,
    ]);
    expect(estCitationSpecCouverte(repoRoot, file, ligne1Based, OLD_NAME)).toBe(true);
  });

  // ⚠️ Mutation-témoin, cas A/C/E (§ Tests, specs/skill-89.md, étendu par la
  // gate de revue) : rétablir `porteUnRenvoi` en test de présence du mot seul
  // (retirer la vérification qu'un bandeau réel du chemin existe ailleurs
  // dans le document) → les cas A et C rougissent (ils deviennent `true` à
  // tort), E reste vert (il l'était déjà sous l'ancienne version, pour la
  // mauvaise raison). Mutation-témoin dédiée au cas E : restreindre la
  // recherche du bandeau-cible à `sections` (au lieu de `raw`, le document
  // complet) → E rougit (`false` à tort), A/C inchangés.
});
