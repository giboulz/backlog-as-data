// Helper PARTAGÉ — politique d'exemption SKILL-72, corrigée par SKILL-79
// (specs/skill-79.md).
//
// Extrait du groupe M2 de `commands-shape-coherence.test.js` (SKILL-73), OÙ
// cette copie précise du mécanisme atteignait son deuxième appelant réel —
// `legacy-path-exemption-coherence.test.js`, qui exige de couvrir le
// prédicat DANS LES DEUX SENS sur une arborescence de fixtures (§ Portée / D1,
// specs/skill-79.md). C'est la convention du dépôt (`prompt-blocks.js`,
// en-tête D3) : ne promouvoir un mécanisme recopié qu'à partir du deuxième
// appelant réel. Point fermé par [[SKILL-88]] (point 1, finding 4 de la gate
// SKILL-79) : `legacy-path-bandeau-coherence.test.js` (SKILL-72, dédié à
// `specs/skill-62.md`) portait sa propre implémentation indépendante et
// ANTÉRIEURE de `decouperEnSections`/`bandeauxDe`/`porteUnRenvoi`, non
// touchée par cette extraction — risque de divergence désormais fermé : ce
// fichier est le lieu UNIQUE des trois primitives, `legacy-path-bandeau-coherence.test.js`
// les importe d'ici (`sansBandeaux`, propre à ce dernier, n'a qu'un appelant
// et ne remonte pas — convention `prompt-blocks.js` en-tête D3).
//
// Arbitrage SKILL-79 (specs/skill-79.md § Correction attendue) : l'exemption
// est portée par le MARQUEUR (bandeau ou renvoi sur la section qui cite),
// PAS par le `status` du frontmatter. Avant ce ticket, `estCitationSpecCouverte`
// lisait `status:` et ne rendait `true` que sur `merged`/`shipped` — une spec
// en `maturing`/`todo`/`wip` qui devait citer un ancien chemin (le sujet même
// d'un ticket de dette) rougissait alors le contrôle M2, sans échappatoire
// autre que de scinder le nom littéral. Le `status` n'est donc plus lu ici.
//
// ⚠️ CONTRAT ACTUEL (durci par [[SKILL-89]], specs/skill-89.md § Correction
// attendue, arbitrage D1, variante (a) « approximation par document » — ne
// PAS se fier à un contrat plus ancien lu ailleurs, y compris dans un
// commentaire local qui daterait d'avant ce ticket) : une section est
// couverte pour un ancien chemin précis si, SOIT
//   (1) elle porte elle-même un bandeau (bloc `>`) qui nomme ce chemin, SOIT
//   (2) elle porte un renvoi — une ligne hors bloc `>` qui évoque le mot
//       « bandeau » — ET qu'il existe, QUELQUE PART AILLEURS dans le même
//       document (n'importe quelle section, ou le préambule avant le premier
//       `## `), un bandeau qui nomme littéralement ce chemin.
// La condition (2) NE vérifie PAS que le renvoi désigne CORRECTEMENT la
// section qui porte ce bandeau (ce serait la variante (b), écartée par la
// mesure — voir `porteUnRenvoi` ci-dessous) : n'importe quel bandeau réel du
// chemin, où qu'il soit dans le document, suffit à valider un renvoi qui
// évoque le mot « bandeau ». Voir `porteUnRenvoi` pour le détail et la
// justification de ce choix.
//
// ⛔ Hors portée, UN cas, non changé ici (hérité tel quel de SKILL-73) :
// une citation placée AVANT le premier titre de niveau 2 — le préambule
// d'une spec — n'appartient à AUCUNE section au sens de `decouperEnSections`
// ci-dessous, donc n'est jamais couverte, quel que soit le bandeau qui la
// précède. C'est un troisième défaut, distinct de l'ancien off-by-one
// ci-dessous, explicitement laissé ouvert par [[SKILL-88]] (§ Portée,
// « Hors portée »).
//
// ⚠️ Point fermé par [[SKILL-88]] (point 2, finding 7 de la gate SKILL-79) :
// une citation portée PAR une ligne de titre `## …` elle-même (pas par son
// corps) était jugée sur le bandeau/renvoi de la section PRÉCÉDENTE, pas sur
// celui de sa propre section — `decouperEnSections` posait `fin` à l'index du
// titre suivant et le test d'appartenance (dans `estCitationSpecCouverte`
// ci-dessous) était inclusif sur `fin`. La ligne de titre appartient
// désormais à SA PROPRE section (`ligneIdx >= s.debut && ligneIdx < s.fin`).
//
// `repoRoot` en paramètre (et non capturé par fermeture, comme avant
// l'extraction) : c'est ce qui permet à `legacy-path-exemption-coherence.test.js`
// d'appeler `estCitationSpecCouverte` sur une arborescence de fixtures écrite
// par le test, distincte du dépôt réel.

