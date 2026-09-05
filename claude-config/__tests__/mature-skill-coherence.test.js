// Cohérence de forme du skill `/mature` — SKILL-98 (specs/skill-98.md, § Tests).
//
// Ce fichier est nommé d'après son SUJET (le skill `/mature`), jamais d'après le
// ticket qui le crée : il survivra à SKILL-98, et SKILL-99 (barrière, challenger
// vierge, dosage) y écrira à son tour.
//
// ⛔ Ce qu'il n'est PAS :
//   - un test de plafond de taille — `__tests__/skill-size-ceiling-coherence.test.js`
//     est réservé aux plafonds, on n'y mêle aucune assertion de prose ;
//   - un test de forme générique sur `commands/**` —
//     `__tests__/commands-shape-coherence.test.js` (déjà > 4 200 lignes) balaie
//     tout le dossier pour F1/F2/F3/R1/D2, et `commands/mature.md` y entre
//     automatiquement par `listCommandFiles()`. Ici on ne vérifie que ce qui est
//     PROPRE à `/mature` : les décisions D1 à D10 de sa spec.
//
// Chaque `it()` nomme sa mutation-témoin en commentaire — la mutation qui doit le
// faire rougir. Une assertion dont on n'a pas vu le rouge ne prouve rien.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const MATURE_FILE = 'commands/mature.md';
const SDD_FILE = 'commands/sdd-run-ticket.md';
const REGLE_FILE = 'rules/maturation.md';

// Lecture TOLÉRANTE à l'absence (rend `null`) : c'est le cas 1 ci-dessous qui doit
// rougir en NOMMANT le fichier manquant, pas la phase de collecte de vitest qui
// exploserait sur un ENOENT au chargement du module.
function lire(rel) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
}

function lireOuVide(rel) {
  return lire(rel) ?? '';
}

// Découpe une section de niveau `##` : du titre qui CONTIENT `titre` jusqu'au
// prochain `## ` (les sous-titres `### ` restent DANS la section — c'est là que
// vit le régime (d) de la gate, D8).
function section(raw, titre) {
  const lignes = raw.split('\n');
  const debut = lignes.findIndex((l) => l.startsWith('## ') && l.includes(titre));
  if (debut === -1) return null;
  let fin = lignes.length;
  for (let i = debut + 1; i < lignes.length; i++) {
    if (lignes[i].startsWith('## ')) {
      fin = i;
      break;
    }
  }
  return lignes.slice(debut, fin).join('\n');
}

function sectionOuEchec(raw, titre) {
  const s = section(raw, titre);
  expect(s, `${MATURE_FILE} : aucune section \`## …${titre}…\` — la structure de D2 ` +
    `n'est pas une suggestion, le § Tests s'y ancre.`).not.toBeNull();
  return s;
}

describe('MAT1 (SKILL-98, D2) — le skill /mature existe', () => {
  // ⚠️ Mutation-témoin : supprimer commands/mature.md → rouge.
  it(`${MATURE_FILE} existe et n'est pas vide`, () => {
    const raw = lire(MATURE_FILE);
    expect(raw, `${MATURE_FILE} est absent — le skill /mature est le livrable de ` +
      `SKILL-98.`).not.toBeNull();
    expect(
      raw.trim().length,
      `${MATURE_FILE} existe mais son contenu est blanc.`
    ).toBeGreaterThan(0);
  });
});

describe('MAT2 (SKILL-98, D1) — la description EST la ligne 1', () => {
  // Un commands/*.md de ce dépôt n'a pas de frontmatter : la description offerte
  // au modèle pour le déclenchement en langage naturel est le titre `#` de la
  // ligne 1 (constat : `head -1 commands/*.md` contre le listing de skills).
  //
  // DEUX assertions séparées, délibérément : une seule les laisserait disparaître
  // à moitié (le titre sans les déclencheurs, ou l'inverse).
  const ligne1 = () => lireOuVide(MATURE_FILE).split('\n')[0] ?? '';

  // ⚠️ Mutation-témoin : remplacer la ligne 1 par un paragraphe sans `# ` → rouge.
  it('la ligne 1 est un titre `# ` et nomme /mature', () => {
    const l = ligne1();
    expect(l.startsWith('# '), `${MATURE_FILE} ligne 1 = ${JSON.stringify(l)} — ` +
      `ce n'est pas un titre \`# \`, donc ce n'est pas la description du skill.`).toBe(true);
    expect(l, `${MATURE_FILE} ligne 1 ne nomme pas /mature.`).toContain('/mature');
  });

  // ⚠️ Mutation-témoin : réduire la ligne 1 à `# /mature — maturer un ticket`
  // → rouge (plus aucun mot de lot, donc plus aucun déclencheur « mature la
  // première vague » / « ok pour les 3, mature le »).
  it('la ligne 1 porte au moins un mot de LOT (déclencheur en langage naturel)', () => {
    const l = ligne1();
    expect(
      /lot|vague|plusieurs/i.test(l),
      `${MATURE_FILE} ligne 1 = ${JSON.stringify(l)} — elle ne porte aucun mot de ` +
        `lot (lot · vague · plusieurs). L'unité de /mature est le LOT (D3) et la ` +
        `ligne 1 est le SEUL endroit où ce déclencheur se place (D1).`
    ).toBe(true);
  });
});

describe('MAT3 (SKILL-98, D3) — les deux régimes d’appel sont écrits', () => {
  const args = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Arguments');

  // ⚠️ Mutation-témoin : retirer la forme variadique de § Arguments → rouge.
  it('§ Arguments porte la forme variadique (N ids)', () => {
    expect(
      /<ID\.\.\.>|plusieurs ids|N ids/i.test(args()),
      `${MATURE_FILE} § Arguments ne dit pas que le verbe prend N ids — l'unité ` +
        `de /mature est le lot, pas le ticket (D3).`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer le paragraphe « sans argument » → rouge.
  it('§ Arguments porte le cas SANS argument', () => {
    expect(
      /sans argument/i.test(args()),
      `${MATURE_FILE} § Arguments ne traite pas l'appel sans argument — le régime ` +
        `le plus fréquent en milieu de conversation (D3).`
    ).toBe(true);
  });
});

describe('MAT4 (SKILL-98, D4) — la méthode est POINTÉE, jamais recopiée', () => {
  // Deux titres de contrôle LITTÉRAUX, recopiés ici en dur — et c'est assumé :
  // ils ne servent qu'à prouver que l'EXTRACTEUR ci-dessous voit encore quelque
  // chose. Si la règle les reformule, le premier `it` rougit en demandant de les
  // ré-ancrer ; il ne valide jamais le vide.
  //
  // ⛔ Ce qu'ils ne sont PAS : la liste sur laquelle « n'en recopie aucun » est
  // vérifié. Cette liste-là est EXTRAITE de rules/maturation.md à chaque run
  // (`titresDeControle()`), sinon un ticket qui reformule un contrôle DANS la
  // règle et recopie la nouvelle formulation dans le skill passerait au vert — le
  // second `it` ne connaîtrait que les littéraux d'origine. C'est le scénario
  // exact de SKILL-99, qui réécrit `rules/maturation.md`.
  const ANCRES_DE_VIE = [
    'Grep le nom, pas seulement ses porteurs connus.',
    'Ne jamais figer une valeur allouée en premier-arrivé.',
  ];

  // Les contrôles de la méthode sont une liste numérotée dont chaque titre est en
  // gras : `1. **Grep le nom, …**`. On extrait les titres, pas leur numérotation.
  function titresDeControle() {
    const regle = lire(REGLE_FILE) ?? '';
    const titres = [];
    const re = /^\d+\.\s+\*\*(.+?)\*\*/gm;
    let m;
    while ((m = re.exec(regle)) !== null) titres.push(m[1]);
    return titres;
  }

  it(`${REGLE_FILE} porte bien les deux titres de contrôle servant d'ancre de vie`, () => {
    const regle = lire(REGLE_FILE);
    expect(regle, `${REGLE_FILE} est absent — ce test n'a RIEN vérifié.`).not.toBeNull();
    for (const ancre of ANCRES_DE_VIE) {
      expect(
        regle,
        `${REGLE_FILE} ne porte plus ${JSON.stringify(ancre)} : l'ancre de vie de ` +
          `MAT4 est morte, ré-ancre-la sur un titre de contrôle réel plutôt que de ` +
          `la laisser valider le vide.`
      ).toContain(ancre);
    }
  });

  // ⚠️ Mutation-témoin : casser le motif d'extraction (retirer le gras d'un titre
  // dans rules/maturation.md) → rouge, au lieu de rendre une liste vide en silence.
  it(`les titres de contrôle sont EXTRAITS de ${REGLE_FILE}, pas figés ici`, () => {
    const titres = titresDeControle();
    expect(
      titres.length,
      `L'extracteur ne rend AUCUN titre de contrôle depuis ${REGLE_FILE} — le ` +
        `format de la liste a changé, et le troisième \`it\` de MAT4 ne vérifierait ` +
        `plus rien tout en restant vert.`
    ).toBeGreaterThan(0);
    for (const ancre of ANCRES_DE_VIE) {
      expect(
        titres,
        `L'extracteur ne retrouve pas ${JSON.stringify(ancre)} parmi les titres ` +
          `qu'il rend (${JSON.stringify(titres)}) — il lit le mauvais motif.`
      ).toContain(ancre);
    }
  });

  // ⚠️ Mutation-témoin : recopier les contrôles de la méthode dans le skill → rouge.
  it(`${MATURE_FILE} cite rules/maturation.md et n'en recopie aucun contrôle`, () => {
    const raw = lireOuVide(MATURE_FILE);
    expect(
      raw,
      `${MATURE_FILE} ne cite pas ${REGLE_FILE} — la méthode n'a qu'un domicile, ` +
        `le skill y renvoie (D4).`
    ).toContain('rules/maturation.md');
    const recopies = titresDeControle().filter((t) => raw.includes(t));
    expect(
      recopies,
      `${MATURE_FILE} recopie ${JSON.stringify(recopies)} — un titre de contrôle ` +
        `de la méthode, LU dans ${REGLE_FILE} à l'instant. Une seconde copie diverge ` +
        `en silence : pointe, ne recopie pas.`
    ).toEqual([]);
  });
});

describe('MAT5 (SKILL-98, D4) — aucun `~/` littéral pour résoudre la méthode', () => {
  // Redondant avec D2 de commands-shape-coherence.test.js, et DÉLIBÉRÉMENT : ce
  // test-ci nomme la RAISON (PowerShell n'expanse pas le tilde dans un argument,
  // et ni bash ni PowerShell ne l'expansent entre guillemets), l'autre balaie le
  // dossier sans savoir pourquoi ce fichier-là y tient.
  //
  // ⚠️ Mutation-témoin : écrire `~/.claude/rules/maturation.md` dans le skill → rouge.
  it(`${MATURE_FILE} résout par homedir() et ne porte aucun \`~/.claude\``, () => {
    const raw = lireOuVide(MATURE_FILE);
    const tildes = raw.match(/~\/\.claude/g) ?? [];
    expect(
      tildes,
      `${MATURE_FILE} porte ${tildes.length} occurrence(s) de \`~/.claude\` — ` +
        `PowerShell (shell par défaut) n'expanse pas le tilde dans un argument ; ` +
        `résous par homedir(), ou écris "$HOME/.claude".`
    ).toEqual([]);
    expect(
      raw,
      `${MATURE_FILE} ne résout le fichier de méthode par aucun homedir() — le ` +
        `chemin de rules/maturation.md se CALCULE, il ne s'écrit pas (D4).`
    ).toContain('homedir()');
  });
});

describe('MAT6 (SKILL-98, D5) — `escalations` précède la maturation', () => {
  const ESCALADES = "Étape 2 — Escalades d'abord";
  const TRIPLET = 'Étape 6 — Poser le triplet';

  // ⚠️ Mutation-témoin : déplacer l'étape des escalades après l'étape du triplet
  // → rouge.
  it(`« ${ESCALADES} » est écrite AVANT « ${TRIPLET} »`, () => {
    const raw = lireOuVide(MATURE_FILE);
    const iEsc = raw.indexOf(`## ${ESCALADES}`);
    const iTri = raw.indexOf(`## ${TRIPLET}`);
    expect(iEsc, `${MATURE_FILE} : section « ${ESCALADES} » introuvable.`).toBeGreaterThan(-1);
    expect(iTri, `${MATURE_FILE} : section « ${TRIPLET} » introuvable.`).toBeGreaterThan(-1);
    expect(
      iEsc,
      `${MATURE_FILE} : l'étape des escalades doit précéder celle du triplet — ` +
        `lire les escalades APRÈS avoir maturé, c'est ne pas les avoir lues (D5).`
    ).toBeLessThan(iTri);
  });

  // Ancrage sur l'APPEL CLI, pas sur la sous-chaîne « escalations » en prose (même
  // principe que MAT16 pour `new`, ci-dessous) : une section qui parle
  // d'escalades sans jamais interroger l'outil ne fait rien.
  //
  // ⚠️ Mutation-témoin : retirer l'appel `backlog.mjs … escalations` de l'Étape 2
  // → rouge.
  it(`« ${ESCALADES} » appelle réellement backlog.mjs escalations`, () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), ESCALADES);
    expect(
      /backlog\.mjs"?\s+escalations/.test(s),
      `${MATURE_FILE} § « ${ESCALADES} » ne contient aucun appel ` +
        `\`backlog.mjs … escalations\` — la bascule en arbitrage est ` +
        `INCONDITIONNELLE, elle ne se raconte pas, elle s'exécute (D5).`
    ).toBe(true);
  });
});

