// SKILL-55 — câblage du producteur de mesures SDD (`tools/sdd-push/push.mjs`)
// dans `commands/send.md` et `commands/deploy.md` (specs/skill-55.md, § Câblage).
//
// Tests de FORME, ancrés à la SECTION concernée et non au fichier entier (même
// stratégie que `commands-shape-coherence.test.js` et `review-log-wiring-coherence.test.js`) :
// un `includes` sur tout le fichier passerait au vert dès qu'un mot apparaît
// n'importe où.
//
// ⚠️ Convention D3 : chaque assertion porte en commentaire la MUTATION qui doit
// la faire rougir.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readNormalized, sectionEntre } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const SEND_FILE = 'commands/send.md';
const DEPLOY_FILE = 'commands/deploy.md';

// Le bloc `bash` qui contient une aiguille donnée, sans dépendre d'ancres qui
// bornent LARGEMENT (la prose de tolérance vit AVANT l'appel du script, donc
// une tranche démarrant à l'aiguille la manquerait).
//
// ⚠️ Finding de gate SKILL-55 n° 8 : `lastIndexOf('```bash', at)` trouve la
// fence OUVRANTE la plus proche AVANT l'aiguille, et `indexOf('```', …)` la
// fence FERMANTE la plus proche après cette ouverture — mais rien ne garantit
// que l'aiguille tombe ENTRE les deux. Si `'sdd-push'` cesse un jour d'être
// dans un bloc ```bash (fence renommée en ```sh, appel déplacé en prose), la
// fonction remonterait silencieusement le bloc `bash` VOISIN (un hook
// backlog, gardé lui aussi) et validerait un câblage disparu. La garde
// ci-dessous exige que l'aiguille soit STRICTEMENT contenue dans le bloc
// rendu — sinon `null`, traduit en échec explicite par l'appelant.
function bashBlockContaining(raw, needle) {
  const at = raw.indexOf(needle);
  if (at === -1) return null;
  const openTag = '```bash';
  const open = raw.lastIndexOf(openTag, at);
  if (open === -1) return null;
  const bodyStart = open + openTag.length;
  const close = raw.indexOf('```', bodyStart);
  if (close === -1) return null;
  if (at < bodyStart || at >= close) return null; // l'aiguille n'est PAS dans ce bloc
  return raw.slice(bodyStart, close);
}

describe('SKILL-55 — câblage dans commands/send.md', () => {
  const raw = readNormalized(REPO_ROOT, SEND_FILE);

  // ⚠️ Mutation : supprimer la section, ou la déplacer avant l'Étape 4.6, ou
  // après l'Étape 5 → rougit.
  it('un bloc d’appel `sdd-push` existe, situé après l’Étape 4.6 et avant l’Étape 5', () => {
    const section = sectionEntre(raw, '### Étape 4.6', '## Étape 5', SEND_FILE);
    expect(
      section,
      `${SEND_FILE} : la section entre 4.6 et 5 ne nomme plus 'sdd-push'.`
    ).toContain("'sdd-push'");
    expect(section).toContain("'push.mjs'");
  });

  // ⚠️ Mutation : retirer la garde `[ -f "$TOOL" ]` → rougit (un poste sans
  // l'outil planterait au lieu de no-op).
  it('le bloc porte la garde `[ -f "$TOOL" ]`', () => {
    const block = bashBlockContaining(raw, "'sdd-push'");
    expect(block, `${SEND_FILE} : aucun bloc \`bash\` ne contient 'sdd-push'.`).not.toBeNull();
    expect(block).toContain('[ -f "$TOOL" ]');
  });

  // ⚠️ Mutation : ajouter un `cd` dans le bloc → rougit (SKILL-32 : le cwd
  // n'est pas persistant entre appels shell, et l'outil résout son corpus par
  // `os.homedir()` — un `cd` erroné serait silencieux).
  it('le bloc ne contient aucun `cd`', () => {
    const block = bashBlockContaining(raw, "'sdd-push'");
    expect(block).not.toBeNull();
    expect(block).not.toMatch(/\bcd\s/);
  });

  // ⚠️ Mutation : retirer la prose de tolérance (« ne peut jamais faire
  // échouer ») → rougit. Même règle que le hook backlog (INFRA-11).
  it('la prose dit explicitement que le hook ne peut pas faire échouer /send', () => {
    const section = sectionEntre(raw, '### Étape 4.6', '## Étape 5', SEND_FILE);
    expect(/jamais faire échouer/i.test(section)).toBe(true);
  });
});

