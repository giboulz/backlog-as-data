// Helpers PARTAGÉS des tests SKILL-25 — un seul exemplaire, importé par
// `impl-templates-coherence.test.js`, `sdd-reviewer-wiring-coherence.test.js`,
// `reviewer-spawn-shape-coherence.test.js` (SKILL-34/SKILL-42 — `readNormalized` et,
// depuis SKILL-42, `extractBetween`), `backlog-skill-msys-coherence.test.js`
// (SKILL-36 — `readNormalized` seulement), `commands-shape-coherence.test.js`
// (familles G1, I1, J1, K1, L1 — 21 sites d'appel) et `review-log-wiring-coherence.test.js`
// (15 sites d'appel), depuis SKILL-43, pour `extractSection` ; et, depuis
// SKILL-28, `session-boundary-coherence.test.js` pour `readNormalized` et
// `extractBetween`.
//
// Pourquoi un module plutôt qu'un copier-coller (trouvé en revue) : ce module
// sert désormais TROIS dispositifs distincts, chacun partagé par plusieurs
// fichiers qui doivent rester d'accord entre eux :
// (1) `impl-templates-coherence.test.js` et `sdd-reviewer-wiring-coherence.test.js`
//     contrôlent le MÊME dispositif (prompts d'appel `<!-- APPEL:* -->` et
//     modes d'emploi `prompts/*.md`) selon la MÊME convention. Recopiés, ils
//     divergent en silence — c'était déjà le cas au premier jet, où l'un
//     normalisait CRLF avant de découper les paragraphes et l'autre non. Un
//     assouplissement futur de la convention (SKILL-27 comprime la prose du
//     skill) n'aurait alors corrigé qu'une moitié : le contrôle croisé « les
//     jetons déclarés dans le mode d'emploi == les jetons fournis par le
//     prompt d'appel » aurait comparé deux ensembles parsés différemment, et
//     serait passé au vert sur un ensemble amputé — rouvrant le trou même
//     qu'il ferme.
// (2) `extractBetween` (SKILL-42) sert un second dispositif — la découpe
//     d'une tranche entre deux ancres littérales — pour quatre fichiers qui,
//     eux, ne contrôlent NI les blocs `APPEL:*` NI les modes d'emploi
//     `prompts/*.md` : `sdd-reviewer-wiring-coherence.test.js`,
//     `impl-templates-coherence.test.js` et `reviewer-spawn-shape-coherence.test.js`
//     découpent des sections de `commands/sdd-run-ticket.md` ; depuis
//     SKILL-28, `session-boundary-coherence.test.js` l'utilise aussi, mais sur
//     `__tests__/skill-size-ceiling-coherence.test.js` (la tranche de commentaire de
//     `PLAFOND_SKILL`), pas sur le skill. La raison d'accueil est la MÊME que
//     pour (1) — une découpe recopiée peut diverger en silence (c'était le
//     constat de specs/skill-34.md, § Problème, qui a fixé le seuil de
//     promotion) — mais le dispositif contrôlé est différent.
// (3) `extractSection` (SKILL-43) sert un troisième dispositif — le corps
//     d'une section (en-tête EXCLU) jusqu'au prochain `## ` — pour SIX
//     appelants répartis dans DEUX fichiers qui, eux non plus, ne
//     contrôlent NI les blocs `APPEL:*` NI les modes d'emploi `prompts/*.md` :
//     `commands-shape-coherence.test.js` (familles G1/SKILL-15, I1/SKILL-18,
//     J1/SKILL-19, K1/SKILL-32, L1/SKILL-27) et `review-log-wiring-coherence.test.js`
//     (SKILL-37). Repris SIX fois avant promotion — dont une copie qui avait
//     réellement divergé (specs/skill-43.md, § Amendement) — c'est le même
//     constat que pour (1) et (2) : une découpe recopiée diverge en silence,
//     et le seuil qui déclenche la promotion est le même (specs/skill-34.md).
//
//     Un futur appelant qui ne touche à aucun bloc `APPEL:*` ni
//     `prompts/*.md` a donc quand même sa place ici s'il partage la découpe
//     par ancres de (2), OU le découpage par en-tête de section de (3).
//
// ⚠️ Troisième exemplaire connu, DÉLIBÉRÉMENT laissé en place :
// `findDeclared()` dans `__tests__/commands-shape-coherence.test.js` (F3). Ce
// fichier appartient à SKILL-27 et SKILL-25 n'a le droit d'y toucher que pour
// `SCAN_DIRS` (specs/skill-25.md, note de propriété). `declaredTokens()`
// ci-dessous en reproduit la sémantique À L'IDENTIQUE : toute évolution de la
// convention « Substitutions » doit toucher LES DEUX.
//
// ⚠️ D3 : ce module ne porte AUCUNE liste de contrôle (sections attendues,
// ancres, jetons). Ces listes restent déclarées dans chaque test, en dur — un
// test qui importerait ses attentes d'un module partagé avec l'autre test se
// validerait contre lui-même.

