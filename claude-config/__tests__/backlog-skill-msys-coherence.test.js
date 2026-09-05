// SKILL-36 — le piège MSYS_NO_PATHCONV (barre en tête de valeur) sur
// commands/backlog.md, et l'entrée manquante `--title` dans la table de
// l'Étape 1.
//
// Contexte du défaut (specs/skill-36.md) : sous Git Bash / MSYS2, un argument
// commençant par `/` est converti en chemin Windows AVANT d'atteindre le CLI
// — `--title "/reflect mode global"` arrive comme
// `C:/Program Files/Git/reflect mode global`. Succès silencieux, exit 0,
// titre faux. Preuve vivante dans ce dépôt : `specs/skill-20.md` porte
// aujourd'hui ce titre corrompu, et l'outil n'a aucun verbe pour le corriger
// (BLG-05, autre dépôt, non livré) — un défaut silencieux ET irréversible.
//
// ⚠️ Chaque `it` porte en commentaire la mutation qui doit le faire échouer
// (D3, cf. commands-shape-coherence.test.js). Le rapport du ticket liste les
// mutations réellement appliquées et le rouge constaté.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const BACKLOG_FILE = 'commands/backlog.md';

const raw = readNormalized(REPO_ROOT, BACKLOG_FILE);

// Trouvé en revue (finding 1) : les 9 puces de « Règles importantes » sont
// CONTIGUËS (aucune ligne vide entre elles) — `raw.split(/\n\n/)` (la
// convention de `declaredTokens()`/`findDeclared()`, qui vaut pour des
// paragraphes séparés par une ligne vide dans `prompts/*.md`) capture donc,
// ici, la liste ENTIÈRE des 9 puces comme un seul "paragraphe" plutôt que la
// seule puce MSYS. Une assertion sur ce bloc entier passe trivialement dès
// qu'une AUTRE puce contient le motif cherché (`/sdd-run-ticket`, `/send`,
// `/deploy`, `--priority`…), qu'elle porte ou non la garantie testée.
//
// Extraction dédiée à ce format « liste de puces contiguës » : on repère la
// ligne de tête de la puce qui contient `needle` (une ligne commençant par
// `- `), puis on capture jusqu'à la ligne suivante qui commence elle-même par
// `- ` (puce suivante) ou une ligne vide (fin de liste) — jamais au-delà.
function extractBulletContaining(text, needle) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => l.includes(needle));
  if (startIdx === -1) return null;
  let bulletStart = startIdx;
  while (bulletStart > 0 && !/^-\s/.test(lines[bulletStart])) bulletStart--;
  if (!/^-\s/.test(lines[bulletStart])) return null;
  let bulletEnd = bulletStart + 1;
  while (bulletEnd < lines.length && !/^-\s/.test(lines[bulletEnd]) && lines[bulletEnd].trim() !== '') {
    bulletEnd++;
  }
  return lines.slice(bulletStart, bulletEnd).join('\n');
}

describe('O1.1 (SKILL-36) — la règle MSYS est présente et nomme sa variable', () => {
  // ⚠️ Mutation-témoin : retirer la puce MSYS_NO_PATHCONV de commands/backlog.md
  // → rouge.
  it(`${BACKLOG_FILE} contient MSYS_NO_PATHCONV=1`, () => {
    expect(
      raw.includes('MSYS_NO_PATHCONV=1'),
      `${BACKLOG_FILE} ne contient pas "MSYS_NO_PATHCONV=1" — la consigne qui ` +
        `évite qu'un titre commençant par "/" soit converti en chemin Windows ` +
        `(succès silencieux, cf. specs/skill-20.md) est absente.`
    ).toBe(true);
  });
});

describe('O1.2 (SKILL-36) — la règle nomme le symptôme, pas seulement la variable', () => {
  // ⚠️ Mutation-témoin : réduire la puce à « préfixer MSYS_NO_PATHCONV=1 » sans
  // dire quand ni pourquoi (retirer le motif "commence par une barre" et
  // `--title` de la même puce) → rouge. Une consigne sans son déclencheur ne
  // se déclenche pas.
  //
  // Trouvé en revue (finding 2) : la spec (O1.2, "Message d'échec") demande
  // que le MESSAGE cite specs/skill-20.md et rappelle l'irréparabilité
  // (BLG-05 non livré) — pas que ces deux faits datés/externes deviennent des
  // invariants TESTÉS sur le contenu de commands/backlog.md. Le jour où
  // BLG-05 est livré, la doc doit pouvoir retirer "(BLG-05, non livré)" sans
  // que ce garde-fou s'y oppose ; ce test ne l'exige donc plus du fichier,
  // seulement du texte qu'il affiche en cas d'échec.
  it(`${BACKLOG_FILE} : la puce MSYS_NO_PATHCONV nomme le déclencheur (barre en tête de valeur) et --title`, () => {
    const bullet = extractBulletContaining(raw, 'MSYS_NO_PATHCONV');
    expect(
      bullet,
      `${BACKLOG_FILE} ne contient aucune puce portant MSYS_NO_PATHCONV (cf. ` +
        `O1.1). Cas vécu : specs/skill-20.md, dont le titre reste corrompu tant ` +
        `que BLG-05 (verbe de correction de titre, non livré) n'existe pas.`
    ).toBeTruthy();

    // Motif précis (pas un simple caractère "/", qui apparaît aussi dans un
    // chemin comme "specs/skill-20.md" et rendrait l'assertion vacueusement
    // vraie sur une puce réduite qui ne citerait QUE le cas vécu) : la puce
    // doit nommer explicitement le déclencheur — un argument qui COMMENCE par
    // une BARRE.
    const declencheurNomme = /commen[çc]ant?\s+par\s+une\s+barre/i.test(bullet);
    expect(
      declencheurNomme,
      `La puce MSYS_NO_PATHCONV de ${BACKLOG_FILE} ne nomme pas le déclencheur ` +
        `("un argument commençant par une barre") — sans lui, la consigne ne se ` +
        `déclenche pour personne relisant la puce. Cas vécu : specs/skill-20.md ` +
        `(titre corrompu par ce mécanisme, irréparable tant que BLG-05, non ` +
        `livré, n'ajoute pas de verbe pour corriger un titre). Puce actuelle : ` +
        `${JSON.stringify(bullet)}`
    ).toBe(true);

    expect(
      bullet.includes('--title'),
      `La puce MSYS_NO_PATHCONV de ${BACKLOG_FILE} ne mentionne pas --title — ` +
        `le drapeau sur lequel le défaut s'est produit (specs/skill-20.md) doit ` +
        `apparaître dans la même puce que la consigne.`
    ).toBe(true);
  });
});

describe('O1.3 (SKILL-36) — --title figure dans la ligne `new` de la table de l\'Étape 1', () => {
  // ⚠️ Mutation-témoin : retirer `[--title <t>]` de la ligne `new <ID>` de la
  // table → rouge.
  it(`${BACKLOG_FILE} : la ligne "new <ID>" de la table porte --title`, () => {
    const lines = raw.split('\n');
    const newLine = lines.find((l) => l.includes('new <ID>'));
    expect(newLine, `${BACKLOG_FILE} ne contient aucune ligne "new <ID>".`).toBeTruthy();
    expect(
      newLine.includes('--title'),
      `La ligne "new <ID>" de ${BACKLOG_FILE} ne porte pas --title : ${JSON.stringify(newLine)}. ` +
        `Le help de l'outil publie ce drapeau — sans lui dans la table, la ` +
        `règle MSYS_NO_PATHCONV (O1.1/O1.2) flotte sans point d'ancrage.`
    ).toBe(true);
  });
});
