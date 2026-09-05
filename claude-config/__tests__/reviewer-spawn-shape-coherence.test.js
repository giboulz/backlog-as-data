// SKILL-34 — assertion de FORME sur l'appel des relecteurs de l'Étape 6.3 de
// `commands/sdd-run-ticket.md`.
//
// Contexte (specs/skill-34.md) : le ticket a été ouvert sur l'intuition que les
// relecteurs d'un dosage `deep` tournaient en série ; la spec constate que le
// parallélisme est DÉJÀ prescrit (trois appels `Agent` dans un seul message),
// abandonne la moitié `run_in_background: true` + attente de N notifications
// (caduque), et retient seulement la moitié testable : verrouiller par un test
// la FORME de l'appel — `run_in_background: false`, et la mention « un seul
// message, N appels Agent » sur la puce `deep`, avec N == nombre de relecteurs.
//
// Ce fichier est NEUF (§ Décision D de specs/skill-34.md) : `sdd-reviewer-
// wiring.test.js` appartient à SKILL-23/SKILL-25, pas d'autorisation écrite
// pour y toucher.
//
// Doit rougir SEULEMENT par mutation (§ Vérification 1) : le fichier commité
// est déjà conforme, il n'y a pas de code à réparer, seulement une garde à
// poser.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// Helpers PARTAGÉS avec sdd-reviewer-wiring-coherence.test.js et
// impl-templates-coherence.test.js — lecture normalisée CRLF → LF et, depuis
// SKILL-42, découpe de section (cf. __tests__/helpers/prompt-blocks.js).
import { readNormalized, sectionEntre } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SDD_FILE = 'commands/sdd-run-ticket.md';

const readSddFile = () => readNormalized(REPO_ROOT, SDD_FILE);

// Découpe déléguée à `sectionEntre` (SKILL-47, cf. specs/skill-42.md,
// § Amendement) — le helper partagé appelle `extractBetween`, et traduit
// LUI-MÊME son `null` en rouge explicite, en nommant le fichier et les deux
// ancres. Cette garde ne protège pas symétriquement les deux assertions
// ci-dessous : une chaîne vide ferait rougir N1.1 (`.toBe(true)`, une section
// vide ne contient pas `run_in_background: false`) mais passerait trivialement
// N1.2 (`.toBe(false)`, une section vide ne contient pas non plus
// `run_in_background: true`) — c'est donc N1.2 que la garde protège d'un vert
// trompeur, pas N1.1.
//
// ⚠️ Historique (SKILL-34, finding 4) : cette découpe par ancres littérales,
// écrite en dur avec `String.prototype.indexOf`, existait en TROIS
// exemplaires — celui-ci, `extractEtape63` de `sdd-reviewer-wiring-coherence.test.js`
// et `etape65` de `impl-templates-coherence.test.js`. Le seuil de promotion
// vers un helper partagé (specs/skill-34.md, § Décision D : « le jour où un
// troisième fichier en aura besoin ») était déjà franchi ; la promotion
// elle-même a été faite par SKILL-42, une fois l'autorisation écrite obtenue
// sur les trois fichiers (specs/skill-42.md, § Autorisations écrites) — puis
// par SKILL-47, qui a promu le wrapper local restant vers `sectionEntre`.
const extractEtape63 = (raw) => sectionEntre(raw, '## Étape 6.3', '## Étape 6.4', SDD_FILE);

// Le "pourquoi" du `false` (§ Décision C de specs/skill-34.md : l'idiome du
// dépôt met le pourquoi dans le message d'échec du test, pas en prose dans le
// skill). Utilisé par N1.1 et N1.2 ci-dessous — trouvé en revue (finding 1) :
// sans lui, un mainteneur qui rougit N1.1/N1.2 en "harmonisant" le `false` sur
// le `true` de l'implémenteur (:517, :530) n'a aucune indication que ce
// `false` est une GARDE délibérée, pas un oubli.
const POURQUOI_FALSE =
  'Ce `false` est une GARDE délibérée (specs/skill-34.md, § Problème — ' +
  '« Pire que neutre… ») : elle rend structurelle l’attente des trois ' +
  'rapports avant les Étapes 6.4/6.5, qui n’ont aucun travail utile à faire ' +
  'tant que tous les relecteurs n’ont pas rendu. Ne l’« harmonise » pas sur ' +
  'le `run_in_background: true` de l’implémenteur (`:517`, `:530`) sans ' +
  'relire cette section de la spec : ce serait rouvrir le mode de défaillance ' +
  'que cette garde ferme.';