import fs from 'node:fs';
import path from 'node:path';
// ⚠️ SKILL-47 introduit ce SEUL import vitest, pour `sectionEntre` (ci-dessous) —
// amende l'interdiction posée par specs/skill-42.md (« n'importe pas vitest »,
// « jamais un `expect` dans le module partagé »). Cf. specs/skill-42.md,
// § Amendement, pour le pourquoi. Conséquence assumée : ce module n'est plus
// importable hors d'un runner vitest (`readNormalized`, `extractBetween`, etc.
// le sont toujours en pratique — seul `sectionEntre` en dépend).
import { expect } from 'vitest';

// Toute lecture est normalisée CRLF → LF avant assertion (convention du repo :
// `core.autocrlf=true` sous Windows ferait diverger les ancres multi-lignes).
// Le verrou `.gitattributes` (`prompts/*.md text eol=lf`) protège autre chose —
// la stabilité d'une MESURE de taille — et ne dispense pas de celle-ci.
export function readNormalized(repoRoot, relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
}

// (4) `platir` (SKILL-94) — QUATRIÈME dispositif : aplatir les blancs d'un bloc
// Markdown AVANT toute assertion de CONTENU. Rien à voir avec un découpage —
// c'est la préparation de l'opérande, pas sa délimitation — d'où l'ajout d'un
// quatrième point à la nomenclature de l'en-tête plutôt qu'un rattachement à
// (2) ou (3).
//
// Pourquoi partagé dès maintenant, plutôt que laissé en `const` locale : la
// prose de ce dépôt est enroulée à la main à ~78 colonnes, donc toute assertion
// sur une locution de plus de deux ou trois mots dépend du POINT D'ENROULEMENT
// — verte aujourd'hui, rouge demain sur un simple reflow qui ne change RIEN au
// sens, avec un message d'échec qui accuse une régression inexistante. Deux
// appelants au moment de la promotion, sur deux fichiers qui contrôlent le même
// ajout de SKILL-94 des deux côtés de la frontière (`CLAUDE.md` et
// `commands/sdd-run-ticket.md`) : `commands-shape-coherence.test.js` (bloc
// L1.4c) et `escalation-wiring-coherence.test.js` (Étape 6.6.5) — le seuil de
// promotion de specs/skill-34.md est atteint, et une copie locale aurait
// divergé exactement comme les trois dispositifs ci-dessus.
//
// ⛔ N'aplatis JAMAIS un texte dont l'assertion porte sur la STRUCTURE de
// lignes (comptage d'items `^\d+\.`, titre cherché en tête de ligne, numéro de
// ligne à rapporter) : `platir` détruit précisément ce que ces assertions
// lisent. Réservé aux assertions de CONTENU.
export function platir(s) {
  return s.replace(/\s+/g, ' ');
}

