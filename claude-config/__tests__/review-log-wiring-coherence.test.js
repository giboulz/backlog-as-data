// SKILL-29 — câblage de l'écrivain de mesures dans `commands/sdd-run-ticket.md`.
//
// Tests de FORME, ancrés à la SECTION concernée et non au fichier entier (même
// stratégie que `commands-shape-coherence.test.js` et `sdd-reviewer-wiring-coherence.test.js`) :
// un `includes` sur tout le fichier passerait au vert dès qu'un mot apparaît
// n'importe où, y compris dans une étape sans rapport.
//
// ⚠️ Chaque test documente la MUTATION qui doit le faire rougir (convention D3).
// Ces tests doivent rougir AVANT que l'Étape 6.8 soit écrite — étape 2 du SDD.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { extractSection } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const FILE = 'commands/sdd-run-ticket.md';

function readSkill() {
  return fs.readFileSync(path.join(REPO_ROOT, FILE), 'utf8');
}

const STEP_6_8_RE = /^##\s*Étape 6\.8\b/;

describe('SKILL-29 — Étape 6.8 (mesure écrite, pas publiée)', () => {
  const raw = readSkill();

  // ⚠️ Mutation : supprimer la section → rougit.
  it('une section `## Étape 6.8` existe', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    expect(
      section,
      `${FILE} n'a pas de section "## Étape 6.8" — le cycle ne mesure plus rien.`
    ).not.toBeNull();
    expect(section.trim().length).toBeGreaterThan(0);
  });

  // ⚠️ Mutation : intervertir 6.8 et 7 (ou placer 6.8 avant 6.7) → rougit.
  // L'étape a besoin du SHA final, que seule l'intégration (6.7) produit.
  it('elle est placée APRÈS l’Étape 6.7 et AVANT l’Étape 7', () => {
    const i67 = raw.indexOf('## Étape 6.7');
    const i68 = raw.indexOf('## Étape 6.8');
    const i7 = raw.indexOf('## Étape 7');
    expect(i67).toBeGreaterThan(-1);
    expect(i68).toBeGreaterThan(i67);
    expect(i7).toBeGreaterThan(i68);
  });

  // ⚠️ Mutation : renommer le script sans mettre le skill à jour → rougit.
  it('elle nomme `tools/review-log/write.mjs`', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    expect(
      section,
      `${FILE} : l'Étape 6.8 ne nomme plus le script à lancer.`
    ).toContain('review-log');
    expect(section).toContain("'write.mjs'");
  });

  // ⚠️ Mutation : retirer la phrase du no-op → l'orchestrateur croirait à une
  // panne et s'arrêterait alors que le cycle est fini.
  it('elle énonce le no-op « dépôt absent »', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    const paragraphs = section.split(/\r?\n\r?\n/);
    const hasNoOp = paragraphs.some(
      (p) => /no-op/i.test(p) && /absent/i.test(p) && /sdd-metrics/.test(p)
    );
    expect(
      hasNoOp,
      `${FILE} : aucun paragraphe de l'Étape 6.8 ne réunit « no-op », ` +
        `« absent » et « sdd-metrics » — sans cette phrase, un code 0 sans ` +
        `fichier se lit comme une panne.`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer cet interdit (en gardant l'autre) → rougit.
  it('elle interdit d’écrire le fichier à la main', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    const lines = section.split(/\r?\n/);
    const hasBan = lines.some((l) => l.includes('⛔') && /à la main/i.test(l));
    expect(
      hasBan,
      `${FILE} : l'Étape 6.8 n'interdit plus d'écrire ce fichier à la main — ` +
        `un enregistrement rédigé de tête est exactement le registre inventé ` +
        `que ce dispositif combat.`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer cet interdit (en gardant l'autre) → rougit.
  it('elle interdit de commiter dans `~/sdd-metrics`', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    const lines = section.split(/\r?\n/);
    const hasBan = lines.some((l) => l.includes('⛔') && /commit/i.test(l) && /sdd-metrics/.test(l));
    expect(
      hasBan,
      `${FILE} : l'Étape 6.8 n'interdit plus de commiter dans \`~/sdd-metrics\` — ` +
        `des commits concurrents depuis 10-15 sessions rouvriraient la panne ` +
        `(index.lock) que « un fichier par cycle » ferme.`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer cet interdit → les cycles `none` cesseraient d'être
  // enregistrés, précisément ceux que l'épic exige d'enregistrer.
  it('elle interdit de sauter l’étape en dosage `none`', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    const lines = section.split(/\r?\n/);
    const hasBan = lines.some((l) => l.includes('⛔') && /none/.test(l) && /saut/i.test(l));
    expect(
      hasBan,
      `${FILE} : l'Étape 6.8 n'interdit plus de sauter la mesure en dosage \`none\`.`
    ).toBe(true);
  });

  // ⚠️ Mutation : remplacer la liste fermée par « et tout ce qui te semble
  // utile » → rougit. La liste des substitutions est FERMÉE (mêmes règles que
  // le template relecteur de l'Étape 6.3).
  it('elle porte une liste FERMÉE de substitutions', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    const paragraphs = section.split(/\r?\n\r?\n/);
    const decl = paragraphs.find((p) => /substitutions/i.test(p) && /ferm/i.test(p));
    expect(
      decl,
      `${FILE} : l'Étape 6.8 n'a pas de paragraphe "Substitutions" déclaré FERMÉ.`
    ).toBeDefined();
    for (const token of ['`<TICKET-ID>`', '`<dosage>`', '`<sha_final>`', '`<finding>`']) {
      expect(decl, `${FILE} : ${token} n'est pas déclaré dans la liste fermée.`).toContain(token);
    }
  });

  // ⚠️ Mutation : repasser `--finding '<finding>'` en guillemets DOUBLES →
  // rougit. Le titre court est du texte libre recopié d'un rapport de
  // relecteur ; près de la moitié des titres réellement produits par ce
  // dispositif contiennent une backquote. Entre guillemets doubles, le shell la
  // substitue : titre amputé en silence, ou commande arbitraire exécutée dans
  // le shell de l'orchestrateur.
  it('le `--finding` est cité entre guillemets SIMPLES', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    expect(
      /--finding '<finding>'/.test(section),
      `${FILE} : l'Étape 6.8 ne cite plus \`--finding\` entre guillemets simples — ` +
        `un titre contenant une backquote serait interprété par le shell.`
    ).toBe(true);
    expect(
      /--finding "<finding>"/.test(section),
      `${FILE} : l'Étape 6.8 cite \`--finding\` entre guillemets doubles.`
    ).toBe(false);
  });

  // ⚠️ Mutation : retirer la consigne de citation (ou la règle sur
  // l'apostrophe) → rougit. Les guillemets simples ne protègent que si l'on dit
  // aussi quoi faire du seul caractère qu'ils ne peuvent pas contenir.
  it('elle explique la citation et le seul caractère à traiter (l’apostrophe)', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    const paragraphs = section.split(/\r?\n\r?\n/);
    const hasRule = paragraphs.some((p) => /guillemets simples/i.test(p) && /apostrophe/i.test(p));
    expect(
      hasRule,
      `${FILE} : aucun paragraphe de l'Étape 6.8 ne réunit « guillemets simples » ` +
        `et « apostrophe » — la consigne de citation du titre a disparu.`
    ).toBe(true);
  });

  // ⚠️ Mutation : revenir à « `<date>` (la date du jour) » sans nommer sa source
  // → rougit. Toutes les autres substitutions nomment leur origine ; sans
  // source, une session à cheval sur minuit ou un horodatage de commit classe le
  // cycle au mauvais jour, et aucun contrôle ne le voit.
  it('`<date>` nomme sa source (le contexte `currentDate`)', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    expect(
      /currentDate/.test(section),
      `${FILE} : l'Étape 6.8 ne nomme plus la source de \`<date>\` — la date ne ` +
        `s'invente pas, donc elle vient d'une source nommée.`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer la clause « si le frontmatter n'en porte pas, omets le
  // flag » → rougit. L'Étape 2 pose que le champ `review` peut légitimement être
  // absent ; sans cette clause l'orchestrateur passerait une valeur vide
  // (écrivain en code 1, aucune mesure) ou recopierait le défaut `light`
  // (l'absence devient indiscernable d'un choix).
  it('elle dit quoi faire quand le frontmatter ne porte pas de `review`', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    const paragraphs = section.split(/\r?\n\r?\n/);
    const hasClause = paragraphs.some((p) => /`<review>`/.test(p) && /omets le flag/i.test(p));
    expect(
      hasClause,
      `${FILE} : la liste des substitutions ne dit pas d'OMETTRE \`--review\` quand ` +
        `le frontmatter n'en porte pas.`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer le rappel de portée en vague parallèle → rougit.
  // L'Étape 6.8 est la seule qui PERSISTE ces valeurs : un `<sha_final>`
  // emprunté au ticket voisin passe tous les contrôles et reste faux pour
  // toujours dans un fichier que plus personne ne relira.
  it('elle rappelle que les valeurs viennent du ticket enregistré (vagues parallèles)', () => {
    const section = extractSection(raw, STEP_6_8_RE);
    const paragraphs = section.split(/\r?\n\r?\n/);
    const hasScope = paragraphs.some(
      (p) => /vague/i.test(p) && /`<sha_final>`/.test(p) && /(voisin|ticket que tu)/i.test(p)
    );
    expect(
      hasScope,
      `${FILE} : l'Étape 6.8 ne rappelle plus qu'en vague de plusieurs tickets ` +
        `chaque valeur vient du ticket enregistré.`
    ).toBe(true);
  });
});

describe('SKILL-29 — le garde-fou « valeurs du bon ticket » couvre l’Étape 6.8', () => {
  // ⚠️ Mutation : ramener l'une des deux plages à « 6.1 à 6.7 » / « 6.2 à 6.7 »
  // → rougit. Les deux phrases qui interdisent de mélanger les valeurs entre
  // tickets voisins doivent inclure l'étape qui les écrit sur disque.
  it('les plages citées (Étapes 6.x) vont jusqu’à 6.8', () => {
    const raw = readSkill();
    expect(
      raw,
      `${FILE} : l'Étape 6.1 borne encore à 6.7 la portée de <WORKTREE_IMPL>/<SHA_IMPL>.`
    ).toContain('Étapes 6.2 à 6.8');
    expect(
      raw,
      `${FILE} : la note sur les agents parallèles borne encore sa règle à 6.7.`
    ).toContain('Étapes 6.1 à 6.8');
    expect(raw).not.toContain('Étapes 6.2 à 6.7');
    expect(raw).not.toContain('Étapes 6.1 à 6.7');
  });
});

describe('SKILL-29 — Étape 6.2 : le raccourci `none` nomme l’Étape 6.8', () => {
  // ⚠️ Mutation : revenir à « va directement à l'Étape 6.7 » (sans nommer 6.8)
  // → rougit. Les cycles `none` — ceux qui doivent justement produire un
  // `reviewed: false` — seraient les seuls à ne rien enregistrer.
  it('le raccourci du dosage `none` cite l’Étape 6.8', () => {
    const raw = readSkill();
    const section = extractSection(raw, /^##\s*Étape 6\.2\b/);
    expect(section, `${FILE} n'a pas de section "## Étape 6.2".`).not.toBeNull();
    expect(section).toContain('none');
    expect(
      /6\.8/.test(section),
      `${FILE} : l'Étape 6.2 ne nomme pas l'Étape 6.8 dans son raccourci \`none\` — ` +
        `un cycle sans revue sortirait du skill sans jamais être mesuré.`
    ).toBe(true);
  });
});

describe('SKILL-29 — Étape 7 : le bloc de confirmation porte une ligne `Mesure :`', () => {
  // ⚠️ Mutation : retirer la ligne → un no-op deviendrait invisible, donc
  // indiscernable d'une mesure oubliée.
  it('le bloc de confirmation porte une ligne `Mesure :`', () => {
    const raw = readSkill();
    const section = extractSection(raw, /^##\s*Étape 7\b/);
    expect(section, `${FILE} n'a pas de section "## Étape 7".`).not.toBeNull();
    expect(
      /^\s*Mesure\s+:/m.test(section),
      `${FILE} : le bloc de confirmation de l'Étape 7 ne porte plus de ligne ` +
        `« Mesure : » — le motif de non-écriture serait tu, et un no-op ` +
        `silencieux est indiscernable d'une mesure oubliée.`
    ).toBe(true);
  });

  // ⚠️ Mutation : n'afficher le chemin que quand il existe → rougit. Le motif
  // de non-écriture est AFFICHÉ, jamais tu.
  it('la ligne prévoit les deux issues : chemin écrit OU motif de non-écriture', () => {
    const raw = readSkill();
    const section = extractSection(raw, /^##\s*Étape 7\b/);
    const line = section.split(/\r?\n/).find((l) => /^\s*Mesure\s+:/.test(l));
    expect(line, `${FILE} : ligne « Mesure : » introuvable.`).toBeDefined();
    expect(
      line.includes('|'),
      `${FILE} : la ligne « Mesure : » ne prévoit qu'une seule issue — le motif ` +
        `de non-écriture doit y être affiché, jamais tu.`
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SKILL-112 — le lancement de CORRECTION (Étape 6.5) porte un marqueur dans sa
// `description`, et les deux bouts de la chaîne doivent tomber d'accord AVEC CE
// TEST, jamais entre eux : le skill l'écrit, `baseline.mjs` le lit.
//
// ⛔ D3 du dépôt : « toute liste de contrôle est DÉCLARÉE ICI, jamais lue de la
// source qu'elle contrôle ». Un test qui importerait la constante de
// `baseline.mjs` se validerait contre lui-même, et un nettoyage des DEUX côtés
// (skill + parseur) resterait vert — la panne exacte que ce ticket ferme.
describe('SKILL-112 — le marqueur du lancement de correction, des deux côtés', () => {
  const SUFFIXE_CORRECTION = '(correction)';
  const DESCRIPTION_CORRECTION = `SDD <TICKET-ID> ${SUFFIXE_CORRECTION}`;
  const STEP_6_5_RE = /^##\s*Étape 6\.5\b/;
  const BASELINE = 'tools/review-log/baseline.mjs';

  // Cas 11 — ⚠️ Mutation : ramener la `description` de l'Étape 6.5 à
  // `SDD <TICKET-ID>` nue (le régime d'avant SKILL-112) → rougit.
  it('le bloc `Agent` de l’Étape 6.5 pose `description: "SDD <TICKET-ID> (correction)"`', () => {
    const section = extractSection(readSkill(), STEP_6_5_RE);
    expect(section, `${FILE} n'a pas de section "## Étape 6.5".`).not.toBeNull();
    expect(
      section,
      `${FILE} § Étape 6.5 : la \`description\` du correcteur ne porte plus le ` +
        `marqueur \`${SUFFIXE_CORRECTION}\` — la mesure de l'Étape 6.8 ` +
        `retiendrait de nouveau le correcteur à la place de l'implémenteur.`
    ).toContain(`description: "${DESCRIPTION_CORRECTION}"`);
  });

  // ⚠️ Mutation : suffixer AUSSI la description de l'Étape 6 → rougit. Le
  // marqueur distingue les deux lancements ; le poser des deux côtés ne
  // distinguerait plus rien.
  it('la `description` de l’Étape 6 (implémenteur) reste NUE, sans le marqueur', () => {
    const raw = readSkill();
    const section = extractSection(raw, /^##\s*Étape 6\b/);
    expect(section, `${FILE} n'a pas de section "## Étape 6".`).not.toBeNull();
    expect(section).toContain('description: "SDD <TICKET-ID>"');
    // Gate de reprise, finding nº 5 : l'assertion porte sur les LIGNES
    // `description:` du bloc `Agent`, jamais sur la section entière. La prose
    // de l'Étape 6 parle déjà du correcteur de l'Étape 6.5 ; une incise citant
    // son suffixe ferait rougir un test dont l'intention — et le message
    // d'échec — ne portent que sur le champ, et le mainteneur chercherait un
    // défaut inexistant. Ancrée à la ligne, l'assertion reste aussi forte et
    // cesse d'être faussable par la prose voisine.
    const lignesDescription = section.split(/\r?\n/).filter((l) => /^\s*description\s*:/.test(l));
    expect(
      lignesDescription.length,
      `${FILE} § Étape 6 : plus aucune ligne \`description:\` — l'assertion ` +
        `ci-dessous ne contrôlerait plus rien.`
    ).toBeGreaterThan(0);
    for (const ligne of lignesDescription) {
      expect(
        ligne.includes(SUFFIXE_CORRECTION),
        `${FILE} § Étape 6 : le lancement d'IMPLÉMENTATION porte le marqueur de ` +
          `correction (« ${ligne.trim()} ») — les deux lancements redeviendraient ` +
          `indiscernables.`
      ).toBe(false);
    }
  });

  // Cas 12 — la constante exportée par `baseline.mjs` est confrontée au MÊME
  // littéral déclaré ci-dessus, par lecture du SOURCE (jamais par import).
  // ⚠️ Mutation : renommer le marqueur d'un seul côté (skill ou parseur) →
  // rougit ici ou au cas 11.
  it('`baseline.mjs` exporte une constante dont le littéral est exactement ce marqueur', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, BASELINE), 'utf8');
    const m = /export const ([A-Z0-9_]*(?:CORRECTION|MARQUEUR)[A-Z0-9_]*)\s*=\s*'([^']*)'/.exec(source);
    expect(
      m,
      `${BASELINE} n'exporte plus de constante nommant le marqueur de correction ` +
        `— le parseur ne saurait plus distinguer un correcteur d'un implémenteur.`
    ).not.toBeNull();
    expect(
      m[2],
      `${BASELINE} : la constante ${m[1]} vaut « ${m[2]} », mais le skill écrit ` +
        `« ${SUFFIXE_CORRECTION} » — les deux bouts de la chaîne ont divergé.`
    ).toBe(SUFFIXE_CORRECTION);
  });

  // Cas 13 — sans ce test, un ticket de compression du skill retire la clause,
  // tout reste vert, et le défaut se rouvre exactement comme le § Décision de
  // specs/skill-112.md le redoute. ⚠️ Mutation : retirer le paragraphe qui
  // explique le marqueur (en gardant la `description`) → rougit.
  it('l’Étape 6.5 explique POURQUOI le marqueur existe et pourquoi il ne casse pas l’attribution', () => {
    const section = extractSection(readSkill(), STEP_6_5_RE);
    const paragraphes = section.split(/\r?\n\r?\n/);
    const pourquoi = paragraphes.some((p) => /suffixe|marqueur/i.test(p) && /mesure/i.test(p));
    expect(
      pourquoi,
      `${FILE} § Étape 6.5 : aucun paragraphe ne dit que le marqueur sert à la ` +
        `MESURE — un lecteur ultérieur le prendrait pour une coquette et le ` +
        `retirerait.`
    ).toBe(true);
    const inoffensif = paragraphes.some((p) => /premier blanc/i.test(p) && /baseline\.mjs/.test(p));
    expect(
      inoffensif,
      `${FILE} § Étape 6.5 : aucun paragraphe ne dit POURQUOI le marqueur ne ` +
        `casse pas l'attribution du ticket (le parseur de \`baseline.mjs\` ` +
        `s'arrête au premier blanc) — sans cette raison, la clause se lit comme ` +
        `un risque à supprimer.`
    ).toBe(true);
  });
});