describe('SKILL-55 — câblage dans commands/deploy.md', () => {
  const raw = readNormalized(REPO_ROOT, DEPLOY_FILE);

  // ⚠️ Mutation : déplacer le bloc avant l'Étape 4.1, ou le supprimer →
  // rougit.
  it('un bloc d’appel `sdd-push` existe après l’Étape 4.1', () => {
    const i41 = raw.indexOf('### Étape 4.1');
    const iTool = raw.indexOf("'sdd-push'");
    expect(i41, `${DEPLOY_FILE} : "### Étape 4.1" introuvable.`).toBeGreaterThan(-1);
    expect(
      iTool,
      `${DEPLOY_FILE} : aucun bloc n'appelle 'sdd-push'.`
    ).toBeGreaterThan(i41);
  });

  // ⚠️ Mutation : appeler l'outil APRÈS l'affichage de confirmation → rougit.
  it('le bloc est placé avant l’affichage de confirmation ("Après le push, afficher")', () => {
    const iTool = raw.indexOf("'sdd-push'");
    const iConfirm = raw.indexOf('Après le push, afficher');
    expect(iConfirm, `${DEPLOY_FILE} : ancre de confirmation introuvable.`).toBeGreaterThan(-1);
    expect(iTool).toBeGreaterThan(-1);
    expect(iTool).toBeLessThan(iConfirm);
  });

  // ⚠️ Mutation : retirer la garde `[ -f "$TOOL" ]` → rougit.
  it('le bloc porte la garde `[ -f "$TOOL" ]`', () => {
    const block = bashBlockContaining(raw, "'sdd-push'");
    expect(block, `${DEPLOY_FILE} : aucun bloc \`bash\` ne contient 'sdd-push'.`).not.toBeNull();
    expect(block).toContain('[ -f "$TOOL" ]');
  });

  // ⚠️ Mutation : ajouter un `cd` dans le bloc → rougit.
  it('le bloc ne contient aucun `cd`', () => {
    const block = bashBlockContaining(raw, "'sdd-push'");
    expect(block).not.toBeNull();
    expect(block).not.toMatch(/\bcd\s/);
  });

  // ⚠️ Mutation : retirer la prose de tolérance → rougit. La prose vit AVANT
  // le bloc `bash` (elle introduit l'appel) — la fenêtre couvre donc depuis
  // l'Étape 4.1 jusqu'à la confirmation, pas seulement depuis l'aiguille.
  it('la prose dit explicitement que le hook ne peut pas faire échouer /deploy', () => {
    const i41 = raw.indexOf('### Étape 4.1');
    const iConfirm = raw.indexOf('Après le push, afficher');
    const section = raw.slice(i41, iConfirm);
    expect(/jamais faire échouer/i.test(section)).toBe(true);
  });
});

describe('SKILL-55 — bashBlockContaining ne rend pas un bloc étranger (finding de gate n° 8)', () => {
  // ⚠️ Mutation : retirer la garde `at < bodyStart || at >= close` → rougit.
  // Ici l'aiguille est APRÈS le seul bloc ```bash du texte : sans la garde,
  // `lastIndexOf`/`indexOf` retomberaient sur ce bloc et le rendraient quand
  // même — exactement le trou décrit par le finding.
  it('rend null quand l’aiguille est hors de tout bloc bash (bloc voisin non confondu)', () => {
    const raw = [
      '```bash',
      '[ -f "$TOOL" ] && node "$TOOL" || true',
      '```',
      '',
      'de la prose qui mentionne sdd-push sans être dans un bloc bash',
    ].join('\n');
    expect(bashBlockContaining(raw, 'sdd-push')).toBeNull();
  });

  it('rend le bloc quand l’aiguille y est réellement contenue', () => {
    const raw = ['```bash', 'node sdd-push/push.mjs', '```'].join('\n');
    expect(bashBlockContaining(raw, 'sdd-push')).toContain('sdd-push');
  });
});

