// SKILL-62 — l'Étape 0 de `/send` détecte les garde-fous structurels par un
// glob de fichiers, mais les EXÉCUTE par un filtre vitest distinct, par nom.
// Les deux divergent dès qu'un dépôt matché par le glob EXCLUT ce même
// fichier de son propre run vitest (cas réel : `backlog-cli`, delibéré, sur
// un fichier qui matche par ailleurs le glob de détection) — vitest sort
// alors en 1 (« No test files found ») alors qu'aucun invariant n'a été
// violé, seulement pas évalué. La règle stricte de fin de fichier (« exit
// non-zéro → stopper ») ne distinguait pas cette « sélection vide » d'un
// vrai rouge.
//
// Correction (specs/skill-62.md) : `--passWithNoTests` sépare désormais TROIS
// issues (verte / sélection vide / rouge) aux DEUX sites concernés (Étape 0
// ET Étape 3.5 — même détection, même exécution, même règle d'arrêt, donc le
// même défaut structurel des deux côtés). Ce fichier contrôle que la
// prescription du skill porte bien ce contrat aux deux sites.
//
// ⚠️ Nom de fichier AVEC « coherence » (SKILL-65) : l'interdiction posée ici par
// SKILL-62 (« mêlerait le contrôle et son objet ») était sans fondement dans le
// dépôt — SKILL-10 § D1 va dans le sens inverse (le suffixe EST le mécanisme
// d'entrée dans le filet joué à la livraison), et ce fichier suit désormais la
// même convention que les 17 autres passés en revue par SKILL-65. Superseté,
// cf. bandeau en tête du § Tests de specs/skill-62.md.
//
// ⚠️ Style de la maison : helpers PARTAGÉS `readNormalized`/`extractSection`
// de `__tests__/helpers/prompt-blocks.js` (jamais une découpe recopiée —
// specs/skill-43.md), extraction scopée à la section par ancre littérale (pas
// de `.*` en mode `s` reliant deux ancres éloignées), texte APLATI (`\s+` → un
// espace) avant assertion — `send.md` est dur-wrappé et une phrase-clé y est
// coupée par un retour à la ligne.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized, extractSection } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const FILE = 'commands/send.md';