describe('MAT7 (SKILL-98, D6) — le format d’arbitrage est figé, attente comprise', () => {
  const arb = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 3 — Arbitrage');

  // ⚠️ Mutation-témoin : retirer « préco » → rouge ; retirer l'attente → rouge.
  it('§ Étape 3 porte le bloc « problème »', () => {
    expect(/problème/i.test(arb()), `${MATURE_FILE} § Étape 3 : bloc « problème » ` +
      `absent (D6).`).toBe(true);
  });

  it('§ Étape 3 porte le bloc « options »', () => {
    expect(/options/i.test(arb()), `${MATURE_FILE} § Étape 3 : bloc « options » ` +
      `absent (D6) — sans les issues possibles et leur coût, la préco n'est pas ` +
      `un arbitrage mais une décision prise à la place de l'utilisateur.`).toBe(true);
  });

  it('§ Étape 3 porte le bloc « préco »', () => {
    expect(/préco/i.test(arb()), `${MATURE_FILE} § Étape 3 : bloc « préco » absent ` +
      `(D6) — c'est le format que l'utilisateur redemande systématiquement.`).toBe(true);
  });

  it('§ Étape 3 rend la main et ATTEND', () => {
    expect(
      /attendre|attente/i.test(arb()),
      `${MATURE_FILE} § Étape 3 : l'attente a disparu — c'est le SEUL point ` +
        `d'arrêt bloquant du skill, sans défaut implicite (D6). Un arbitrage ` +
        `affiché puis refermé tout seul n'est pas un arbitrage.`
    ).toBe(true);
  });
});

describe('MAT8 (SKILL-98, D7 a) — la gate conditionne réellement le `close`', () => {
  const gate = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 4 — Gate de fermeture');

  // ⚠️ Mutation-témoin : garder l'appel `escalations close` en retirant la phrase
  // qui le conditionne → rouge. Une gate sans son geste bloquant est exactement ce
  // que SKILL-98 refuse de livrer.
  it('§ Étape 4 réunit `escalations close`, `Escalades (D10)` et la phrase qui conditionne', () => {
    const s = gate();
    expect(s, `${MATURE_FILE} § Étape 4 n'appelle pas \`escalations close\`.`).toContain(
      'escalations close'
    );
    expect(
      s,
      `${MATURE_FILE} § Étape 4 ne nomme pas la section \`## Escalades (D10)\` — ` +
        `la gate ne dit pas OÙ la ligne de diagnostic s'écrit (D7).`
    ).toContain('Escalades (D10)');
    expect(
      s,
      `${MATURE_FILE} § Étape 4 : la phrase qui BLOQUE le close a disparu. ` +
        `Sans elle il reste un appel CLI documenté, pas une gate.`
    ).toContain('Pas de `escalations close` sans');
    expect(
      s,
      `${MATURE_FILE} § Étape 4 n'exige aucune « ligne de diagnostic ».`
    ).toContain('ligne de diagnostic');
  });
});

describe('MAT9 (SKILL-98, D7 a) — les DEUX issues du diagnostic sont écrites', () => {
  // Deux `it()` distincts, pour la raison exacte de D3 de SKILL-94 : une assertion
  // unique les laisserait disparaître à moitié sans rougir.
  const gate = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 4 — Gate de fermeture');

  // ⚠️ Mutation-témoin : retirer « un numéro (1 à 7) » → rouge.
  it('§ Étape 4 écrit la première issue : un numéro (1 à 7)', () => {
    expect(
      gate(),
      `${MATURE_FILE} § Étape 4 : la première issue de la question fermée a ` +
        `disparu. « Quel contrôle aurait dû l'attraper ? » n'a que deux réponses.`
    ).toContain('un numéro (1 à 7)');
  });

  // ⚠️ Mutation-témoin : retirer `aucun` → rouge. L'ancrage exige les deux issues
  // sur la MÊME ligne : `aucun` écrit ailleurs dans la section (le régime (d) le
  // cite aussi) ne suffit pas à rendre la question fermée.
  it('§ Étape 4 écrit la seconde issue : `aucun`, à côté de la première', () => {
    expect(
      /un numéro \(1 à 7\)[^\n]{0,80}`aucun`/.test(gate()),
      `${MATURE_FILE} § Étape 4 : la seconde issue (\`aucun\`) ne figure pas aux ` +
        `côtés de la première. Sans elle, « la méthode a un trou » devient ` +
        `indiscernable de « je ne l'ai pas suivie » — deux problèmes aux réponses ` +
        `opposées.`
    ).toBe(true);
  });
});