describe('SKILL-55 — symétrie liste/dossier (esprit SKILL-51)', () => {
  // ⚠️ Mutation : renommer/déplacer le script sans mettre les skills à jour →
  // rougit.
  it('le chemin `tools/sdd-push/push.mjs` cité existe réellement sur le disque', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tools', 'sdd-push', 'push.mjs'))).toBe(true);
  });
});

describe('SKILL-60 — cohérence spec ↔ code : grammaire de cycles[].id retirée', () => {
  // ⚠️ Mutation : réintroduire la forme `-s<NN>` comme grammaire à faire
  // respecter dans specs/skill-55.md sans mettre à jour le code → rougit.
  // Le producteur ET le consommateur sont couverts : la ligne doit dire que
  // NI L'UN NI L'AUTRE ne doit faire respecter la forme (finding de reprise
  // n° 1 — un contrat qui ne l'interdit qu'au producteur laisse un futur
  // `personal-hub` la faire respecter côté consommateur, et perdre des lots
  // entiers sur des `id` parfaitement légitimes).
  it('specs/skill-55.md dit que la forme de `cycles[].id` est indicative, et que NI le producteur NI le consommateur ne la valident', () => {
    const raw = readNormalized(REPO_ROOT, 'specs/skill-55.md');
    const idLine = raw.split('\n').find((l) => l.includes('`cycles[].id`'));
    expect(idLine, 'specs/skill-55.md : ligne `cycles[].id` introuvable.').toBeTruthy();
    expect(idLine).toMatch(/indicativ/i);
    expect(idLine).toMatch(/producteur ne la valide pas/i);
    expect(idLine, 'la ligne ne dit pas explicitement que le CONSOMMATEUR ne doit pas non plus valider la forme').toMatch(
      /consommateur ne doit pas non plus/i
    );
  });

  // ⚠️ Mutation : ajouter, n'importe où ailleurs dans le fichier (§ Erreurs,
  // § Invariants, § Évolution…), une phrase qui réintroduit la forme
  // `-s<NN>` comme règle à faire respecter → rougit (finding de reprise
  // n° 2). La forme n'a le droit d'apparaître qu'UNE fois dans tout le
  // contrat : la ligne `cycles[].id`, à titre indicatif. Un second endroit
  // qui la cite est nécessairement soit une redite (à fusionner), soit une
  // réintroduction contradictoire de la grammaire retirée.
  it('la forme `-s<NN>` n’apparaît nulle part ailleurs que la ligne indicative `cycles[].id`', () => {
    const raw = readNormalized(REPO_ROOT, 'specs/skill-55.md');
    const occurrences = raw.split('-s<NN>').length - 1;
    expect(occurrences, 'la forme `-s<NN>` doit apparaître EXACTEMENT une fois (la ligne cycles[].id, à titre indicatif)').toBe(1);
    const idLine = raw.split('\n').find((l) => l.includes('`cycles[].id`'));
    expect(idLine).toContain('-s<NN>');
  });

  // ⚠️ Mutation : réintroduire `CYCLE_ID_RE` dans push.mjs → rougit — une
  // réintroduction silencieuse doit être détectée par grep littéral, pas
  // seulement par le test d'export de sdd-push-coherence.test.js.
  it('tools/sdd-push/push.mjs ne contient plus l’identifiant CYCLE_ID_RE', () => {
    const raw = readNormalized(REPO_ROOT, 'tools/sdd-push/push.mjs');
    expect(raw).not.toMatch(/CYCLE_ID_RE/);
  });

  // ⚠️ Mutation : filtrer `id` par une regex renommée (`ID_SHAPE_RE`, inline
  // `/^.../.test(id)`…) → rougit (finding de reprise n° 2, scénario de
  // contournement par renommage). Ce grep est STRUCTUREL — il ne dépend
  // d'aucun nom de constante — et couvre tout appel `.test(id)` dans
  // `collectCycles`, quelle que soit l'expression régulière ou son nom.
  it('aucun `.test(id)` (filtre de forme sur id, quel que soit son nom) dans push.mjs', () => {
    const raw = readNormalized(REPO_ROOT, 'tools/sdd-push/push.mjs');
    expect(raw).not.toMatch(/\.test\(\s*id\s*\)/);
  });
});