// Anchoré sur la puce `deep` elle-même (trouvé en revue, finding 2) : un motif
// non ancré prendrait la première occurrence de « un seul message, N appels
// `Agent` » de TOUTE la section, quelle que soit la puce qui la porte — faux
// négatif si un dosage inséré AVANT `deep` porte un N différent, faux positif
// si son N coïncide par accident avec celui de `deep` alors que le nombre de
// relecteurs de `deep`, lui, diverge. Les DEUX nombres sont donc capturés par
// UN SEUL motif, rattaché au jeton `` `deep` `` littéral.
const DEEP_BULLET_SHAPE =
  /`deep`\s*→\s*\*\*(\d+)\*\*\s*relecteurs?[^\n]*un seul message,\s*(\d+)\s*appels\s*`Agent`/;

describe('SKILL-34 — N1 : forme de l’appel du relecteur (Étape 6.3)', () => {
  // N1.1 — l'appel du relecteur reste synchrone.
  // Mutation-témoin : remplacer `false` par `true` à :717 → rouge.
  it('N1.1 — la section porte `run_in_background: false`', () => {
    const etape63 = extractEtape63(readSddFile());
    expect(
      etape63.includes('run_in_background: false'),
      `${SDD_FILE} : l'appel du relecteur (Étape 6.3) ne porte plus ` +
        `\`run_in_background: false\`. ${POURQUOI_FALSE}`
    ).toBe(true);
  });

  // N1.2 — l'Étape 6.3 ne prescrit nulle part le background pour un relecteur.
  // Mutation-témoin : ajouter une variante `run_in_background: true` dans
  // l'Étape 6.3 (à côté du `false`, sans le retirer) → rouge.
  // Contre-témoin (doit rester VERT) : les `run_in_background: true` de
  // l'implémenteur (:517, :530) sont hors de la découpe — preuve que le
  // découpage mord (§ Vérification 2 de la spec).
  it('N1.2 — la section ne prescrit nulle part `run_in_background: true`', () => {
    const etape63 = extractEtape63(readSddFile());
    expect(
      etape63.includes('run_in_background: true'),
      `${SDD_FILE} : l'Étape 6.3 prescrit désormais aussi ` +
        `\`run_in_background: true\` pour un relecteur, à côté du \`false\`. ` +
        `${POURQUOI_FALSE}`
    ).toBe(false);
  });

  // N1.3 — le dosage `deep` nomme sa forme d'appel : un seul message, N appels
  // `Agent`, avec N capturé par le motif.
  // Mutation-témoin : retirer la parenthèse de :726, en laissant
  // « `deep` → **3** relecteurs **en parallèle**. » → rouge.
  it('N1.3 — la puce `deep` nomme sa forme d’appel (un seul message, N appels Agent)', () => {
    const etape63 = extractEtape63(readSddFile());
    // Le motif est ANCRÉ sur `deep` (cf. DEEP_BULLET_SHAPE) : un match ailleurs
    // dans la section (une autre puce) ne compte pas.
    const shapeMatch = etape63.match(DEEP_BULLET_SHAPE);
    expect(
      shapeMatch,
      `${SDD_FILE} : la puce \`deep\` de l'Étape 6.3 ne nomme plus sa forme ` +
        `d'appel (« un seul message, N appels \`Agent\` ») — le parallélisme ` +
        `redeviendrait une intuition non écrite.`
    ).not.toBeNull();
  });

  // N1.4 — le N capturé en N1.3 est ÉGAL au nombre de relecteurs annoncé juste
  // à côté, sur la même puce (`deep` → `**N**` relecteurs). Aucun des deux
  // nombres n'est écrit en dur ici — sinon ce test deviendrait la troisième
  // copie du nombre au lieu d'en supprimer une.
  // Mutation-témoin : passer :726 à « `deep` → **3** relecteurs **en
  // parallèle** (un seul message, 4 appels `Agent`). » → rouge, là où N1.1 à
  // N1.3 resteraient tous verts.
  it('N1.4 — le nombre d’appels du message unique égale le nombre de relecteurs', () => {
    const etape63 = extractEtape63(readSddFile());

    // Les DEUX nombres viennent d'UN SEUL motif ancré sur `deep` (finding 2) :
    // un couple de motifs séparés pourrait chacun matcher une puce DIFFÉRENTE
    // (ex. un dosage `medium` inséré avant `deep`) et comparer deux nombres
    // sans rapport l'un avec l'autre, silencieusement.
    const match = etape63.match(DEEP_BULLET_SHAPE);
    expect(
      match,
      `${SDD_FILE} : impossible de retrouver, sur UNE MÊME puce \`deep\`, à la ` +
        `fois son nombre de relecteurs et son nombre d'appels \`Agent\`.`
    ).not.toBeNull();

    const [, declaredReviewers, declaredCalls] = match;
    expect(
      declaredCalls,
      `Le nombre d'appels Agent (${declaredCalls}) et le nombre de relecteurs ` +
        `(${declaredReviewers}) doivent décrire LA MÊME chose : un dosage \`deep\` ` +
        `qui change de nombre de relecteurs doit répercuter les DEUX à la fois.`
    ).toBe(declaredReviewers);
  });
});