export function fileExists(repoRoot, relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

// Extrait le bloc à QUATRE backticks qui suit un marqueur-commentaire donné
// (ex. `<!-- APPEL:impl-same -->`), en tolérant des lignes vides entre le
// marqueur et la fence ouvrante. La première ligne non-vide après le marqueur
// DOIT être exactement "````" — sinon le marqueur n'est pas rattaché à un bloc
// et on renvoie `null`, que l'appelant traduit en rouge EXPLICITE (jamais une
// chaîne vide, qui passerait trivialement tous les `.includes()`).
//
// ⚠️ Le marqueur est cherché SUR SA PROPRE LIGNE, pas par `indexOf` : la prose
// du skill CITE légitimement ces marqueurs entre backticks, et un `indexOf`
// s'arrêterait sur cette première mention — non suivie d'une fence — donc
// rendrait `null` pour un fichier pourtant correct.
export function extractBlockAfterMarker(raw, marker) {
  const lines = raw.split('\n');
  const markerLine = lines.findIndex((l) => l.trim() === marker);
  if (markerLine === -1) return null;
  let openLine = -1;
  for (let i = markerLine + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (lines[i].trim() === '````') openLine = i;
    break; // la première ligne non vide après le marqueur DOIT être la fence
  }
  if (openLine === -1) return null;
  for (let j = openLine + 1; j < lines.length; j++) {
    if (lines[j].trim() === '````') return lines.slice(openLine + 1, j).join('\n');
  }
  return null; // fence ouverte jamais refermée
}

// Extrait la tranche `[from, to)` d'un texte entre deux ancres LITTÉRALES
// (ex. `## Étape 6.3` → `## Étape 6.4`), par `indexOf`, pas une regex : les
// ancres sont des titres Markdown exacts. Rend `null` si `from` est
// introuvable, OU si `to` est introuvable APRÈS `from` (ancre de fin absente,
// ou les deux dans le mauvais ordre) — JAMAIS une chaîne vide, qui passerait
// trivialement tous les `.includes()` de l'appelant (même convention que
// `extractBlockAfterMarker` ci-dessus).
//
// ⚠️ Amendé par SKILL-47 (cf. specs/skill-42.md, § Amendement) : SKILL-42 avait
// posé ici que la traduction du `null` en rouge explicite revenait TOUJOURS à
// l'appelant, jamais à ce module. Devenu faux dès la cinquième copie du même
// wrapper (`sectionEntre`, ci-dessous) : quand le message d'échec est
// STRICTEMENT le même pour tous les appelants (fichier + les deux ancres,
// rien d'autre), dupliquer sa traduction n'apporte plus rien — c'est
// `sectionEntre` qu'il faut appeler. `extractBetween` lui-même reste sans
// `expect` : un appelant qui a besoin d'un message différent (ex. distinguer
// « ancre de début » de « ancre de fin », ou ne pas nommer les ancres) l'appelle
// directement et traduit son `null` lui-même, comme avant SKILL-47.
export function extractBetween(raw, from, to) {
  const start = raw.indexOf(from);
  if (start === -1) return null;
  const end = raw.indexOf(to, start);
  // `end <= start` couvre `to` introuvable (`indexOf` rend `-1`, toujours
  // `<= start` puisque `start >= 0`) ET `to` trouvé À la position de `from`
  // (ex. `from === to`, ou `to` préfixe de `from`) — sinon `slice(start,
  // start)` rendrait `''`, exactement la chaîne vide que ce helper s'engage
  // à ne jamais rendre (trouvé en revue, SKILL-42 finding 1).
  if (end <= start) return null;
  return raw.slice(start, end);
}

// Enveloppe `extractBetween` : traduit son `null` en échec explicite nommant
// le FICHIER et les DEUX ancres, puis rend la section sinon. Promu depuis CINQ
// exemplaires quasi identiques — `etape645` (aggregator-wiring, SKILL-26),
// `etape65` (impl-templates-coherence, SKILL-25), `extractEtape63` ×2
// (reviewer-spawn-shape/SKILL-34, sdd-reviewer-wiring/SKILL-23) et `etape665`
// (escalation-wiring, SKILL-31) — cf. specs/skill-47.md, § Problème. Le seuil
// de promotion (« le jour où un troisième fichier en aura besoin »,
// specs/skill-34.md, § Décision D) était franchi dès la troisième copie,
// avant même SKILL-31.
//
// ⚠️ D3, comme pour `extractBetween` lui-même : ce helper ne porte AUCUNE
// liste de contrôle (ancres, sections attendues) — chaque appelant continue
// de déclarer ses ancres en dur.
export function sectionEntre(raw, from, to, fichier) {
  const section = extractBetween(raw, from, to);
  expect(
    section,
    `${fichier} : section "${from}" → "${to}" introuvable ` +
      `(l'une des deux ancres manque, ou elles sont dans le mauvais ordre).`
  ).not.toBeNull();
  return section;
}

// Extrait le corps d'une section (en-tête EXCLU) jusqu'au prochain `## ` —
// promu depuis SIX exemplaires quasi identiques (G1/SKILL-15, I1/SKILL-18,
// J1/SKILL-19, K1/SKILL-32, L1/SKILL-27, review-log-wiring/SKILL-37, cf.
// specs/skill-43.md). Rend `null` si `headingRe` ne matche aucune ligne.
//
// ⚠️ Le split est `/\r?\n/`, TOLÉRANT au CRLF, pas `'\n'` nu — c'est LA
// divergence mesurée entre les six copies avant promotion (specs/skill-43.md,
// § Amendement) : cinq appelants lisent leur fichier BRUT
// (`fs.readFileSync(…, 'utf8')`, sans normalisation), et sur ce dépôt
// `core.autocrlf=true` avec `commands/*.md` absent de `.gitattributes` — leur
// entrée PEUT porter des `\r`. Un seul appelant (L1/SKILL-27) normalise déjà
// CRLF → LF en amont (`readNorm`) avant d'appeler ce helper ; pour lui, ce
// split tolérant est un no-op prouvé (une entrée déjà normalisée ne contient
// plus de `\r`, les deux splits rendent le même tableau), jamais une
// régression. NE PAS « simplifier » en `split('\n')` au prétexte qu'un
// appelant normalise déjà : ce serait casser silencieusement les cinq autres.
export function extractSection(raw, headingRe) {
  const lines = raw.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const out = [];
  for (let j = start + 1; j < lines.length; j++) {
    if (/^##\s/.test(lines[j])) break;
    out.push(lines[j]);
  }
  return out.join('\n');
}

// Un titre de section est cherché EN DÉBUT DE LIGNE et doit être suivi d'un
// blanc ou d'une fin de ligne. ⚠️ Un `includes` (ou un `startsWith` nu) rendrait
// l'assertion « `## Étape 0` est présent » trivialement vraie dès que
// `## Étape 0.1` existe — `## Étape 0` en est un préfixe.
export function hasSectionHeading(raw, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(\\s|$)`, 'm').test(raw);
}

// Les jetons déclarés vivent dans un paragraphe (bloc séparé par une ligne
// vide) qui contient le mot « Substitutions », chacun cité entre backticks
// simples. Sémantique STRICTEMENT identique à `findDeclared()` de F3
// (`commands-shape-coherence.test.js`), y compris le découpage tolérant au
// CRLF — les deux doivent évoluer ensemble (cf. en-tête de ce module).
export function declaredTokens(raw) {
  const declared = new Set();
  for (const paragraph of raw.split(/\r?\n\r?\n/)) {
    if (!/substitutions/i.test(paragraph)) continue;
    const re = /`(<[^`>]+>)`/g;
    let m;
    while ((m = re.exec(paragraph))) declared.add(m[1]);
  }
  return declared;
}

// Jetons de substitution d'un bloc d'appel. Motif DÉLIBÉRÉMENT large (`<…>`
// sans chevron imbriqué) : la liste de variables est « fermée » au sens de D4,
// donc toute paire de chevrons présente dans un bloc d'appel EST une variable —
// les blocs sont courts et n'ont aucune raison de porter de la prose entre
// chevrons. Un motif restreint aux ALL_CAPS laisserait passer exactement la
// variable clandestine que ce contrôle est censé voir.
export function tokensOf(block) {
  return new Set(block.match(/<[^<>]+>/g) || []);
}