describe('MAT10 (SKILL-98, D7 b/c/e) — les trois autres régimes sont couverts', () => {
  const gate = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 4 — Gate de fermeture');

  // ⚠️ Mutation-témoin : supprimer la ligne (b) → rouge.
  it('§ Étape 4 traite (b) — une E1 qui conteste une décision produit', () => {
    expect(
      /décision produit/i.test(gate()),
      `${MATURE_FILE} § Étape 4 ne dit pas ce qu'elle fait d'une E1 qui conteste ` +
        `une décision PRODUIT : la méthode n'y est pas en cause, exiger un ` +
        `diagnostic y serait un rituel vide (D7 b).`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : supprimer la ligne E3 → rouge.
  it('§ Étape 4 traite (c) — une E3', () => {
    expect(
      /\(c\)[^\n]*\bE3\b/.test(gate()),
      `${MATURE_FILE} § Étape 4 ne dit pas ce qu'elle fait d'une E3 (la correction ` +
        `cassait un test vert) — le rituel de rules/maturation.md ne porte que sur ` +
        `le premier régime, la gate doit couvrir les cinq (D7 c).`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : supprimer la ligne (e) → rouge.
  it('§ Étape 4 traite (e) — une escalade déjà close', () => {
    expect(
      /déjà close/i.test(gate()),
      `${MATURE_FILE} § Étape 4 ne dit pas ce qu'elle fait d'une escalade DÉJÀ ` +
        `close (visible en \`escalations --all\`) : ne rien faire, ne pas ` +
        `re-fermer (D7 e).`
    ).toBe(true);
  });
});

describe('MAT11 (SKILL-98, D8) — l’id du SKILL-NN de (d) n’est pas figé', () => {
  const gate = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 4 — Gate de fermeture');

  // ⚠️ Mutation-témoin : remplacer la règle d'allocation par un id littéral → rouge.
  it('§ Étape 4 pose l’INTERDIT (aucun id inventé ni pré-écrit)', () => {
    expect(
      /n'invente aucun id|jamais pré-écrit|n'en pré-écris aucun/i.test(gate()),
      `${MATURE_FILE} § Étape 4 n'interdit pas d'inventer l'id du SKILL-NN ` +
        `ouvert en (d) — un id dérivé d'un \`list\` lu plus tôt est une course ` +
        `perdue face à une session parallèle (contrôle 6 de la méthode).`
    ).toBe(true);
  });

  it('§ Étape 4 pose la RÈGLE D’ALLOCATION (constat au moment d’ouvrir, reprise de l’id proposé)', () => {
    const s = gate();
    expect(
      /prochain libre/i.test(s),
      `${MATURE_FILE} § Étape 4 ne dit pas de constater le prochain id libre AU ` +
        `MOMENT d'ouvrir le ticket (D8).`
    ).toBe(true);
    expect(
      /reprends l'id|reprendre l'id/i.test(s),
      `${MATURE_FILE} § Étape 4 ne dit pas de REPRENDRE l'id que \`new\` propose ` +
        `quand il refuse — incrémenter de soi-même rejoue la course (D8).`
    ).toBe(true);
  });
});

describe('MAT12 (SKILL-98, D9) — le triplet passe par l’outil, avec --date', () => {
  const etape6 = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 6 — Poser le triplet');

  // ⚠️ Mutation-témoin : retirer `--date` → rouge. Le CLI n'invente JAMAIS une
  // date : sans le drapeau la commande échoue à l'exécution, et rien ne l'aurait
  // dit avant.
  it('§ Étape 6 appelle backlog.mjs mature avec --model, --effort, --review et --date', () => {
    const s = etape6();
    expect(
      /backlog\.mjs"?\s+mature/.test(s),
      `${MATURE_FILE} § Étape 6 ne passe pas par l'outil : le triplet ne s'écrit ` +
        `JAMAIS à la main dans le frontmatter (D9).`
    ).toBe(true);
    for (const flag of ['--model', '--effort', '--review', '--date']) {
      expect(
        s,
        `${MATURE_FILE} § Étape 6 : ${flag} manquant. Maturer, c'est poser le ` +
          `TRIPLET et dater — un drapeau manquant, c'est la commande qui échoue ` +
          `chez l'utilisateur.`
      ).toContain(flag);
    }
  });
});

describe('MAT13 (SKILL-98, D9) — récap avant effets de bord, défaut oui', () => {
  // ⚠️ Mutation-témoin : retirer la ligne de confirmation → rouge.
  it('§ Récap avant effets de bord existe et se ferme sur un défaut « oui »', () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), 'Récap avant effets de bord');
    expect(
      s,
      `${MATURE_FILE} § Récap avant effets de bord ne porte pas « défaut oui » — ` +
        `un skill invoqué EXPLICITEMENT ne redemande pas l'autorisation qu'il ` +
        `vient de recevoir (D9).`
    ).toContain('défaut oui');
  });
});

describe('MAT14 (SKILL-98, D10) — la prémisse est écrite dans les DEUX sens', () => {
  // ⚠️ Mutation-témoin : retirer `/mature` de la cellule `maturing` → rouge.
  it(`${MATURE_FILE} nomme /sdd-run-ticket`, () => {
    expect(
      lireOuVide(MATURE_FILE),
      `${MATURE_FILE} ne nomme pas /sdd-run-ticket — /mature EST sa prémisse, et ` +
        `le dire est la moitié du câblage (D10).`
    ).toContain('/sdd-run-ticket');
  });

  it(`${SDD_FILE} nomme /mature dans sa cellule \`maturing\``, () => {
    const raw = lireOuVide(SDD_FILE);
    const cellule = raw
      .split('\n')
      .find((l) => l.startsWith('| `maturing` |'));
    expect(
      cellule,
      `${SDD_FILE} : la cellule \`maturing\` du tableau de l'Étape 1.5 est ` +
        `introuvable — l'ancre de MAT14 est morte.`
    ).toBeDefined();
    // `(?![-A-Za-z])` : un skill dont le nom PROLONGE `mature` par un tiret
    // (ex. un futur `/mature-quelquechose`) ne compte pas pour `/mature`.
    expect(
      /\/mature(?![-A-Za-z])/.test(cellule),
      `${SDD_FILE} : la cellule \`maturing\` ne nomme pas /mature. C'est le seul ` +
        `endroit où un utilisateur bloqué sur un ticket non maturé apprend que le ` +
        `verbe existe (D10) — la commande CLI nue reste derrière, en équivalent.`
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Familles MAT15 à MAT21 — gate de revue de SKILL-98.
//
// Elles gardent des défauts que la première passe avait laissés passer, et qui
// ont TOUS le même mode de défaillance : le skill décrit un comportement de
// l'outil `backlog.mjs` que l'outil n'a pas. D'où la forme récurrente ci-dessous
// — une assertion sur le skill, DOUBLÉE d'une assertion de vie sur le bundle
// vendorisé `tools/backlog/backlog.mjs`, qui vit dans CE dépôt. Sans la seconde,
// l'ancre meurt le jour où le bundle change de message et le test continue de
// valider une prose devenue fausse (contrôle 7 de la méthode : une clause qui
// énonce un fait constatable cite le moyen de le constater).
//
// ⛔ Le bundle porte ses chaînes accentuées sous forme d'échappements `\xE9` :
// n'y ancre QUE des sous-chaînes sans accent, sous peine d'un faux rouge.
// ---------------------------------------------------------------------------

const BUNDLE_FILE = 'tools/backlog/backlog.mjs';

function bundle() {
  const raw = lire(BUNDLE_FILE);
  expect(
    raw,
    `${BUNDLE_FILE} est absent — les ancres de vie de MAT15+ ne vérifient RIEN.`
  ).not.toBeNull();
  return raw;
}

// Même extraction que F2/F3 de commands-shape-coherence.test.js, refaite ici
// plutôt qu'importée : ce fichier appartient à SKILL-98 et ne doit pas coupler
// sa collecte à un helper d'un autre ticket (style de la maison, cf. la triple
// copie de `findDeclared`).
function blocsBash(raw) {
  const blocs = [];
  let courant = null;
  for (const ligne of raw.split('\n')) {
    if (/^\s*```bash\s*$/.test(ligne)) {
      courant = [];
      continue;
    }
    if (courant !== null && /^\s*```\s*$/.test(ligne)) {
      blocs.push(courant.join('\n'));
      courant = null;
      continue;
    }
    if (courant !== null) courant.push(ligne);
  }
  return blocs;
}

describe('MAT15 (gate) — aucune mutation avant le récap', () => {
  // Le skill s'exécute section par section : les CINQ étapes qui MUTENT
  // (Étape 4 `escalations close` et `new`, Étape 5 les corps de spec, Étape 5.5
  // la section `## Challenge`, Étape 6 `mature`) sont toutes écrites AVANT le
  // § Récap. Le récap ne peut donc pas tenir sa promesse (« avant toute
  // mutation ») par sa seule position — chaque étape mutante doit y RENVOYER,
  // comme /reflect le fait inline.
  //
  // ⚠️ Gate de revue, finding 10 (SKILL-99) : l'Étape 5.5 (nouvelle, § Challenge
  // — dosage puis spawn) MUTE elle aussi (elle écrit `## Challenge` dans le
  // corps des specs) et l'affirme explicitement (« ⛔ Cette écriture est une
  // mutation… »), mais la boucle ne la balayait pas — un ticket qui aurait
  // retiré son renvoi serait resté invisible. Ajoutée à la liste.
  //
  // ⚠️ Mutation-témoin : retirer le renvoi au récap d'une des CINQ étapes →
  // rouge (Étape 5.5 comprise : retirer sa phrase « ⛔ Cette écriture est une
  // mutation… » → rouge).
  for (const titre of [
    'Étape 4 — Gate de fermeture',
    'Étape 5 — Maturer',
    'Étape 5.5 — Challenge (dosage puis spawn)',
    'Étape 6 — Poser le triplet',
  ]) {
    it(`§ ${titre} renvoie au récap avant de muter`, () => {
      const s = sectionOuEchec(lireOuVide(MATURE_FILE), titre);
      expect(
        s,
        `${MATURE_FILE} § ${titre} mute sans renvoyer au « Récap avant effets de ` +
          `bord », qui est écrit APRÈS elle. Répondre « non » à un récap déjà ` +
          `dépassé n'annule rien.`
      ).toContain('Récap avant effets de bord');
    });
  }

  // ⚠️ Mutation-témoin : retirer `new` ou les écritures de corps de l'énumération
  // du récap → rouge. La première passe n'énumérait que `escalations close` et
  // `mature` — les deux mutations les plus lourdes n'étaient pas annoncées.
  // ⚠️ SKILL-101, D3 : le ticket TRAITANT est une cinquième mutation — l'énumération
  // passe de quatre à cinq paires.
  it('§ Récap énumère les CINQ mutations, pas seulement les deux appels CLI', () => {
    const section4 = sectionOuEchec(lireOuVide(MATURE_FILE), 'Récap avant effets de bord');
    // L'ÉNUMÉRATION elle-même, pas la section entière : `new` et `mature` sont
    // nommés ailleurs dans le § Récap (rappel de commit, clause de promotion) et
    // absorberaient la disparition d'un item de la liste.
    const enumeration = section4
      .split('\n')
      .filter((l) => /^\d+\.\s/.test(l) || /^\s{3,}\S/.test(l))
      .join('\n');
    expect(
      enumeration.trim().length,
      `${MATURE_FILE} § Récap ne porte aucune énumération numérotée des mutations.`
    ).toBeGreaterThan(0);
    const s = enumeration;
    for (const [quoi, motif] of [
      ['la fermeture d’escalade', /escalations close/],
      // ⚠️ Gate de revue (finding 5) : /\bnew\b/ ne distingue plus l'item 2 de
      // l'item 3 depuis l'ajout du ticket traitant — les DEUX items contiennent
      // « new ». Ancré sur « régime (d) », discriminant propre à l'item 2.
      ['l’ouverture du ticket du régime (d)', /r[ée]gime \(d\)/],
      ['l’ouverture du ticket traitant', /ticket traitant/],
      ['les écritures de corps de spec', /corps de spec|sections? de spec|§ Portée/],
      ['la pose du triplet', /\bmature\b/],
    ]) {
      expect(
        motif.test(s),
        `${MATURE_FILE} § Récap n'annonce pas ${quoi}. Un récap qui n'énumère ` +
          `qu'une partie des effets de bord fait dire « oui » à ce qu'on n'a pas lu.`
      ).toBe(true);
    }
  });

  // ⛔ Assertion NEUVE (SKILL-101, § Tests cas 6), pas seulement un amendement de
  // la boucle ci-dessus : celle-ci vérifie les paires de l'énumération, jamais le
  // mot-compte LITTÉRAL de la phrase qui l'introduit. Ajouter une cinquième paire
  // à l'énumération sans corriger « quatre » dans cette phrase laisserait « les
  // quatre mutations » survivre VERT dans la prose.
  //
  // ⚠️ Mutation-témoin : ajouter la cinquième entrée à l'énumération en laissant
  // « quatre » dans la phrase qui l'introduit → rouge (mutation inatteignable
  // sans cette assertion précise — c'est ce qui la justifie).
  it(`${MATURE_FILE} § Récap dit « cinq », pas « quatre », dans la phrase qui introduit l'énumération`, () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), 'Récap avant effets de bord');
    const phraseIntro = s
      .split('\n')
      .find((l) => /mutations?\*{0,2} que la suite produira/i.test(l));
    expect(
      phraseIntro,
      `${MATURE_FILE} § Récap : aucune phrase n'introduit l'énumération des ` +
        `mutations par « … mutations que la suite produira » — l'ancre du ` +
        `mot-compte est morte.`
    ).toBeDefined();
    expect(
      /cinq/i.test(phraseIntro ?? ''),
      `${MATURE_FILE} § Récap : la phrase d'introduction de l'énumération ne dit ` +
        `pas « cinq ».`
    ).toBe(true);
    expect(
      /quatre/i.test(phraseIntro ?? ''),
      `${MATURE_FILE} § Récap : la phrase d'introduction de l'énumération dit ` +
        `encore « quatre » — le compte est passé à cinq avec l'ouverture du ` +
        `ticket traitant (D3).`
    ).toBe(false);
  });
});

describe('MAT16 (gate) — aucun bloc exécutable ne porte d’id littéral', () => {
  // `SKILL-NN` n'est un trou que pour un lecteur humain : l'outil l'accepte
  // (`ID_BODY = "[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+"`), et le § Pré-requis annonce
  // que les commandes du skill sont recopiables telles quelles. Un bloc du régime
  // (d) recopié verbatim crée donc un ticket RÉEL d'id `SKILL-NN` dans le
  // checkout LIVE de claude-config.
  //
  // ⚠️ Mutation-témoin : remettre `new "SKILL-NN"` dans le bloc bash → rouge.
  it(`${MATURE_FILE} : aucun identifiant SCOPE-NN littéral dans un bloc \`\`\`bash`, () => {
    const fautifs = [];
    for (const bloc of blocsBash(lireOuVide(MATURE_FILE))) {
      // Les placeholders `<…>` sont des trous DÉCLARÉS (F3 de
      // commands-shape-coherence.test.js les garde) : on les retire avant de
      // chercher un id nu, sinon `<TICKET-ID>` serait un faux positif.
      const sansPlaceholders = bloc.replace(/<[^>]*>/g, '');
      for (const m of sansPlaceholders.match(/\b[A-Z][A-Z0-9]*-[A-Za-z0-9]+\b/g) ?? []) {
        fautifs.push(m);
      }
    }
    expect(
      fautifs,
      `${MATURE_FILE} : ${JSON.stringify(fautifs)} apparaî(ssen)t en clair dans un ` +
        `bloc \`\`\`bash. L'outil ACCEPTE un id de cette forme — un bloc recopié ` +
        `verbatim crée un vrai ticket. Utilise un placeholder déclaré.`
    ).toEqual([]);
  });

  it(`${BUNDLE_FILE} accepte bien un id de la forme SCOPE-NN (ancre de vie)`, () => {
    expect(
      bundle(),
      `${BUNDLE_FILE} ne porte plus ID_BODY — l'ancre de MAT16 est morte : ` +
        `re-constate ce que l'outil accepte comme id avant de relâcher ce test.`
    ).toContain('ID_BODY');
  });

  // ⚠️ Mutation-témoin : ré-employer `<TICKET-ID>` pour `--by` → rouge.
  it('la commande `escalations close` distingue le ticket PORTEUR du ticket TRAITANT', () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 4 — Gate de fermeture');
    // La COMMANDE, pas la prose qui la nomme : l'intro de la gate contient elle
    // aussi « escalations close », et c'est la ligne exécutable qu'on inspecte.
    const ligne = s
      .split('\n')
      .find((l) => /backlog\.mjs"?\s+escalations close/.test(l));
    expect(ligne, `${MATURE_FILE} § Étape 4 : appel \`escalations close\` introuvable.`)
      .toBeDefined();
    const positionnel = /escalations close "(<[^"]+>)"/.exec(ligne);
    const by = /--by "(<[^"]+>)"/.exec(ligne);
    expect(positionnel, `${MATURE_FILE} : le positionnel de \`escalations close\` ` +
      `n'est pas un placeholder déclaré.`).not.toBeNull();
    expect(by, `${MATURE_FILE} : \`--by\` n'est pas un placeholder déclaré.`).not.toBeNull();
    expect(
      by[1],
      `${MATURE_FILE} : le positionnel (ticket PORTEUR de l'escalade) et \`--by\` ` +
        `(ticket qui la TRAITE, « souvent le ticket suivant », donc hors lot) ` +
        `partagent le placeholder ${positionnel[1]}. Substitué littéralement, le ` +
        `marqueur « Traitée par … » désigne le porteur lui-même : la traçabilité ` +
        `que ce marqueur existe pour porter est perdue, exit 0.`
    ).not.toEqual(positionnel[1]);
  });
});

describe('MAT17 (gate) — l’Étape 2 branche sur la sortie RÉELLE de `escalations`', () => {
  // `escalations` n'a pas de sortie vide : sans escalade ouverte il imprime
  // `aucune escalade ouverte.` (exit 0), et hors projet backlog il imprime le
  // message « pas un projet backlog ». Brancher sur « sortie vide », c'est
  // brancher sur un état que l'outil ne produit jamais — le cas NOMINAL tombe
  // alors dans la branche « intersecter avec le lot », et l'instruction « sauter
  // les Étapes 3 et 4 » est morte.
  //
  // ⚠️ Mutation-témoin : revenir à « Sortie vide → … » → rouge.
  it('§ Étape 2 nomme la sortie « aucune escalade ouverte. », pas une sortie vide', () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), "Étape 2 — Escalades d'abord");
    expect(
      s,
      `${MATURE_FILE} § Étape 2 ne cite pas la sortie réelle de l'outil quand rien ` +
        `n'est ouvert. Le prédicat de bascule de D5 doit être vrai.`
    ).toContain('aucune escalade ouverte.');
    expect(
      /sortie vide/i.test(s),
      `${MATURE_FILE} § Étape 2 branche encore sur une « sortie vide » — ` +
        `\`escalations\` n'en produit jamais.`
    ).toBe(false);
  });

  it(`${BUNDLE_FILE} imprime bien « aucune escalade ouverte. » (ancre de vie)`, () => {
    expect(
      bundle(),
      `${BUNDLE_FILE} n'imprime plus « aucune escalade ouverte. » — l'ancre de ` +
        `MAT17 est morte : re-constate la sortie réelle avant de retoucher l'Étape 2.`
    ).toContain('aucune escalade ouverte.');
  });
});

describe('MAT18 (gate) — les trois refus de `new` sont écrits, pas seulement celui de main', () => {
  // `cmdNew` refuse pour trois raisons et ne PROPOSE un id libre que pour la
  // troisième (collision sur `main`). Le skill interdisant par ailleurs
  // d'incrémenter soi-même, les deux premiers régimes n'avaient aucune issue
  // écrite — dans le cas précis où l'attente bloquante de l'Étape 3 rend la
  // course la plus probable.
  //
  // ⚠️ Mutation-témoin : retirer la mention du refus « sur le disque » → rouge.
  it('§ Étape 4 dit quoi faire des refus SANS id proposé', () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 4 — Gate de fermeture');
    expect(s, `${MATURE_FILE} : le refus « existe déjà sur le disque » n'est pas ` +
      `écrit.`).toContain('sur le disque');
    expect(s, `${MATURE_FILE} : le refus « existe déjà sur main » — le SEUL qui ` +
      `propose un id — n'est pas distingué des deux autres.`).toContain('sur main');
    expect(
      /re-?constate|recommence|rejoue/i.test(s),
      `${MATURE_FILE} § Étape 4 : aucune issue écrite quand \`new\` refuse SANS ` +
        `proposer d'id. Le skill interdit d'incrémenter soi-même — sans issue, ` +
        `l'agent est bloqué ou désobéit.`
    ).toBe(true);
  });

  it(`${BUNDLE_FILE} : seul le refus « sur main » propose un id (ancre de vie)`, () => {
    const raw = bundle();
    expect(raw, `${BUNDLE_FILE} : refus « sur le disque » introuvable.`).toContain(
      'sur le disque'
    );
    expect(
      raw,
      `${BUNDLE_FILE} : « prochain id libre » introuvable — l'ancre de MAT18 est ` +
        `morte, re-constate les trois refus de \`new\`.`
    ).toContain('prochain id libre');
  });
});