function etape0() {
  const raw = readNormalized(REPO_ROOT, FILE);
  const section = extractSection(raw, /^## Étape 0\b/);
  expect(section, `${FILE} : section "## Étape 0" introuvable.`).not.toBeNull();
  return section;
}

function etape35() {
  const raw = readNormalized(REPO_ROOT, FILE);
  const section = extractSection(raw, /^## Étape 3\.5\b/);
  expect(section, `${FILE} : section "## Étape 3.5" introuvable.`).not.toBeNull();
  return section;
}

const SECTIONS = [
  ['## Étape 0', etape0],
  ['## Étape 3.5', etape35],
];

// Fenêtre `[Sélection vide, Rouge)` d'une section, sur texte APLATI — UNIQUE
// exemplaire (finding SKILL-62 nº 4 : trois copies quasi identiques de ce
// calcul, dont une sans garde sur `iVide`/`iRouge`, dégénérait en `""` sous
// mutation et validait un test qui n'avait plus rien vérifié — cf. l'en-tête
// de `helpers/prompt-blocks.js`, « JAMAIS une chaîne vide »). Lève une
// assertion EXPLICITE (jamais `-1` silencieusement propagé) si l'une des deux
// ancres manque.
function fenetreSelectionVide(section, label) {
  const flat = section.replace(/\s+/g, ' ');
  const iVide = flat.indexOf('Sélection vide');
  expect(iVide, `${FILE} : ancre "Sélection vide" introuvable dans "${label}".`).toBeGreaterThan(-1);
  const iRouge = flat.indexOf('**Rouge**', iVide);
  expect(iRouge, `${FILE} : ancre "**Rouge**" introuvable après "Sélection vide" dans "${label}".`).toBeGreaterThan(
    iVide
  );
  return { flat, fenetre: flat.slice(iVide, iRouge) };
}

describe('SKILL-62 — /send : sélection vide ≠ rouge, aux deux sites', () => {
  // T1 — la commande porte le drapeau, aux deux sites.
  // Mutation-témoin : retirer le drapeau d'UN SEUL des deux sites → rouge.
  describe.each(SECTIONS)('%s — la commande porte --passWithNoTests', (label, getSection) => {
    it(`${label} : le corps contient "npm test -- coherence --passWithNoTests"`, () => {
      const flat = getSection().replace(/\s+/g, ' ');
      expect(
        flat.includes('npm test -- coherence --passWithNoTests'),
        `${FILE} : la section "${label}" n'invoque plus "npm test -- coherence --passWithNoTests".`
      ).toBe(true);
    });
  });

  // T2 — la sélection vide n'arrête plus, nommée distinctement du rouge.
  // Mutation-témoin : réintroduire, dans l'une des deux, une règle d'arrêt
  // booléenne (« si l'exit code est non-zéro : stopper » comme SEULE lecture
  // du résultat, sans le cas de la sélection vide) → rouge.
  describe.each(SECTIONS)('%s — l’issue « sélection vide » est nommée et continue', (label, getSection) => {
    it(`${label} : l'issue "sélection vide" est nommée`, () => {
      const flat = getSection().replace(/\s+/g, ' ');
      expect(
        flat.includes('Sélection vide'),
        `${FILE} : la section "${label}" ne nomme plus l'issue "Sélection vide".`
      ).toBe(true);
    });

    it(`${label} : la conduite sur sélection vide est de continuer, pas stopper`, () => {
      // Fenêtre bornée à l'issue "Sélection vide" (jusqu'à "Rouge") — jamais
      // toute la section, qui contiendrait aussi la conduite de l'issue
      // rouge et rendrait le test aveugle à une inversion.
      const { fenetre } = fenetreSelectionVide(getSection(), label);
      expect(
        /ne \*\*pas\*\* stopper/.test(fenetre),
        `${FILE} : la section "${label}" ne prescrit plus explicitement "ne pas stopper" sur sélection vide.`
      ).toBe(true);
      expect(
        fenetre.includes('continuer'),
        `${FILE} : la section "${label}" ne prescrit plus de continuer sur sélection vide.`
      ).toBe(true);
      expect(
        /stopper immédiatement/i.test(fenetre),
        `${FILE} : la section "${label}" prescrit encore un arrêt immédiat sur sélection vide — ` +
          `c'est exactement la fusion des deux issues que ce ticket corrige.`
      ).toBe(false);
    });
  });

  // T3 — l'issue rouge stoppe toujours (garde-fou contre l'excès de zèle de D2).
  // Mutation-témoin : remplacer l'arrêt par une poursuite → rouge.
  describe.each(SECTIONS)('%s — l’issue rouge stoppe toujours', (label, getSection) => {
    it(`${label} : "Rouge" prescrit "stopper immédiatement"`, () => {
      const flat = getSection().replace(/\s+/g, ' ');
      const iRouge = flat.indexOf('**Rouge**');
      expect(iRouge, `${FILE} : ancre "**Rouge**" introuvable dans "${label}".`).toBeGreaterThan(-1);
      const fenetre = flat.slice(iRouge);
      expect(
        /stopper immédiatement/i.test(fenetre),
        `${FILE} : la section "${label}" ne prescrit plus l'arrêt immédiat sur l'issue rouge.`
      ).toBe(true);
    });
  });

  // T4 — la ligne de trace (D3) est prescrite, avec ses trois éléments, AUX
  // DEUX SITES (D4 : même contrat). Mutation-témoin : remplacer la trace par
  // un saut silencieux (« étape sautée silencieusement »), ou retirer l'un
  // des trois éléments, d'UN SEUL des deux sites → rouge.
  //
  // ⚠️ Finding SKILL-62 nº 3 : avant cette correction, seule l'Étape 0 était
  // gardée ici — l'Étape 3.5 pouvait perdre sa trace en silence sans qu'aucun
  // test ne rougisse, exactement la « moitié de trou » que D4 interdit. Les
  // deux sites n'emploient pas mot pour mot la même formule (l'Étape 3.5 dit
  // « garde-fous non évalués », l'Étape 0 « garde-fous structurels n'ont pas
  // été évalués ») : la table ci-dessous porte donc la formule PROPRE à
  // chaque site plutôt qu'une phrase unique partagée.
  const TRACE_PHRASES = {
    '## Étape 0': {
      a: "garde-fous structurels n'ont pas été évalués",
      b: /fichiers vus par le glob/,
      c: /exclusion par la config du runner/,
    },
    '## Étape 3.5': {
      a: 'garde-fous non évalués',
      b: /fichiers vus par le glob et non joués/,
      c: /exclusion par la config du runner/,
    },
  };

  describe.each(SECTIONS)('%s — la trace de sélection vide porte ses trois éléments (a)(b)(c)', (label, getSection) => {
    it(`${label} : les trois éléments (a)(b)(c) sont présents`, () => {
      const { fenetre } = fenetreSelectionVide(getSection(), label);
      const { a, b, c } = TRACE_PHRASES[label];
      expect(
        fenetre.includes(a),
        `${FILE} : la section "${label}" ne dit plus, sur sélection vide, que les garde-fous n'ont pas été évalués.`
      ).toBe(true);
      expect(
        b.test(fenetre),
        `${FILE} : la section "${label}" ne nomme plus les fichiers vus par le glob mais non joués.`
      ).toBe(true);
      expect(
        c.test(fenetre),
        `${FILE} : la section "${label}" n'attribue plus la cause probable à une exclusion par la config du runner.`
      ).toBe(true);
    });

    it(`${label} : la trace n'est pas un saut silencieux`, () => {
      const { fenetre } = fenetreSelectionVide(getSection(), label);
      expect(
        fenetre.includes('étape sautée silencieusement'),
        `${FILE} : la section "${label}" traite la sélection vide comme un saut silencieux — ` +
          `elle doit tracer (D3), pas se taire.`
      ).toBe(false);
    });
  });

  // D4 : l'Étape 3.5 renvoie explicitement au contrat de l'Étape 0 plutôt que
  // de le réénoncer en entier — ce lien est lui-même une partie du contrat
  // partagé et doit rester vérifiable, pas seulement les trois éléments
  // qu'il introduit (ci-dessus).
  it('Étape 3.5 : renvoie explicitement au même contrat qu’à l’Étape 0', () => {
    const flat = etape35().replace(/\s+/g, ' ');
    expect(
      flat.includes("Même contrat à trois issues qu'à l'Étape 0"),
      `${FILE} : l'Étape 3.5 ne renvoie plus explicitement au contrat à trois issues de l'Étape 0.`
    ).toBe(true);
  });

  // T5 — le fondement est écrit, pas seulement la règle, à l'Étape 0.
  // Mutation-témoin : supprimer cette phrase en gardant la règle → rouge.
  it('Étape 0 : le fondement « aucun invariant évalué n’est pas un invariant violé » est écrit', () => {
    const flat = etape0().replace(/\s+/g, ' ');
    expect(
      flat.includes('aucun invariant évalué') && flat.includes('un invariant violé'),
      `${FILE} : l'Étape 0 n'énonce plus le fondement ("aucun invariant évalué" ` +
        `n'est pas "un invariant violé").`
    ).toBe(true);
  });

  // T6 — la règle stricte de fin de fichier n'est pas amendée (D5).
  // Mutation-témoin : y ajouter « sauf sélection vide » → rouge.
  //
  // ⚠️ Finding SKILL-62 nº 5 : borner la fenêtre à la SEULE puce contrôlée
  // (de son "- " de départ au "- " suivant, ou à la fin de la section), pas
  // au reste de "## Règles strictes" jusqu'à la fin. Un `apres` non borné
  // rougirait sur un futur « sauf … » ajouté dans une AUTRE puce, plus bas
  // dans la section (ex. une nouvelle règle stricte future) — un défaut
  // inexistant, qui enverrait un futur éditeur chercher au mauvais endroit.
  it('la règle stricte finale "Exit code non-zéro..." ne porte aucune exception pour la sélection vide', () => {
    const raw = readNormalized(REPO_ROOT, FILE);
    const reglesStrictes = extractSection(raw, /^## Règles strictes\b/);
    expect(reglesStrictes, `${FILE} : section "## Règles strictes" introuvable.`).not.toBeNull();
    const lignes = reglesStrictes.split('\n');
    const iDebut = lignes.findIndex((l) => /^- Exit code non-zéro à/.test(l));
    expect(
      iDebut,
      `${FILE} : aucune puce "## Règles strictes" ne commence par "- Exit code non-zéro à".`
    ).toBeGreaterThan(-1);
    let iFin = lignes.length;
    for (let i = iDebut + 1; i < lignes.length; i++) {
      if (/^- /.test(lignes[i])) {
        iFin = i;
        break;
      }
    }
    const clause = lignes.slice(iDebut, iFin).join(' ').replace(/\s+/g, ' ');
    expect(
      /sauf/i.test(clause),
      `${FILE} : la clause finale porte désormais une exception ("sauf …") — ` +
        `D5 interdit d'en ajouter une pour la sélection vide.`
    ).toBe(false);
  });
});