import fs from 'node:fs';
import path from 'node:path';

// Politique SKILL-72, moitié (b) : une citation n'est exemptée QUE si la
// SECTION qui la porte a un bandeau qui la nomme, ou un renvoi vers la
// section qui le porte — jamais l'exemption en bloc du fichier entier.
//
// `titre` (SKILL-88, point 1) : la copie indépendante de
// `legacy-path-bandeau-coherence.test.js` (SKILL-72) avait besoin du titre de
// chaque section (`s.titre`, utilisé dans ses descriptions de test et ses
// messages d'assertion) ; cette version unifiée le porte aussi, en plus de
// `debut`/`fin`/`corps` — aucun appelant ne perd d'information.
export function decouperEnSections(raw) {
  const lignes = raw.split('\n');
  const sections = [];
  let courante = null;
  lignes.forEach((ligne, i) => {
    if (/^##\s+/.test(ligne)) {
      if (courante) {
        courante.fin = i;
        sections.push(courante);
      }
      courante = { debut: i, titre: ligne.replace(/^##\s+/, '').trim(), corps: [] };
    } else if (courante) {
      courante.corps.push(ligne);
    }
  });
  if (courante) {
    courante.fin = lignes.length;
    sections.push(courante);
  }
  return sections.map((s) => ({ ...s, corps: s.corps.join('\n') }));
}

// --- Bandeaux : blocs de lignes CONSÉCUTIVES commençant par `>` -------------
//
// ⚠️ Reprise (finding 7 de la gate SKILL-72, déplacé ici par [[SKILL-88]]
// point 1 avec le code qu'il explique) : une version antérieure cherchait UN
// SEUL bandeau, par l'ancre littérale du bandeau SKILL-65. Un second bandeau,
// posé par un autre ticket sur une autre section, lui était invisible —
// celle-ci détecte TOUT bloc `>` du document, où qu'il soit.
export function bandeauxDe(corps) {
  const blocs = [];
  let courant = [];
  for (const ligne of corps.split('\n')) {
    if (ligne.startsWith('>')) {
      courant.push(ligne);
    } else if (courant.length) {
      blocs.push(courant.join('\n'));
      courant = [];
    }
  }
  if (courant.length) blocs.push(courant.join('\n'));
  return blocs;
}

// Une section porte un RENVOI, pour un ANCIEN CHEMIN précis, quand DEUX
// conditions tiennent ensemble (durci par [[SKILL-89]] — specs/skill-89.md
// § Correction attendue, arbitrage D1, variante (a) « approximation par
// document ») :
//
//  1. une de ses lignes, HORS bandeau, évoque explicitement un bandeau
//     (inchangé depuis SKILL-72/SKILL-88) ;
//  2. il existe, QUELQUE PART AILLEURS dans le même document, un bandeau qui
//     nomme littéralement CET ancien chemin — n'importe où dans `raw`, y
//     compris dans le PRÉAMBULE (avant le premier `## `). Point fermé par
//     [[SKILL-89]] (finding 5 de sa propre gate) : une version antérieure ne
//     cherchait que dans `sections` (issues de `decouperEnSections`, qui
//     jette le préambule par construction — voir l'en-tête de ce fichier,
//     § Hors portée) — un bandeau posé en tête de fichier, l'idiome dominant
//     du dépôt pour les blocs `>` d'ouverture (ex. specs/skill-89.md:18-26),
//     était donc INVISIBLE comme cible de renvoi, en silence.
//
// Avant SKILL-89, seule la condition 1 était vérifiée : n'importe quelle
// ligne de prose contenant le mot « bandeau » exemptait la section, sans
// jamais vérifier qu'un bandeau existe quelque part pour LE chemin en cause
// — un renvoi pouvait mentir, ou pointer dans le vide, sans que rien ne le
// détecte (specs/skill-89.md § Symptôme, mesuré : 42 sections exemptées par
// cette seule branche, 26 sites réels en dépendant uniquement).
//
// ⚠️ La condition 2 ne vérifie PAS que le renvoi désigne CORRECTEMENT la
// section qui porte le bandeau (ce serait la variante (b), « résolution du
// renvoi », qui suppose de résoudre un titre `§ X`/`## X` écrit à la main) :
// n'importe quel bandeau réel du chemin, où qu'il soit dans le document,
// suffit. Choix mesuré, pas présumé depuis la préférence écrite de D1 :
// remesuré sur le corpus AVANT durcissement (commit 4a6eef3), (a) laisse
// 15 sites rouges sur 4 fichiers quand (b) — résolution heuristique de
// `§`/`##` dans le corps du renvoi — en laisse 26 sur les mêmes 4 fichiers.
// Voir specs/skill-89.md § Correction attendue, D1 pour le détail des deux
// mesures.
//
// ⚠️ La garantie de la condition 1 ne vient PAS d'une propriété du corpus —
// sur `specs/**.md` (le corpus de ce helper, distinct de `specs/skill-62.md`
// qui motivait le commentaire d'origine chez SKILL-72), de nombreux BANDEAUX
// contiennent eux-mêmes littéralement le mot « bandeau » (ex.
// `specs/skill-79.md:108`, `specs/skill-82.md:76`). La garantie vient
// UNIQUEMENT du `.filter((l) => !l.startsWith('>'))` ci-dessous, qui écarte
// ces lignes avant le test `/bandeau/i` — ne pas le retirer en le prenant
// pour une redondance : sans lui, un bandeau qui nomme son propre mécanisme
// exempterait à tort sa section.
//
// `raw` : le texte COMPLET du document (pas seulement les sections) —
// `bandeauxDe(raw)` y détecte TOUT bloc `>`, section ou préambule confondus.
// Inclut la section qui porte le renvoi elle-même : sans effet pratique (si
// elle portait déjà le bandeau du chemin, `estCitationSpecCouverte` aurait
// rendu `true` par sa première branche, avant d'appeler `porteUnRenvoi`),
// mais évite un filtrage inutile ici.
export function porteUnRenvoi(corps, oldName, raw) {
  const aUneLigneDeRenvoi = corps
    .split('\n')
    .filter((l) => !l.startsWith('>'))
    .some((l) => /bandeau/i.test(l));
  if (!aUneLigneDeRenvoi) return false;
  return bandeauxDe(raw).some((b) => b.includes(oldName));
}

export function estCitationSpecCouverte(repoRoot, file, ligne1Based, oldName) {
  if (!/^specs\/.*\.md$/.test(file)) return false;
  const abs = path.join(repoRoot, file);
  if (!fs.existsSync(abs)) return false;
  const raw = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  const ligneIdx = Number(ligne1Based) - 1;
  const sections = decouperEnSections(raw);
  // SKILL-88 point 2 : `>= s.debut && < s.fin` (au lieu de `> s.debut && <=
  // s.fin`) rattache la ligne de titre `## …` à SA PROPRE section — voir
  // l'en-tête de ce fichier.
  const section = sections.find((s) => ligneIdx >= s.debut && ligneIdx < s.fin);
  if (!section) return false;
  const bandeaux = bandeauxDe(section.corps);
  if (bandeaux.some((b) => b.includes(oldName))) return true;
  return porteUnRenvoi(section.corps, oldName, raw);
}