describe('MAT19 (gate) — le rappel de commit DÉRIVE les dépôts à commiter', () => {
  // Le régime (d) écrit trois artefacts dans `$HOME/.claude` (la spec,
  // `backlog.json`, `specs/backlog.md`), pas dans le projet courant. Un rappel de
  // commit au singulier de dépôt laisse le checkout live sale, et la ligne de
  // diagnostic du projet courant cite alors un id qui n'a jamais été livré.
  //
  // ⚠️ SKILL-101, D3 : le rappel ne se borne plus à « jusqu'à deux dépôts » — un
  // ticket traitant peut ouvrir un TROISIÈME dépôt. Le rappel doit DÉRIVER de
  // `<DEPOT_OUVERTURE>`, pas énumérer une liste fermée à deux.
  //
  // ⚠️ Mutation-témoin : retirer la mention du régime (d) / `$HOME/.claude`, ou
  // retirer la dérivation par `<DEPOT_OUVERTURE>` → rouge.
  it('§ Récap rappelle de commiter le régime (d) ET dérive du dépôt du ticket traitant', () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), 'Récap avant effets de bord');
    expect(
      /\$HOME\/\.claude/.test(s),
      `${MATURE_FILE} § Récap : le rappel de commit ne nomme plus le dépôt du ` +
        `régime (d). La mutation cross-dépôt du régime (d) resterait non commitée, ` +
        `et l'id cité dans la ligne de diagnostic n'aurait jamais existé.`
    ).toBe(true);
    expect(
      s,
      `${MATURE_FILE} § Récap : le rappel de commit ne DÉRIVE plus de ` +
        `<DEPOT_OUVERTURE> — un ticket traitant ouvert dans un TROISIÈME dépôt ` +
        `resterait non nommé par une liste fermée à deux.`
    ).toContain('<DEPOT_OUVERTURE>');
  });
});

describe('MAT20 (gate) — l’Étape 5 couvre les DEUX kind de ticket', () => {
  // `new --kind bug` scaffolde Symptôme / Cause racine / Correction attendue en
  // plus de Portée / Tests / Vérification, chacune sous `_(à remplir)_`. Une
  // Étape 5 qui n'énumère que les trois sections d'un `feature` laisse la moitié
  // d'un ticket `bug` vide, et l'Étape 6 le promeut quand même.
  //
  // ⚠️ Mutation-témoin : retirer la mention de `bug` → rouge.
  it('§ Étape 5 nomme le régime `bug` et le placeholder qui reste à remplir', () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 5 — Maturer');
    expect(
      /\bbug\b/i.test(s),
      `${MATURE_FILE} § Étape 5 ne connaît qu'un des deux \`kind\` du backlog — ` +
        `un ticket \`bug\` partirait en \`todo\` avec ses sections de diagnostic vides.`
    ).toBe(true);
    expect(
      s,
      `${MATURE_FILE} § Étape 5 ne nomme pas le placeholder \`_(à remplir)_\` que ` +
        `\`new\` laisse dans CHAQUE section scaffoldée — c'est le seul signal ` +
        `mécanique qu'une section n'a pas été rédigée.`
    ).toContain('à remplir');
  });

  it(`${BUNDLE_FILE} scaffolde bien les sections de diagnostic d'un bug (ancre de vie)`, () => {
    const raw = bundle();
    for (const ancre of ['Cause racine', 'Correction attendue']) {
      expect(
        raw,
        `${BUNDLE_FILE} ne scaffolde plus « ${ancre} » — l'ancre de MAT20 est ` +
          `morte, re-constate les sections core d'un \`kind: bug\`.`
      ).toContain(ancre);
    }
  });
});

describe('MAT21 (gate) — la sortie ne promet pas `todo` en re-maturation', () => {
  // `cmdMature` ne promeut QUE depuis `maturing`. Un ticket re-maturé — le cas
  // explicitement admis à l'Étape 1, celui d'une escalade à refermer — garde son
  // statut. Promettre « le lot maturé est en todo » envoie l'opérateur sur un
  // `/sdd-run-ticket` qui refusera.
  //
  // ⚠️ Mutation-témoin : revenir à « Le lot maturé est en `todo` » sec → rouge.
  it('§ Récap dit que la promotion ne vaut QUE depuis `maturing`', () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), 'Récap avant effets de bord');
    expect(
      /ne promeut que|seuls? les tickets `?maturing|depuis `maturing`/i.test(s),
      `${MATURE_FILE} § Récap promet un lot en \`todo\` sans dire que la promotion ` +
        `ne s'applique qu'aux tickets \`maturing\`. Un ticket \`merged\` re-maturé ` +
        `pour refermer son escalade reste \`merged\`, et /sdd-run-ticket le refuse.`
    ).toBe(true);
  });

  it(`${BUNDLE_FILE} ne promeut que depuis \`maturing\` (ancre de vie)`, () => {
    expect(
      bundle(),
      `${BUNDLE_FILE} : la garde \`next.status === "maturing"\` a disparu — ` +
        `l'ancre de MAT21 est morte, re-constate ce que \`mature\` promeut.`
    ).toContain('next.status === "maturing"');
  });
});

// ---------------------------------------------------------------------------
// Familles MAT22 à MAT31 — SKILL-99 (specs/skill-99.md, § Tests, cas 1 à 11).
//
// L'ancien skill d'orchestration de maturation d'épic est déclaré caduc : la
// barrière et le challenger vierge, en dosage, sont récupérés dans `/mature`
// (§ Étape 5.5) ; les deux conventions de découpage de SKILL-57 sont déplacées
// telles quelles dans `/mature` (§ Étape 5, remplaçant les describes H1/M1
// retirés de commands-shape-coherence.test.js) ; le renvoi de
// `rules/maturation.md` est re-pointé.
//
// ⚠️ Ce fichier NOMME l'ancien chemin, mais `NOM_SKILL_CADUC` ci-dessous est
// construit par CONCATÉNATION pour ne JAMAIS apparaître comme substring
// contiguë dans ce fichier : la recherche `git grep -l` du cas 2 ne peut donc
// jamais LE rendre, et il n'a besoin d'AUCUNE exemption à la liste fermée D7
// (gate de revue, finding 7 : une exemption motivée par « ce fichier doit se
// nommer lui-même » était à la fois fausse — la branche n'était jamais
// atteinte — et un élargissement non nécessaire de D7, retirée).
// ---------------------------------------------------------------------------

const NOM_SKILL_CADUC = ['mature', 'epic'].join('-');
const OLD_FILE = `commands/${NOM_SKILL_CADUC}.md`;
const ETAPE_5_5 = 'Étape 5.5 — Challenge (dosage puis spawn)';
const ETAPE_5 = 'Étape 5 — Maturer';

describe(`MAT22 (SKILL-99, cas 1) — l'ancien skill a disparu du dépôt`, () => {
  // ⚠️ Mutation-témoin : restaurer commands/<NOM_SKILL_CADUC>.md sur le disque → rouge.
  it(`${OLD_FILE} est absent du disque`, () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, OLD_FILE)),
      `${OLD_FILE} existe encore — le skill caduc (SKILL-99) doit être ` +
        `supprimé, pas laissé sur le disque.`
    ).toBe(false);
  });

  // ⚠️ Mutation-témoin : `git add -f` le fichier restauré sans le committer
  // (présent dans l'index, absent du working tree resterait invisible au test
  // ci-dessus) → rouge. L'un peut mentir sans l'autre, d'où les deux assertions.
  it(`${OLD_FILE} n'est plus suivi par git`, () => {
    const res = spawnSync('git', ['ls-files', '--', 'commands/'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(res.status, 'git ls-files -- commands/ a échoué.').toBe(0);
    const fichiers = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(
      fichiers,
      `${OLD_FILE} figure encore dans l'INDEX git (git ls-files -- commands/) — ` +
        `la suppression n'a pas été committée.`
    ).not.toContain(OLD_FILE);
  });
});

describe('MAT23 (SKILL-99, cas 2) — aucune citation pendante hors de la liste fermée D7', () => {
  // ⚠️ Gate de revue, finding 1 : la liste ne se décrit PLUS par un motif large
  // (`/^specs\/.*\.md$/`), qui absorbait n'importe quelle spec FUTURE — y
  // compris une spec VIVANTE (un brief d'épic `phase: à-venir`, prescriptif,
  // pas un compte rendu daté) qui citerait l'ancien skill. Les 13 fichiers
  // `specs/**/*.md` de D7 sont donc ÉNUMÉRÉS un par un, comme le reste de la
  // liste — c'est la même exigence ("elle s'énumère, elle ne se décrit pas par
  // un motif large") qui s'applique déjà à `commands-shape-coherence.test.js`
  // pour sa propre garde anti-régression transverse.
  const SPECS_LIVREES_D7 = new Set([
    'specs/epics/prompt-hors-skill.md',
    'specs/skill-16.md',
    'specs/skill-19.md',
    'specs/skill-24.md',
    'specs/skill-31.md',
    'specs/skill-37.md',
    'specs/skill-57.md',
    'specs/skill-59.md',
    'specs/skill-91.md',
    'specs/skill-93.md',
    'specs/skill-97.md',
    'specs/skill-98.md',
    'specs/skill-99.md',
  ]);

  const EXEMPTIONS = [
    {
      motif: (f) => SPECS_LIVREES_D7.has(f),
      raison:
        'specs livrées = comptes rendus datés (D3, convention 1) : les réécrire ' +
        'falsifierait le compte rendu de tickets livrés — liste ÉNUMÉRÉE (13 ' +
        'fichiers), jamais un préfixe specs/',
    },
    {
      motif: (f) => f === 'backlog.json' || f === 'specs/backlog.md',
      raison: 'artefacts générés (snapshot) : les occurrences sont des TITRES qui ne changent pas',
    },
    {
      motif: (f) => f === '__tests__/skill-size-ceiling-coherence.test.js',
      raison:
        "commentaire qui RELATE pourquoi une politique a été sortie de l'ancien " +
        'skill — la re-pointer sur /mature inverserait le sens du récit',
    },
  ];

  function fichiersCitantSkillCaduc() {
    // git grep, PAS un readdirSync récursif : seuls les fichiers SUIVIS comptent
    // (363 .md non suivis vivent dans le checkout live — projects/*/memory/,
    // memory/candidates/, plugins/marketplaces/, cache/, backups/).
    //
    // ⚠️ Gate de revue, finding 8 : AUCUN pathspec d'extension (le § Tests cas 2
    // de specs/skill-99.md dit « aucun fichier suivi par git », sans borne
    // d'extension — un pathspec `*.md *.js *.json` laisse hors périmètre les
    // `.mjs` suivis (`tools/backlog/backlog.mjs`, `tools/sdd/preflight.mjs`,
    // etc.), qui nomment déjà des skills en clair). `git grep -l` sans
    // pathspec balaie TOUT le contenu suivi, quelle que soit son extension.
    const res = spawnSync('git', ['grep', '-l', NOM_SKILL_CADUC], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    // git grep : exit 1 = aucune correspondance (pas une erreur) ; exit > 1 = erreur réelle.
    if (res.status === 1) return [];
    expect(
      res.status,
      `git grep -l ${NOM_SKILL_CADUC} a échoué de façon inattendue (code ${res.status}) : ${res.stderr}`
    ).toBe(0);
    return res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  // ⚠️ Mutation-témoin : écrire le nom de l'ancien skill dans commands/reflect.md
  // → rouge.
  it("aucun fichier suivi par git ne cite l'ancien skill hors de la liste fermée D7", () => {
    const fichiers = fichiersCitantSkillCaduc();
    const nonExemptes = fichiers.filter((f) => !EXEMPTIONS.some((e) => e.motif(f)));
    expect(
      nonExemptes,
      `Fichier(s) suivi(s) par git citant encore l'ancien skill hors de la liste ` +
        `fermée D7 (specs/skill-99.md) : ${JSON.stringify(nonExemptes)}.`
    ).toEqual([]);
  });

  // ⚠️ Mutation-témoin (finding 1 de la gate) : un futur brief d'épic VIVANT
  // (`specs/epics/<id>.md`, `phase: à-venir`, non livré) qui citerait l'ancien
  // skill DOIT rougir — il n'est dans AUCUNE des 13 entrées énumérées. C'est
  // exactement le scénario que le finding décrit (une section Découpage qui
  // invoquerait l'ancien skill par son nom) : la garde ne doit plus l'absorber
  // par un motif large `specs/`.
  it("un fichier specs/ HORS des 13 entrées énumérées n'est jamais exempté (pas de motif large)", () => {
    for (const hypothetique of [
      'specs/epics/un-futur-epic.md',
      'specs/skill-999.md',
      'specs/backlog/quelque-chose.md',
    ]) {
      expect(
        EXEMPTIONS.some((e) => e.motif(hypothetique)),
        `${hypothetique} matche une exemption — la liste D7 doit être une ` +
          `énumération FERMÉE de chemins exacts, jamais un motif \`specs/\` ` +
          `large qui absorberait n'importe quelle spec future.`
      ).toBe(false);
    }
  });
});

describe('MAT24 (SKILL-99, cas 3) — la barrière de § Étape 5.5 est écrite', () => {
  // Ancrage DIRECT sur l'INTERDIT explicite (pas la co-présence lâche de deux
  // mots dans un paragraphe, qui resterait vraie même après avoir retiré cette
  // phrase précise — « barrière » et « transcript »/« conversation » cohabitent
  // par ailleurs dans le paragraphe d'ouverture de la section).
  //
  // ⚠️ Mutation-témoin : retirer « rien de la conversation ne franchit la
  // barrière » → rouge.
  it(`§ ${ETAPE_5_5} pose l'interdit explicite : rien de la conversation ne franchit la barrière`, () => {
    // Aplati (le skill est dur-wrappé, la phrase peut porter un saut de ligne
    // en son milieu — même convention que sha-final-timing-coherence.test.js).
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), ETAPE_5_5).replace(/\s+/g, ' ');
    expect(
      /rien de la conversation ne franchit la barri[èe]re/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5_5} : l'interdit « rien de la conversation ne ` +
        `franchit la barrière » a disparu — le principe (le challenger lit les ` +
        `fichiers de spec, jamais le transcript) n'est plus qu'implicite.`
    ).toBe(true);
  });
});

describe('MAT25 (SKILL-99, cas 4/5) — le dosage a ses QUATRE cas, indexés sur la taille du LOT', () => {
  const etape55 = () => sectionOuEchec(lireOuVide(MATURE_FILE), ETAPE_5_5);

  // Une assertion PAR CAS (0, 1, 2, 3) — même raison que D3 de SKILL-94 : une
  // assertion unique les laisserait disparaître à moitié sans rougir. Le cas 0
  // est nommé explicitement : c'est lui qui porte le « pas systématiquement » du
  // § Décision de specs/skill-99.md.
  for (const cas of ['0', '1', '2', '3']) {
    // ⚠️ Mutation-témoin : supprimer la ligne de table du cas ${cas} → rouge
    // (pour le cas 0 : supprimer sa ligne → rouge, comme l'exige le § Tests).
    it(`§ ${ETAPE_5_5} porte le cas ${cas} de la table de dosage`, () => {
      const lignes = etape55().split(/\r?\n/);
      const trouve = lignes.some((l) => new RegExp(`^\\|\\s*\\*\\*${cas}\\*\\*\\s*\\|`).test(l));
      expect(
        trouve,
        `${MATURE_FILE} § ${ETAPE_5_5} : la ligne de table du cas ${cas} est ` +
          `introuvable (« | **${cas}** | »).`
      ).toBe(true);
    });
  }

  // ⚠️ Mutation-témoin : réécrire les déclencheurs en « tickets de l'épic » →
  // rouge. /mature n'a pas d'épic ; son unité est le LOT (argument de /mature).
  it(`§ ${ETAPE_5_5} indexe le dosage sur la taille du LOT, jamais sur des « tickets de l'épic »`, () => {
    const s = etape55();
    expect(
      /lot de/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5_5} : aucun déclencheur n'indexe sur « lot de … tickets ».`
    ).toBe(true);
    expect(
      /tickets de l'épic/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5_5} indexe le dosage sur des « tickets de ` +
        `l'épic » — /mature n'a pas d'épic, son unité est le LOT.`
    ).toBe(false);
  });

  // ⛔ SKILL-101, § Tests cas 1 (D1) : trois assertions NEUVES, ajoutées à cette
  // même famille (amendée, pas une nouvelle) — cf. § Portée : « MAT25 …
  // amendés ». Les DEUX assertions d'absence sont bornées à la LIGNE du cas 3,
  // jamais à la section : la section porte légitimement « cas 2 » dans le
  // paragraphe de recouvrement (MAT38 ci-dessous), et une assertion bornée à la
  // section se contredirait avec lui.
  //
  // ⚠️ Mutation-témoin : rétablir « 3 ou 4 » → rouge.
  it(`§ ${ETAPE_5_5} : le cas 1 dit « 3 à 5 », pas « 3 ou 4 » (D1)`, () => {
    const lignes = etape55().split(/\r?\n/);
    const ligneCas1 = lignes.find((l) => /^\|\s*\*\*1\*\*\s*\|/.test(l));
    expect(ligneCas1, `${MATURE_FILE} § ${ETAPE_5_5} : la ligne du cas 1 est introuvable.`)
      .toBeDefined();
    expect(
      ligneCas1,
      `${MATURE_FILE} § ${ETAPE_5_5} : la ligne du cas 1 ne dit pas « 3 à 5 » (D1).`
    ).toMatch(/3 à 5/);
    expect(
      ligneCas1,
      `${MATURE_FILE} § ${ETAPE_5_5} : la ligne du cas 1 dit encore « 3 ou 4 » (D1).`
    ).not.toMatch(/3 ou 4/);
  });

  // ⚠️ Mutation-témoin : rétablir « cas 2 ET » sur la ligne du cas 3 → rouge.
  it(`§ ${ETAPE_5_5} : la LIGNE du cas 3 ne conditionne plus au cas 2 (D1)`, () => {
    const lignes = etape55().split(/\r?\n/);
    const ligneCas3 = lignes.find((l) => /^\|\s*\*\*3\*\*\s*\|/.test(l));
    expect(ligneCas3, `${MATURE_FILE} § ${ETAPE_5_5} : la ligne du cas 3 est introuvable.`)
      .toBeDefined();
    expect(
      /cas 2/i.test(ligneCas3),
      `${MATURE_FILE} § ${ETAPE_5_5} : la ligne du cas 3 mentionne encore « cas 2 » ` +
        `— le cas 3 doit s'appliquer SANS exiger le cas 2 (D1).`
    ).toBe(false);
  });

  // ⚠️ Mutation-témoin : rétablir « à dépendances inter-tickets » → rouge.
  it(`§ ${ETAPE_5_5} : la LIGNE du cas 3 ne porte plus de qualificatif de dépendance (D1)`, () => {
    const lignes = etape55().split(/\r?\n/);
    const ligneCas3 = lignes.find((l) => /^\|\s*\*\*3\*\*\s*\|/.test(l));
    expect(
      /d[ée]pendance/i.test(ligneCas3 ?? ''),
      `${MATURE_FILE} § ${ETAPE_5_5} : la ligne du cas 3 porte encore un ` +
        `qualificatif de dépendance — ce second retrait referme le domaine sur ` +
        `les gros lots INDÉPENDANTS (D1) ; sans lui le trou d'origine survit, ` +
        `déplacé d'une variable.`
    ).toBe(false);
  });
});

describe('MAT26 (SKILL-99/SKILL-101, cas 6) — les N challengers sont spawnés en UN message, régime aligné sur SKILL-34', () => {
  // ⚠️ SKILL-101, D2 : le régime de spawn est INVERSÉ — `run_in_background: false`,
  // aucune attente de notification, alignés sur le précédent réel de la gate
  // (`sdd-run-ticket.md` Étape 6.3) et sur l'arbitrage de SKILL-34. Cinq
  // assertions : le spawn groupé reste exigé ; `run_in_background: false` est
  // présent ; `run_in_background: true` est ABSENT de la SECTION (elle en porte
  // deux occurrences avant ce ticket — la phrase et le bloc `Agent({…})` — une
  // assertion bornée à la seule phrase laisserait survivre celle que
  // l'orchestrateur recopie) ; « attendre les N notifications » est ABSENT ; le
  // renvoi à SKILL-34 est présent.
  //
  // ⚠️ Mutations-témoins : rétablir `true` dans le bloc `Agent({…})` seulement →
  // rouge ; retirer « dans un seul message » → rouge ; laisser « attendre les N
  // notifications » → rouge ; retirer le renvoi à SKILL-34 → rouge.
  it(`§ ${ETAPE_5_5} exige un spawn groupé, \`run_in_background: false\`, aucune attente, et renvoie à SKILL-34`, () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), ETAPE_5_5);
    expect(
      /dans un seul message/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5_5} n'exige plus un spawn dans UN SEUL message ` +
        `— le mot « parallèle » seul ne suffit pas (D2).`
    ).toBe(true);
    expect(
      s,
      `${MATURE_FILE} § ${ETAPE_5_5} ne porte pas \`run_in_background: false\`.`
    ).toContain('run_in_background: false');
    expect(
      s.includes('run_in_background: true'),
      `${MATURE_FILE} § ${ETAPE_5_5} porte encore \`run_in_background: true\` ` +
        `quelque part dans la SECTION — la phrase et le bloc \`Agent({…})\` sont ` +
        `DEUX porteurs distincts, et le second est celui que l'orchestrateur ` +
        `recopie littéralement.`
    ).toBe(false);
    expect(
      /attendre les n notifications/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5_5} exige encore d'attendre les N notifications ` +
        `— le régime inversé (SKILL-101, D2) n'attend plus rien.`
    ).toBe(false);
    expect(
      /skill-34/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5_5} ne renvoie pas à SKILL-34, qui a déjà arbitré ` +
        `ce point pour la gate — une seconde justification autonome diverge de sa source.`
    ).toBe(true);
  });
});

describe('MAT27 (SKILL-99, cas 7) — le challenger est vierge et lit des FICHIERS', () => {
  // ⚠️ Gate de revue, finding 6 : APLATIR avant de tester l'assertion NÉGATIVE
  // (« contexte de la conversation » ne doit PAS apparaître). Le skill est
  // dur-wrappé : sur le texte BRUT, la phrase légitime d'interdit (« jamais un
  // transcript, jamais le contexte de la\nconversation. ») coupe elle-même la
  // chaîne interdite par un retour à la ligne — l'assertion négative passait
  // par accident de mise en page, pas par une vraie absence de polarité, et un
  // reflow cosmétique aurait pu la faire rougir à tort (ou, plus grave, un
  // AJOUT réel de fuite qui se ferait couper au même endroit serait passé
  // inaperçu). Même aplatissement que MAT24/MAT29/MAT30, tous voisins du même
  // dur-wrap.
  function etape55() {
    return sectionOuEchec(lireOuVide(MATURE_FILE), ETAPE_5_5).replace(/\s+/g, ' ');
  }

  // ⚠️ Mutation-témoin : ajouter « voici le contexte de la conversation » au
  // template → rouge.
  it(`§ ${ETAPE_5_5} : le template nomme les CHEMINS des specs comme seule source, et interdit le transcript`, () => {
    const s = etape55();
    expect(
      s,
      `${MATURE_FILE} § ${ETAPE_5_5} : le template ne nomme pas <CHEMINS_SPECS>.`
    ).toContain('<CHEMINS_SPECS>');
    expect(
      /jamais un transcript/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5_5} : le template n'interdit plus explicitement ` +
        `le transcript.`
    ).toBe(true);
    // ⚠️ Polarité, pas la seule présence de « contexte de la conversation » :
    // l'interdit légitime ci-dessus CONTIENT déjà cette sous-chaîne (« jamais
    // le contexte de la conversation »), une fois aplatie — un `.toBe(false)`
    // sur cette seule sous-chaîne rougirait sur la phrase même qui protège la
    // barrière. On cible le marqueur POSITIF d'une fuite (introduire le
    // contexte au lieu de l'interdire), même formulation que la mutation-témoin
    // (specs/skill-99.md, § Tests cas 7).
    expect(
      /voici le contexte/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5_5} : le template fait fuir le contexte de la ` +
        `conversation vers le challenger — la barrière est rompue.`
    ).toBe(false);
  });

  // ⚠️ Gate de revue, finding 3 : D2 n'autorise qu'UNE adaptation du template
  // figé (son objet), tout le reste doit survivre — l'auto-suffisance de la
  // spec (rendement opérationnel de la barrière) avait été perdue au lieu
  // d'être ajoutée. ⚠️ Mutation-témoin : retirer « chaque spec doit se tenir
  // SEULE » → rouge.
  it(`§ ${ETAPE_5_5} : le template exige que chaque spec se tienne SEULE`, () => {
    expect(
      /se tenir seule/i.test(etape55()),
      `${MATURE_FILE} § ${ETAPE_5_5} : le template n'exige plus qu'une spec se ` +
        `tienne SEULE — le rendement opérationnel de la barrière (détecter une ` +
        `décision qui ne se comprend que par la conversation) a disparu.`
    ).toBe(true);
  });

  // ⚠️ Gate de revue, finding 14 : le template nommait § Hors-scope (confirmé
  // légitime — `tools/backlog/backlog.mjs`, `TICKET_SPEC_SECTIONS.feature.core`
  // la scaffolde bien) mais ratait les trois sections propres à un ticket
  // `bug`, que le § Récap de /mature annonce pourtant comme mutation possible.
  // ⚠️ Mutation-témoin : retirer la ligne « Ticket bug : … » → rouge.
  it(`§ ${ETAPE_5_5} : le template attaque aussi les TROIS sections d'un ticket bug`, () => {
    const s = etape55();
    for (const section of ['Symptôme', 'Cause racine', 'Correction attendue']) {
      expect(
        s,
        `${MATURE_FILE} § ${ETAPE_5_5} : le template n'attaque pas § ${section} ` +
          `d'un ticket \`bug\` — la passe adverse ne couvrirait qu'un ticket ` +
          `\`feature\`.`
      ).toContain(section);
    }
  });
});

describe('MAT28 (SKILL-99, cas 8) — l’arbitrage est gardé (révision OU défense, pour CHAQUE objection)', () => {
  const etape55 = () => sectionOuEchec(lireOuVide(MATURE_FILE), ETAPE_5_5);

  // ⚠️ Mutation-témoin : retirer « chaque objection a une issue écrite » → rouge.
  it(`§ ${ETAPE_5_5} exige une issue écrite pour CHAQUE objection`, () => {
    expect(
      /chaque\s+objection\s+a\s+une\s+issue\s+écrite/i.test(etape55()),
      `${MATURE_FILE} § ${ETAPE_5_5} n'exige plus une issue écrite pour CHAQUE objection.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer « défense » → rouge (une passe adverse dont
  // seules les révisions survivent perd la moitié de son intérêt).
  it(`§ ${ETAPE_5_5} garde la DÉFENSE d'une objection à côté, pas seulement la révision`, () => {
    expect(
      /d[ée]fendre|d[ée]fense/i.test(etape55()),
      `${MATURE_FILE} § ${ETAPE_5_5} ne garde plus la défense d'une objection à ` +
        `côté — seules les révisions survivraient.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : renommer la section `## Challenge` → rouge.
  it(`§ ${ETAPE_5_5} nomme la section \`## Challenge\` où l'arbitrage s'écrit`, () => {
    expect(
      etape55(),
      `${MATURE_FILE} § ${ETAPE_5_5} ne nomme pas \`## Challenge\`.`
    ).toContain('## Challenge');
  });
});

describe('MAT29 (SKILL-99, cas 9) — le cas 0 ne fabrique pas de section vide', () => {
  // ⚠️ Mutation-témoin : retirer la phrase qui exempte le cas 0 → rouge.
  it(`§ ${ETAPE_5_5} dit qu'en CAS 0, aucune section \`## Challenge\` n'est créée`, () => {
    const flat = sectionOuEchec(lireOuVide(MATURE_FILE), ETAPE_5_5).replace(/\s+/g, ' ');
    expect(
      /cas 0.{0,150}aucune section `?## Challenge`? n'est cr[ée][ée]e/i.test(flat),
      `${MATURE_FILE} § ${ETAPE_5_5} ne dit plus qu'en cas 0 aucune section ` +
        `\`## Challenge\` n'est créée — une section vide dirait qu'un challenge a ` +
        `eu lieu.`
    ).toBe(true);
  });
});

describe('MAT30 (SKILL-99, cas 10) — les deux conventions de découpage ont survécu (SKILL-57, déplacées)', () => {
  // Reprise TELLE QUELLE des assertions de l'ancien describe M1 de
  // commands-shape-coherence.test.js (retiré, cf. D6 de specs/skill-99.md),
  // ancrées désormais sur `## Étape 5` de commands/mature.md.
  //
  // ⚠️ D6 (specs/skill-99.md) : la borne de FIN de `sectionOuEchec`/`section()`
  // devient `## Étape 5.5` (le prochain `## ` après `## Étape 5`) au lieu de
  // l'ancien `## Récap avant effets de bord` de l'ancien skill caduc — la
  // zone scannée change de taille, SANS effet sur les assertions ci-dessous
  // (elles cherchent des phrases, pas une longueur), MAIS cette borne de fin
  // n'est contrôlée par AUCUNE assertion ici (reprise du finding 9 de la gate
  // SKILL-57, jamais fermé). Un `## Étape 5.6` intercalé, ou un renommage de
  // `## Étape 5.5`, changerait la zone scannée par MAT30 sans faire rougir un
  // seul test.
  function etape5() {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), ETAPE_5);
    // Aplati (espaces/retours à la ligne réduits à un seul espace) — le skill
    // est dur-wrappé. Les marqueurs de gras Markdown (`**`) sont aussi retirés :
    // les tests contrôlent le FOND, jamais la typographie (finding 4, gate SKILL-57).
    return s.replace(/\s+/g, ' ').replace(/\*\*/g, '');
  }

  // ⚠️ Mutation-témoin : retirer la phrase qui impose le bandeau en gardant
  // celle qui dit qu'une spec livrée n'est plus prescriptive → rougit.
  it(`${MATURE_FILE} dit qu'une spec livrée n'est plus prescriptive ET impose le bandeau`, () => {
    const s = etape5();
    expect(
      /ne prescrit plus/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5} ne dit plus qu'une spec livrée n'est plus prescriptive.`
    ).toBe(true);
    expect(
      /pose un bandeau/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5} n'impose plus le geste du bandeau lors d'une supersession.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer « en tête de la section supersédée » → rougit.
  it(`${MATURE_FILE} prescrit le bandeau EN TÊTE de la section supersédée`, () => {
    expect(
      /en tête de la section supersédée/i.test(etape5()),
      `${MATURE_FILE} § ${ETAPE_5} ne prescrit plus explicitement que le bandeau ` +
        `va en tête de la section supersédée.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer l'interdit (« jamais d'après un ticket ») en
  // gardant « nommé d'après son sujet » → rougit (POLARITÉ, pas seule présence).
  it(`${MATURE_FILE} interdit de nommer un fichier de test neuf d'après son ticket`, () => {
    const s = etape5();
    expect(
      /nommé d'après son sujet/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5} ne dit plus qu'un fichier de test neuf se ` +
        `nomme d'après son sujet.`
    ).toBe(true);
    expect(
      /jamais d'après un ticket/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5} n'interdit plus explicitement de nommer un ` +
        `fichier de test d'après le ticket qui le crée.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : affaiblir la réserve, ou la déancrer du nom de fichier
  // → rougit (POLARITÉ, bornée à la même PHRASE — finding 2, gate SKILL-57).
  it(`${MATURE_FILE} nomme explicitement skill-size-ceiling-coherence.test.js comme réservé aux plafonds`, () => {
    const s = etape5();
    const sentences = s.split(/(?<=[.!?])\s+/);
    const reserveSentence = sentences.find((p) => p.includes('skill-size-ceiling-coherence.test.js'));
    expect(
      reserveSentence,
      `${MATURE_FILE} § ${ETAPE_5} : aucune phrase ne nomme skill-size-ceiling-coherence.test.js.`
    ).toBeTruthy();
    expect(
      /\breste réservé aux plafonds\b/i.test(reserveSentence || ''),
      `${MATURE_FILE} § ${ETAPE_5} : la phrase qui nomme ` +
        `skill-size-ceiling-coherence.test.js ne dit plus, EXPLICITEMENT et ` +
        `POSITIVEMENT, qu'il « reste réservé aux plafonds ».`
    ).toBe(true);
  });

  // ⚠️ Gate de revue, finding 15 (SKILL-99) : D3 exige que les deux conventions
  // soient déplacées TELLES QUELLES — la 2ᵉ avait perdu son GESTE MÉCANIQUE (le
  // § Portée doit NOMMER le fichier neuf), ne gardant que la doctrine. C'est
  // exactement le défaut que la mutation-témoin de la 1ʳᵉ convention (bandeau)
  // refuse déjà : une doctrine sans son geste n'est pas une convention
  // appliquée. ⚠️ Mutation-témoin : retirer la phrase « le § Portée … nomme ce
  // fichier neuf » → rouge.
  it(`${MATURE_FILE} exige que le § Portée NOMME le fichier de test neuf`, () => {
    expect(
      /§ portée.{0,60}nomme|nomme.{0,60}§ portée/is.test(etape5()),
      `${MATURE_FILE} § ${ETAPE_5} : la convention du fichier de test neuf n'a ` +
        `plus son geste mécanique — rien n'exige plus que le § Portée le nomme.`
    ).toBe(true);
  });
});

describe('MAT31 (SKILL-99, cas 11) — rules/maturation.md a été re-pointé, dans les DEUX lectures', () => {
  const regle = () => lireOuVide(REGLE_FILE);

  // ⚠️ Mutation : restaurer la phrase « (dosage à 3 cas dans /<NOM_SKILL_CADUC>) »
  // → rouge.
  it(`${REGLE_FILE} ne cite plus l'ancien skill caduc`, () => {
    expect(
      regle(),
      `${REGLE_FILE} cite encore l'ancien skill caduc (${NOM_SKILL_CADUC}).`
    ).not.toContain(NOM_SKILL_CADUC);
  });

  // ⚠️ Mutation-témoin : retirer le renvoi FORMAT (dosage de challenge de
  // /mature) en laissant la phrase amputée → rouge — une par renvoi, une
  // assertion unique en laisserait disparaître un sans rougir.
  it(`${REGLE_FILE} renvoie le FORMAT de l'échelle \`review\` au dosage de challenge de /mature`, () => {
    expect(
      /\/mature.{0,80}[ée]tape 5\.5|[ée]tape 5\.5.{0,80}\/mature/is.test(regle()),
      `${REGLE_FILE} ne renvoie plus le format de l'échelle \`review\` au dosage ` +
        `de challenge de /mature, § Étape 5.5.`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer le renvoi CONTENU (commands/backlog.md) en
  // laissant la phrase amputée → rouge.
  it(`${REGLE_FILE} renvoie le CONTENU de l'échelle \`review\` à commands/backlog.md`, () => {
    expect(
      regle(),
      `${REGLE_FILE} ne renvoie plus le contenu de l'échelle \`review\` à commands/backlog.md.`
    ).toContain('commands/backlog.md');
  });

  // ⚠️ Gate de revue, finding 4 : le § Tests cas 11 borne l'assertion à « la
  // phrase re-pointée », pas au fichier entier — `rules/maturation.md` porte
  // légitimement, DEUX lignes plus bas, une échelle de MODÈLE à 3 cas
  // (`1 — mécanique`, `2 — porteur`, `3 — exceptionnel`) qui n'a rien à voir
  // avec `/mature`. On isole donc le PARAGRAPHE qui renvoie sur `review`
  // (contient « review » et « échelle écrite »), pas tout le fichier.
  function phraseReview() {
    const paragraphe = regle()
      .split(/\r?\n\r?\n/)
      .find((p) => /`review`/.test(p) && /échelle écrite/i.test(p));
    expect(
      paragraphe,
      `${REGLE_FILE} : aucun paragraphe ne réunit \`review\` et « échelle ` +
        `écrite » — l'ancre de MAT31 est morte.`
    ).toBeTruthy();
    return paragraphe;
  }

  // ⚠️ Mutation-témoin : garder « 3 cas » en pointant /mature DANS la phrase
  // re-pointée → rouge, le nombre étant devenu faux (/mature a QUATRE cas,
  // D2). ⛔ Ne mutation-témoin PAS en ajoutant « 3 cas » ailleurs dans le
  // fichier (ex. la table de modèle) : cette assertion est bornée exprès à ne
  // pas y rougir (§ Tests cas 11 : « dans la phrase re-pointée »).
  it(`${REGLE_FILE} ne garde pas "3 cas" dans la phrase re-pointée`, () => {
    expect(
      /3\s*cas/i.test(phraseReview()),
      `${REGLE_FILE} : la phrase re-pointée contient encore « 3 cas » — ` +
        `/mature a QUATRE cas de dosage (SKILL-99, D2), garder « 3 cas » en ` +
        `pointant /mature serait faux.`
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SKILL-102 — /mature ne résout pas le ticket cross-repo : brancher le verbe
// `resolve` de preflight. Familles MAT32 à MAT37, à la suite de MAT31.
// ---------------------------------------------------------------------------

// Ancrage sur l'APPEL réel du verbe `resolve`, pas sur la sous-chaîne « resolve »
// en prose : la commande recopiée de `/sdd-run-ticket` passe par la variable
// `$PREFLIGHT` (résolue juste au-dessus par homedir()), jamais par le chemin
// littéral suivi de `resolve` — même principe d'ancrage robuste que MAT6 pour
// `escalations`, adapté à cette forme d'appel.
const APPEL_RESOLVE = /"\$PREFLIGHT"\s+resolve\b/;

describe('MAT32 (SKILL-102, D1) — l’Étape 1 appelle réellement preflight resolve', () => {
  const etape1 = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 1 — Constituer le lot');

  // ⚠️ Mutation-témoin : retirer la ligne d'appel `"$PREFLIGHT" resolve` en
  // laissant la mention en prose → rouge.
  it(`${MATURE_FILE} § Étape 1 contient l'appel CLI \`"$PREFLIGHT" resolve\``, () => {
    const s = etape1();
    expect(
      s.includes('preflight.mjs'),
      `${MATURE_FILE} § Étape 1 ne résout jamais le chemin de \`preflight.mjs\`.`
    ).toBe(true);
    expect(
      APPEL_RESOLVE.test(s),
      `${MATURE_FILE} § Étape 1 ne contient aucun appel \`"$PREFLIGHT" resolve\` ` +
        `— la résolution du dépôt cible ne se raconte pas, elle s'exécute (D1).`
    ).toBe(true);
  });

  it(`${MATURE_FILE} § Étape 1 porte le drapeau \`--session-root\``, () => {
    expect(
      etape1(),
      `${MATURE_FILE} § Étape 1 n'appelle pas \`resolve\` avec \`--session-root\`.`
    ).toContain('--session-root');
  });
});

describe('MAT33 (SKILL-102, D1) — le `list` seul ne suffit plus', () => {
  const etape1 = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 1 — Constituer le lot');

  // ⚠️ Mutation-témoin : remettre `list` en tête et retirer `resolve` → rouge.
  it(`${MATURE_FILE} § Étape 1 : si \`list\` subsiste, il vient APRÈS \`resolve\``, () => {
    const s = etape1();
    const iResolve = s.search(APPEL_RESOLVE);
    const iList = s.search(/backlog\.mjs"\s+list/);
    expect(iResolve, `${MATURE_FILE} § Étape 1 : aucun appel \`resolve\` trouvé.`).toBeGreaterThan(
      -1
    );
    if (iList !== -1) {
      expect(
        iList,
        `${MATURE_FILE} § Étape 1 : \`list\` apparaît AVANT \`resolve\` — \`list\` ` +
          `suppose le dépôt déjà résolu, c'est précisément ce qui manque (D1).`
      ).toBeGreaterThan(iResolve);
    }
  });
});

describe('MAT34 (SKILL-102, D2) — <RACINE_PROJET> a disparu du skill', () => {
  // ⚠️ Mutation-témoin : rétablir un seul des six sites → rouge. Deux
  // assertions — l'absence seule laisserait passer un renommage vers un nom
  // quelconque.
  it(`${MATURE_FILE} ne porte plus \`RACINE_PROJET\`, et porte \`RACINE_CIBLE\``, () => {
    const raw = lireOuVide(MATURE_FILE);
    expect(
      raw.includes('RACINE_PROJET'),
      `${MATURE_FILE} contient encore \`RACINE_PROJET\` — le renommage de D2 n'est ` +
        `pas complet.`
    ).toBe(false);
    expect(
      raw.includes('RACINE_CIBLE'),
      `${MATURE_FILE} ne contient aucun \`RACINE_CIBLE\` — le nouveau placeholder ` +
        `n'a jamais été introduit.`
    ).toBe(true);
  });
});

describe('MAT35 (SKILL-102, D3) — le lot est mono-dépôt', () => {
  const etape1 = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 1 — Constituer le lot');

  // Gate de revue (finding 5, SKILL-102) : l'ancrage précédent testait la
  // présence de `targetRoot` et de « deux invocations » N'IMPORTE OÙ dans la
  // section — une mutation qui retire SEULEMENT la phrase d'arrêt (en laissant
  // intactes la phrase de comparaison qui mentionne aussi `targetRoot`, et la
  // phrase d'issue « Deux invocations » juste après) restait verte. On ancre
  // maintenant sur la phrase d'arrêt ELLE-MÊME — divergence de `targetRoot` →
  // `stopper` → « sans rien muter » — et sur la proximité immédiate de l'issue
  // avec elle, pas sur des occurrences disjointes du même mot.
  //
  // ⚠️ Mutation-témoin : retirer la phrase d'arrêt complète (« S'ils ne
  // rendent pas tous le même `targetRoot` : **stopper** … sans rien muter. »)
  // en laissant la phrase de comparaison ET la phrase d'issue intactes →
  // rouge sur les DEUX assertions ci-dessous (elles sont ancrées sur la même
  // phrase composite, chacune y coupe à un point différent).
  it(`${MATURE_FILE} § Étape 1 stoppe sur des \`targetRoot\` divergents, sans rien muter`, () => {
    expect(
      /targetRoot`\s*:\s*\*\*stopper\*\*[\s\S]{0,200}sans rien muter\./.test(etape1()),
      `${MATURE_FILE} § Étape 1 ne contient pas la phrase d'arrêt complète — ` +
        `« targetRoot divergent → stopper → sans rien muter » (D3). Une simple ` +
        `mention isolée de \`targetRoot\` ailleurs dans la section ne suffit pas.`
    ).toBe(true);
  });

  it(`${MATURE_FILE} § Étape 1 donne l'issue « deux invocations » à la SUITE immédiate de l'arrêt`, () => {
    expect(
      /sans rien muter\.[\s\S]{0,20}deux\s+invocations/i.test(etape1()),
      `${MATURE_FILE} § Étape 1 : l'issue « deux invocations » n'est pas ` +
        `accolée à la phrase d'arrêt — une occurrence de « deux invocations » ` +
        `ailleurs dans la section, sans lien avec l'arrêt lui-même, ne suffit pas ` +
        `(D3).`
    ).toBe(true);
  });
});

describe('MAT36 (SKILL-102, D4) — l’arrêt est relayé, et --repo existe', () => {
  const etape1 = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 1 — Constituer le lot');
  const args = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Arguments');

  // ⚠️ Mutation : réintroduire le gabarit supprimé → rouge.
  it(`${MATURE_FILE} : le gabarit "est absent du backlog de ce projet" a disparu`, () => {
    expect(
      lireOuVide(MATURE_FILE),
      `${MATURE_FILE} contient encore le gabarit d'arrêt supprimé par D4 — une ` +
        `seconde formulation du même arrêt diverge dès que preflight change la sienne.`
    ).not.toContain('est absent du backlog de ce projet');
  });

  it(`${MATURE_FILE} § Étape 1 prescrit de relayer le message de l'outil`, () => {
    expect(
      /relaie/i.test(etape1()),
      `${MATURE_FILE} § Étape 1 ne prescrit pas de relayer tel quel le message de ` +
        `\`preflight resolve\` (D4).`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer --repo du § Arguments → rouge (le message relayé le
  // prescrirait sans qu'il existe).
  it(`${MATURE_FILE} § Arguments déclare --repo`, () => {
    expect(
      args(),
      `${MATURE_FILE} § Arguments ne déclare pas \`--repo\` — le message relayé ` +
        `de \`preflight resolve\` le prescrit pourtant (D4).`
    ).toContain('--repo');
  });
});

describe('MAT37 (SKILL-102, D5) — les trois pièges du JSON sont écrits', () => {
  const etape1 = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 1 — Constituer le lot');

  // ⚠️ Mutation-témoin : supprimer la ligne `review` du tableau → rouge. Une
  // assertion PAR champ — trois `it()` distincts — même raison que MAT9 : une
  // assertion unique les laisserait disparaître à moitié sans rougir.
  it(`${MATURE_FILE} § Étape 1 explique pourquoi \`guards.specOnMain\` est ignoré`, () => {
    expect(
      etape1(),
      `${MATURE_FILE} § Étape 1 ne dit rien de \`guards.specOnMain\` (D5) — le lire ` +
        `comme une gate refuserait chaque ticket à maturer.`
    ).toContain('specOnMain');
  });

  it(`${MATURE_FILE} § Étape 1 explique pourquoi \`guards.statusGate\` est ignoré`, () => {
    expect(
      etape1(),
      `${MATURE_FILE} § Étape 1 ne dit rien de \`guards.statusGate\` (D5) — le lire ` +
        `comme une gate casserait la fermeture d'escalade.`
    ).toContain('statusGate');
  });

  it(`${MATURE_FILE} § Étape 1 explique pourquoi \`review\` (champ JSON) est ignoré`, () => {
    expect(
      etape1(),
      `${MATURE_FILE} § Étape 1 ne dit rien du champ \`review\` du JSON (D5) — ` +
        `\`/mature\` POSE le triplet, il ne le lit pas.`
    ).toContain('review');
  });
});

// ---------------------------------------------------------------------------
// Familles MAT38 à MAT43 — SKILL-101 (specs/skill-101.md, § Tests, cas 2, 4, 5,
// 7, 8 et 9). Les cas 1 (bornes du dosage), 3 (régime de spawn) et 6 (compte des
// mutations) sont des assertions NEUVES ajoutées aux describes AMENDÉS
// (MAT25, MAT26, MAT15 respectivement, plus haut dans ce fichier) plutôt que des
// familles séparées — cf. § Portée de specs/skill-101.md : « MAT15, MAT19,
// MAT25 et MAT26 amendés ; cinq familles neuves (cas 2, 4, 5, 8 et 9) ».
//
// ⚠️ Le cas 7 (D4, régime de re-maturation de l'Étape 6) n'apparaît dans AUCUNE
// des deux listes ci-dessus (ni « amendé », ni dans les cinq « neuves »
// énumérées) — lecture la plus conservative retenue : le contenu du régime D4
// est entièrement nouveau (aucun test existant ne couvrait l'Étape 6 au-delà de
// --model/--effort/--review/--date, MAT12) et le § Vérification 3(b) comme le
// § Tests l'exigent explicitement ; l'absence du cas 7 dans le compte de la
// Portée se lit comme une omission de comptage, pas comme une dispense de
// test — une sixième famille neuve (MAT41) le couvre.
// ---------------------------------------------------------------------------

describe('MAT38 (SKILL-101, § Tests 2) — le recouvrement du cas 3 est arbitré et écrit (D1)', () => {
  // ⚠️ Mutation-témoin : retirer la phrase de recouvrement → rouge.
  it(`§ ${ETAPE_5_5} dit qu'un lot de ≥ 6 AVEC signal du cas 2 relève du cas 3`, () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), ETAPE_5_5).replace(/\s+/g, ' ');
    expect(
      /≥\s*6.{0,200}cas 2.{0,100}cas 3|cas 2.{0,200}≥\s*6.{0,100}cas 3/i.test(s),
      `${MATURE_FILE} § ${ETAPE_5_5} ne dit pas explicitement qu'un lot de ≥ 6 ` +
        `tickets portant AUSSI un signal du cas 2 relève du cas 3 — sans cette ` +
        `phrase, deux lignes du domaine seraient vraies en même temps et ` +
        `laisseraient l'orchestrateur choisir (D1).`
    ).toBe(true);
  });
});

describe('MAT39 (SKILL-101, § Tests 4) — l’ouverture a ses DEUX origines (D3)', () => {
  const recap = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Récap avant effets de bord');
  const etape4 = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 4 — Gate de fermeture');

  // ⚠️ Mutation-témoin : ramener la ligne `Ouverture` à la seule mention du
  // régime (d) → rouge. Le gabarit porte désormais DEUX lignes (une par
  // origine, D3/finding 10) — aplati avant de chercher, comme le reste du
  // fichier dur-wrappé.
  it('la ligne `Ouverture` du gabarit nomme les DEUX origines', () => {
    const s = recap().replace(/\s+/g, ' ');
    expect(
      /Ouverture\s*:.{0,120}\(r[ée]gime \(d\)\).{0,200}\(ticket traitant\)/.test(s),
      `${MATURE_FILE} § Récap : la ligne \`Ouverture\` du gabarit ne nomme pas ` +
        `les DEUX origines (régime (d) | ticket traitant) — elle suppose encore ` +
        `que tout ticket ouvert vient du régime (d) (D3).`
    ).toBe(true);
  });

  // ⚠️ Mutation-témoin : retirer le paragraphe du ticket traitant → rouge.
  it('§ Étape 4 prescrit l’ouverture du TICKET TRAITANT', () => {
    expect(
      /ticket traitant/i.test(etape4()),
      `${MATURE_FILE} § Étape 4 ne prescrit nulle part l'ouverture du ticket ` +
        `TRAITANT — le cas fréquent (celui qui fournit le --by) n'est prescrit ` +
        `par aucun paragraphe (D3).`
    ).toBe(true);
  });

  // ⚠️ Gate de revue (finding 6) : l'ancienne disjonction était satisfaite par
  // la première branche seule (« n'est pas … le SKILL-NN du régime (d) »), et
  // la seconde moitié — « n'est exigé par aucune gate », que le § Tests cas 4
  // cite entre guillemets — n'était vérifiée par rien. Conjonction, pas
  // disjonction : LES DEUX phrases doivent être présentes.
  //
  // ⚠️ Mutation-témoin : retirer « n'est exigé par aucune gate » en laissant
  // « n'est pas … le SKILL-NN du régime (d) » → rouge (c'est exactement la
  // mutation que la disjonction précédente laissait passer).
  it('§ Étape 4 distingue le ticket traitant du SKILL-NN du régime (d) ET dit qu’il n’est exigé par aucune gate', () => {
    const s = etape4();
    expect(
      /n'est pas.{0,40}SKILL-NN.{0,80}r[ée]gime \(d\)/is.test(s),
      `${MATURE_FILE} § Étape 4 ne dit pas explicitement que le ticket traitant ` +
        `n'est pas le SKILL-NN du régime (d) (D3).`
    ).toBe(true);
    expect(
      /n'est.{0,80}exig[ée].{0,40}\*{0,2}aucune\*{0,2} gate/is.test(s),
      `${MATURE_FILE} § Étape 4 ne dit pas que le ticket traitant « n'est exigé ` +
        `par aucune gate » (D3, § Tests cas 4 — cité entre guillemets) — cette ` +
        `moitié de la distinction ne doit pas dépendre de la première pour ` +
        `rester vraie.`
    ).toBe(true);
  });
});

describe('MAT40 (SKILL-101, § Tests 5) — l’ouverture nomme son dépôt (D3)', () => {
  const recap = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Récap avant effets de bord');
  const etape4 = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 4 — Gate de fermeture');

  // ⚠️ Mutation-témoin : rétablir « dans $HOME/.claude » sur la ligne `Ouverture`
  // → rouge.
  it('la ligne `Ouverture` du gabarit ne code plus `$HOME/.claude` en dur', () => {
    const s = recap();
    const ligneOuverture = s.split('\n').find((l) => l.trim().startsWith('Ouverture'));
    expect(
      ligneOuverture,
      `${MATURE_FILE} § Récap : la ligne \`Ouverture\` du gabarit est introuvable.`
    ).toBeDefined();
    expect(
      /\$HOME\/\.claude/.test(ligneOuverture ?? ''),
      `${MATURE_FILE} § Récap : la ligne \`Ouverture\` du gabarit code encore ` +
        `\`$HOME/.claude\` en dur — un ticket traitant vit là où vit son ` +
        `livrable, pas systématiquement \`$HOME/.claude\` (D3).`
    ).toBe(false);
  });

  // ⚠️ Gate de revue (finding 3) : l'assertion précédente portait sur le
  // FICHIER ENTIER, or `<DEPOT_OUVERTURE>` est déjà UTILISÉ deux fois dans le
  // § Récap (ligne `Ouverture`, rappel de commit) — elle était donc verte SANS
  // aucune déclaration au § Substitutions. Bornée au paragraphe qui commence par
  // « **Substitutions** » et finit avant `## Pré-requis`.
  //
  // ⚠️ Mutation-témoin : retirer intégralement le fragment qui déclare
  // `<DEPOT_OUVERTURE>` du § Substitutions (en le laissant utilisé ailleurs) →
  // rouge.
  it('§ Substitutions (et LUI SEUL) déclare `<DEPOT_OUVERTURE>`', () => {
    const raw = lireOuVide(MATURE_FILE);
    const lignes = raw.split('\n');
    const debut = lignes.findIndex((l) => l.startsWith('**Substitutions**'));
    const fin = lignes.findIndex((l) => l.startsWith('## Pré-requis'));
    expect(
      debut,
      `${MATURE_FILE} : le paragraphe \`**Substitutions**\` est introuvable.`
    ).toBeGreaterThan(-1);
    expect(
      fin,
      `${MATURE_FILE} : la borne de fin \`## Pré-requis\` est introuvable.`
    ).toBeGreaterThan(debut);
    const substitutions = lignes.slice(debut, fin).join('\n');
    expect(
      substitutions,
      `${MATURE_FILE} § Substitutions ne déclare pas \`<DEPOT_OUVERTURE>\` — le ` +
        `placeholder est déjà UTILISÉ ailleurs (§ Récap), ce qui rendrait une ` +
        `assertion fichier-entier verte sans aucune déclaration (D3).`
    ).toContain('<DEPOT_OUVERTURE>');
  });

  // ⚠️ Mutation-témoin : laisser la phrase « seule mutation à cible fixe » non
  // bornée → rouge. Sans cette borne, l'Étape 4 continuerait d'affirmer une
  // cible fixe en contradiction directe avec le paragraphe du ticket traitant.
  it('§ Étape 4 borne au régime (d) la phrase « seule mutation à cible fixe » ET le bloc de constat d’id', () => {
    const s = etape4();
    expect(
      /seule mutation du r[ée]gime \(d\)/i.test(s),
      `${MATURE_FILE} § Étape 4 : la phrase « seule mutation … à cible fixe » ` +
        `n'est plus bornée au régime (d) — elle contredirait le paragraphe du ` +
        `ticket traitant, qui n'écrit pas toujours dans \`$HOME/.claude\` (D3).`
    ).toBe(true);
    expect(
      /born[ée].{0,80}r[ée]gime \(d\)|r[ée]gime \(d\).{0,80}born[ée]/is.test(s),
      `${MATURE_FILE} § Étape 4 : le bloc de constat d'id (\`ls specs/skill-*.md\`) ` +
        `n'est pas explicitement borné au régime (d) — pour un ticket traitant ` +
        `d'un autre dépôt, le prochain id libre se constate DANS ce dépôt-là (D3).`
    ).toBe(true);
  });
});

describe('MAT41 (SKILL-101, § Tests 7) — l’Étape 6 a son régime de re-maturation, ancré sur le STATUT (D4, sixième famille neuve — cf. note ci-dessus)', () => {
  const etape6 = () => sectionOuEchec(lireOuVide(MATURE_FILE), 'Étape 6 — Poser le triplet');

  // Une assertion par ligne du tableau — quatre `it()` distincts, même raison
  // que MAT9/MAT37 : une assertion unique en laisserait disparaître une sans
  // rougir.
  it('§ Étape 6 : la ligne `maturing` — appeler `mature`', () => {
    expect(
      /`maturing`[^\n|]*\|[^\n|]*appeler `mature`/.test(etape6()),
      `${MATURE_FILE} § Étape 6 : la ligne du tableau pour le statut \`maturing\` ` +
        `est absente ou ne prescrit pas d'appeler \`mature\` (D4).`
    ).toBe(true);
  });

  it('§ Étape 6 : la ligne statut avancé + triplet À CHANGER — appeler `mature`', () => {
    const s = etape6();
    expect(
      /triplet à changer[^\n|]*\|[^\n|]*appeler `mature`/.test(s),
      `${MATURE_FILE} § Étape 6 : la ligne « statut avancé, triplet à changer » ` +
        `est absente ou ne prescrit pas d'appeler \`mature\` (D4).`
    ).toBe(true);
  });

  it('§ Étape 6 : la ligne statut avancé + triplet IDENTIQUE — ne pas appeler `mature`', () => {
    const s = etape6();
    expect(
      /triplet identique[^\n|]*\|[^\n|]*ne pas appeler `mature`/.test(s),
      `${MATURE_FILE} § Étape 6 : la ligne « statut avancé, triplet identique » ` +
        `est absente ou n'interdit pas d'appeler \`mature\` (D4).`
    ).toBe(true);
  });

  it('§ Étape 6 : la ligne `parked`/`wont` — STOPPER', () => {
    const s = etape6();
    expect(
      /`parked`[^\n|]*`wont`[^\n|]*\|[^\n|]*stopper/i.test(s),
      `${MATURE_FILE} § Étape 6 : la ligne pour les statuts \`parked\`/\`wont\` ` +
        `est absente ou ne prescrit pas de STOPPER (D4) — l'invariant \`exec\` ` +
        `n'admet le triplet que sur todo/wip/merged, et optionnellement shipped.`
    ).toBe(true);
  });

  // ⛔ Ne pas asserter « l'Étape 6 renvoie au § Récap » : MAT15 l'impose déjà.
  //
  // ⚠️ Mutation-témoin : recopier « ne promeut que depuis maturing » dans
  // l'Étape 6 → rouge.
  it('§ Étape 6 ne RECOPIE PAS la formule de promotion du § Récap', () => {
    expect(
      /ne promeut que depuis/i.test(etape6()),
      `${MATURE_FILE} § Étape 6 recopie la formule « ne promeut que depuis … » ` +
        `du § Récap — une seconde copie de la règle de promotion divergerait (D4).`
    ).toBe(false);
  });
});

describe('MAT42 (SKILL-101, § Tests 8) — le déclencheur du récap ne dépend plus d’une étape sautable (D5)', () => {
  // ⚠️ Mutation-témoin : rétablir « dès la fin de l'Étape 3 » → rouge.
  it('§ Récap ne nomme plus « dès la fin de l’Étape 3 » et dit « avant la première mutation »', () => {
    const s = sectionOuEchec(lireOuVide(MATURE_FILE), 'Récap avant effets de bord');
    expect(
      /d[èe]s la fin de l'[ée]tape 3/i.test(s),
      `${MATURE_FILE} § Récap nomme encore « dès la fin de l'Étape 3 » — ce ` +
        `déclencheur n'a AUCUNE ancre sur le chemin sans escalade, où les ` +
        `Étapes 3 et 4 sont sautées (D5).`
    ).toBe(false);
    expect(
      /avant la premi[èe]re mutation/i.test(s),
      `${MATURE_FILE} § Récap ne dit pas s'afficher « avant la première ` +
        `mutation, quelle qu'elle soit » (D5).`
    ).toBe(true);
  });
});

describe('MAT43 (SKILL-101, § Tests 9) — le bandeau de supersession est posé sur specs/skill-99.md (D5bis)', () => {
  const SKILL99_FILE = 'specs/skill-99.md';

  // ⚠️ Mutation-témoin : retirer un des deux bandeaux → rouge.
  it(`${SKILL99_FILE} porte DEUX bandeaux « Supersédé par SKILL-101 » — un par section supersédée`, () => {
    const raw = lireOuVide(SKILL99_FILE);
    const occurrences = raw.match(/Supersédé par SKILL-101/g) ?? [];
    expect(
      occurrences.length,
      `${SKILL99_FILE} : ${occurrences.length} bandeau(x) « Supersédé par ` +
        `SKILL-101 » trouvé(s), deux attendus — un pour la table de dosage (D1), ` +
        `un pour le régime de spawn (D2). Sans les deux, une des deux sections ` +
        `supersédées reste présentée comme un contrat toujours vivant.`
    ).toBe(2);
  });

  // ⚠️ Mutation-témoin : écrire le bandeau ailleurs qu'en tête de section, ou
  // hors blockquote → rouge.
  it(`${SKILL99_FILE} : chaque bandeau est en blockquote, forme \`> ⚠️ **Supersédé par SKILL-101**\``, () => {
    const raw = lireOuVide(SKILL99_FILE);
    const lignesBandeau = raw
      .split('\n')
      .filter((l) => l.includes('Supersédé par SKILL-101'));
    expect(lignesBandeau.length).toBeGreaterThan(0);
    for (const ligne of lignesBandeau) {
      expect(
        /^>\s*⚠️\s*\*\*Supersédé par SKILL-101\*\*/.test(ligne.trim()),
        `${SKILL99_FILE} : la ligne ${JSON.stringify(ligne)} n'est pas de la ` +
          `forme blockquote attendue « > ⚠️ **Supersédé par SKILL-101** ».`
      ).toBe(true);
    }
  });

  // ⚠️ Gate de revue (finding 7) : les deux `it()` ci-dessus ne contrôlent NI le
  // compte par section NI la POSITION — la mutation-témoin déclarée par le
  // § Tests cas 9 (« écrire le bandeau ailleurs qu'en tête de section, ou hors
  // blockquote ») restait donc inatteignable pour la moitié « position ». Un
  // bandeau doit être ATTACHÉ à la section qu'il supersède : la ligne
  // IMMÉDIATEMENT PRÉCÉDENTE (une fois les lignes vides ignorées) doit être le
  // début de cette section.
  //
  // ⚠️ Mutation-témoin : déplacer les deux bandeaux en tête de fichier, l'un
  // sous l'autre, hors de tout § D2 → rouge sur les deux assertions.
  it(`${SKILL99_FILE} : le bandeau du spawn est ATTACHÉ à la puce « Le spawn », celui du dosage à son paragraphe`, () => {
    const lignes = lireOuVide(SKILL99_FILE).split('\n');
    const iSpawnBandeau = lignes.findIndex((l) =>
      l.includes('Supersédé par SKILL-101') && l.includes('régime de spawn')
    );
    const iDosageBandeau = lignes.findIndex((l) =>
      l.includes('Supersédé par SKILL-101') && l.includes('table de dosage')
    );
    expect(iSpawnBandeau, `${SKILL99_FILE} : bandeau du spawn introuvable.`).toBeGreaterThan(-1);
    expect(iDosageBandeau, `${SKILL99_FILE} : bandeau du dosage introuvable.`).toBeGreaterThan(-1);
    // Le bandeau du spawn est la ligne qui suit IMMÉDIATEMENT « - **Le spawn** »
    // (attaché à sa puce, indenté sous elle — pas un blockquote de premier
    // niveau qui se romprait sur la puce PRÉCÉDENTE, cf. finding 11).
    expect(
      lignes[iSpawnBandeau - 1],
      `${SKILL99_FILE} : le bandeau du spawn (ligne ${iSpawnBandeau + 1}) n'est ` +
        `pas la ligne qui suit immédiatement « - **Le spawn** » — il pourrait ` +
        `s'attacher à la puce précédente au lieu de la section qu'il supersède.`
    ).toMatch(/^- \*\*Le spawn\*\*/);
    // Le bandeau du dosage précède, à ses propres lignes `>` et aux lignes
    // vides près, le paragraphe « **Dosage à 4 cas … » qu'il supersède —
    // sauter le RESTE du blockquote (toutes les lignes `>` qui suivent),
    // pas seulement la ligne suivante.
    let j = iDosageBandeau + 1;
    while (lignes[j] !== undefined && (lignes[j].trim() === '' || lignes[j].trim().startsWith('>'))) j++;
    expect(
      lignes[j],
      `${SKILL99_FILE} : la ligne qui suit le bandeau du dosage (au-delà des ` +
        `lignes vides) n'est pas le paragraphe « **Dosage à 4 cas … » qu'il est ` +
        `censé superséder — il pourrait être détaché de sa section.`
    ).toMatch(/^\*\*Dosage à 4 cas/);
  });
});
