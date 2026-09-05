// Test de forme sur commands/*.md (et skills/**, si ce repo en gagne un jour un
// jour) — SKILL-03, durci par SKILL-04.
//
// SKILL-03 fermait l'angle mort où /sdd-run-ticket n'est dans le diff d'aucun
// ticket, donc aucun relecteur ne le lit jamais. SKILL-04 (specs/skill-04.md)
// a constaté que ce filet protégeait le mieux là où le risque était le plus
// faible (les blocs courts) et pas du tout là où il était le plus fort (les
// blocs longs, systématiquement exclus dès qu'ils contenaient UN placeholder)
// — au point que le bloc sdd-run-ticket.md:253-271, celui du Défaut 2
// historique, était lui-même exclu de F2.
//
// ⚠️ Chaque test ci-dessous documente, en commentaire, la mutation qui doit
// le faire échouer (D3/SKILL-03, réaffirmé SKILL-04). Le rapport final du
// ticket liste les mutations réellement appliquées et leur résultat (rouge
// constaté, retour au vert).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { extractSection, platir } from './helpers/prompt-blocks.js';
import { estCitationSpecCouverte } from './helpers/legacy-path-policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

// D2 (SKILL-04) : COMMANDS_DIR était figé sur commands/, non récursif. On
// scanne maintenant tout .md sous CES répertoires précis DE CE REPO,
// récursivement — et seulement eux. ⚠️ Ne JAMAIS élargir au-delà : les skills
// de whereismycard (`.claude/commands/`, `.claude/skills/`) portent le même
// défaut de conception, mais c'est INFRA-36, LÀ-BAS, qui les traite, avec sa
// propre garde (specs/skill-04.md D2). Un test d'un repo qui va lire les
// fichiers d'un autre est un couplage qu'on ne maintiendra pas.
//
// `skills/` n'existe pas encore dans ce repo au moment d'écrire ce test — pas
// besoin qu'il existe pour que le scan le couvre le jour où il apparaît :
// `fs.existsSync` en fait un no-op tant qu'il est absent.
//
// SKILL-25 : `prompts/` entre dans le périmètre. Les ~490 lignes de mode
// d'emploi (implémenteur × 2, relecteur) qui vivaient INLINE dans
// commands/sdd-run-ticket.md en sont sorties pour devenir des fichiers que le
// sous-agent lit lui-même — sans cet ajout elles quitteraient F1
// (dollar-chiffre), F2 (`bash -n`), R1 (placeholder nu en fin de ligne) et F3
// (placeholder déclaré) EN SILENCE. Perdre une couverture en déplaçant du
// texte est une régression, pas un effet de bord acceptable.
//
// SKILL-54 : `steps/` entre dans le périmètre, pour la MÊME raison et sans
// aucune autre. Les ~7 Ko de sections conditionnelles sorties du skill (Étapes
// 4.5, 5.7, « Variante cross-repo », corps de 6.4.5) emportent avec elles un
// bloc ```bash exécutable et trois placeholders de substitution : sans cet
// ajout elles quitteraient F1, F2, R1, F3 et D2 (chemin `~/` non portable) EN
// SILENCE, exactement comme l'aurait fait prompts/ avant SKILL-25. Le
// paragraphe ci-dessus vaut mot pour mot pour ce ticket-ci.
//
// SKILL-97 : `rules/` entre dans le périmètre, pour la MÊME raison et sans
// aucune autre — c'est le TROISIÈME dossier de prose né d'un déplacement, après
// `prompts/` (SKILL-25) et `steps/` (SKILL-54). La méthode de maturation sortie
// de `CLAUDE.md` y emporte de la prose PRESCRIPTIVE, qui citera demain des
// chemins et des commandes : sans cet ajout elle quitterait F1, F2, R1, F3 et
// D2 (chemin `~/` non portable) EN SILENCE, alors que le même texte écrit dans
// `prompts/` ou `steps/` ferait rougir `npm test`. Les deux paragraphes
// ci-dessus valent mot pour mot pour ce ticket-ci. `rules/` avait reçu ses deux
// AUTRES gardes de dossier dans le même commit (`.gitattributes`,
// `PLAFOND_RULES`) ; celle-ci, qui regarde le CONTENU et non la taille,
// manquait.
const SCAN_DIRS = ['commands', 'skills', 'prompts', 'steps', 'rules'];

function listCommandFiles() {
  const files = [];
  function walk(absDir, relPrefix) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const rel = `${relPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.name.endsWith('.md')) {
        files.push(rel);
      }
    }
  }
  for (const dirName of SCAN_DIRS) {
    const abs = path.join(REPO_ROOT, dirName);
    if (fs.existsSync(abs)) walk(abs, dirName);
  }
  return files.sort();
}

function readCommandFile(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// --- F2 : extraction des blocs ```bash ... ``` ------------------------------
//
// commands/sdd-run-ticket.md contient des exemples ```bash imbriqués À
// L'INTÉRIEUR d'un plus grand bloc ``` sans langage (le "Template du prompt à
// passer à l'agent" est lui-même un exemple de prompt qui, pour être lisible,
// montre un extrait ```bash au milieu de son propre texte). Une extraction
// "un seul fence actif à la fois" (même correcte au sens strict CommonMark —
// une ligne ```bash rencontrée à l'intérieur d'un fence déjà ouvert ne le
// ferme pas) rate ces exemples imbriqués : leur PROPRE ligne de fermeture
// ``` referme alors le bloc englobant au lieu du sous-bloc, et le sous-bloc
// ```bash n'est jamais reconnu comme tel (vécu : les exemples imbriqués aux
// lignes 322-327 et 495-499 de sdd-run-ticket.md disparaissaient purement et
// simplement — ni testés, ni skip, ni visibles). On extrait donc CHAQUE
// occurrence de ```bash indépendamment : pour chaque ligne exactement
// "```bash", on prend tout jusqu'à la PROCHAINE ligne exactement "```" (bare),
// sans tenir compte d'un éventuel fence englobant. C'est délibérément "local" :
// ça n'essaie pas de reconstruire une arborescence de blocs imbriqués (les
// fichiers de ce repo ne sont de toute façon pas du CommonMark valide à cet
// égard), juste d'attraper tout extrait ```bash tel qu'écrit.
function extractBashBlocks(raw) {
  const lines = raw.split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '```bash') continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '```') {
        blocks.push({ startLine: i + 1, endLine: j + 1, content: lines.slice(i + 1, j) });
        break;
      }
    }
  }
  return blocks;
}

describe('F0 (SKILL-25) — les modes d’emploi de prompts/ sont dans le périmètre scanné', () => {
  // Assertion COMPORTEMENTALE — sur la liste réellement rendue par
  // `listCommandFiles()`, jamais sur la constante `SCAN_DIRS` elle-même : un
  // test qui lit la constante qu'il contrôle se valide contre lui-même (D3).
  // La liste attendue est déclarée ICI, pas dérivée d'un `readdirSync`.
  //
  // ⚠️ Mutation : retirer `prompts` de SCAN_DIRS → rouge. Sans ce test, la
  // mutation serait silencieuse : F1/F2/R1/F3 continueraient de passer, sur un
  // corpus amputé de ~490 lignes.
  const EXPECTED_PROMPT_FILES = [
    'prompts/impl-same.md',
    'prompts/impl-cross.md',
    'prompts/reviewer.md',
    'prompts/aggregator.md',
  ];

  for (const rel of EXPECTED_PROMPT_FILES) {
    it(`listCommandFiles() inclut ${rel}`, () => {
      expect(
        listCommandFiles(),
        `${rel} n'est pas balayé par les tests de forme — il en sortirait en ` +
          `silence (F1/F2/R1/F3).`
      ).toContain(rel);
    });
  }

  // SKILL-51 — symétrie EXPECTED_PROMPT_FILES ↔ ce que `listCommandFiles()`
  // renvoie réellement pour prompts/.
  //
  // Hors de la boucle ci-dessus, DÉLIBÉRÉMENT : un `it` généré par itération
  // sur EXPECTED_PROMPT_FILES ne rougit jamais quand on retire une entrée de
  // cette même liste — il disparaît avec elle (688 tests avant, 687 après,
  // zéro échec, exit 0 : c'est le défaut exact que ce test ferme). Cette
  // assertion vit dans SON PROPRE `it`, indépendant de la liste qu'elle
  // contrôle, pour survivre à la mutation qu'elle doit détecter.
  //
  // ⚠️ Comparaison à `listCommandFiles()` (récursif, comme le scanner F1/F2/
  // R1/F3 qu'on verrouille ici), PAS à un `fs.readdirSync(prompts/)` à plat
  // (SKILL-51, finding 1 de gate) : un `readdirSync` non récursif désaligne le
  // verrou du scanner qu'il protège dès qu'un mode d'emploi vit dans un
  // sous-dossier de prompts/ — il resterait hors de portée de l'assertion de
  // symétrie (vert trompeur) alors qu'il entrerait par le scan récursif réel
  // (silence dans F1/F2/R1/F3), ou inversement ferait rougir à tort une entrée
  // correctement déclarée dans un sous-dossier.
  //
  // ⚠️ Mutations-témoins (SKILL-51, appliquées et révoquées réellement, jamais
  // via `git checkout --`) :
  //   - retirer 'prompts/aggregator.md' de EXPECTED_PROMPT_FILES → rouge ;
  //   - déposer prompts/zzz-temoin.md sans l'ajouter à EXPECTED_PROMPT_FILES
  //     → rouge.
  //
  // Ne contredit pas D3 : la liste contrôlée reste déclarée en dur ci-dessus,
  // pas dérivée du disque — seule cette assertion de symétrie lit le rendu de
  // `listCommandFiles()` pour vérifier qu'aucun fichier de prompts/ n'échappe
  // à la liste.
  it('EXPECTED_PROMPT_FILES est exactement ce que listCommandFiles() rend pour prompts/', () => {
    const surDisque = listCommandFiles()
      .filter((rel) => rel.startsWith('prompts/'))
      .sort();
    expect(
      surDisque.length,
      `listCommandFiles() ne rend aucun prompts/*.md — ce test n'a rien vérifié.`
    ).toBeGreaterThan(0);
    expect(
      [...EXPECTED_PROMPT_FILES].sort(),
      `EXPECTED_PROMPT_FILES (${EXPECTED_PROMPT_FILES.join(', ')}) ne ` +
        `correspond pas à ce que listCommandFiles() rend pour prompts/ ` +
        `(${surDisque.join(', ')}) — un fichier a été retiré de la liste en ` +
        `silence, ou balayé par listCommandFiles() sans être déclaré ici.`
    ).toEqual(surDisque);
  });
});

describe('F1 — aucun placeholder positionnel dans commands/*.md', () => {
  // Défaut 1 vécu : le rendu du skill substitue les placeholders positionnels
  // (dollar suivi d'un chiffre). Deux occurrences ont produit un champ vide
  // en silence (Étape 0 et Étape 5.5 de sdd-run-ticket.md), corrigées à chaud
  // en SKILL-01 (commit d3fd904). Ce test empêche la régression.
  //
  // D2 (SKILL-04) : listCommandFiles() scanne maintenant récursivement
  // commands/** (et skills/** s'il apparaît un jour) au lieu d'un seul niveau
  // de commands/ — ce test en hérite automatiquement, aucune logique propre à
  // dupliquer ici.
  //
  // ⚠️ Mutation D3 : insérer un dollar suivi d'un chiffre (ex. dans une chaîne
  // sed) dans n'importe quel commands/*.md → ce test doit rougir.
  for (const file of listCommandFiles()) {
    it(`${file} ne contient aucun dollar suivi d'un chiffre`, () => {
      const raw = readCommandFile(file);
      const matches = raw.match(/\$[0-9]/g) || [];
      expect(
        matches,
        `${file} contient un dollar suivi d'un chiffre — le rendu du skill ` +
          `substitue les placeholders positionnels, ce champ arriverait vide ` +
          `côté agent (cf. specs/skill-03.md, Défaut 1).`
      ).toEqual([]);
    });
  }
});

describe('F2 — les blocs ```bash sont syntaxiquement valides', () => {
  // D1 (SKILL-04). L'ancienne version excluait TOUT le bloc dès qu'un seul
  // placeholder de substitution y apparaissait — 47/52 lignes bash exclues
  // côté sdd-run-ticket.md (6 blocs sur 10), 43/51 côté send.md (6 sur 13),
  // dont le bloc :253-271 qui EST le Défaut 2 historique (checkout main dont
  // l'échec était silencieux) : le test écrit pour fermer cet angle mort
  // excluait le lieu du crime (specs/skill-04.md, le constat chiffré).
  //
  // Piste retenue : un placeholder est une info de LIGNE, pas une raison de
  // renoncer au BLOC entier. On substitue chaque placeholder CONNU par une
  // valeur inerte plausible avant `bash -n`, et le bloc entier est validé.
  //
  // Registre BORNÉ et JUSTIFIÉ ligne à ligne (l'invariant posé par D1 : "une
  // liste qui grossit est un test qui rétrécit" — exactement comment
  // `<chemin>` était entré dans l'ancienne liste d'EXCLUSION pour contourner
  // worktree-clean.md, SKILL-03). Chaque entrée ci-dessous correspond à un
  // token qui apparaît RÉELLEMENT dans au moins un bloc ```bash de ce repo
  // (vérifié à la main à l'écriture de SKILL-04, cf. rapport du ticket).
  //
  // ⚠️ Corrigé après revue (SKILL-04, dosage deep) : ce registre n'est PAS un
  // filet de complétude — un nouveau placeholder utilisé bien formé (ex. déjà
  // entre guillemets) passe `bash -n` avec ou sans lui, silencieusement. Ce
  // registre ne sert QU'À rendre `bash -n` capable de dire quelque chose sur
  // des blocs qui, sinon, casseraient sur un `<`/`>` nu. La garantie que
  // "tout placeholder de substitution est déclaré quelque part" est un
  // travail DIFFÉRENT, fait indépendamment par F3 ci-dessous (qui scanne les
  // blocs ```bash directement, pas ce registre) — ne pas confondre les deux.
  const SUBSTITUTIONS = [
    ['<TICKET-ID>', 'TICKET_ID_PLACEHOLDER'],
    // SKILL-06 : renommés depuis `<TON_HEAD_SHA>` / `<TON_WORKTREE>` — ces
    // deux valeurs sont désormais renseignées par l'ORCHESTRATEUR (qui les lit
    // programmatiquement dans le worktree de l'implémenteur), plus par
    // l'implémenteur lui-même ; « TON » y désignait le mauvais acteur.
    ['<SHA_IMPL>', 'SHA_IMPL_PLACEHOLDER'],
    ['<WORKTREE_IMPL>', '/tmp/WORKTREE_IMPL_PLACEHOLDER'],
    ['<chemin_main>', '/tmp/chemin_main_placeholder'],
    ['<chemin>', '/tmp/chemin_placeholder'],
    ['<branche_courante>', 'branche_courante_placeholder'],
    ['<spec_path>', 'specs/spec_path_placeholder.md'],
    ['<message>', 'message_placeholder'],
    ['<repo>', '/tmp/repo_placeholder'],
  ];

  function substitutePlaceholders(content) {
    let out = content;
    for (const [token, value] of SUBSTITUTIONS) {
      out = out.split(token).join(value);
    }
    return out;
  }

  // ⚠️ Limite réelle du dispositif, documentée plutôt que contournée (D1) :
  // les blocs contenant un programme `node -e '…'` restent validés comme DU
  // BASH (la chaîne passée à `-e` est un simple argument entre quotes,
  // syntaxiquement valide pour bash quel que soit son contenu) — mais PAS
  // comme DU JS : `bash -n` ne parse pas le JS embarqué dans la chaîne. Une
  // erreur de syntaxe DANS ce JS (accolade non fermée, etc.) ne serait pas
  // détectée ici. Ça ne réduit la couverture d'aucun bloc — tous sont scannés
  // — ça borne seulement ce que "scanné" prouve pour ceux-là.

  // Probe SYNCHRONE, à l'évaluation du describe (phase de collecte vitest) —
  // pas dans un beforeAll, qui tournerait trop tard pour décider it() vs
  // it.skip() à l'enregistrement des tests.
  const bashProbe = spawnSync('bash', ['-n'], { input: '', encoding: 'utf8' });
  const bashAvailable = !bashProbe.error;
  const itBash = bashAvailable ? it : it.skip;
  const skipReason = bashAvailable
    ? ''
    : ` [SKIP: binaire \`bash\` introuvable sur cette machine — ce test n'a ` +
      `RIEN vérifié, cf. specs/skill-03.md F2]`;

  // ⚠️ Mutation D3 : dans un bloc ```bash NON exclu (ex. `git rev-parse
  // --abbrev-ref HEAD` en tête de sdd-run-ticket.md ou send.md), casser la
  // syntaxe (ex. ajouter une parenthèse ouvrante non fermée) → ce test doit
  // rougir. Si `bash` est absent du PATH, le test se déclare `skip` avec une
  // raison visible dans son nom plutôt que de passer en silence (piège
  // explicitement documenté par la spec).
  for (const file of listCommandFiles()) {
    const raw = readCommandFile(file);
    const bashBlocks = extractBashBlocks(raw);

    for (const block of bashBlocks) {
      const label = `${file}:${block.startLine}-${block.endLine}`;
      const content = substitutePlaceholders(block.content.join('\n'));

      itBash(`${label} parse avec bash -n (placeholders substitués)${skipReason}`, () => {
        const res = spawnSync('bash', ['-n'], { input: content, encoding: 'utf8' });
        expect(
          res.status,
          `${label} n'est pas un bash valide une fois les placeholders CONNUS ` +
            `substitués par une valeur inerte :\n${content}\n\nstderr:\n${res.stderr}\n\n` +
            `Si ce bloc contient un placeholder <...> absent du registre SUBSTITUTIONS ` +
            `(en tête de ce describe), c'est probablement la cause — ajoute-le au ` +
            `registre plutôt que d'exclure ce bloc.`
        ).toBe(0);
      });
    }
  }
});

describe('R1 — un placeholder nu en fin de ligne reste quoté', () => {
  // R1 (specs/skill-04.md) : `<chemin>` nu en fin de ligne casse `bash -n`
  // (`<`/`>` = redirections shell) — c'est comme ça que la dette a été
  // trouvée dans worktree-clean.md, corrigée en quotant. Trouvé en revue
  // (SKILL-04, dosage deep, 2 relecteurs indépendants) : la substitution de
  // placeholders de F2 ci-dessus neutralise CE mode de détection pour
  // l'avenir — une valeur substituée sans `<`/`>` passe `bash -n` que le
  // placeholder d'origine ait été quoté ou non dans la SOURCE. F2 ne peut
  // donc plus jamais revoir R1 régresser. Ce test restaure la protection
  // directement sur la source, AVANT toute substitution — et de façon
  // structurelle (n'importe quel placeholder, pas seulement `<chemin>`) :
  // un vrai chemin Windows substitué contenant un espace (cas réel,
  // `claude-config-wt/mon ticket`) casserait la commande RÉELLE par
  // word-splitting si les guillemets disparaissent, même si `bash -n`,
  // après substitution, ne le verrait plus.
  //
  // ⚠️ Mutation D3 : dans worktree-clean.md, retirer les guillemets ajoutés
  // par R1 autour de `<chemin>` (`git worktree remove "<chemin>"` →
  // `git worktree remove <chemin>`) → ce test doit rougir.
  const BARE_EOL_PLACEHOLDER_RE = /(^|[^"])(<[A-Za-z][A-Za-z0-9_-]*>)\s*$/;

  for (const file of listCommandFiles()) {
    it(`${file} : aucun placeholder nu en fin de ligne dans un bloc \`\`\`bash`, () => {
      const raw = readCommandFile(file);
      const bashBlocks = extractBashBlocks(raw);
      const offenders = [];
      for (const block of bashBlocks) {
        for (const line of block.content) {
          if (BARE_EOL_PLACEHOLDER_RE.test(line)) offenders.push(line.trim());
        }
      }
      expect(
        offenders,
        `${file} laisse un placeholder nu en toute fin de ligne dans un bloc ` +
          `\`\`\`bash : ${JSON.stringify(offenders)}. Quote-le ("<...>") — nu, ` +
          `il casse bash -n (< et > sont des redirections shell) et casserait ` +
          `la commande réelle sur un chemin contenant un espace (cf. ` +
          `specs/skill-04.md R1).`
      ).toEqual([]);
    });
  }
});

describe('F3 — pas de placeholder de substitution orphelin', () => {
  // Portée : whole-file plutôt que "bloc de prompt" au sens strict CommonMark.
  // Justification (documentée pour cause d'ambiguïté de spec) : le grand bloc
  // "Template du prompt à passer à l'agent" de sdd-run-ticket.md contient un
  // exemple ```bash imbriqué qui, en CommonMark strict, referme le fence
  // englobant prématurément (une ligne "```bash" à l'intérieur d'un fence ne
  // le ferme pas, mais la ligne "```" bare qui suit CE bloc imbriqué, si —
  // vérifié empiriquement). Restreindre la recherche aux fences aurait donc
  // silencieusement exclu `<REVIEW_MODE>` (utilisé hors de tout fence après
  // cette fermeture prématurée) de la vérification — exactement le genre de
  // trou que ce ticket est censé fermer. On scanne donc tout le corps du
  // fichier, avec deux garde-fous contre les faux positifs :
  //   - seuls les tokens d'au moins 4 caractères comptent (exclut `<ID>`,
  //     `<N>`, `<SHA>` : des placeholders de FORMAT DE RAPPORT — ce que
  //     l'agent doit écrire lui-même dans sa sortie — pas des valeurs que le
  //     skill substitue). Le tiret est autorisé DANS le token (`<TICKET-ID>`
  //     est le placeholder le plus cité du corpus — l'exclure serait précisément
  //     le genre de trou de couverture que D3 interdit) ;
  //   - `<PROMPT_TEMPLATE>` et `<YYYY-MM-DD>` sont explicitement exemptés : le
  //     premier est un renvoi structurel ("insère le template ci-dessous"), le
  //     second une illustration de format de date dans un usage CLI — ni l'un
  //     ni l'autre n'est une valeur que le skill substitue.
  const CANDIDATE_RE = /<[A-Z][A-Z0-9_-]{3,}>/g;
  const EXEMPT = new Set(['<PROMPT_TEMPLATE>', '<YYYY-MM-DD>']);

  // D3 (SKILL-04). CANDIDATE_RE ne voit que le format ALL_CAPS — aveugle aux
  // placeholders minuscules RÉELS (`<chemin_main>`, `<spec_path>`,
  // `<branche_courante>`, `<chemin>`, `<message>`, `<repo>`).
  //
  // ⚠️ Corrigé après revue (SKILL-04, dosage deep, 3 relecteurs convergents
  // sur ce point). La première version listait ces 6 tokens EN DUR, recopiés
  // du registre `SUBSTITUTIONS` de F2 — deux listes séparées, sans lien
  // testé entre elles : un nouveau placeholder minuscule ajouté à l'une
  // (pour faire passer F2) sans être ajouté à l'autre restait invisible ici,
  // rouvrant le cercle vicieux que ce test prétendait fermer. Et même
  // PARTAGER une seule liste n'aurait pas suffi : un placeholder minuscule
  // qui n'entrave pas `bash -n` (ex. `-C <workdir>` au milieu d'une ligne)
  // n'a jamais BESOIN d'être ajouté au registre de F2 pour que F2 passe,
  // donc ne serait jamais poussé vers F3 non plus.
  //
  // Détection retenue : STRUCTURELLE, pas une liste à tenir à jour. Tout
  // token `<mot_minuscule>` qui apparaît À L'INTÉRIEUR d'un bloc ```bash EST
  // par construction une valeur que quelqu'un (opérateur ou agent) doit
  // résoudre avant d'exécuter ce bloc pour de vrai — qu'il casse `bash -n`
  // ou non, qu'il soit déjà quoté ou non, listé dans le registre F2 ou non.
  // On réutilise `extractBashBlocks` (la même extraction que F2) : aucune
  // liste dupliquée, aucun couplage à deux endroits à maintenir en phase.
  //
  // ⚠️ Restreint AUX blocs ```bash (contrairement à CANDIDATE_RE ci-dessus,
  // volontairement whole-file pour la raison CommonMark documentée plus
  // haut) : un regex minuscule appliqué à TOUT le fichier ferait exploser
  // sdd-run-ticket.md en 17+ faux positifs vérifiés empiriquement le
  // 2026-07-21 — `<effort>`, `<model>`, `<review>`, `<fichier>`, `<ligne>`…
  // — du format de rapport ou de la prose narrative, jamais utilisés à
  // l'intérieur d'un bloc exécutable. La frontière "dans un bloc bash" est
  // exactement ce qui sépare "valeur que le skill substitue avant
  // exécution" de "placeholder que l'agent écrit dans SA PROPRE sortie" —
  // vérifié : aucun des faux positifs whole-file n'apparaît dans un bloc
  // ```bash de ce repo aujourd'hui.
  const LOWERCASE_IN_BASH_RE = /<[a-z][a-z0-9_-]{1,}>/g;

  function findLowercaseBashCandidates(raw) {
    const found = new Set();
    for (const block of extractBashBlocks(raw)) {
      const content = block.content.join('\n');
      const re = new RegExp(LOWERCASE_IN_BASH_RE);
      let m;
      while ((m = re.exec(content))) found.add(m[0]);
    }
    return found;
  }

  function findDeclared(raw) {
    // Les déclarations vivent dans un paragraphe (bloc séparé par une ligne
    // vide) qui contient le mot "Substitutions" — c'est la convention déjà
    // utilisée deux fois dans sdd-run-ticket.md ("Substitutions autorisées…",
    // "Substitutions à faire…"). Chaque token déclaré y est cité entre
    // backticks simples.
    //
    // ⚠️ SKILL-25 — SECOND CONSOMMATEUR de cette convention :
    // `declaredTokens()` dans `__tests__/helpers/prompt-blocks.js`, dont
    // dépend le contrôle croisé « mode d'emploi ↔ prompt d'appel » de
    // `impl-templates-coherence.test.js`. Les deux implémentations sont
    // volontairement identiques et NON fusionnées (ce fichier appartient à
    // SKILL-27, seul habilité à les réunir). Tout assouplissement fait ICI —
    // par exemple tolérer une ligne vide entre le titre `## Substitutions` et
    // sa liste — doit être répercuté LÀ-BAS : sinon le contrôle croisé compare
    // deux ensembles parsés différemment et peut passer au vert sur un
    // ensemble amputé.
    const paragraphs = raw.split(/\r?\n\r?\n/);
    const declared = new Set();
    for (const p of paragraphs) {
      if (!/substitutions/i.test(p)) continue;
      const re = /`(<[^`>]+>)`/g;
      let m;
      while ((m = re.exec(p))) declared.add(m[1]);
    }
    return declared;
  }

  function findCandidates(raw) {
    const found = new Set();
    let m;
    const re = new RegExp(CANDIDATE_RE);
    while ((m = re.exec(raw))) {
      if (!EXEMPT.has(m[0])) found.add(m[0]);
    }
    // D3 : tout placeholder minuscule réellement utilisé dans un bloc
    // ```bash est un candidat — détection structurelle, cf. commentaire de
    // findLowercaseBashCandidates ci-dessus.
    for (const token of findLowercaseBashCandidates(raw)) found.add(token);
    return found;
  }

  for (const file of listCommandFiles()) {
    describe(file, () => {
      const raw = readCommandFile(file);
      const declared = findDeclared(raw);
      const candidates = findCandidates(raw);

      // ⚠️ Mutation D3 (sens 1) : ajouter un nouveau placeholder ALL_CAPS
      // (ex. `<FOO_BAR>`) — ou un des tokens minuscules du registre partagé
      // avec F2 — dans le corps d'un commands/*.md sans le déclarer dans une
      // section "Substitutions" → ce test doit rougir. C'est exactement le
      // "second trou" de specs/skill-04.md D3 : avant SKILL-04, send.md,
      // sync.md, sync-all.md et worktree-clean.md n'avaient AUCUNE section
      // "Substitutions" et leur contrôle passait donc trivialement (vide).
      it('tout placeholder de substitution utilisé est déclaré dans une section Substitutions', () => {
        const orphans = [...candidates].filter((c) => !declared.has(c));
        expect(
          orphans,
          `${file} utilise ${JSON.stringify(orphans)} sans le déclarer dans ` +
            `un paragraphe "Substitutions".`
        ).toEqual([]);
      });

      // ⚠️ Mutation D3 (sens 2) : dans une section "Substitutions", déclarer
      // un token qui n'apparaît nulle part ailleurs dans le fichier (ex.
      // ajouter `<REVIEW_MODE>` deux fois dans la même liste au lieu d'une
      // fois dans la liste + une fois dans le corps) → ce test doit rougir.
      if (declared.size > 0) {
        it('toute substitution déclarée apparaît au moins une fois hors de sa déclaration', () => {
          const unused = [...declared].filter((token) => {
            const count = raw.split(token).length - 1;
            return count < 2; // 1 = seulement la déclaration elle-même
          });
          expect(
            unused,
            `${file} déclare ${JSON.stringify(unused)} dans "Substitutions" ` +
              `mais ce token n'apparaît nulle part ailleurs dans le fichier.`
          ).toEqual([]);
        });
      }
    });
  }
});

describe('F4 — cohérence des vocabulaires model / effort / review', () => {
  // D4 (SKILL-04). L'ancienne version comparait le skill à une CONSTANTE
  // RECOPIÉE `['none','light','deep']`, décorrélée de sa source — jamais à
  // EXEC_REVIEWS (qui vit dans lib/backlog, whereismycard, un AUTRE repo,
  // inimportable ici). Elle ne couvrait que `review`, jamais `model`
  // (EXEC_MODELS : fable|opus|sonnet|haiku) ni `effort` (EXEC_EFFORTS :
  // none|think|think-hard|ultrathink), pourtant tous deux écrits en dur dans
  // commands/backlog.md:45 sans AUCUN test, ici ou côté whereismycard.
  //
  // ⚠️ SKILL-27 : BLG-01 a changé ce vocabulaire — `EXEC_EFFORTS` vaut
  // désormais `low|medium|high|xhigh|max`, l'ancien énuméré n'étant plus qu'un
  // alias normalisé À L'ÉCRITURE par `mature`. Le paragraphe ci-dessus est
  // conservé comme état des lieux de SKILL-04 (on complète l'historique, on ne
  // le réécrit pas) ; la valeur qui pilote aujourd'hui est celle de la famille
  // L1 ci-dessous. Rappel du piège que F4 ne peut PAS voir : F4 compare
  // `commands/backlog.md` et `commands/sdd-run-ticket.md` ENTRE EUX — deux
  // documents périmés du même périmé s'accordent parfaitement, et c'est
  // exactement pourquoi la valeur officielle est déclarée EN DUR dans L1.
  //
  // Correction retenue : OPTION (a) de specs/skill-04.md D4 — couvrir les
  // trois vocabulaires sur la chaîne d'usage, portée honnête, faible risque de
  // faux positif (pas l'option (b), un contrôle de non-divergence sur toute
  // occurrence du mot dans la prose : mesuré comme risquant de hurler sur de
  // la prose légitime — à réévaluer séparément si besoin, cf. rapport du
  // ticket). Choix conservateur documenté ici faute de trancher (a) vs (b)
  // explicitement dans le frontmatter du ticket.
  //
  // Le vrai fix pour "décorrélé de sa source" : ne PLUS hardcoder de liste de
  // référence. `commands/backlog.md` (Étape 1, ligne `mature`) EST la source
  // canonique DE CE REPO — le seul endroit qui énumère les trois vocabulaires
  // en toutes lettres dans leur syntaxe CLI réelle (`--flag <a\|b\|c>`). On
  // compare tout le reste À CETTE LIGNE, jamais à une constante recopiée. Ça
  // ne prouve pas que backlog.md a raison par rapport au CLI réel (ça,
  // whereismycard le garantit de son côté, hors de portée d'un test ici) —
  // seulement que ce repo reste interne-cohérent, ce qui est TOUT ce qu'un
  // test de ce repo peut honnêtement prouver.

  const BACKLOG_FILE = 'commands/backlog.md';
  const SDD_FILE = 'commands/sdd-run-ticket.md';

  function extractEnumFromUsageLine(raw, flag) {
    // Forme générique `--<flag> <a\|b\|c>` (ex. `--model <fable\|opus\|sonnet>`
    // depuis SKILL-40 ; `--review <none\|light\|deep>` pour `review`) :
    // markdown échappe le `|` d'une table par un backslash LITTÉRAL (pas une
    // classe regex) — même convention que l'ancien test pour `--review`.
    const re = new RegExp('--' + flag + ' <([^>]+)>');
    const m = re.exec(raw);
    if (!m) return null;
    return m[1].split('\\|');
  }

  function extractEnumFromSetNotation(raw, field) {
    // Forme `` `model` ∈ {`fable`, `opus`, `sonnet`, `haiku`} `` (prose de
    // l'Étape 2 de sdd-run-ticket.md) : valeurs séparées par virgule, chacune
    // elle-même entre backticks simples.
    const re = new RegExp('`' + field + '`\\s*∈\\s*\\{([^}]+)\\}');
    const m = re.exec(raw);
    if (!m) return null;
    return m[1].split(',').map((s) => s.trim().replace(/^`|`$/g, ''));
  }

  const backlogRaw = readCommandFile(BACKLOG_FILE);
  const sddRaw = readCommandFile(SDD_FILE);

  // ⚠️ Mutation D3 : dans backlog.md, retirer entièrement le `--model <...>`
  // (ou `--effort <...>`, `--review <...>`) littéral de la ligne `mature` →
  // ce test doit rougir (plus de source canonique à lire).
  for (const flag of ['model', 'effort', 'review']) {
    it(`${BACKLOG_FILE} cite un --${flag} <...> littéral et non vide (source canonique)`, () => {
      const values = extractEnumFromUsageLine(backlogRaw, flag);
      expect(values, `${BACKLOG_FILE} ne contient aucun --${flag} <...> littéral.`).not.toBeNull();
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) {
        expect(v.trim(), `${BACKLOG_FILE} : valeur vide dans --${flag} <...>.`).not.toEqual('');
      }
    });
  }

  // ⚠️ Mutation D3 (celle vérifiée à la main par specs/skill-04.md : "muter
  // deep → heavy dans backlog.md laisse F4 vert") : remplacer `deep` par
  // `heavy` dans LA LIGNE `--review <...>` de backlog.md (celle qu'on lit
  // comme source canonique ci-dessus) SANS toucher sdd-run-ticket.md → les
  // deux valeurs divergent → ce test doit rougir. C'est le point précis que
  // l'ancien test (comparaison à une constante recopiée) ratait : muter la
  // SOURCE elle-même ne pouvait jamais faire rougir un test qui ne la lisait
  // pas.
  it(`${SDD_FILE} cite --review <...> identique à ${BACKLOG_FILE}`, () => {
    const backlogValues = extractEnumFromUsageLine(backlogRaw, 'review');
    const sddValues = extractEnumFromUsageLine(sddRaw, 'review');
    expect(sddValues, `${SDD_FILE} ne contient aucun --review <...> littéral.`).not.toBeNull();
    expect(sddValues).toEqual(backlogValues);
  });

  // SKILL-40 : depuis BLG-01, `commands/backlog.md` (ce que `mature` accepte
  // d'ÉCRIRE) et `commands/sdd-run-ticket.md` (ce que l'Étape 2 accepte de
  // LIRE) ont des énumérés `model` légitimement DIFFÉRENTS — un ticket
  // historique `model: haiku` doit rester lançable alors que `mature` refuse
  // désormais d'écrire `haiku`. L'égalité stricte d'avant SKILL-40 comparait
  // deux périmés ; ici elle compare écriture et lecture, avec un delta
  // explicitement déclaré et assumé — pas une inclusion laxiste (voir plus
  // bas pourquoi une inclusion serait refusée).
  //
  // Valeurs que l'Étape 2 accepte de LIRE sans que `mature` sache les
  // ÉCRIRE. Déclarées EN DUR ICI, pour CE test de cohérence documentaire :
  // c'est une POLITIQUE (« on ne casse pas les tickets historiques »), pas un
  // vocabulaire dérivable d'un fichier de ce repo — donc elle se déclare,
  // elle ne se déduit pas d'un fichier.
  // ⚠️ La même politique existe AUSSI côté bundle vendorisé
  // (`LEGACY_EXEC_MODELS` / `READ_TOLERANT_MODELS` dans
  // tools/backlog/backlog.mjs). Depuis SKILL-41 (famille M1.5,
  // __tests__/backlog-bundle-coherence.test.js), cette ligne-ci N'EST PLUS
  // en double non relié — mais PAS parce que M1.5.2 lirait
  // `MODELS_TOLERES_EN_LECTURE` (elle ne le fait pas, cette constante est
  // locale à CE test). La garde est TRANSITIVE : M1.5.2 confronte la MÊME
  // ligne `` `model` ∈ {...} `` de sdd-run-ticket.md (ci-dessous, `sddValues`)
  // à `EXEC_MODELS ∪ LEGACY_EXEC_MODELS` du bundle, pendant que CE test la
  // confronte à `--model` de backlog.md ∪ `MODELS_TOLERES_EN_LECTURE`. Les
  // deux comparaisons partageant leur membre de gauche (`sddValues`) et
  // `--model` == `EXEC_MODELS` (M1.5.1), un écart entre `MODELS_TOLERES_EN_LECTURE`
  // et `LEGACY_EXEC_MODELS` ferait rougir l'un des deux tests — jamais les
  // deux en silence. Ne pas faire lire `LEGACY_EXEC_MODELS` à CE test pour
  // autant (refusé par SKILL-41, § Décision) : la transitivité suffit.
  const MODELS_TOLERES_EN_LECTURE = ['haiku']; // BLG-01, cf. specs/skill-40.md

  // ⚠️ Mutation-témoin A : retirer `haiku` de la ligne `` `model` ∈ {...} ``
  // de sdd-run-ticket.md (Étape 2) → rouge. Une valeur tolérée déclarée mais
  // absente de la lecture est une incohérence, pas une simplification.
  //
  // ⚠️ Mutation-témoin B : ajouter `sonar` à cette même ligne → rouge. C'est
  // la mutation qu'une simple inclusion (`écriture ⊆ lecture`) laisserait
  // passer sans rien faire rougir — c'est elle qui prouve que la forme
  // retenue (égalité contre écriture ∪ delta déclaré) n'est pas laxiste.
  //
  // ⚠️ Mutation-témoin C : remettre `haiku` dans le `--model <...>` de
  // backlog.md → rouge (`haiku` compté deux fois : présent à l'écriture ET
  // déclaré comme toléré en lecture seule — l'union n'est plus disjointe).
  //
  // ⚠️ Mutation-témoin D : vider `MODELS_TOLERES_EN_LECTURE` → rouge, tant
  // que `haiku` reste dans la ligne de lecture. La constante n'est donc pas
  // décorative.
  it(`${SDD_FILE} déclare "model ∈ {...}" identique au --model de ${BACKLOG_FILE} ∪ MODELS_TOLERES_EN_LECTURE`, () => {
    const backlogValues = extractEnumFromUsageLine(backlogRaw, 'model');
    const sddValues = extractEnumFromSetNotation(sddRaw, 'model');
    expect(sddValues, `${SDD_FILE} ne déclare aucun "model ∈ {...}".`).not.toBeNull();

    const expected = new Set([...backlogValues, ...MODELS_TOLERES_EN_LECTURE]);
    const actual = new Set(sddValues);

    // Comparaison d'ENSEMBLES : l'ordre d'énumération n'est pas un invariant.
    // Détecte un manquant (mutation-témoin A : `haiku` retiré de la lecture)
    // et un surplus (mutation-témoin B : `sonar` ajouté à la lecture ; ou
    // mutation-témoin D : `MODELS_TOLERES_EN_LECTURE` vidée alors que `haiku`
    // reste dans la lecture — `actual` garde un élément que `expected` a
    // perdu). Elle NE détecte PAS la mutation-témoin C (`haiku` remis dans le
    // `--model` de backlog.md) : `Set` absorbe le doublon, `expected` et
    // `actual` restent identiques malgré lui — c'est le second `expect`
    // ci-dessous, sur la disjonction écriture/tolérance, qui rougit dans ce
    // cas précis.
    expect(
      [...actual].sort(),
      `${SDD_FILE} "model ∈ {...}" = ${JSON.stringify([...actual].sort())} ; ` +
        `attendu ${BACKLOG_FILE} --model ∪ MODELS_TOLERES_EN_LECTURE = ` +
        `${JSON.stringify([...expected].sort())}.`
    ).toEqual([...expected].sort());
    const dupes = backlogValues.filter((v) => MODELS_TOLERES_EN_LECTURE.includes(v));
    expect(
      dupes,
      `${BACKLOG_FILE} --model contient ${JSON.stringify(dupes)}, présent(e) ` +
        `AUSSI dans MODELS_TOLERES_EN_LECTURE (${JSON.stringify(MODELS_TOLERES_EN_LECTURE)}) : ` +
        `une valeur ne peut pas être à la fois écrite et tolérée-en-lecture-seule. ` +
        `Le correctif est de retirer ${JSON.stringify(dupes)} du --model de ` +
        `${BACKLOG_FILE} — NE PAS vider MODELS_TOLERES_EN_LECTURE ni retirer ` +
        `de valeur de ${SDD_FILE}, qui doivent rester inchangés (un ticket ` +
        `historique model: haiku doit rester lançable).`
    ).toEqual([]);
  });

  it(`${SDD_FILE} déclare "effort ∈ {...}" identique au --effort de ${BACKLOG_FILE}`, () => {
    const backlogValues = extractEnumFromUsageLine(backlogRaw, 'effort');
    const sddValues = extractEnumFromSetNotation(sddRaw, 'effort');
    expect(sddValues, `${SDD_FILE} ne déclare aucun "effort ∈ {...}".`).not.toBeNull();
    expect(sddValues).toEqual(backlogValues);
  });

  // Trouvé en revue (SKILL-04, dosage deep) : le test `--review <...>`
  // ci-dessus ne lit QUE le message d'erreur de l'Étape 1.5 (`status:
  // maturing`) — un texte informatif, pas la déclaration qui pilote
  // vraiment le dosage de la gate. La déclaration OPÉRATIVE est
  // `` `review` ∈ {...} `` à l'Étape 2, dans le MÊME format que model/effort
  // — elle n'était comparée à rien. Mutation D3 : remplacer `deep` par
  // `heavy` dans CETTE ligne (Étape 2) sans toucher backlog.md ni le message
  // de l'Étape 1.5 → devait rougir, ne rougissait pas avant ce correctif.
  it(`${SDD_FILE} déclare "review ∈ {...}" (Étape 2) identique au --review de ${BACKLOG_FILE}`, () => {
    const backlogValues = extractEnumFromUsageLine(backlogRaw, 'review');
    const sddValues = extractEnumFromSetNotation(sddRaw, 'review');
    expect(sddValues, `${SDD_FILE} ne déclare aucun "review ∈ {...}".`).not.toBeNull();
    expect(sddValues).toEqual(backlogValues);
  });
});

describe('D2 (SKILL-07) — aucun binaire invoqué sur un chemin ~/ non portable', () => {
  // PowerShell (le shell PAR DÉFAUT de cet environnement) n'expanse PAS le
  // tilde dans un ARGUMENT — `node ~/.claude/tools/backlog/backlog.mjs`
  // échoue avec MODULE_NOT_FOUND (vérifié en réel, specs/skill-07.md). Git
  // Bash l'expanse, ce qui masque le défaut à quiconque teste depuis bash.
  // Trouvé par les relecteurs de SKILL-05 : deux messages d'erreur de
  // sdd-run-ticket.md proposaient cette forme au moment précis où
  // l'utilisateur est déjà bloqué — la commande de secours échouait à son
  // tour, avec une erreur Node opaque.
  //
  // Portée du motif (instruite sur le corpus réel de commands/*.md, pas
  // décrétée) : un mot-commande (lettres/chiffres/`.`/`_`/`-`) suivi d'un ou
  // plusieurs espaces PUIS directement `~/` — c'est-à-dire un tilde-chemin
  // passé en ARGUMENT à un exécutable, dans la continuité immédiate de son
  // nom. Ça attrape `node ~/…` (les 2 lignes fautives de sdd-run-ticket.md,
  // vérifié : le contrôle est rouge sans le correctif D1) sans attraper :
  //   - la prose descriptive (« le bundle vit dans `~/.claude/tools/` »,
  //     specs/skill-07.md D1) : le tilde y est précédé d'un backtick, pas
  //     directement d'un espace après un mot — `\s+~\/` ne matche pas au
  //     travers d'une ponctuation ;
  //   - `$TOOL = ~/.claude/tools/backlog/backlog.mjs` (commands/backlog.md:4,
  //     D3 — la résolution RÉELLE de `$TOOL` y est un `node -e` qui renvoie
  //     un chemin absolu, correcte, à ne pas toucher) : `=` sépare le mot
  //     `TOOL` du tilde, `\s+~\/` exige que l'espace précède `~/`
  //     IMMÉDIATEMENT ;
  //   - `cd ~/...` (tilde NU, sans guillemets) : explicitement exclu (cf.
  //     `cmd === 'cd' && quote === ''` ci-dessous), parce que CE cas-là
  //     FONCTIONNE en PowerShell ET en Git Bash — vérifié en réel
  //     (`cd ~/.claude` change bien de répertoire dans les deux, SKILL-07 +
  //     re-vérifié SKILL-08) — cf. specs/skill-07.md D2. Aucune occurrence de
  //     `cd ~/` n'existe aujourd'hui dans commands/*.md ; l'exclusion est là
  //     pour ne pas casser ce cas-là s'il apparaît demain, pas pour
  //     contourner un faux positif déjà observé ;
  //   - `~1 Ko`, `~3-5 min` (approximations numériques) : pas de `/` après
  //     le tilde, hors du motif par construction.
  //
  // ⚠️ SKILL-08 (D1) : le motif tolère maintenant un guillemet simple OU
  // double optionnel entre le mot-commande et le tilde (`node "~/…"`,
  // `node '~/…'`) — la forme que produirait un correcteur par mimétisme en
  // gardant le tilde et en ajoutant des guillemets à `node ~/…`, alors que
  // ni bash ni PowerShell n'expansent un tilde ENTRE guillemets (spec
  // skill-08.md, "pourquoi ce n'est pas théorique"). Instruit sur le corpus
  // réel (`grep -rn '~' commands/`, 2026-07-21, 3 occurrences non-match :
  // `commands/backlog.md:4` `$TOOL = ~/…`, `sdd-run-ticket.md:373` `~1 Ko`,
  // `sdd-run-ticket.md:712` `~3-5 min`) : aucune ne se met à rougir avec le
  // groupe de capture optionnel `(["']?)`.
  //
  // ⚠️ SKILL-08 (D2) : `cd "~/…"` (tilde QUOTÉ) N'EST PLUS exclu, contrairement
  // à `cd ~/…` (tilde nu). Vérifié en réel, les deux shells :
  //   - PowerShell : `cd "~/.claude"` puis `Get-Location` → `C:\Users\gibou\.claude`
  //     (fonctionne — PowerShell ne traite pas les guillemets différemment
  //     pour l'expansion du tilde) ;
  //   - Git Bash : `cd "~/.claude"` → `bash: cd: ~/.claude: No such file or
  //     directory` (ÉCHOUE — bash n'expanse le tilde QUE non quoté, c'est la
  //     règle POSIX ; guillemeter `~` en bash le neutralise explicitement,
  //     que ce soit pour `cd` ou n'importe quel autre binaire).
  //   Asymétrie confirmée (spec D2, "ne pas supposer la symétrie") : la forme
  //   quotée casse sur UN des deux shells cible → `cd` ne peut plus être
  //   exclu inconditionnellement, l'exclusion devient conditionnelle à
  //   `quote === ''`.
  //
  // ⚠️ Mutation D3 : réintroduire `node ~/.claude/tools/backlog/backlog.mjs`
  // (ou tout autre `<binaire> ~/…`, quoté ou non) dans un commands/*.md → ce
  // test doit rougir. Rapporté dans le rapport du ticket : rouge constaté (2
  // occurrences, avant D1 SKILL-07), retour au vert après correctif, rouge de
  // nouveau sur mutation — matrice des 8 cas SKILL-08 rejouée dans le rapport.
  //
  // ⚠️ Portée délibérément limitée à SCAN_DIRS (`commands`, `skills`), PAS
  // `tools/` (trouvé en revue, SKILL-07, dosage light). `tools/backlog/README.md`
  // porte AUJOURD'HUI le même défaut (5 occurrences de `node ~/…`), mais c'est
  // un fichier GÉNÉRÉ : il est réécrit par la sous-commande `self-update` du
  // bundle à partir de `ADOPTION_README` (`lib/backlog/adoption-readme.ts`,
  // whereismycard — vérifié : `tools/backlog/README.md` lui-même le documente,
  // "node <repo>/dist-backlog/backlog.mjs self-update` le réinstalle ici (+ ce
  // README)"). Exactement le même cas que `specs/backlog.md` (D3 ci-dessus,
  // vue générée par `render-md.ts`, ne pas éditer à la main) : le corriger ICI
  // serait écrasé au prochain `self-update`, et la source du défaut (le
  // template `ADOPTION_README`) est déjà couverte par INFRA-37, LÀ-BAS. Le
  // scanner ferait rougir ce test durablement pour une cause que ce repo ne
  // peut pas corriger — exactement le genre de rouge permanent qui finit
  // désactivé. Une fois INFRA-37 livré + `self-update` relancé ici, ce README
  // se corrigera de lui-même, sans qu'aucun test de CE repo n'ait besoin de le
  // constater.
  // SKILL-08 D1 : `(["']?)` tolère un guillemet simple OU double optionnel
  // entre le mot-commande et le tilde — `node "~/…"` et `node '~/…'` matchent
  // maintenant, sans faire rougir la prose (backtick), `$TOOL = ~/…` (`=`) ou
  // les approximations numériques (pas de `/` après le tilde), cf. corpus
  // instruit dans le commentaire ci-dessus.
  const TILDE_ARG_RE = /([A-Za-z][A-Za-z0-9._-]*)[ \t]+(["']?)~\//g;

  // Extrait pour être réutilisable telle quelle par le describe "matrice" ci-
  // dessous (SKILL-08) : mêmes règles, testées directement sur des chaînes
  // littérales plutôt que seulement via le corpus vivant de commands/*.md
  // (qui ne porte aujourd'hui aucune des formes quotées — D3).
  function findTildeArgOffenders(raw) {
    const offenders = [];
    const re = new RegExp(TILDE_ARG_RE);
    let m;
    while ((m = re.exec(raw))) {
      const cmd = m[1];
      const quote = m[2];
      // `cd ~/...` (tilde NU) fonctionne en PowerShell ET en Git Bash — reste
      // exclu. `cd "~/..."` / `cd '~/...'` (tilde QUOTÉ) échoue en Git Bash
      // (SKILL-08 D2, vérifié en réel : "No such file or directory") — n'est
      // PLUS exclu, quel que soit le binaire.
      if (cmd.toLowerCase() === 'cd' && quote === '') continue;
      offenders.push(m[0]);
    }
    return offenders;
  }

  for (const file of listCommandFiles()) {
    it(`${file} n'invoque aucun binaire sur un chemin ~/ (non portable en PowerShell)`, () => {
      const raw = readCommandFile(file);
      const offenders = findTildeArgOffenders(raw);
      expect(
        offenders,
        `${file} invoque un binaire sur un chemin ~/ : ${JSON.stringify(offenders)}. ` +
          `PowerShell (shell par défaut) n'expanse pas le tilde dans un argument, et ni ` +
          `bash ni PowerShell ne l'expansent entre guillemets — utilise la forme portable ` +
          `node "$HOME/…" (cf. specs/skill-07.md D1, specs/skill-08.md D1).`
      ).toEqual([]);
    });
  }

  // --- Matrice SKILL-08 (specs/skill-08.md, section "Tests") -----------------
  //
  // Le corpus vivant de commands/*.md ne porte aujourd'hui AUCUNE des formes
  // quotées (D3 : ce ticket ferme un trou de garde, pas un défaut vivant) —
  // les tests par-fichier ci-dessus ne peuvent donc jamais exercer la branche
  // "rouge" du guillemet tant que personne n'introduit la forme dans un vrai
  // fichier. On encode ici, en dur, les 8 cas de la matrice de la spec comme
  // tests directs sur `findTildeArgOffenders` (même fonction, mêmes règles,
  // aucune logique dupliquée) — ainsi le trou fermé par D1/D2 reste prouvé
  // même le jour où le corpus ne contient plus aucun exemple positif.
  //
  // ⚠️ Mutation D3 : retirer le groupe de capture optionnel `(["']?)` du motif
  // (retour au motif SKILL-07 nu) → les cas 2 et 3 ci-dessous doivent rougir
  // (ils passeraient de "offenders non-vide" à "offenders vide"). Retirer la
  // condition `quote === ''` de l'exclusion `cd` → le cas 5 doit rougir.
  describe('SKILL-08 — matrice des 8 cas (D1/D2)', () => {
    it('1. `node ~/…` (nu) -> rouge', () => {
      expect(findTildeArgOffenders('node ~/.claude/tools/backlog/backlog.mjs list')).toEqual([
        'node ~/',
      ]);
    });

    it('2. `node "~/…"` (double guillemet) -> rouge (le trou que ce ticket ferme)', () => {
      expect(
        findTildeArgOffenders('node "~/.claude/tools/backlog/backlog.mjs" list')
      ).toEqual(['node "~/']);
    });

    it("3. `node '~/…'` (simple guillemet) -> rouge", () => {
      expect(
        findTildeArgOffenders("node '~/.claude/tools/backlog/backlog.mjs' list")
      ).toEqual(["node '~/"]);
    });

    it('4. `cd ~/…` (nu) -> vert (D2 : fonctionne en PowerShell et Git Bash)', () => {
      expect(findTildeArgOffenders('cd ~/.claude/tools')).toEqual([]);
    });

    it('5. `cd "~/…"` (quoté) -> rouge (D2 : échoue en Git Bash, vérifié en réel)', () => {
      expect(findTildeArgOffenders('cd "~/.claude/tools"')).toEqual(['cd "~/']);
    });

    it('6. prose entre backticks -> vert', () => {
      expect(
        findTildeArgOffenders('le bundle vit dans `~/.claude/tools/` (documentation)')
      ).toEqual([]);
    });

    it('7. `$TOOL = ~/…` (assignation) -> vert', () => {
      expect(
        findTildeArgOffenders('$TOOL = ~/.claude/tools/backlog/backlog.mjs')
      ).toEqual([]);
    });

    it('8. `~3-5 min` (approximation numérique) -> vert', () => {
      expect(findTildeArgOffenders('ça prend ~3-5 min')).toEqual([]);
    });
  });
});

describe('G1 (SKILL-15) — /deploy et /send gardent leur branche', () => {
  // Défaut vécu le 2026-07-23 (specs/skill-15.md) : le checkout main PARTAGÉ
  // (10-15 sessions/worktrees) laissé par une session voisine sur une branche
  // `claude/…` étrangère, un `/deploy` lancé là aurait poussé ce HEAD mi-fini
  // vers origin/main. `send.md` avait déjà sa garde de branche (Prérequis :
  // `git rev-parse --abbrev-ref HEAD` → STOP si == main) ; `deploy.md` n'avait
  // AUCUNE garde miroir. SKILL-15 pose la garde symétrique sur deploy.md
  // (STOP si != main) et la PROTÈGE ici : elle ne doit plus pouvoir disparaître
  // en silence. Helpers réutilisés : readCommandFile, extractBashBlocks.

  const GUARD_CMD = 'git rev-parse --abbrev-ref HEAD';

  // Test 1 — deploy.md porte la garde, dans un vrai bloc ```bash.
  // ⚠️ Mutation : retirer le bloc de garde de deploy.md → rouge.
  it('commands/deploy.md porte la garde de branche dans un bloc ```bash', () => {
    const blocks = extractBashBlocks(readCommandFile('commands/deploy.md'));
    const hasGuard = blocks.some((b) => b.content.join('\n').includes(GUARD_CMD));
    expect(
      hasGuard,
      `commands/deploy.md ne contient aucun bloc \`\`\`bash avec "${GUARD_CMD}" — ` +
        `la garde "ne déployer que depuis main" (specs/skill-15.md, Portée 1) est absente.`
    ).toBe(true);
  });

  // Test 2 — la garde de deploy.md vise `main` et arrête.
  // ⚠️ Mutation : retirer le mot d'arrêt de la section Prérequis → rouge.
  it('la section Prérequis de deploy.md cite la commande, "main" et un mot d’arrêt', () => {
    const section = extractSection(readCommandFile('commands/deploy.md'), /^#+\s*Prérequis\b/i);
    expect(section, 'commands/deploy.md n’a pas de section "Prérequis".').not.toBeNull();
    expect(section).toContain('rev-parse --abbrev-ref HEAD');
    expect(section.toLowerCase()).toContain('main');
    expect(
      /stop/i.test(section),
      'La section Prérequis de deploy.md ne contient aucun mot d’arrêt (stop/stopper) — ' +
        'une garde sans clause d’arrêt ne garde rien.'
    ).toBe(true);
  });

  // Test 3 — symétrie : les DEUX skills gardent leur branche.
  // ⚠️ Mutation : retirer la garde de l'un OU l'autre → rouge.
  for (const file of ['commands/send.md', 'commands/deploy.md']) {
    it(`${file} contient la garde ${GUARD_CMD} (symétrie send/deploy)`, () => {
      expect(
        readCommandFile(file),
        `${file} ne contient plus "${GUARD_CMD}" — un des deux skills a perdu sa garde de branche.`
      ).toContain(GUARD_CMD);
    });
  }

  // Test 4 — deploy.md ne prétend plus être indépendant de la branche.
  // Portée 2 de specs/skill-15.md : l'Étape 4.1 ne doit plus présenter HEAD:main
  // comme un moyen de déployer depuis n'importe quelle branche. Assertion CIBLÉE
  // (pas un `!includes('worktree')` naïf — worktree est mentionné légitimement
  // ailleurs) : la tournure « sans condition sur la branche » devient FAUSSE dès
  // que la garde existe (la garde EST une condition sur la branche).
  // ⚠️ Mutation : réintroduire cette tournure dans deploy.md → rouge.
  it('commands/deploy.md ne revendique plus être "sans condition sur la branche"', () => {
    const raw = readCommandFile('commands/deploy.md');
    expect(
      raw.includes('sans condition sur la branche'),
      'commands/deploy.md contient encore « sans condition sur la branche » — ' +
        'cette tournure contredit la garde SKILL-15 (Portée 2) et doit être reformulée.'
    ).toBe(false);
  });
});

// SKILL-73 (finding 11 de specs/skill-65.md) — mécanise, pour CHAQUE renommage
// connu de fichier de test, le contrôle qu'un seul renommage (SKILL-57)
// possédait déjà : `git grep --untracked` sur l'ancien nom, une liste
// d'exemptions motivées, jouée à chaque `npm test`. SKILL-65 (18 renommages)
// retombait sur un `grep -rn` manuel au § Vérification 4 — un contrôle
// ponctuel, sans témoin, qui a déjà laissé passer trois références pendantes
// au premier jet (retrouvées par la gate, pas par lui).
//
// Reprise (findings de la gate, seconde lecture) : cette batterie a été
// corrigée sur plusieurs points distincts après une première version
// défectueuse — chacun est documenté au fil du code, à l'endroit qu'il
// corrige (findings 1 à 11 de la reprise SKILL-73).
//
// D2 (specs/skill-73.md, mise à jour SKILL-79 puis SKILL-88) : ce groupe
// ÉTENDAIT le patron M2 avec un seul consommateur — plus vrai depuis SKILL-79
// (specs/skill-79.md § Portée, point 1) : `estCitationSpecCouverte()` et ses
// fonctions internes ont été promues dans `./helpers/legacy-path-policy.js`,
// dès que `legacy-path-exemption-coherence.test.js` en est devenu le
// DEUXIÈME appelant réel (la convention du dépôt,
// `__tests__/helpers/prompt-blocks.js` en-tête D3, ne promeut un mécanisme
// recopié qu'à ce moment-là). Il y en avait un TROISIÈME, `legacy-path-bandeau-coherence.test.js`
// (SKILL-72), qui portait sa propre copie indépendante de
// `decouperEnSections`/`bandeauxDe`/`porteUnRenvoi` — SKILL-88 l'a converti
// en appelant du même helper, fermant la divergence entre les deux copies.
//
// D1 (dépendance SKILL-72, corrigée par SKILL-79) : la politique d'exemption
// n'est PAS réinventée ici. `estCitationSpecCouverte()` (importée du helper
// ci-dessus) l'applique : chaque SECTION d'une spec qui cite l'ancien chemin
// doit porter un bandeau qui le nomme, ou un renvoi vers la section qui le
// porte — PAS l'exemption en bloc du fichier entier (finding 3, reprise
// SKILL-73 : la première version ne retenait que le `status` de la spec, un
// lecteur tombait sur un chemin mort sans aucune explication dans plusieurs
// specs shippées). Arbitrage SKILL-79 (specs/skill-79.md § Correction
// attendue) : cette condition — bandeau ou renvoi — est désormais la SEULE.
// Le `status` du frontmatter n'est plus lu : une spec `maturing`/`todo`/`wip`
// qui doit citer un ancien chemin (le sujet même d'un ticket de dette) est
// couverte dans les mêmes conditions qu'une spec `merged`/`shipped`. Ne pas
// réécrire un chemin cité dans une spec LIVRÉE reste, séparément, une règle
// éditoriale (`prompts/impl-same.md`/`prompts/impl-cross.md`, § Discipline
// SDD point 1) — elle n'est plus la condition d'exemption de ce contrôle.
//
// D3 (specs/skill-73.md) : « la source des renommages est une donnée, pas de
// la prose ». RENAMES ci-dessous EST cette donnée, et couvre les 22
// renommages de `__tests__/*.test.js` que porte l'HISTOIRE GIT du dépôt — pas
// un sous-ensemble arbitraire (finding 1, reprise : la première version n'en
// déclarait que 19, en oubliant SKILL-10 et deux renommages de SKILL-64/66,
// avec un site réellement pendant parmi les oubliés). Chaque entrée porte le
// couple `{ old, new }` (finding 4) et ses exemptions LOCALES, chacune avec un
// motif écrit et un numéro de ligne — une exemption sans motif est un rejet
// silencieux déguisé (même exigence que `specs/skill-65.md` D2 pour sa propre
// liste d'exceptions).
describe('M2 (SKILL-57/SKILL-65/SKILL-73) — aucune référence pendante à un ancien nom de fichier de test renommé', () => {
  // Ce fichier-ci contient, dans RENAMES, les anciens noms en toutes lettres
  // pour les rechercher : il s'auto-cite systématiquement et s'exempte donc
  // lui-même, pour LES 22 entrées, une fois pour toutes.
  const SELF = '__tests__/commands-shape-coherence.test.js';

  const RENAMES = [
    {
      old: 'skill-46-sha-final-timing.test.js',
      new: 'sha-final-timing.test.js',
      // Radical SANS extension (finding 7, reprise) : c'est la recherche
      // D'ORIGINE de M2/SKILL-57, et la seule qui égale le `grep -rn` manuel
      // du § Vérification 4 de specs/skill-65.md sur CE renommage précis
      // (mesuré : 5 sites en radical contre 4 en `<nom>.test.js` — l'écart
      // portait sur specs/skill-57.md:65, qui cite le radical nu). Les 21
      // AUTRES entrées ci-dessous cherchent le nom `.test.js` COMPLET,
      // délibérément plus étroit : un radical nu (`session-boundary`,
      // `effort-mapping`…) est aussi un mot du LANGAGE COURANT de ce corpus
      // (discussions de convention de nommage, § Décision de specs/skill-57.md
      // et specs/skill-65.md), et le balayer en entier transformerait des
      // dizaines de citations de sujet en dette — l'écueil que D3
      // (specs/skill-73.md) nomme explicitement (« un balayage trop large
      // transformerait chaque citation historique en dette »). Ce
      // rétrécissement-LÀ est mesuré et documenté (§ Vérification 3 : chaque
      // entrée `.test.js` a été comparée à son `grep -rn` scopé
      // `specs/,commands/,prompts/,__tests__/` — toutes égales ou
      // supérieures), pas laissé sans justification.
      bareSearch: true,
      exemptions: [],
    },
    {
      // ⚠️ Chaînage (finding 9, reprise) : ce nom est un SUFFIXE littéral de
      // l'entrée précédente (`skill-46-sha-final-timing.test.js`). Toute ligne
      // qui cite le nom LONG contient donc aussi ce nom COURT — sans garde,
      // chaque site serait compté (et à exempter) deux fois. La boucle
      // ci-dessous exclut automatiquement, pour CHAQUE entrée, les lignes où
      // un AUTRE `old` du tableau, plus long et contenant celui-ci, est
      // littéralement présent : ces lignes sont la responsabilité de l'entrée
      // longue, jamais de la courte.
      old: 'sha-final-timing.test.js',
      new: 'sha-final-timing-coherence.test.js',
      exemptions: [],
    },
    {
      old: 'aggregator-wiring.test.js',
      new: 'aggregator-wiring-coherence.test.js',
      exemptions: [
        {
          file: '.gitattributes',
          line: 35,
          motif: "commentaire narrant l'historique des ancres multi-lignes (SKILL-54) — pas un chemin actif.",
        },
      ],
    },
    { old: 'backlog-skill-msys.test.js', new: 'backlog-skill-msys-coherence.test.js', exemptions: [] },
    { old: 'effort-mapping.test.js', new: 'effort-mapping-coherence.test.js', exemptions: [] },
    {
      old: 'escalation-wiring.test.js',
      new: 'escalation-wiring-coherence.test.js',
      exemptions: [],
    },
    { old: 'skill-49-mode-criterion.test.js', new: 'mode-criterion-coherence.test.js', exemptions: [] },
    { old: 'review-log-baseline.test.js', new: 'review-log-baseline-coherence.test.js', exemptions: [] },
    { old: 'review-log-wiring.test.js', new: 'review-log-wiring-coherence.test.js', exemptions: [] },
    { old: 'review-log-write.test.js', new: 'review-log-write-coherence.test.js', exemptions: [] },
    { old: 'reviewer-report-drop.test.js', new: 'reviewer-report-drop-coherence.test.js', exemptions: [] },
    { old: 'reviewer-spawn-shape.test.js', new: 'reviewer-spawn-shape-coherence.test.js', exemptions: [] },
    { old: 'sdd-preflight.test.js', new: 'sdd-preflight-coherence.test.js', exemptions: [] },
    { old: 'sdd-push.test.js', new: 'sdd-push-coherence.test.js', exemptions: [] },
    { old: 'sdd-push-wiring.test.js', new: 'sdd-push-wiring-coherence.test.js', exemptions: [] },
    { old: 'sdd-reviewer-wiring.test.js', new: 'sdd-reviewer-wiring-coherence.test.js', exemptions: [] },
    {
      old: 'send-empty-selection.test.js',
      new: 'send-empty-selection-coherence.test.js',
      exemptions: [
        {
          file: '__tests__/legacy-path-bandeau-coherence.test.js',
          line: 124,
          motif: "commentaire du mécanisme SKILL-72 lui-même, qui cite le nom pour l'expliquer (message d'assertion).",
        },
        {
          file: '__tests__/test-selection-coherence.test.js',
          line: 307,
          motif: 'commentaire narrant le renommage dans sa mutation-témoin T5 (SKILL-65).',
        },
      ],
    },
    { old: 'session-boundary.test.js', new: 'session-boundary-coherence.test.js', exemptions: [] },
    {
      old: 'skill-size-ceiling.test.js',
      new: 'skill-size-ceiling-coherence.test.js',
      exemptions: [
        {
          file: '.gitattributes',
          line: 36,
          motif: "commentaire narrant le rôle du fichier (mesure PLAFOND_STEPS) — pas un chemin actif.",
        },
        {
          file: '__tests__/legacy-path-bandeau-coherence.test.js',
          line: 125,
          motif: "commentaire du mécanisme SKILL-72 lui-même (message d'assertion).",
        },
      ],
    },
    {
      // Renommage SKILL-10 (finding 1, reprise : absent de la première
      // version de cette table — un site pendant réel dormait derrière cette
      // omission, cf. commentaire ci-dessous).
      old: 'commands-shape.test.js',
      new: 'commands-shape-coherence.test.js',
      exemptions: [
        {
          file: '__tests__/legacy-path-bandeau-coherence.test.js',
          line: 54,
          motif: "commentaire narrant le renommage (précédent SKILL-10), pour l'expliquer.",
        },
      ],
    },
    {
      // Renommage SKILL-66 (finding 1, reprise). Aucun site pendant mesuré.
      old: 'desuivi-only-exception.test.js',
      new: 'desuivi-only-exception-coherence.test.js',
      exemptions: [],
    },
    {
      // Renommage SKILL-64 (finding 1, reprise). Aucun site pendant mesuré.
      old: 'escalation-tag-position.test.js',
      new: 'escalation-tag-position-coherence.test.js',
      exemptions: [],
    },
  ];

  const OLDS = new Set(RENAMES.map((r) => r.old));

  // Test le plus important du lot (specs/skill-73.md § Tests, point 3) : un
  // renommage réel qui n'est PAS déclaré dans RENAMES doit être visible.
  // Finding 2 (reprise) : la première version ne verrouillait qu'un COMPTE
  // (`RENAMES.length === 19`), qui ne peut détecter que le RETRAIT d'une
  // ligne déjà écrite — jamais l'ABSENCE d'une ligne jamais écrite, alors que
  // c'est exactement l'inverse qui s'est produit (finding 1 : trois
  // renommages réels, dont un avec un site pendant, manquaient). Ce test-ci
  // dérive la liste de référence de L'HISTOIRE GIT elle-même — indépendante de
  // RENAMES — et exige que chaque renommage historique de `__tests__/*.test.js`
  // y ait une entrée.
  // *Mutation-témoin :* un futur `git mv __tests__/x.test.js
  // __tests__/x-coherence.test.js` sans ajouter de ligne à RENAMES → rouge,
  // nommant le renommage manquant.
  function renommagesHistoriquesDeTests() {
    const result = spawnSync(
      'git',
      ['log', '--diff-filter=R', '--find-renames=40%', '--name-status', '--follow', '--', '__tests__/*'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    expect(
      result.error,
      `git log n'a pas pu s'exécuter (${result.error && result.error.message}) — ce test n'a RIEN vérifié.`
    ).toBeUndefined();
    expect(
      result.status,
      `git log a rendu un code de sortie inattendu (${result.status}, stderr: ${result.stderr}) — ` +
        `ce test n'a RIEN vérifié.`
    ).toBe(0);
    const anciens = new Set();
    for (const ligne of (result.stdout || '').split(/\r?\n/)) {
      const m = ligne.match(/^R\d+\t(\S+)\t(\S+)$/);
      if (!m) continue;
      const [, oldPath] = m;
      if (/^__tests__\/[^/]+\.test\.js$/.test(oldPath)) anciens.add(path.basename(oldPath));
    }
    return anciens;
  }

  it('RENAMES couvre tous les renommages de __tests__/*.test.js connus de git (aucune omission silencieuse)', () => {
    const anciens = renommagesHistoriquesDeTests();
    const manquants = [...anciens].filter((n) => !OLDS.has(n));
    expect(
      manquants,
      `Renommage(s) de __tests__/*.test.js absent(s) de RENAMES : ${manquants.join(', ')}.`
    ).toEqual([]);
  });

  // Politique SKILL-72 (D1), corrigée par SKILL-79 — finding 3, reprise
  // SKILL-73 : une citation n'est exemptée QUE si la SECTION qui la porte a
  // un bandeau qui la nomme, ou un renvoi vers la section qui le porte. Une
  // spec qui cite un ancien chemin SANS l'un ni l'autre reste une référence
  // pendante — la politique ne dispense jamais de ce second geste, elle en
  // fait la condition de l'exemption. `estCitationSpecCouverte()` est
  // importée de `./helpers/legacy-path-policy.js` (D2 ci-dessus) : plus de
  // définition locale ici.

  // ⚠️ `--untracked` : le seul moment où une référence pendante est
  // INTRODUITE est précisément celui où le fichier qui la porte n'est pas
  // encore suivi (créé avant `git add`) — un `git grep` sans cette option ne
  // le verrait pas (finding 7, gate SKILL-57).
  // `-F` (chaîne fixe, pas une regex) : plusieurs anciens noms contiennent un
  // `.` littéral (`sdd-push.test.js`…) qui matcherait n'importe quel
  // caractère en mode regex — imprécision que `-F` élimine.
  //
  // ⚠️ `status`/`error` contrôlés explicitement, même garde que `bashProbe`
  // ci-dessus (F2) : un `git grep` qui échoue (pas de dépôt `.git`, binaire
  // `git` absent du PATH) rend `stdout` vide — indistinguable, sans ce
  // contrôle, d'une recherche qui a RÉELLEMENT tourné et n'a rien trouvé.
  // `git grep -n` sort en 1 quand la recherche a tourné sans trouver de match
  // (résultat NORMAL, pas une erreur) ; tout autre code ou une erreur de spawn
  // signale que rien n'a été vérifié (finding 1, gate SKILL-57).
  it.each(RENAMES)(
    '$old → $new : renommage complet sur le disque, aucune référence pendante hors exemptions déclarées',
    ({ old, new: nouveau, bareSearch, exemptions }) => {
      // Motif non vide (D3/specs/skill-65.md D2) — mutation-témoin : vider un
      // `motif` (`motif: ''`) → rouge, ICI (finding 11, reprise : cette boucle
      // n'avait pas sa propre mutation-témoin documentée).
      for (const e of exemptions) {
        expect(
          e.motif && e.motif.trim().length > 0,
          `${old} : l'exemption "${e.file}:${e.line}" n'a pas de motif écrit.`
        ).toBe(true);
      }

      // Renommage complet (finding 4, reprise) : l'ancien nom n'existe plus,
      // et le nom COURANT (celui qui n'est lui-même relancé par aucune AUTRE
      // entrée — un maillon INTERMÉDIAIRE de chaîne n'a pas à survivre sur le
      // disque) existe encore.
      expect(
        fs.existsSync(path.join(REPO_ROOT, '__tests__', old)),
        `__tests__/${old} existe encore sous son ancien nom.`
      ).toBe(false);
      if (!OLDS.has(nouveau)) {
        expect(
          fs.existsSync(path.join(REPO_ROOT, '__tests__', nouveau)),
          `__tests__/${nouveau} (cible de ${old}) est absent.`
        ).toBe(true);
      }

      const terme = bareSearch ? old.replace(/\.test\.js$/, '') : old;
      const result = spawnSync('git', ['grep', '--untracked', '-n', '-F', '--', terme], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      expect(
        result.error,
        `git grep n'a pas pu s'exécuter (${result.error && result.error.message}) — ce test n'a RIEN vérifié.`
      ).toBeUndefined();
      expect(
        [0, 1].includes(result.status),
        `git grep a rendu un code de sortie inattendu (${result.status}, stderr: ${result.stderr}) — ` +
          `ce test n'a RIEN vérifié (0 = matches trouvés, 1 = aucun match, tout autre code = échec réel).`
      ).toBe(true);

      const toutesLesLignes = (result.stdout || '').split(/\r?\n/).filter((l) => l.trim().length > 0);

      // Une exemption devient FAUSSE (fichier renommé, ligne déplacée) ou
      // INUTILE (le site a été corrigé) sans jamais périmer d'elle-même
      // (finding 6, reprise) : chaque exemption déclarée doit correspondre à
      // une occurrence RÉELLE et ACTUELLE, sans quoi elle est un blanc-seing
      // permanent. *Mutation-témoin :* corriger le commentaire de
      // `.gitattributes` ligne 35 (SKILL-54, exemption de l'entrée
      // `aggregator-wiring.test.js`) sans retirer son exemption de la table →
      // rouge, ICI.
      for (const e of exemptions) {
        const consommee = toutesLesLignes.some((l) => l.startsWith(`${e.file}:${e.line}:`));
        expect(
          consommee,
          `${old} : l'exemption "${e.file}:${e.line}" ne correspond plus à aucune occurrence — ` +
            `retire-la (le site a été corrigé ou déplacé) ou corrige la ligne déclarée.`
        ).toBe(true);
      }

      const lignesPendantes = toutesLesLignes.filter((ligneBrute) => {
        const m = ligneBrute.match(/^([^:]+):(\d+):(.*)$/);
        if (!m) return true; // format inattendu : ne JAMAIS l'avaler en silence
        const [, file, ligneNo, contenu] = m;
        if (file === SELF) return false;
        // Chaînage (finding 9) : cette ligne est la responsabilité d'un AUTRE
        // `old`, plus long et contenant celui-ci, littéralement présent ici.
        const couvertParPlusLong = [...OLDS].some(
          (autre) => autre !== old && autre.length > old.length && autre.includes(old) && contenu.includes(autre)
        );
        if (couvertParPlusLong) return false;
        if (exemptions.some((e) => e.file === file && String(e.line) === ligneNo)) return false;
        if (estCitationSpecCouverte(REPO_ROOT, file, ligneNo, old)) return false;
        // Finding 5 (reprise) : `backlog.json` et `specs/backlog.md` sont des
        // artefacts INTÉGRALEMENT générés à partir du frontmatter/titre des
        // `specs/*.md` (CLAUDE.md global, § Backlog) — jamais une référence
        // NOUVELLE, seulement le miroir de leur spec source. Les exempter
        // structurellement évite de compter deux fois la même citation
        // (source + dérivé) et, concrètement, d'obliger un futur ticket
        // (dette y compris) à obfusquer son propre titre pour ne pas rougir
        // ce contrôle — c'était le seul contournement disponible avant ce
        // correctif (finding 5, scénario réalisé sur cette branche : la
        // reformulation forcée du titre de SKILL-79, depuis retirée, cf.
        // rapport final § finding 8).
        if (file === 'backlog.json' || file === 'specs/backlog.md') return false;
        return true;
      });

      expect(
        lignesPendantes,
        `Référence(s) pendante(s) à l'ancien nom "${old}" (hors exemptions déclarées et hors ` +
          `politique SKILL-72 — bandeau/renvoi local) :\n${lignesPendantes.join('\n')}`
      ).toEqual([]);
    }
  );
});


describe('M3 (SKILL-57) — bandeau de supersession sur specs/skill-28.md § Décision 3', () => {
  const FILE = 'specs/skill-28.md';

  function decision3() {
    const raw = readCommandFile(FILE);
    const section = extractSection(
      raw,
      /^### 3\. La condition de retrait — vérifiable, pas déclarative/
    );
    expect(section, `${FILE} : section "§ Décision 3" introuvable.`).not.toBeNull();
    return section;
  }

  // ⚠️ Mutation-témoin : retirer le bandeau → rougit. Motif GÉNÉRIQUE
  // (`SKILL-\d+`), jamais `SKILL-53` figé (leçon des findings 3/4 de la gate
  // de SKILL-28, re-prise en défaut par le finding 3 de celle de SKILL-53).
  it(`${FILE} § Décision 3 porte un bandeau de supersession nommant un ticket SKILL-\\d+`, () => {
    const section = decision3();
    const firstBlock = section.trim().split(/\r?\n\r?\n/)[0] || '';
    expect(
      /Supersédé par SKILL-\d+/.test(firstBlock),
      `${FILE} : § Décision 3 ne porte pas de bandeau « Supersédé par SKILL-NN » ` +
        `en tête de section.`
    ).toBe(true);
  });
});

describe('I1 (SKILL-18) — /reflect mine les candidats et route les propositions', () => {
  // Test de FORME du skill commands/reflect.md (specs/skill-18.md § Tests).
  // But : les 4 invariants du mineur (lecture des candidats · garde-fou
  // pattern≥2/artefact-n=1 · table de routage vers les 4 domiciles · propose
  // sans graver) ne doivent pas DISPARAÎTRE en silence. Helpers réutilisés :
  // readCommandFile (readFileSync lève ENOENT si le fichier est absent → rouge
  // tant que le skill n'existe pas, ce qui EST l'état TDD attendu). Chaque cas
  // documente la mutation qui doit le faire rougir (cf. specs/skill-18.md,
  // § Tests). Tournures ROBUSTES : co-présence de familles de marqueurs dans un
  // même paragraphe (granularité déjà utilisée par F3), jamais un `includes`
  // naïf sur un mot courant.
  //
  // ⚠️ Revue SKILL-18 (findings 1-3) : la 1ʳᵉ version cherchait ses marqueurs en
  // whole-file (ou en co-présence de paragraphe libre). Trois faux-négatifs
  // vérifiés : l'intro (`candidate` + « mineur », où `mine` matchait « mineur »),
  // le bloc récap (qui réunit « ≥ 2 » et « n=1 » dans son template d'affichage) et
  // les mentions éparses `SKILL-1x`/`ticket`/`CLAUDE.md` gardaient les tests verts
  // APRÈS suppression de l'étape concernée. Correction : on ANCRE chaque assertion
  // à la SECTION `## Étape N` qui porte réellement le comportement (même stratégie
  // que l'`extractSection` de G1) — la présence ailleurs ne peut plus masquer la
  // disparition de l'étape.
  const FILE = 'commands/reflect.md';

  // Test 1 — l'étape « Lire » (Étape 1) charge les candidats (l'entrée de la
  // mine). Ancré à la SECTION `## Étape 1`, pas au whole-file : l'intro cite
  // aussi `candidate` (finding 1), mais elle n'est pas l'étape de lecture.
  // ⚠️ Mutation : supprimer l'Étape 1 (ou en retirer la lecture des mémoires
  // `type: candidate`) → la section disparaît ou perd la co-présence → rouge.
  it(`${FILE} charge les candidats dans son étape « Lire » (Étape 1)`, () => {
    const raw = readCommandFile(FILE);
    const step1 = extractSection(raw, /^##\s*Étape 1\b/);
    expect(
      step1,
      `${FILE} n'a pas de section « ## Étape 1 » — l'étape « Lire » a disparu ` +
        `(specs/skill-18.md, Étape 1).`
    ).not.toBeNull();
    // Co-présence, DANS cette section, du type `candidate` ET d'un verbe de
    // lecture (`mine`/« mineur » écarté du registre : il désigne l'outil, pas
    // l'acte de lire — c'est lui qui gardait le finding 1 vert).
    expect(
      /candidate/.test(step1) &&
        /(charger|lire|lit|frontmatter|scanne)/i.test(step1),
      `${FILE} : l'Étape 1 ne relie plus « candidate » à un verbe de lecture ` +
        `(charger/lire/frontmatter/scanner) — l'entrée de la mine a disparu ` +
        `(specs/skill-18.md, Étape 1).`
    ).toBe(true);
  });

  // Test 2 — le garde-fou pattern (≥2) vs artefact (n=1). Ancré à la SECTION
  // `## Étape 3`, pas au whole-file : le bloc récap réunit lui-même « ≥ 2 » et
  // « n=1 » dans son template d'affichage (finding 2), ce qui gardait le test
  // vert même sans garde-fou. L'en-tête de l'Étape 3 (qui contient « artefact
  // n=1 ») est exclu par extractSection → seul le CORPS de l'étape peut
  // satisfaire l'assertion.
  // ⚠️ Mutation : retirer de l'Étape 3 la distinction récurrent-≥2 / artefact-n=1
  // (sans toucher au récap) → rouge.
  it(`${FILE} porte le garde-fou pattern (≥ 2) vs artefact (n=1) en Étape 3`, () => {
    const raw = readCommandFile(FILE);
    const step3 = extractSection(raw, /^##\s*Étape 3\b/);
    expect(
      step3,
      `${FILE} n'a pas de section « ## Étape 3 » — le garde-fou pattern/n=1 a ` +
        `disparu (specs/skill-18.md, Étape 3).`
    ).not.toBeNull();
    expect(
      /(≥\s*2|>=\s*2)/.test(step3) && /(n\s*=\s*1|artefact)/i.test(step3),
      `${FILE} : le corps de l'Étape 3 ne réunit plus un seuil « ≥ 2 » et ` +
        `« n=1 »/« artefact » — le garde-fou central a disparu ` +
        `(specs/skill-18.md, Étape 3).`
    ).toBe(true);
  });

  // Test 3 — la table de routage vers les 4 domiciles. Ancré à la SECTION
  // `## Étape 4`, pas au whole-file : router/routage, `SKILL-1x`, `ticket` et
  // `CLAUDE.md` apparaissent tous AILLEURS dans le fichier (finding 3), donc
  // remplacer l'Étape 4 par « propose une amélioration » gardait le test vert.
  // Les 4 domiciles doivent apparaître DANS le corps de l'étape de routage.
  // ⚠️ Mutation : réduire l'Étape 4 à « propose une amélioration » (retirer la
  // table / les domiciles) → rouge.
  it(`${FILE} porte la table de routage vers les 4 domiciles en Étape 4`, () => {
    const raw = readCommandFile(FILE);
    const step4 = extractSection(raw, /^##\s*Étape 4\b/);
    expect(
      step4,
      `${FILE} n'a pas de section « ## Étape 4 » — la table de routage a disparu ` +
        `(specs/skill-18.md, Étape 4).`
    ).not.toBeNull();
    expect(
      /rout(er|age)/i.test(step4),
      `${FILE} : le corps de l'Étape 4 ne mentionne ni « router » ni « routage » — ` +
        `le cœur du skill est un ROUTEUR, pas un « propose une amélioration » non ` +
        `borné (specs/skill-18.md, Étape 4).`
    ).toBe(true);
    const homes = {
      'mémoire durable': /m[ée]moire/i,
      'ticket SKILL-NN': /SKILL-NN|SKILL-\d/,
      'backlog / ticket projet': /backlog|ticket/i,
      'diff CLAUDE.md': /CLAUDE\.md/,
    };
    const missing = Object.entries(homes)
      .filter(([, re]) => !re.test(step4))
      .map(([label]) => label);
    expect(
      missing,
      `${FILE} : domicile(s) de routage absent(s) du corps de l'Étape 4 : ` +
        `${JSON.stringify(missing)}. Les 4 domiciles (mémoire durable · SKILL-NN · ` +
        `ticket projet · CLAUDE.md) doivent tous apparaître dans la table de ` +
        `routage (specs/skill-18.md, Étape 4).`
    ).toEqual([]);
  });

  // Test 4 — propose, ne grave pas : l'interdiction de hot-patch est écrite.
  // Co-présence, dans un même paragraphe, de propose/proposition ET d'une
  // NÉGATION de modification directe (`ne modifie pas` / `pas de hot-patch` /
  // `jamais de hot-patch`). On évite le `jamais` nu (il apparaît légitimement
  // ailleurs — « jamais automatique »).
  // ⚠️ Mutation : faire écrire directement le skill/CLAUDE.md (remplacer la
  // proposition par un hot-patch) → rouge.
  it(`${FILE} propose sans graver (interdiction de hot-patch)`, () => {
    const raw = readCommandFile(FILE);
    const paragraphs = raw.split(/\r?\n\r?\n/);
    const hasProposeNotPatch = paragraphs.some(
      (p) =>
        /propos(e|ition|er)/i.test(p) &&
        /(ne modifie pas|pas de hot-patch|jamais de hot-patch)/i.test(p)
    );
    expect(
      hasProposeNotPatch,
      `${FILE} : aucun paragraphe ne réunit « propose »/« proposition » et une ` +
        `négation de modification directe (« ne modifie pas » / « pas de ` +
        `hot-patch ») — l'interdiction de hot-patch (specs/skill-18.md, Étape 5) ` +
        `a disparu.`
    ).toBe(true);
  });
});

describe('J1 (SKILL-19) — /improve-skill rode un skill jeune', () => {
  // Test de FORME du skill commands/improve-skill.md (specs/skill-19.md § Tests).
  // But : les 4 invariants ne doivent pas DISPARAÎTRE en silence —
  //   1. lit le fichier skill cible passé en <name> (Arguments + Étape 1) ;
  //   2. améliorateur VIERGE nourri des DEUX entrées, rapport de run + friction
  //      atteignable (Étape 2 — les deux angles morts complémentaires) ;
  //   3. rubric pattern / artefact n=1 (Étape 2) ;
  //   4. propose un ticket SKILL-NN, jamais de hot-patch (Étape 3).
  //
  // ⚠️ Leçon des tickets SKILL-16/17/18 (findings répétés en revue) : un test de
  // forme qui cherche une CO-PRÉSENCE de marqueurs en WHOLE-FILE reste VERT même
  // après suppression de la structure qu'il prétend protéger — l'intro, le récap
  // ou une autre section satisfont la co-présence. On ANCRE donc CHAQUE assertion
  // à SA section précise (`## Arguments` / `## Étape N`) via extractSection
  // (importé de `helpers/prompt-blocks.js`, partagé avec G1/SKILL-15 &
  // I1/SKILL-18 — SKILL-43), jamais en whole-file. La
  // présence d'un marqueur AILLEURS ne peut plus masquer la disparition de la
  // section qui le porte. Chaque cas documente la mutation qui doit le faire
  // rougir — ces mutations ont été rejouées à la main (rapport du ticket) :
  // chacune fait bien passer son test au rouge.
  const FILE = 'commands/improve-skill.md';

  // Comme extractSection mais s'arrête au prochain titre `##` OU `###` — pour
  // ISOLER une SOUS-section `### …` (ex. le rubric) sans absorber la sous-section
  // suivante (ex. le template figé qui la suit).
  function extractSubsection(raw, headingRe) {
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
      if (/^#{2,3}\s/.test(lines[j])) break;
      out.push(lines[j]);
    }
    return out.join('\n');
  }

  // Retire les blocs délimités par QUATRE backticks (le TEMPLATE figé illustratif
  // du prompt améliorateur). Ce template ré-échoit TOUS les marqueurs (rapport de
  // run, friction, pattern, artefact n=1) : le laisser dans la zone testée rendait
  // les tests 2 & 3 tautologiques (findings 1 & 2 de revue — la mutation de spec
  // ne rougissait pas). On l'exclut avant d'assertion.
  function stripFrozenTemplate(text) {
    const lines = text.split(/\r?\n/);
    const out = [];
    let inFence = false;
    for (const line of lines) {
      if (line.trim() === '````') {
        inFence = !inFence;
        continue;
      }
      if (!inFence) out.push(line);
    }
    return out.join('\n');
  }

  // Test 1 — le skill prend un skill en argument <name> ET lit le fichier skill
  // cible. Deux ancrages distincts : `## Arguments` porte l'argument + l'usage ;
  // `## Étape 1` (Rassembler les entrées) LIT le fichier cible
  // `commands/<name>.md`. On sépare les deux volontairement : `<name>` apparaît
  // partout en prose, mais la LECTURE du fichier cible est un geste précis de
  // l'Étape 1 — la seule entrée sans laquelle l'améliorateur n'a pas de matière.
  // ⚠️ Mutation : retirer de l'Étape 1 la lecture du fichier `commands/<name>.md`
  // (l'entrée (c)) → l'Étape 1 perd la co-présence → rouge (vérifié à la main).
  it(`${FILE} prend <name> en argument (Arguments) et lit le fichier skill cible (Étape 1)`, () => {
    const raw = readCommandFile(FILE);

    const args = extractSection(raw, /^##\s*Arguments\b/);
    expect(args, `${FILE} n'a pas de section « ## Arguments ».`).not.toBeNull();
    expect(
      /<name>/.test(args) && /\/improve-skill/.test(args),
      `${FILE} : la section Arguments ne relie plus l'argument « <name> » à ` +
        `l'usage « /improve-skill » (specs/skill-19.md, Portée 2).`
    ).toBe(true);

    const step1 = extractSection(raw, /^##\s*Étape 1\b/);
    expect(
      step1,
      `${FILE} n'a pas de section « ## Étape 1 » — l'étape « Rassembler les ` +
        `entrées » a disparu (specs/skill-19.md, Étape 1).`
    ).not.toBeNull();
    // Co-présence, DANS l'Étape 1, du fichier cible `commands/<name>.md` ET d'un
    // verbe de lecture. Le chemin littéral `commands/<name>.md` est l'ancre : il
    // ne survit pas à la suppression de l'entrée (c), contrairement à un simple
    // « fichier skill » qui subsisterait en prose.
    expect(
      /commands\/<name>\.md/.test(step1) &&
        /(lire|lit|lis|charger|charge|actuel)/i.test(step1),
      `${FILE} : l'Étape 1 ne lit plus le fichier skill cible ` +
        `« commands/<name>.md » — l'entrée (c) « fichier skill actuel » a disparu ` +
        `(specs/skill-19.md, Étape 1).`
    ).toBe(true);
  });

  // Test 2 — améliorateur VIERGE nourri des DEUX entrées. Ancré à `## Étape 2`
  // (Améliorateur vierge). Deux invariants :
  //   - l'agent neuf/vierge, réellement SPAWNÉ (`Agent(`) — pas une simple
  //     mention en prose ;
  //   - les DEUX entrées réellement PASSÉES à l'améliorateur.
  //
  // ⚠️ Finding 1 de revue (corrigé ici) : la 1ʳᵉ version cherchait les MOTS
  // « friction atteignable »/« transcript » dans toute l'Étape 2 — or ces mots
  // apparaissent aussi (1) dans la prose conceptuelle (« l'agent vierge voit les
  // bricolages via la friction atteignable ») qui n'est PAS un passage d'entrée,
  // et (2) dans le TEMPLATE figé illustratif. Retirer l'entrée 2 de la phrase de
  // passage « L'améliorateur reçoit : … » ET du template laissait donc le test
  // VERT (la prose conceptuelle survivait). Correctif : on ancre aux PLACEHOLDERS
  // de substitution `<RAPPORT_RUN>` / `<FRICTION_ATTEIGNABLE>` — le mécanisme
  // d'injection réel, absent de la prose conceptuelle (qui emploie les mots, pas
  // les tokens) — ET on exclut le template figé (stripFrozenTemplate). Après
  // strip, chaque placeholder ne subsiste QUE dans la phrase de passage effective.
  // ⚠️ Mutation (a) : retirer l'agent vierge (le spawn `Agent(`) → rouge.
  // ⚠️ Mutation (b) : ne passer qu'une entrée — retirer `<FRICTION_ATTEIGNABLE>`
  //    de la phrase de passage ET du template → rouge (rejoué à la main).
  it(`${FILE} spawne un améliorateur vierge nourri des DEUX entrées (Étape 2)`, () => {
    const raw = readCommandFile(FILE);
    const step2 = extractSection(raw, /^##\s*Étape 2\b/);
    expect(
      step2,
      `${FILE} n'a pas de section « ## Étape 2 » — l'améliorateur vierge a ` +
        `disparu (specs/skill-19.md, Étape 2).`
    ).not.toBeNull();
    expect(
      /(vierge|neuf|neuve)/i.test(step2) && /Agent\s*\(/.test(step2),
      `${FILE} : l'Étape 2 ne SPAWNE plus d'agent « vierge/neuf » (\`Agent(\`) — ` +
        `l'améliorateur vierge a disparu (specs/skill-19.md, Étape 2).`
    ).toBe(true);
    // Zone testée : l'Étape 2 SANS le template figé (qui ré-échoit les deux
    // placeholders à titre illustratif). Ce qui reste porte le passage EFFECTIF.
    const passage = stripFrozenTemplate(step2);
    expect(
      /<RAPPORT_RUN>/.test(passage),
      `${FILE} : l'Étape 2 (hors template figé) n'injecte plus « <RAPPORT_RUN> » — ` +
        `l'entrée qui porte l'INTENTION n'est plus passée (specs/skill-19.md, Étape 2).`
    ).toBe(true);
    expect(
      /<FRICTION_ATTEIGNABLE>/.test(passage),
      `${FILE} : l'Étape 2 (hors template figé) n'injecte plus ` +
        `« <FRICTION_ATTEIGNABLE> » — l'améliorateur ne reçoit plus qu'UNE entrée, ` +
        `or les DEUX angles morts sont complémentaires (specs/skill-19.md, Étape 2).`
    ).toBe(true);
  });

  // Test 3 — le rubric offre le choix de label pattern / artefact n=1. Ancré au
  // PARAGRAPHE de label du rubric (sous-section `### Rubric`), PAS à toute l'Étape
  // 2 ni au whole-file.
  //
  // ⚠️ Finding 2 de revue (corrigé ici) : la 1ʳᵉ version exigeait la co-présence
  // « pattern » + « n=1/artefact » dans TOUTE l'Étape 2 — or « artefact n=1 » y
  // apparaît 4× (label du rubric, warning down-weight, template figé ×2) et
  // « pattern » ailleurs aussi. Retirer le côté « artefact n=1 » DU RUBRIC (le
  // garde-fou) laissait donc la co-présence intacte via le warning et le template
  // → test VERT. Correctif : on isole la sous-section `### Rubric`
  // (extractSubsection, qui s'arrête à `### Template` → template exclu), puis LE
  // paragraphe de label — celui qui offre « pattern », le SEUL du rubric à le
  // mentionner (ni l'intro ni le warning down-weight ne citent « pattern »). On
  // exige que ce MÊME paragraphe porte encore le côté « n=1 »/« artefact » du choix.
  // ⚠️ Mutation : retirer « ou artefact n=1 (…) » du point 2 du rubric (en
  // laissant « pattern ») → le paragraphe de label perd son côté n=1 → rouge
  // (rejoué à la main).
  it(`${FILE} porte le choix de label pattern / artefact n=1 dans le rubric (### Rubric)`, () => {
    const raw = readCommandFile(FILE);
    const rubric = extractSubsection(raw, /^###\s*Rubric\b/);
    expect(
      rubric,
      `${FILE} n'a pas de sous-section « ### Rubric » — le rubric a disparu ` +
        `(specs/skill-19.md, Étape 2).`
    ).not.toBeNull();
    const labelPara = rubric.split(/\r?\n\r?\n/).find((p) => /pattern/i.test(p));
    expect(
      labelPara,
      `${FILE} : aucun paragraphe du rubric n'offre le label « pattern » — ` +
        `le choix pattern/n=1 a disparu (specs/skill-19.md, Étape 2).`
    ).toBeDefined();
    expect(
      /(n\s*=\s*1|artefact)/i.test(labelPara),
      `${FILE} : le paragraphe de label du rubric offre « pattern » mais plus son ` +
        `côté « n=1 »/« artefact » — le garde-fou qui down-weight l'occurrence ` +
        `unique a disparu du rubric (specs/skill-19.md, Étape 2 & Étape 4).`
    ).toBe(true);
  });

  // Test 4 — propose un ticket SKILL-NN, jamais de hot-patch. Ancré à
  // `## Étape 3` (Proposer, pas patcher). Trois marqueurs co-présents DANS la
  // section : un verbe « propos… », la cible « SKILL-… »/« ticket », ET une
  // NÉGATION EXPLICITE de hot-patch. On évite le `jamais` nu (il apparaît
  // légitimement ailleurs — « manuel, jamais automatique ») en exigeant une
  // tournure « hot-patch » / « ne ré-écrit pas ».
  // ⚠️ Mutation : remplacer la proposition par un edit direct du skill (retirer
  // la négation de hot-patch, ou remplacer « propose un ticket » par « édite le
  // skill ») → rouge (vérifié à la main).
  it(`${FILE} propose un ticket SKILL-NN sans hot-patch (Étape 3)`, () => {
    const raw = readCommandFile(FILE);
    const step3 = extractSection(raw, /^##\s*Étape 3\b/);
    expect(
      step3,
      `${FILE} n'a pas de section « ## Étape 3 » — l'étape « Proposer, pas ` +
        `patcher » a disparu (specs/skill-19.md, Étape 3).`
    ).not.toBeNull();
    expect(
      /propos(e|ition|er)/i.test(step3),
      `${FILE} : l'Étape 3 ne « propose » plus rien.`
    ).toBe(true);
    expect(
      /SKILL-[A-Z0-9]|ticket/i.test(step3),
      `${FILE} : l'Étape 3 ne dirige plus la proposition vers un ticket ` +
        `« SKILL-NN » (specs/skill-19.md, Étape 3).`
    ).toBe(true);
    expect(
      /(jamais de hot-patch|pas de hot-patch|aucun hot-patch|ne r[ée]-?[ée]crit pas)/i.test(
        step3
      ),
      `${FILE} : l'Étape 3 ne porte plus de négation explicite de hot-patch — ` +
        `« proposer, pas patcher » (specs/skill-19.md, Étape 3) a disparu, le ` +
        `skill pourrait être ré-écrit à chaud.`
    ).toBe(true);
  });
});

describe('K1 (SKILL-32) — Étape 6.7 : chaque commande porte son propre cd', () => {
  // Défaut vécu le 2026-08-17 (specs/skill-32.md) pendant l'intégration de
  // SKILL-30 : l'Étape 6.7 prescrivait `cd "<chemin_worktree>"` PUIS des `git`
  // nus, en supposant un cwd persistant d'une commande à l'autre. Constaté :
  // il ne persiste pas ("Shell cwd was reset to …" après chaque appel), donc un
  // `git` nu ultérieur vise le repo de la SESSION, pas le worktree — succès
  // crédible mais mauvais arbre. Le correctif : le `cd` devient partie de
  // CHAQUE commande (`cd "…" && git …`), jamais un état antérieur.
  const FILE = 'commands/sdd-run-ticket.md';

  // Comme extractSection, mais renvoie les blocs ```bash (via extractBashBlocks,
  // qui numérote sur le fichier ENTIER) dont le fence d'ouverture tombe dans le
  // CORPS de la section visée — pas seulement dont le texte matche.
  function sectionBashBlocks(raw, headingRe) {
    const lines = raw.split(/\r?\n/);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (headingRe.test(lines[i])) {
        start = i;
        break;
      }
    }
    if (start === -1) return null;
    let end = lines.length;
    for (let j = start + 1; j < lines.length; j++) {
      if (/^##\s/.test(lines[j])) {
        end = j;
        break;
      }
    }
    // block.startLine (1-indexé) est la ligne du fence ```bash ; le corps de
    // la section couvre les lignes 0-indexées [start+1, end-1], soit en
    // 1-indexé [start+2, end].
    return extractBashBlocks(raw).filter((b) => b.startLine >= start + 2 && b.startLine <= end);
  }

  const STEP_6_7_RE = /^##\s*Étape 6\.7\b/;

  // Test 1 — toute ligne invoquant `git` dans un bloc ```bash de l'Étape 6.7
  // porte, DANS LA MÊME LIGNE, `cd "…" &&` ou `-C`.
  // ⚠️ Mutation attrapée : reposer un `git` nu sur un `cd` antérieur (retirer
  // le `cd "…" &&` d'une des lignes `git` de l'Étape 6.7) → rouge.
  it("chaque ligne invoquant git dans les blocs bash de l'Étape 6.7 porte cd \"…\" && ou -C", () => {
    const raw = readCommandFile(FILE);
    const blocks = sectionBashBlocks(raw, STEP_6_7_RE);
    expect(blocks, `${FILE} n'a pas de section "## Étape 6.7".`).not.toBeNull();
    expect(
      blocks.length,
      `${FILE} : la section "## Étape 6.7" ne contient plus aucun bloc \`\`\`bash.`
    ).toBeGreaterThan(0);

    let gitLineCount = 0;
    for (const block of blocks) {
      for (const line of block.content) {
        if (!/\bgit\b/.test(line)) continue;
        gitLineCount += 1;
        const hasLocalCd = /cd\s+"[^"]+"\s*&&/.test(line);
        const hasDashC = /-C\b/.test(line);
        expect(
          hasLocalCd || hasDashC,
          `${FILE} (bloc ${block.startLine}-${block.endLine}) : la ligne ` +
            `"${line.trim()}" invoque git sans porter ni cd "…" && ni -C — un ` +
            `git nu qui repose sur un cd antérieur (le défaut SKILL-32).`
        ).toBe(true);
      }
    }
    expect(
      gitLineCount,
      `${FILE} : aucune ligne invoquant git n'a été trouvée dans les blocs ` +
        `bash de l'Étape 6.7 — ce test n'a rien vérifié.`
    ).toBeGreaterThan(0);
  });

  // Test 2 — aucune ligne de l'Étape 6.7 ne consiste en un `cd` seul (la forme
  // à deux temps, celle qui a produit le défaut).
  // ⚠️ Mutation attrapée : réintroduire `cd "<WORKTREE_IMPL>"` seul sur sa
  // ligne, suivi de `git` nu sur la ligne d'après → rouge.
  it("aucune ligne de l'Étape 6.7 ne consiste en un cd seul", () => {
    const raw = readCommandFile(FILE);
    const blocks = sectionBashBlocks(raw, STEP_6_7_RE);
    expect(blocks).not.toBeNull();
    for (const block of blocks) {
      for (const line of block.content) {
        const trimmed = line.trim();
        expect(
          /^cd\s+"[^"]*"\s*$/.test(trimmed),
          `${FILE} (bloc ${block.startLine}-${block.endLine}) : la ligne ` +
            `"${trimmed}" est un cd isolé — la forme à deux temps (cd d'état ` +
            `puis commandes séparées) est revenue.`
        ).toBe(false);
      }
    }
  });

  // Test 3 — le tableau de l'Étape 1.2 ne présente plus « cd … puis git nu »
  // sans préciser que le cd est local à la commande.
  // ⚠️ Mutation attrapée : corriger 6.7 en laissant l'Étape 1.2 énoncer
  // l'ancienne règle ("puis `git` nu") — deux passages du même fichier en
  // désaccord.
  it("le tableau de l'Étape 1.2 précise que le cd est local à la commande", () => {
    const raw = readCommandFile(FILE);
    const step12 = extractSection(raw, /^##\s*Étape 1\.2\b/);
    expect(step12, `${FILE} n'a pas de section "## Étape 1.2".`).not.toBeNull();
    expect(
      /puis\s*`git`\s*nu/i.test(step12),
      `${FILE} : l'Étape 1.2 énonce encore "puis \`git\` nu" — la règle périmée ` +
        `(cd comme état persistant) n'a pas été corrigée.`
    ).toBe(false);
    expect(
      /(local(e)?\s*à\s*la\s*commande|de la commande elle-même)/i.test(step12),
      `${FILE} : l'Étape 1.2 ne précise plus que le cd de l'Étape 6.7 est ` +
        `local à la commande (ou "de la commande elle-même") — jamais un cd ` +
        `antérieur.`
    ).toBe(true);
  });

  // Test 4 — l'interdiction du `-C` à l'Étape 6.7 est toujours présente.
  // ⚠️ Mutation attrapée : "simplifier" en remplaçant les `cd "…" &&` par des
  // `-C`, ce qui ferait perdre la vérification que 6.7 constate.
  it("l'interdiction du -C à l'Étape 6.7 est toujours présente", () => {
    const raw = readCommandFile(FILE);
    const step12 = extractSection(raw, /^##\s*Étape 1\.2\b/);
    expect(step12).not.toBeNull();
    expect(step12).toContain('⛔');
    expect(step12).toContain('6.7');
    expect(step12).toContain('-C');
    // Reprise après revue (finding 2, 2026-08-17) : la justification initiale
    // ("-C masquerait ce qu'une vérification préalable constate") est devenue
    // fausse une fois cette vérification retirée (finding 2). La justification
    // qui la remplace n'invoque plus de vérification préalable — elle ne doit
    // plus jamais réapparaître ici (elle réintroduirait le même défaut logique).
    expect(
      /masquerait précisément ce qu'elles vérifient/i.test(step12),
      `${FILE} : l'Étape 1.2 réintroduit la justification "masquerait ce ` +
        `qu'elles vérifient" — fausse depuis que la vérification préalable de ` +
        `6.7 a été retirée (finding 2, specs/skill-32.md).`
    ).toBe(false);
    expect(
      /(équivalentes en comportement|convention)/i.test(step12),
      `${FILE} : l'Étape 1.2 ne justifie plus l'interdiction du -C par la ` +
        `convention (les deux formes étant équivalentes en comportement) — ` +
        `l'interdiction a perdu sa justification, ou a disparu.`
    ).toBe(true);
  });

  // Test 5 (finding 1, revue du 2026-08-17) — la règle "chaque commande porte
  // son cd" s'applique aussi aux commandes que `/send` prescrit et que 6.7
  // exécute pour son compte, pas seulement aux 3 lignes de vérification qui
  // précèdent son invocation.
  // ⚠️ Mutation attrapée : retirer la prose qui étend la règle aux commandes
  // de `/send` (ex. revenir à "invoquer le skill /send depuis ce répertoire"
  // sans rien dire de plus) → rouge : /send exécuterait alors ses propres
  // commandes `git` nues sur le repo de la session, pas sur le worktree cible.
  it("l'Étape 6.7 étend la règle du cd local aux commandes que /send exécute", () => {
    const raw = readCommandFile(FILE);
    const step67 = extractSection(raw, STEP_6_7_RE);
    expect(step67, `${FILE} n'a pas de section "## Étape 6.7".`).not.toBeNull();
    expect(step67).toContain('send.md');
    expect(
      /chaque commande `git` que tu exécutes en son\s+nom/i.test(step67),
      `${FILE} : l'Étape 6.7 ne dit plus explicitement que CHAQUE commande ` +
        `git de /send (pas seulement les 3 commandes de vérification) doit ` +
        `porter le même cd "…" && — l'angle mort du finding 1 est revenu.`
    ).toBe(true);
    expect(
      /même quand `send\.md` la montre nue/i.test(step67),
      `${FILE} : l'Étape 6.7 ne dit plus que la règle s'applique MÊME QUAND ` +
        `send.md montre sa commande nue — sans cette précision, un lecteur ` +
        `peut croire que send.md est déjà conforme.`
    ).toBe(true);
  });

  // Test 6 (finding 2, revue du 2026-08-17) — la vérification tautologique
  // "cd '<WORKTREE_IMPL>' && git rev-parse --show-toplevel" a été retirée :
  // elle imprimait toujours le chemin qu'on venait d'y cd-er, donc ne
  // constatait plus rien depuis que le cd est devenu local à la commande.
  // ⚠️ Mutation attrapée : réintroduire ce bloc (ou tout bloc "vérifie avant
  // d'invoquer" équivalent) dans l'Étape 6.7 → rouge.
  it("l'Étape 6.7 ne contient plus la vérification tautologique show-toplevel", () => {
    const raw = readCommandFile(FILE);
    const step67 = extractSection(raw, STEP_6_7_RE);
    expect(step67).not.toBeNull();
    expect(
      step67.includes('show-toplevel'),
      `${FILE} : l'Étape 6.7 contient encore un "git rev-parse --show-toplevel" ` +
        `— devenu tautologique une fois le cd rendu local à chaque commande ` +
        `(finding 2, specs/skill-32.md) : il imprime toujours le chemin qu'on ` +
        `vient d'y cd-er, quel que soit le répertoire réel de /send.`
    ).toBe(false);
  });

  // Test 7 (finding 3, revue du 2026-08-17) — la prose n'affirme plus qu'il
  // faille "reposer" le shell après /send : puisque le cwd ne persiste jamais
  // d'une commande à l'autre, il n'y a rien à reposer, et prescrire un cd de
  // retour réintroduit le modèle mental (cd = état) que ce ticket corrige.
  // ⚠️ Mutation attrapée : réintroduire "repose ton shell" / "shell resté dans
  // un autre dépôt" comme justification → rouge.
  it("l'Étape 6.7 n'affirme plus qu'il faut reposer le shell après /send", () => {
    const raw = readCommandFile(FILE);
    const step67 = extractSection(raw, STEP_6_7_RE);
    expect(step67).not.toBeNull();
    expect(
      /repose ton shell/i.test(step67),
      `${FILE} : l'Étape 6.7 prescrit encore de "reposer" le shell après /send ` +
        `— cette prescription suppose qu'un cd antérieur a laissé un état, ce ` +
        `que l'étape affirme par ailleurs être faux (finding 3, specs/skill-32.md).`
    ).toBe(false);
    expect(
      /shell resté dans un autre dépôt fait dérailler/i.test(step67),
      `${FILE} : l'Étape 6.7 justifie encore par "un shell resté dans un autre ` +
        `dépôt fait dérailler" — prémisse contredite par le reste de l'étape.`
    ).toBe(false);
    expect(
      /(cwd ne persistant jamais|rien à reposer)/i.test(step67),
      `${FILE} : l'Étape 6.7 ne réaffirme plus, à propos de l'après-/send, que ` +
        `le cwd ne persiste jamais et qu'il n'y a donc rien à reposer.`
    ).toBe(true);
  });
});

describe('L1 (SKILL-27) — vocabulaire d’effort officiel, et compression de la prose', () => {
  // specs/skill-27.md, volets A et B.
  //
  // Volet B : depuis BLG-01, l'outil de backlog n'écrit QUE `low|medium|high|
  // xhigh|max` (l'ancien vocabulaire `none|think|think-hard|ultrathink` est un
  // alias normalisé À L'ÉCRITURE). Les deux énumérés du skill étaient restés
  // sur l'ancien vocabulaire : tout ticket maturé aujourd'hui tombait HORS de
  // l'énuméré, dont la prose prescrit alors de stopper. F4 ne pouvait pas le
  // voir — il compare `commands/backlog.md` et `commands/sdd-run-ticket.md`
  // entre eux, et les deux étaient périmés du même périmé.
  //
  // ⛔ `EFFORTS_OFFICIELS` est écrit EN DUR ici, jamais importé de `tools/` ni
  // extrait d'un `commands/*.md` (D3) : un test qui lit le fichier qu'il
  // contrôle se valide contre lui-même — précisément le trou de F4.
  const EFFORTS_OFFICIELS = ['low', 'medium', 'high', 'xhigh', 'max'];

  const SDD_FILE = 'commands/sdd-run-ticket.md';
  const BACKLOG_FILE = 'commands/backlog.md';

  // Normalisation CRLF → LF : ce repo est `core.autocrlf=true`, les ancres de
  // L1.5/L1.6 sont comparées sur du texte, pas sur des octets de disque.
  const readNorm = (rel) => readCommandFile(rel).replace(/\r\n/g, '\n');

  // Copie LOCALE et délibérée de l'extracteur de F4 (même convention que la
  // triple copie de `findDeclared`, cf. F3) : F4 appartient à SKILL-04 et doit
  // rester vert SANS être touché par ce ticket.
  function extractEnumFromSetNotation(raw, field) {
    const re = new RegExp('`' + field + '`\\s*∈\\s*\\{([^}]+)\\}');
    const m = re.exec(raw);
    if (!m) return null;
    return m[1].split(',').map((s) => s.trim().replace(/^`|`$/g, ''));
  }

  // --- L1.1 — l'Étape 2 énumère le vocabulaire officiel ---------------------

  // ⚠️ Mutation : remettre `none, think, think-hard, ultrathink` dans la
  // notation `` `effort` ∈ {…} `` de l'Étape 2 → rouge.
  it(`${SDD_FILE} : "effort ∈ {...}" énumère le vocabulaire officiel, dans cet ordre`, () => {
    const values = extractEnumFromSetNotation(readNorm(SDD_FILE), 'effort');
    expect(values, `${SDD_FILE} ne déclare aucun "effort ∈ {...}".`).not.toBeNull();
    expect(
      values,
      `${SDD_FILE} : l'énuméré d'effort de l'Étape 2 n'est pas le vocabulaire ` +
        `officiel écrit par l'outil de backlog depuis BLG-01 — tout ticket ` +
        `maturé aujourd'hui tomberait hors énuméré, et l'Étape 2 stopperait.`
    ).toEqual(EFFORTS_OFFICIELS);
  });

  // ⚠️ Mutation : recoller le tableau de correspondance `exec.effort` → palier
  // → `subagent_type` à l'Étape 6 → rouge.
  it(`${SDD_FILE} ne porte plus la colonne "palier officiel"`, () => {
    expect(
      readNorm(SDD_FILE).includes('palier officiel'),
      `${SDD_FILE} : le tableau de correspondance effort → palier est revenu. ` +
        `Les cinq paliers officiels portent le nom de leur agent-def : la ` +
        `règle d'identité (Étape 6) suffit, le tableau n'a plus d'objet.`
    ).toBe(false);
  });

  // ⚠️ Mutation : réaffirmer que `xhigh` est hors d'atteinte → rouge.
  it(`${SDD_FILE} ne prétend plus que xhigh est inatteignable`, () => {
    expect(
      readNorm(SDD_FILE).includes("atteignable par l'ancien vocab d'effort"),
      `${SDD_FILE} : la note « le palier xhigh n'est pas atteignable par ` +
        `l'ancien vocab d'effort » est revenue — `+
        `\`xhigh\` est un palier officiel comme les autres depuis BLG-01.`
    ).toBe(false);
  });

  // --- L1.2 — l'Étape 6 porte la règle d'identité, plus un tableau ----------

  const STEP_6_RE = /^##\s*Étape 6\s/;

  // ⚠️ Mutation : revenir à `sdd-impl-<palier>` sans dire d'où vient le palier
  // → rouge.
  it(`${SDD_FILE} : l'Étape 6 porte la règle d'identité subagent_type = sdd-impl-<effort>`, () => {
    const step6 = extractSection(readNorm(SDD_FILE), STEP_6_RE);
    expect(step6, `${SDD_FILE} n'a pas de section "## Étape 6".`).not.toBeNull();
    expect(
      step6,
      `${SDD_FILE} : l'Étape 6 ne dérive plus le subagent_type DE L'EFFORT ` +
        `lui-même — c'est cette identité qui remplace le tableau.`
    ).toContain('sdd-impl-<effort>');
  });

  // ⚠️ Mutation : réintroduire le shim ancien→officiel sur le chemin
  // d'exécution (ou le tableau qu'il pilotait) → rouge. Le shim reste au BUILD
  // des agent-defs (`tools/agent-defs/generate.mjs`), jamais au runtime.
  for (const dead of ['via le shim', 'hors du tableau', 'la 3ᵉ colonne de ce tableau']) {
    it(`${SDD_FILE} : l'Étape 6 ne contient plus "${dead}"`, () => {
      const step6 = extractSection(readNorm(SDD_FILE), STEP_6_RE);
      expect(step6).not.toBeNull();
      expect(
        step6.includes(dead),
        `${SDD_FILE} : l'Étape 6 contient encore "${dead}" — le tableau de ` +
          `correspondance (et le shim qui le pilotait) est revenu sur le ` +
          `chemin d'exécution.`
      ).toBe(false);
    });
  }

  // ⚠️ Mutation : retirer le stop de l'Étape 6 → rouge. La correction de
  // l'énuméré ne doit pas emporter le garde-fou.
  it(`${SDD_FILE} : l'Étape 6 prescrit toujours de stopper sur un effort hors énuméré`, () => {
    const step6 = extractSection(readNorm(SDD_FILE), STEP_6_RE);
    expect(step6).not.toBeNull();
    expect(
      /stopper/i.test(step6),
      `${SDD_FILE} : l'Étape 6 ne prescrit plus de stopper — un effort ` +
        `inconnu produirait un subagent_type inexistant, en silence.`
    ).toBe(true);
  });

  // --- L1.3 — une seule notation `effort ∈ {…}` dans le fichier -------------

  // ⚠️ Mutation : ajouter une seconde notation (par exemple pour citer
  // l'ancien vocabulaire dans la phrase d'aide du stop) → rouge.
  // `extractEnumFromSetNotation` prend la PREMIÈRE occurrence : une seconde
  // notation ferait comparer à `commands/backlog.md` (F4) un énuméré qui ne
  // pilote rien.
  it(`${SDD_FILE} ne contient qu'UNE notation \`effort\` ∈ {…}`, () => {
    const count = (readNorm(SDD_FILE).match(/`effort` ∈ \{/g) || []).length;
    expect(
      count,
      `${SDD_FILE} porte ${count} notation(s) \`effort\` ∈ {…}. Une seule doit ` +
        `exister : F4 et L1.1 lisent la PREMIÈRE, et compareraient alors un ` +
        `énuméré qui ne pilote rien.`
    ).toBe(1);
  });

  // --- L1.4 — backlog.md : l'exemple suit sa propre ligne d'usage -----------

  // ⚠️ Mutation : laisser `--effort think-hard` dans l'exemple → rouge.
  it(`${BACKLOG_FILE} : les valeurs --effort des exemples sont officielles`, () => {
    const raw = readNorm(BACKLOG_FILE);
    // Valeur CONCRÈTE (pas la ligne d'usage `--effort <a\|b\|c>`, qui commence
    // par `<`) : c'est l'exemple exécutable que F4 ne lit jamais.
    const values = [...raw.matchAll(/--effort\s+([^\s<][^\s]*)/g)].map((m) => m[1]);
    expect(
      values.length,
      `${BACKLOG_FILE} ne montre plus aucun --effort <valeur concrète> — ` +
        `ce test n'a rien vérifié.`
    ).toBeGreaterThan(0);
    for (const v of values) {
      expect(
        EFFORTS_OFFICIELS,
        `${BACKLOG_FILE} : l'exemple utilise --effort ${v}, hors du vocabulaire ` +
          `officiel. F4 ne lit que la ligne d'usage — l'exemple peut périmer seul.`
      ).toContain(v);
    }
  });

  // ⚠️ Mutation : oublier la ligne 121 (« en opus think-hard », l'énoncé
  // utilisateur de l'exemple) → rouge. La ligne d'usage seule ne suffit pas :
  // F4 ne lit qu'elle.
  it(`${BACKLOG_FILE} ne contient plus la chaîne "think-hard"`, () => {
    expect(
      readNorm(BACKLOG_FILE).includes('think-hard'),
      `${BACKLOG_FILE} cite encore "think-hard" — vocabulaire d'avant BLG-01, ` +
        `que \`mature\` ne peut plus écrire.`
    ).toBe(false);
  });

  // --- L1.4b — CLAUDE.md : le vocabulaire d'effort mort (BLG-01) ne pourrit
  // plus la prose (SKILL-37, après BLG-06) ------------------------------------
  //
  // Assertion symétrique de L1.4 : `CLAUDE.md` (chargé en entier, à chaque
  // session, dans tous les projets) portait encore les trois lignes de la
  // règle de cohérence `effort ⇒ model`, écrites contre l'ancien vocabulaire.
  // La règle vit désormais dans `tools/backlog/backlog.mjs` (BLG-06,
  // `--override-coherence`) ; la prose ne doit plus nommer aucune valeur
  // d'effort d'avant BLG-01.
  //
  // ⚠️ `readCommandFile(rel)` joint `REPO_ROOT`, pas `commands/`, malgré son
  // nom (définition ci-dessus, lignes 68-70) : il lit donc bien `CLAUDE.md` à
  // la racine, sans adaptation.
  //
  // ⚠️ Borne délibérée : seule la moitié NON AMBIGUË du vocabulaire mort est
  // gardée ici (`think-hard`, `ultrathink`). `none` et `think` nus ne sont pas
  // assertables — trop génériques, ils apparaissent légitimement ailleurs, en
  // français comme en anglais. C'est le retrait du paragraphe (D1) qui traite
  // le reste ; ce test ne couvre que sa moitié testable.
  //
  // ⚠️ Les deux jetons n'ont PAS la même origine — le message d'échec de
  // chacun le reflète, il ne peut pas être générique :
  // - `think-hard` était RÉELLEMENT dans la règle de cohérence retirée par ce
  //   ticket (vérifié : mutation-témoin, la remettre → rouge — c'est
  //   l'assertion dont l'absence a laissé pourrir la prose, cf. spec
  //   SKILL-37 § Problème). Le geste correctif nommé (« vit dans l'outil,
  //   BLG-06 ») s'y applique donc exactement.
  // - `ultrathink` n'a JAMAIS figuré dans `CLAUDE.md` (vérifié :
  //   `git show main:CLAUDE.md | grep ultrathink` ne rend rien) — la règle ne
  //   citait que `think-hard`, `none` et `think`. Cette seconde assertion est
  //   **préventive**, symétrique de celle posée sur `commands/backlog.md`
  //   (D5 exige les deux jetons non ambigus), pas un rouge-d'abord. Son
  //   message ne doit donc pas prétendre qu'une règle de cohérence est en
  //   train de déménager : il ne nomme que l'origine du vocabulaire mort
  //   (BLG-01) et le vocabulaire officiel qui le remplace.
  const CLAUDE_FILE = 'CLAUDE.md';
  // SKILL-97 : domicile de la méthode de maturation depuis ce ticket. Déclaré
  // ICI, aux côtés de `CLAUDE_FILE`, parce que la garde « jetons morts »
  // ci-dessous le vise AUSSI (voir `PORTEURS_JETONS_MORTS`) — pas seulement le
  // bloc L1.4c plus bas, qui en était le premier lecteur.
  const MATURATION_FILE = 'rules/maturation.md';

  const JETONS_MORTS_CLAUDE = [
    [
      'think-hard',
      "vocabulaire d'avant BLG-01 : c'était la règle de cohérence " +
        'effort ⇒ model, retirée par SKILL-37 — elle vit désormais dans ' +
        "l'outil (BLG-06, `--override-coherence`), pas dans la prose",
    ],
    [
      'ultrathink',
      "vocabulaire d'avant BLG-01 (`none|think|think-hard|ultrathink`) — " +
        'le vocabulaire officiel `mature` écrit depuis est ' +
        '`low|medium|high|xhigh|max`',
    ],
  ];

  // SKILL-97 — DEUX porteurs, pas un. La prose que cette garde surveille est
  // celle de la cohérence `effort ⇒ model` (cf. le commentaire d'origine
  // ci-dessus) : elle a DÉMÉNAGÉ dans `rules/maturation.md` avec le reste de la
  // méthode — c'est son § « Plancher effort → modèle » qui cite aujourd'hui
  // `--override-coherence`. Rester ancré sur le seul `CLAUDE.md` laisserait
  // `think-hard` revenir dans le fichier qui porte RÉELLEMENT le sujet sans
  // rougir, alors que la garde symétrique sur `commands/backlog.md` (au-dessus)
  // rougirait toujours : une garde qui suit la prose, pas son ancien domicile.
  //
  // `CLAUDE.md` RESTE dans la liste : le déplacement ne lui donne pas le droit
  // de ressusciter ce vocabulaire ailleurs dans ses 200 lignes restantes.
  //
  // ⚠️ Mutation : écrire `think-hard` (ou `ultrathink`) dans
  // `rules/maturation.md` § « Choix du modèle » → rouge. Avec l'ancienne
  // version ancrée sur `CLAUDE.md` seul : vert.
  const PORTEURS_JETONS_MORTS = [CLAUDE_FILE, MATURATION_FILE];

  for (const porteur of PORTEURS_JETONS_MORTS) {
    for (const [token, origine] of JETONS_MORTS_CLAUDE) {
      it(`${porteur} ne contient plus la chaîne "${token}"`, () => {
        expect(
          readNorm(porteur).includes(token),
          `${porteur} cite encore "${token}" — ${origine}.`
        ).toBe(false);
      });
    }
  }

  // --- L1.4c (SKILL-91, SKILL-93, SKILL-94) — méthode de maturation : les contrôles écrits ---
  //
  // Quatre des CINQ invariants du § Tests de specs/skill-91.md sont ici — le
  // cinquième invariant DE SKILL-91 (le plafond de taille) vit dans S6 de
  // `skill-size-ceiling-coherence.test.js`, réservé aux plafonds
  // (`commands/mature.md` : un fichier de plafonds le reste). SKILL-93 a
  // ajouté un CINQUIÈME `it()` ICI MÊME (le test du contrôle 5) — à ne pas
  // confondre avec le « cinquième invariant » de SKILL-91 ci-dessus : les deux
  // numérotations ne se recouvrent pas, l'une compte les invariants du § Tests
  // de specs/skill-91.md, l'autre les contrôles numérotés de la méthode de
  // maturation elle-même. SKILL-94 en a ajouté SEPT de plus, ICI MÊME : la
  // contiguïté des items 1 à 7, le contenu du contrôle 6 (D1) et du contrôle 7
  // (D2), les DEUX issues du rituel de fermeture d'escalade (D3, une assertion
  // par issue — une seule les laisserait disparaître à moitié sans rougir), la
  // garde transverse qui interdit à tout `.md` du dépôt de ressusciter le
  // nombre périmé, et — ajouté à la gate de revue — la plage « 1 à N » du
  // diagnostic, DÉRIVÉE du comptage et vérifiée sur ses DEUX porteurs
  // prescriptifs par un `it()` généré en boucle. SKILL-96 en a ajouté TROIS de
  // plus : le contrôle 7, élargi d'un état du dépôt seul à tout fait
  // constatable (dépôt OU dépendance tierce), gagne une assertion par moitié
  // — dépôt conservé, dépendance tierce ajoutée — plus l'obligation de citer
  // le moyen, chacune bornée séparément pour la même raison que le rituel D3
  // ci-dessus. SKILL-97 en RETIRE un (celui du placement sous
  // `## Workflow obligatoire (SDD)`, devenu faux par construction — la méthode
  // n'est plus dans `CLAUDE.md`) et en ajoute TROIS, qui gardent ensemble ce
  // que lui gardait seul : le titre à sa nouvelle adresse, le frontmatter
  // `paths:` sans lequel la règle se chargerait inconditionnellement, et le
  // pointeur de `CLAUDE.md` sans lequel la méthode devient invisible à qui lit
  // le seul `CLAUDE.md`. SKILL-95 en ajoute DEUX de plus (T1, T2) : l'item 5
  // nomme la seconde source de permission (les deux modes d'emploi de
  // sous-agent) et route au lieu d'interdire. Ce bloc porte donc DIX-NEUF
  // `it()` déclarés, VINGT tests exécutés (la plage en produit deux), tous
  // testant le CONTENU (C3) — jamais la seule présence d'un titre.
  //
  // ⚠️ Ce compte est lui-même un porteur de nombre : un `it()` ajouté ici sans
  // le mettre à jour est exactement le défaut que le contrôle 2 de la méthode
  // (dérouler l'effet de bord du geste prescrit) existe pour attraper.
  //
  // --- SKILL-97 : la CIBLE des douze `it()` de la méthode change -------------
  //
  // La méthode (les sept contrôles, le rituel D3, l'échelle de choix du modèle)
  // a quitté `CLAUDE.md` — chargé à CHAQUE session de CHAQUE projet — pour la
  // règle path-scopée `rules/maturation.md`, qui ne se charge qu'à l'ouverture
  // d'un fichier de spec. Les douze `it()` sont RE-POINTÉS sur ce fichier ;
  // leurs ASSERTIONS sont inchangées, seule leur cible bouge.
  //
  // Le corps n'est plus borné par `## Workflow obligatoire (SDD)` : ce `##`
  // n'existe pas dans la règle. `### Méthode de maturation` s'y cherche donc à
  // la racine du fichier, et `extractSubsection` l'y borne au prochain `##` OU
  // `###` — c'est-à-dire `### Choix du modèle à la maturation`, déplacé avec
  // elle — exactement comme il le bornait avant.
  //
  // `MATURATION_FILE` est déclaré PLUS HAUT, aux côtés de `CLAUDE_FILE` : la
  // garde « jetons morts » (L1.4b) le vise aussi depuis la reprise de gate.
  const MATURATION_HEADING_RE = /^### Méthode de maturation/;

  // Copie LOCALE et délibérée d'`extractSubsection` (même convention que la
  // triple copie de `findDeclared`, cf. F3, et les deux copies déjà présentes
  // plus bas dans ce même fichier, lignes ~1714 et ~2709) : s'arrête au
  // prochain titre `##` OU `###`, contrairement à `extractSection` qui ne
  // s'arrête qu'à `##`. Nécessaire ici pour ISOLER `### Méthode de
  // maturation` sans absorber la sous-section `###` voisine — depuis SKILL-97,
  // `### Choix du modèle à la maturation`, déplacée dans le même fichier de
  // règle et écrite juste sous elle. Ce n'est plus un cas hypothétique.
  function extractSubsection(raw, headingRe) {
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
      if (/^#{2,3}\s/.test(lines[j])) break;
      out.push(lines[j]);
    }
    return out.join('\n');
  }

  // Isole le bloc du contrôle numéroté `n` (borné au prochain item numéroté,
  // ou à la fin du corps) — pour que les invariants 3 et 4 (SKILL-91), le test
  // du contrôle 5 (SKILL-93) ET ceux des contrôles 6 et 7 (SKILL-94)
  // n'assertionnent QUE sur LEUR contrôle, jamais sur la section entière (une
  // prescription qui aurait glissé du contrôle 1 au contrôle 2, par exemple,
  // doit rester détectable). Cinq appelants aujourd'hui : contrôles 1, 4, 5, 6
  // et 7.
  //
  // ⚠️ SKILL-93, finding de revue : le DERNIER item de la liste — sans borne
  // haute propre — absorberait toute prose de clôture ajoutée sous la liste
  // (encore À L'INTÉRIEUR du corps de la sous-section), et sa reformulation
  // vide resterait invisible tant qu'un tel paragraphe de clôture continue de
  // citer les porteurs attendus. Un item se termine donc aussi sur une ligne
  // VIDE non suivie d'une continuation indentée ni du prochain item numéroté —
  // pas seulement sur le prochain item numéroté.
  //
  // ⚠️ SKILL-94 : le contrôle 5 a CESSÉ d'être le dernier item (le contrôle 7
  // l'est devenu), et retombe donc dans le régime ordinaire des items bornés
  // par l'item suivant. La borne « ligne vide » N'EST PAS retirée pour autant :
  // elle protège désormais le contrôle 7, exactement comme elle protégeait le 5
  // — et le rituel de fermeture d'escalade (D3), ajouté SOUS la liste dans la
  // même sous-section, est précisément la prose de clôture que le 7 absorberait
  // sans elle. Le corpus actuel (aucune ligne vide À L'INTÉRIEUR de la liste,
  // items 1 à 7 contigus) ne fait jamais jouer cette borne pour les items 1 à
  // 6, qui continuent d'être bornés par l'item suivant comme avant.
  function extractControle(corps, n) {
    const lines = corps.split('\n');
    let start = -1;
    let end = lines.length;
    const startRe = new RegExp(`^${n}\\.\\s+\\*\\*`);
    const nextItemRe = /^\d+\.\s+\*\*/;
    const continuationRe = /^\s+\S/;
    for (let i = 0; i < lines.length; i++) {
      if (start === -1 && startRe.test(lines[i])) {
        start = i;
        continue;
      }
      if (start === -1) continue;
      if (nextItemRe.test(lines[i])) {
        end = i;
        break;
      }
      if (lines[i].trim() === '') {
        const next = lines[i + 1];
        if (next === undefined || !(continuationRe.test(next) || nextItemRe.test(next))) {
          end = i;
          break;
        }
      }
    }
    if (start === -1) return null;
    return lines.slice(start, end).join('\n');
  }

  // `platir` (aplatir les blancs avant assertion de CONTENU) est importé de
  // `helpers/prompt-blocks.js`, PAS redéfini ici : il a deux appelants dès
  // SKILL-94 (ce fichier et `escalation-wiring-coherence.test.js`), donc le
  // seuil de promotion du dépôt est atteint — cf. l'en-tête du module, point
  // (4). Sans lui, une assertion `.includes('cite ce moyen')` dépend du
  // point d'enroulement de la prose : verte aujourd'hui, rouge demain sur un
  // reflow qui ne change RIEN au sens. Les assertions bornées préexistantes
  // (contrôles 1, 4, 5) portent sur des marqueurs assez courts pour n'avoir
  // jamais rencontré ce piège ; elles restent inchangées.
  //
  // ⛔ Ne l'applique JAMAIS aux assertions de STRUCTURE ci-dessous (comptage
  // `^\d+\.`, rangs, numéros de ligne) : il détruit ce qu'elles lisent.

  // --- Deux régions DISTINCTES sous `### Méthode de maturation` (SKILL-94) ---
  //
  // `extractSubsection` s'arrête sur `##` et `###`, jamais sur `####` : le
  // rituel `#### Refermer une escalade E1` introduit par SKILL-94 est donc DANS
  // `corps`. Laisser les tests de STRUCTURE compter sur `corps` entier rouvre
  // exactement la coïncidence que leur commentaire déclare impossible — un
  // futur ticket qui reformate les deux issues de D3 en liste numérotée
  // (`1. **un numéro (1 à 7)** …` / `2. **\`aucun\`** …`), geste éditorial
  // banal, ferait rendre au comptage « 9 contrôle(s) … 7 attendus » et à la
  // contiguïté « [1,…,7,1,2] », deux messages qui accuseraient la liste des
  // contrôles, non touchée. D'où DEUX régions, et jamais `corps` nu :
  //   - `corpsListe`  : la liste numérotée seule, jusqu'au premier `#### `.
  //   - `blocRituel`  : le bloc `#### Refermer une escalade E1 …` seul.
  //
  // ⚠️ Mutation-témoin de ce découpage : reformater les deux issues du rituel
  // en `1.` / `2.` → les tests de structure DOIVENT rester verts (la liste des
  // contrôles n'a pas bougé), et les tests du rituel aussi.
  const RITUEL_HEADING_RE = /^#### Refermer une escalade E1/m;

  function corpsListe(corps) {
    if (corps === null) return null;
    const m = /^#### /m.exec(corps);
    return m === null ? corps : corps.slice(0, m.index);
  }

  // Le rituel D3, borné à SON titre `####` (jusqu'au prochain `####` ou à la
  // fin du corps). Sans cette borne, les deux `it()` du rituel portaient sur
  // TOUTE la sous-section — donc restaient verts si le titre `####` était
  // supprimé et ses deux paragraphes réinjectés en lignes de continuation à
  // l'intérieur d'un contrôle, au milieu de la liste : le rituel cessait
  // d'exister comme section repérable sans que rien ne rougisse, exactement le
  // mode de défaillance (« une prescription qui aurait glissé du contrôle 1 au
  // contrôle 2 doit rester détectable ») que `extractControle` existe pour
  // empêcher. Même doctrine, appliquée au grain du `####`.
  function blocRituel(corps) {
    if (corps === null) return null;
    const lignes = corps.split('\n');
    const debut = lignes.findIndex((l) => RITUEL_HEADING_RE.test(l));
    if (debut === -1) return null;
    const suite = lignes.slice(debut + 1);
    const fin = suite.findIndex((l) => /^#### /.test(l));
    return [lignes[debut], ...(fin === -1 ? suite : suite.slice(0, fin))].join('\n');
  }

  // Le corps de la méthode s'obtient désormais par un appel DIRECT à
  // `extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE)` :
  // borné à `### Méthode de maturation`, jusqu'au prochain `##` OU `###`,
  // cherché à la racine de `rules/maturation.md`.
  //
  // Avant SKILL-97, un `corpsMaturation()` bornait d'abord à `## Workflow
  // obligatoire (SDD)` pour qu'une section déplacée sous `## Backlog` cesse
  // d'être trouvable, et rendait DEUX champs (`corpsWorkflow`, `corps`). Ce
  // risque-là n'existe plus — la règle NE PORTE QUE la méthode, il n'y a aucune
  // autre section sous laquelle la cacher — et l'unique lecteur de
  // `corpsWorkflow` (l'`it()` de placement) est parti avec lui : l'indirection
  // ne rendait plus qu'un objet à un champ, dont la destructuration n'avait
  // plus de raison lisible. Ce qui remplace cette garde, c'est le triplet
  // d'`it()` de SKILL-97 ci-dessous : titre présent ici, frontmatter `paths:`
  // présent ici, pointeur présent dans `CLAUDE.md`.

  // Chemin d'une spec RÉELLE de ce dépôt, au format que le client compare : un
  // chemin RELATIF au répertoire d'où la session a été lancée, séparateurs `/`.
  // Écrit en dur, pas dérivé d'un `readdirSync` : un test qui construit son
  // opérande depuis le dossier qu'il contrôle se valide contre lui-même (D3).
  const CHEMIN_SPEC_CANONIQUE = 'specs/skill-97.md';

  // Matcheur de glob minimal, DÉLIBÉRÉMENT local et sans dépendance : ce dépôt
  // n'a que `vitest` en devDependencies, et tirer un paquet de glob pour trois
  // métacaractères coûterait plus que la fonction. Couvre ce que le frontmatter
  // `paths:` peut légitimement écrire — `**` (zéro ou plusieurs segments), `*`
  // (dans un segment, ne franchit pas `/`), `?`. Tout le reste est littéral.
  //
  // ⛔ Ce n'est PAS une réimplémentation du matcheur du client : c'est un
  // minorant honnête. Un glob que CETTE fonction juge matchant peut, à la
  // rigueur, ne pas l'être chez le client ; l'inverse — le cas que le test
  // attrape — est ce qui compte, et il ne dépend d'aucune subtilité.
  function globMatche(glob, chemin) {
    const re = glob
      .split('')
      .reduce((acc, c, i, arr) => {
        if (c === '*' && arr[i - 1] === '*') return acc; // second `*` d'un `**`
        if (c === '*') return acc + (arr[i + 1] === '*' ? '(?:.*)' : '[^/]*');
        if (c === '?') return acc + '[^/]';
        return acc + c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }, '')
      .replace(/\(\?:\.\*\)\\?\//g, '(?:.*/)?'); // `**/` matche AUSSI zéro segment
    return new RegExp(`^${re}$`).test(chemin);
  }

  // --- SKILL-97 : les trois `it()` qui remplacent celui du placement ---------
  //
  // Ils gardent ENSEMBLE ce que l'ancien gardait seul (la méthode est là où
  // elle doit être, et atteignable). Trois assertions et non une : chacune
  // peut tomber sans les autres.

  // ⚠️ Mutation : renommer le titre `### Méthode de maturation` dans la règle
  // → rouge. C'est l'existence de la section à sa NOUVELLE adresse ; sans
  // elle, les douze `it()` re-pointés ci-dessous échoueraient tous sur un
  // `corps` nul, sans qu'aucun ne dise que c'est le TITRE qui a bougé.
  it(`${MATURATION_FILE} porte le titre "### Méthode de maturation"`, () => {
    expect(
      new RegExp(MATURATION_HEADING_RE.source, 'm').test(readNorm(MATURATION_FILE)),
      `${MATURATION_FILE} : le titre "### Méthode de maturation" n'apparaît ` +
        `pas EN TÊTE DE LIGNE — la méthode n'est plus à l'adresse que ` +
        `${CLAUDE_FILE} désigne (SKILL-97 § Portée 1).`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer le frontmatter → rouge. Sans lui la règle se charge
  // INCONDITIONNELLEMENT, ce qui annule tout le bénéfice du ticket (sortir la
  // méthode de la surface payée à chaque session) SANS qu'aucune autre
  // assertion ne bouge — la méthode serait toujours là, tous les contrôles
  // toujours écrits, et le coût de retour.
  //
  // L'assertion porte sur le GLOB, pas sur la seule présence de `paths:` : un
  // frontmatter `paths: []`, ou un glob qui ne matche aucune spec, se charge
  // aussi mal qu'un frontmatter absent.
  it(`${MATURATION_FILE} porte un frontmatter \`paths:\` dont un glob matche specs/`, () => {
    const raw = readNorm(MATURATION_FILE);
    const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
    expect(
      m,
      `${MATURATION_FILE} : aucun frontmatter YAML en tête de fichier — la ` +
        `règle se chargerait INCONDITIONNELLEMENT, à chaque session de chaque ` +
        `projet, ce que SKILL-97 existe pour supprimer.`
    ).not.toBeNull();
    const globs = [...m[1].matchAll(/^\s*-\s*["']?([^"'\n]+?)["']?\s*$/gm)].map((g) => g[1]);
    expect(
      /^paths\s*:/m.test(m[1]),
      `${MATURATION_FILE} : le frontmatter ne porte pas de clé \`paths:\` — ` +
        `même symptôme qu'un frontmatter absent.`
    ).toBe(true);
    // ⚠️ Reprise de gate : l'assertion était `g.startsWith('specs/')`, un
    // PRÉFIXE — donc `paths: ["specs/epics/**/*.md"]` la satisfaisait alors que
    // la règle cesserait de s'injecter à l'ouverture de `specs/skill-100.md`,
    // exactement la moitié de garde que le commentaire ci-dessus ANNONCE
    // (« un glob qui ne matche aucune spec ») et que le préfixe ne tenait pas.
    // On MATCHE donc réellement, sur le chemin canonique d'une spec de ce
    // dépôt — au format que le client compare (relatif, séparateurs `/`).
    expect(
      globs.some((g) => globMatche(g, CHEMIN_SPEC_CANONIQUE)),
      `${MATURATION_FILE} : aucun glob de \`paths:\` ne matche ` +
        `\`${CHEMIN_SPEC_CANONIQUE}\` (lus : ${JSON.stringify(globs)}). Un ` +
        `glob qui commence par \`specs/\` sans matcher une spec à la racine de ` +
        `\`specs/\` (ex. \`specs/epics/**/*.md\`) ne vaut pas mieux qu'un ` +
        `frontmatter absent : la règle ne se déclencherait jamais à l'ouverture ` +
        `d'une spec — le seul moment où elle sert.`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer le pointeur de `CLAUDE.md` → rouge. La méthode
  // deviendrait invisible à qui lit le seul `CLAUDE.md` : la règle ne se
  // charge qu'à l'ouverture d'une spec, et rien ne dirait plus qu'elle existe.
  it(`${CLAUDE_FILE} porte un pointeur nommant ${MATURATION_FILE}`, () => {
    expect(
      readNorm(CLAUDE_FILE).includes(MATURATION_FILE),
      `${CLAUDE_FILE} ne nomme plus ${MATURATION_FILE} — la méthode de ` +
        `maturation n'a plus aucun chemin de lecture depuis la surface ` +
        `chargée à chaque session (SKILL-97 § Portée 2).`
    ).toBe(true);
  });

  // ⚠️ Mutation : fusionner deux des sept contrôles en un seul point (en
  // renumérotant la liste 1-6) → rouge. Compte les items numérotés `N. **...**`
  // de la LISTE (`corpsListe`), doublement borné : par `extractSubsection` pour
  // ne pas absorber une sous-section `###` voisine qui suivrait un jour, et par
  // le premier `#### ` pour ne pas absorber le rituel D3 — une fusion à 6 plus
  // un item apparu ailleurs sous le même `###` ne doivent JAMAIS pouvoir sommer
  // à 7 par coïncidence.
  it(`${MATURATION_FILE} : la méthode de maturation porte SEPT contrôles distincts`, () => {
    const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    const items = (corpsListe(corps).match(/^\d+\.\s+\*\*/gm) || []).length;
    expect(
      items,
      `${MATURATION_FILE} : ${items} contrôle(s) numéroté(s) trouvé(s) sous ` +
        `"### Méthode de maturation", 7 attendus (SKILL-91 § Décision ; ` +
        `cinquième contrôle ajouté par SKILL-93, sixième et septième par ` +
        `SKILL-94 § D1/D2).`
    ).toBe(7);
  });

  // ⚠️ Mutation : retirer « le nom » de la prescription du contrôle 1 (ex. la
  // reformuler en « grep les chemins/fichiers touchés ») → rouge. C'est la
  // moitié de l'invariant que la formulation d'origine ne gardait pas : le
  // contrôle 1 prescrit spécifiquement de chercher LE NOM de l'entité — pas
  // seulement « grep quelque chose, avec commentaires » — et c'est CETTE
  // prescription précise à laquelle SKILL-79/82/83 imputent 4 des 16 findings
  // (grep qui s'arrête aux porteurs connus au lieu de chercher le nom
  // partout, commentaires et mutations-témoins compris). L'assertion est en
  // outre BORNÉE au bloc du contrôle 1 (`extractControle`), pas à la section
  // entière : si « commentaires » glisse au contrôle 2, ce test doit rester
  // rouge, pas être sauvé par une autre prescription voisine.
  it(`${MATURATION_FILE} : le contrôle 1 prescrit de chercher LE NOM de l'entité, commentaires compris`, () => {
    const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    const controle1 = extractControle(corps, 1);
    expect(controle1, `${MATURATION_FILE} : contrôle 1 introuvable.`).not.toBeNull();
    expect(
      /grep/i.test(controle1) && controle1.includes('le nom') && controle1.includes('commentaires'),
      `${MATURATION_FILE} : le contrôle 1 ne prescrit plus explicitement de ` +
        `chercher LE NOM de l'entité modifiée (commentaires et ` +
        `mutations-témoins compris) — c'est exactement le trou qui a laissé ` +
        `passer 4 des 16 findings de maturation (SKILL-91 § Décision).`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer la prescription d'énumérer les cas d'une clause de
  // non-régression (garder seulement « relire ses clauses ») → rouge. C'est
  // le point qui absorbe l'héritage de SKILL-90 (§ Hors-scope de SKILL-91).
  // Assertion BORNÉE au bloc du contrôle 4 (`extractControle`), même raison
  // que ci-dessus.
  it(`${MATURATION_FILE} : le contrôle 4 prescrit d'énumérer les cas d'une clause de non-régression, pas « tous, sans retouche »`, () => {
    const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    const controle4 = extractControle(corps, 4);
    expect(controle4, `${MATURATION_FILE} : contrôle 4 introuvable.`).not.toBeNull();
    expect(
      controle4.includes('sans retouche') && controle4.includes('énumère'),
      `${MATURATION_FILE} : le contrôle 4 ne prescrit plus explicitement ` +
        `d'énumérer les cas d'une clause de non-régression au lieu d'écrire ` +
        `« tous, sans retouche » (SKILL-91 § Hors-scope, absorption de SKILL-90).`
    ).toBe(true);
  });

  // ⚠️ Mutation D1 (SKILL-93, § Tests item 2) : reformuler le contrôle 5 en une
  // prescription vague (« relire la spec avant de l'écrire ») qui ne nomme ni
  // CLAUDE.md ni package.json → rouge. Assertion BORNÉE au bloc du contrôle 5
  // (`extractControle`), même raison que ci-dessus pour les contrôles 1 et 4 :
  // une prescription qui glisserait au contrôle 4 doit rester détectable.
  //
  // ⚠️ SKILL-94 : le contrôle 5 n'est PLUS le dernier item de la liste — le
  // contrôle 7 l'est. La borne « ligne vide » de `extractControle`, ajoutée par
  // SKILL-93 pour ce cas précis, devient donc inopérante ICI (le contrôle 5 est
  // désormais borné par l'item 6, régime ordinaire) et opérante pour le
  // contrôle 7. L'ASSERTION ci-dessous, elle, est inchangée : le libellé du
  // contrôle 5 n'est pas retouché par ce ticket (§ Hors-scope de
  // specs/skill-94.md) — si elle rougit, c'est qu'un libellé existant a bougé.
  //
  // Calcule UNE FOIS le bloc du contrôle 5, pour les TROIS `it()` ci-dessous
  // qui l'assertionnent séparément — même remède que `blocControle7()`
  // (SKILL-96, finding de revue 4) appliqué ici pour ne pas recréer la
  // divergence qu'il corrige : recopier le même préambule (`extractSubsection`
  // + garde `corps` + `extractControle` + garde `controle5`) trois fois est
  // le défaut nommé par son propre commentaire (SKILL-95, finding de revue 4).
  function blocControle5() {
    const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
    return { corps, controle5: corps === null ? null : extractControle(corps, 5) };
  }

  it(`${MATURATION_FILE} : le contrôle 5 nomme CLAUDE.md et package.json, les deux porteurs à ouvrir dans le dépôt cible`, () => {
    const { corps, controle5 } = blocControle5();
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    expect(controle5, `${MATURATION_FILE} : contrôle 5 introuvable.`).not.toBeNull();
    expect(
      controle5.includes('CLAUDE.md') && controle5.includes('package.json'),
      `${MATURATION_FILE} : le contrôle 5 ne nomme plus les deux porteurs à ouvrir ` +
        `dans le dépôt cible (CLAUDE.md, package.json) — SKILL-93 § Décision D1.`
    ).toBe(true);
  });

  // T1 (SKILL-95 § Tests) — ⚠️ Mutation-témoin : retirer la phrase ajoutée par
  // SKILL-95 (la seconde source de permission) → rouge. Assertion BORNÉE au
  // bloc du contrôle 5 (`extractControle`), même raison que ci-dessus.
  // Opérande APLATI par `platir` : la prose est enroulée à ~78 colonnes, et
  // `impl-cross.md` peut tomber sur une ligne différente de `impl-same.md`
  // selon le point de coupure.
  it(`${MATURATION_FILE} : le contrôle 5 nomme la seconde source de permission (les deux modes d'emploi de sous-agent)`, () => {
    const { corps, controle5 } = blocControle5();
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    expect(controle5, `${MATURATION_FILE} : contrôle 5 introuvable.`).not.toBeNull();
    expect(
      platir(controle5).includes('impl-same.md') && platir(controle5).includes('impl-cross.md'),
      `${MATURATION_FILE} : le contrôle 5 ne nomme plus les deux modes ` +
        `d'emploi de sous-agent (\`prompts/impl-same.md\`, ` +
        `\`prompts/impl-cross.md\`) comme seconde source de permission ` +
        `— SKILL-95 § Décision D1.`
    ).toBe(true);
  });

  // T2 (SKILL-95 § Tests) — ⚠️ Mutation-témoin : remplacer la phrase de
  // routage par « ne jamais exiger de build dans une spec » → rouge. C'est le
  // test qui garde D2 (router, jamais interdire) : le risque principal du
  // ticket est qu'une reformulation fasse cesser d'exiger une vérification en
  // aval au lieu d'en changer le destinataire. Même bornage et aplatissement
  // que T1.
  it(`${MATURATION_FILE} : le contrôle 5 route (change de destinataire) au lieu d'interdire`, () => {
    const { corps, controle5 } = blocControle5();
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    expect(controle5, `${MATURATION_FILE} : contrôle 5 introuvable.`).not.toBeNull();
    expect(
      platir(controle5).includes('destinataire'),
      `${MATURATION_FILE} : le contrôle 5 ne mentionne plus le changement de ` +
        `DESTINATAIRE d'une vérification bloquée — sans ce mot, la clause ` +
        `risque de se lire comme une interdiction sèche au lieu d'un routage ` +
        `(SKILL-95 § Décision D2).`
    ).toBe(true);
  });

  // ⚠️ Mutation (SKILL-94 § Tests, cas 2) : renuméroter la liste en sautant un
  // rang (1, 2, 3, 4, 5, 7, 8) ou en inversant deux items → rouge. Le comptage
  // ci-dessus vérifie COMBIEN d'items existent, pas QUELS rangs ils portent :
  // sept items numérotés `1, 2, 3, 4, 5, 5, 6` le satisferaient, alors que les
  // bornes `extractControle(…, 6)` / `(…, 7)` deviendraient muettes ou
  // pointeraient sur le mauvais bloc. Ce test ferme cet angle : les rangs lus
  // dans l'ordre du fichier valent exactement 1..7. Lu sur `corpsListe`, comme
  // le comptage : une liste numérotée apparue dans le rituel D3 ne doit pas
  // faire accuser la liste des contrôles (cf. le découpage en deux régions).
  it(`${MATURATION_FILE} : les sept contrôles sont numérotés 1 à 7, contigus et dans l'ordre`, () => {
    const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    const rangs = (corpsListe(corps).match(/^\d+\.\s+\*\*/gm) || []).map((m) =>
      Number.parseInt(m, 10)
    );
    expect(
      rangs,
      `${MATURATION_FILE} : les rangs des contrôles lus dans l'ordre du fichier ` +
        `sont [${rangs.join(', ')}] — attendu [1, 2, 3, 4, 5, 6, 7] ` +
        `(SKILL-94 § Tests, cas 2).`
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  // ⚠️ Mutation (SKILL-94 § Tests, cas 4) : reformuler le contrôle 6 en une
  // prescription vague (« attention aux valeurs qui changent ») qui ne nomme ni
  // l'index de migration ni l'allocation concurrente → rouge. Ce sont les deux
  // moitiés de D1 : l'exemple canonique du cas réel (l'index `0055` pris par
  // une session parallèle entre la maturation et l'implémentation) ET le
  // critère qui le généralise. Assertion BORNÉE au bloc du contrôle 6
  // (`extractControle`), même raison que pour les contrôles 1, 4 et 5.
  it(`${MATURATION_FILE} : le contrôle 6 nomme l'index de migration et l'allocation concurrente`, () => {
    const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    const controle6 = extractControle(corpsListe(corps), 6);
    expect(controle6, `${MATURATION_FILE} : contrôle 6 introuvable.`).not.toBeNull();
    expect(
      platir(controle6).includes('index de migration') &&
        platir(controle6).includes('allocation concurrente'),
      `${MATURATION_FILE} : le contrôle 6 ne nomme plus l'index de migration ` +
        `(l'exemple qui a coûté une escalade E1 sur ONBOARD-03) et ` +
        `l'allocation concurrente (le critère qui le généralise) — ` +
        `SKILL-94 § Décision D1.`
    ).toBe(true);
  });

  // Calcule UNE FOIS le bloc du contrôle 7, pour les QUATRE `it()` ci-dessous
  // qui l'assertionnent séparément (SKILL-96, finding de revue 4) : les trois
  // premières versions de ces tests recopiaient littéralement le même
  // préambule (`extractSubsection` + garde `corps` + `extractControle` + garde
  // `controle7`) — exactement la divergence déjà survenue une fois dans ce
  // fichier entre les appelants de `extractControle(corps, n)` (contrôles 1,
  // 4, 5) et `extractControle(corpsListe(corps), n)` (contrôles 6, 7). Un seul
  // point d'accès referme cet écart pour le contrôle 7.
  function blocControle7() {
    const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
    return { corps, controle7: corps === null ? null : extractControle(corpsListe(corps), 7) };
  }

  // ⚠️ Mutation (SKILL-96 § Tests, cas 1) : rétablir le libellé d'origine
  // borné au seul état du dépôt (retirer « fait constatable ») → rouge. Le
  // contrôle 7 ne se borne plus à l'état du dépôt depuis SKILL-96 : il porte
  // sur tout FAIT CONSTATABLE, dépôt ou dépendance tierce. Assertion BORNÉE au
  // bloc du contrôle 7 (`extractControle`), qui reste le DERNIER item de la
  // liste : c'est sa borne « ligne vide » qui l'empêche d'absorber le rituel
  // de fermeture d'escalade (D3) écrit juste sous la liste.
  it(`${MATURATION_FILE} : le contrôle 7 porte sur un FAIT CONSTATABLE, pas seulement un état du dépôt`, () => {
    const { corps, controle7 } = blocControle7();
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    expect(controle7, `${MATURATION_FILE} : contrôle 7 introuvable.`).not.toBeNull();
    expect(
      platir(controle7).includes('fait constatable'),
      `${MATURATION_FILE} : le contrôle 7 ne porte plus sur un FAIT CONSTATABLE — ` +
        `il est retombé sur le seul état du dépôt (SKILL-96 § Décision).`
    ).toBe(true);
  });

  // Symétrique du test précédent : la moitié HISTORIQUE (état du dépôt), pas
  // la moitié nouvelle. SKILL-96 élargit le contrôle 7, il ne le RÉDUIT pas —
  // une réécriture qui garderait « fait constatable » et « dépendance tierce »
  // mais perdrait le cas qui a motivé le contrôle depuis SKILL-94 (liste,
  // régime, énumération, inventaire, seuil DU DÉPÔT) doit rougir ici, alors
  // qu'aucune des trois autres assertions de ce bloc ne l'aurait attrapée
  // (finding de revue 3).
  it(`${MATURATION_FILE} : le contrôle 7 couvre toujours L'ÉTAT DU DÉPÔT, pas seulement la dépendance tierce`, () => {
    const { corps, controle7 } = blocControle7();
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    expect(controle7, `${MATURATION_FILE} : contrôle 7 introuvable.`).not.toBeNull();
    expect(
      platir(controle7).includes('état du dépôt'),
      `${MATURATION_FILE} : le contrôle 7 ne nomme plus L'ÉTAT DU DÉPÔT — SKILL-96 ` +
        `élargit ce contrôle à la dépendance tierce, il ne remplace pas le cas ` +
        `qui le motive depuis SKILL-94 (SKILL-96 § Décision).`
    ).toBe(true);
  });

  // ⚠️ Mutation (SKILL-96 § Tests, cas 2) : réécrire le 7 sur le seul dépôt en
  // gardant « fait constatable » → rouge. Assertion SÉPARÉE de la précédente :
  // sans elle, la moitié « dépendance tierce » peut disparaître pendant que
  // « fait constatable » reste vert — le mode de défaillance documenté par
  // SKILL-94 § Tests cas 6 sur le rituel D3.
  it(`${MATURATION_FILE} : le contrôle 7 couvre le comportement d'une DÉPENDANCE TIERCE`, () => {
    const { corps, controle7 } = blocControle7();
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    expect(controle7, `${MATURATION_FILE} : contrôle 7 introuvable.`).not.toBeNull();
    expect(
      platir(controle7).includes('dépendance tierce'),
      `${MATURATION_FILE} : le contrôle 7 ne nomme plus le comportement d'une ` +
        `DÉPENDANCE TIERCE — c'est la moitié que SKILL-96 ajoute au contrôle ` +
        `(SKILL-96 § Décision).`
    ).toBe(true);
  });

  // ⚠️ Mutation (SKILL-96 § Tests, cas 3) : reformuler en « vérifier le
  // comportement de la dépendance » sans exiger la citation du moyen → rouge.
  // Sans cette obligation, le contrôle 7 est redondant avec le 5 : c'est
  // exactement la citation qui transforme une intention (« j'ai vérifié ») en
  // artefact rejouable, et rend visible à la relecture la clause qui n'en
  // porte aucune.
  it(`${MATURATION_FILE} : le contrôle 7 exige de CITER le moyen qui établit le fait énoncé`, () => {
    const { corps, controle7 } = blocControle7();
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    expect(controle7, `${MATURATION_FILE} : contrôle 7 introuvable.`).not.toBeNull();
    expect(
      platir(controle7).includes('cite ce moyen'),
      `${MATURATION_FILE} : le contrôle 7 n'exige plus que la spec CITE CE MOYEN ` +
        `— sans cette obligation de citation il est redondant avec le ` +
        `contrôle 5 (SKILL-96 § Décision).`
    ).toBe(true);
  });

  // Le rituel de fermeture d'escalade (D3) porte DEUX issues, testées
  // séparément : une assertion unique sur la présence du mot « escalade »
  // laisserait la moitié du dispositif disparaître sans rougir (SKILL-94
  // § Tests, cas 6).
  //
  // Les deux assertions sont BORNÉES à `blocRituel`, jamais à `corps` : sinon
  // la mutation « supprimer le titre `####` et réinjecter ses deux paragraphes
  // en lignes de continuation à l'intérieur du contrôle 3 » les laisse VERTES
  // (les trois marqueurs sont toujours quelque part sous le `###`), alors que
  // le rituel a cessé d'exister comme section repérable. C'est la doctrine
  // d'`extractControle` — n'assertionner QUE sur SON bloc — appliquée au grain
  // du `####`.
  //
  // ⚠️ Mutation : retirer la question fermée (« quel contrôle aurait dû
  // l'attraper ? ») ou l'issue « un numéro (1 à 7) » → rouge.
  // ⚠️ Mutation : supprimer le titre `#### Refermer une escalade E1 …` →
  // `blocRituel` rend `null`, les deux `it()` rougissent sur leur première
  // assertion.
  it(`${MATURATION_FILE} : le rituel de fermeture d'escalade exige un numéro de contrôle (1 à 7)`, () => {
    const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
    const rituel = blocRituel(corps);
    expect(
      rituel,
      `${MATURATION_FILE} : le titre "#### Refermer une escalade E1 …" est ` +
        `introuvable sous "### Méthode de maturation" — le rituel D3 n'existe ` +
        `plus comme section repérable (SKILL-94 § Décision D3).`
    ).not.toBeNull();
    expect(
      /quel contrôle de la méthode aurait dû l.attraper/i.test(platir(rituel)) &&
        platir(rituel).includes('un numéro (1 à 7)'),
      `${MATURATION_FILE} : le rituel de fermeture d'escalade ne pose plus la ` +
        `question fermée « quel contrôle de la méthode aurait dû l'attraper ? » ` +
        `avec sa PREMIÈRE issue, un numéro (1 à 7) — SKILL-94 § Décision D3.`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer la seconde issue (`aucun` → ouverture d'un
  // `SKILL-NN`) en gardant la première → rouge. C'est la moitié qui porte TOUTE
  // la boucle de retour : sans elle, un trou de méthode constaté reste non
  // ticketé, et la distinction « la méthode a un trou » / « je ne l'ai pas
  // suivie » disparaît.
  it(`${MATURATION_FILE} : le rituel de fermeture d'escalade exige, si « aucun », l'ouverture d'un SKILL-NN`, () => {
    const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
    const rituel = blocRituel(corps);
    expect(
      rituel,
      `${MATURATION_FILE} : le titre "#### Refermer une escalade E1 …" est ` +
        `introuvable sous "### Méthode de maturation".`
    ).not.toBeNull();
    expect(
      platir(rituel).includes('`aucun`') && platir(rituel).includes('`SKILL-NN`'),
      `${MATURATION_FILE} : le rituel de fermeture d'escalade ne porte plus sa ` +
        `SECONDE issue — la réponse \`aucun\`, qui exige en plus l'ouverture ` +
        `d'un ticket \`SKILL-NN\` sur la méthode elle-même (SKILL-94 § D3).`
    ).toBe(true);
  });

  // --- La plage du diagnostic suit le NOMBRE de contrôles (SKILL-94, reprise) -
  //
  // « 1 à 7 » est écrit en toutes lettres dans DEUX porteurs prescriptifs —
  // `rules/maturation.md` (le rituel D3, qui a quitté `CLAUDE.md` avec le reste
  // de la méthode, SKILL-97) et `commands/sdd-run-ticket.md` (cinquième
  // élément de l'Étape 6.6.5) — sans aucun lien mécanique avec le nombre de
  // contrôles réellement écrits. Une assertion littérale sur `1 à 7` reste
  // verte quand ce nombre change : c'est EXACTEMENT le motif que ce ticket
  // traite pour « cinq contrôles » (un nombre porté à plusieurs endroits, un
  // seul tenu par un test), rouvert par la plage qu'il introduit.
  //
  // La borne haute est donc DÉRIVÉE du comptage, jamais réécrite à la main.
  //
  // ⚠️ SKILL-97 : le PREMIER porteur suit la méthode. `CLAUDE.md` n'y figure
  // pas — la plage « 1 à N » elle-même n'y est PAS répétée (SKILL-100 ne
  // projette que les SEPT TITRES, pas le rituel D3 qui la porte), et l'y
  // laisser ferait rougir ce test pour la seule raison que le rituel n'a
  // jamais vécu dans `CLAUDE.md`, sans qu'aucun nombre ait bougé. Le noyau
  // des titres, lui, EST vérifié — par le test dédié de L1.4d, pas ici.
  //
  // ⚠️ Mutation : ajouter un huitième contrôle à `rules/maturation.md` et
  // mettre à jour les seuls `.toBe(7)` / `toEqual([1..7])` (le geste naturel)
  // → rouge ICI, sur les deux porteurs, tant que la plage dit encore « 1 à 7 ».
  // Sans ce test, le contrôle 8 ne pourrait jamais être cité comme diagnostic
  // et l'orchestrateur répondrait `aucun` pour une escalade que le contrôle 8
  // aurait attrapée — donc ouvrirait un ticket de méthode inutile, l'inverse
  // exact de ce que D3 sépare.
  const PORTEURS_PLAGE_DIAGNOSTIC = [MATURATION_FILE, 'commands/sdd-run-ticket.md'];

  for (const porteur of PORTEURS_PLAGE_DIAGNOSTIC) {
    it(`${porteur} : la plage du diagnostic « 1 à N » suit le nombre de contrôles de la méthode`, () => {
      const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
      expect(
        corps,
        `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
          `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
      ).not.toBeNull();
      const n = (corpsListe(corps).match(/^\d+\.\s+\*\*/gm) || []).length;
      expect(
        n,
        `${MATURATION_FILE} : aucun contrôle numéroté trouvé — la plage attendue ` +
          `serait indéterminée, ce test n'aurait RIEN vérifié.`
      ).toBeGreaterThan(0);
      const attendu = `un numéro (1 à ${n})`;
      expect(
        platir(readNorm(porteur)).includes(attendu),
        `${porteur} : la plage du diagnostic ne dit pas « ${attendu} », alors ` +
          `que ${MATURATION_FILE} porte ${n} contrôle(s) numéroté(s). Un contrôle ` +
          `ajouté ou retiré périme cette plage dans les DEUX porteurs ` +
          `prescriptifs (${PORTEURS_PLAGE_DIAGNOSTIC.join(', ')}) : mets-les ` +
          `à jour ensemble.`
      ).toBe(true);
    });
  }

  // --- Garde anti-régression transverse (SKILL-94 § Tests, cas 9) -----------
  //
  // Version EXÉCUTABLE du grep de constat du § Portée de specs/skill-94.md :
  // `grep -rn "cinq contrôles\|5 contrôles" --include=*.md`. Le comptage
  // ci-dessus tient CLAUDE.md ; rien ne tenait les AUTRES porteurs du nombre
  // périmé, qu'un futur ticket pourrait ressusciter ailleurs sans rougir.
  //
  // ⛔ L'exemption est une LISTE FERMÉE DE DEUX CHEMINS, jamais un motif large
  // du type « tout specs/ » — qui laisserait passer exactement le cas qu'on
  // veut attraper (une spec future qui recopie le nombre périmé comme s'il
  // était courant). Les deux exemptés le sont pour des raisons distinctes :
  // specs/skill-94.md cite la formule d'origine dans son § Problème (c'est SON
  // sujet) ; specs/skill-93.md est le compte rendu d'un ticket LIVRÉ, dont le
  // § Tests relate l'état attendu à SA date — le réécrire falsifierait un
  // compte rendu (§ Portée de specs/skill-94.md).
  //
  // ⚠️ Mutation : écrire « cinq contrôles » dans n'importe quel autre `.md` du
  // dépôt (ex. commands/mature.md) → rouge.
  //
  // --- Deux pièges refermés à la reprise de gate ----------------------------
  //
  // (a) « du DÉPÔT », pas « du disque ». Un `readdirSync` récursif depuis
  //     REPO_ROOT énumère tout ce qui est PRÉSENT, `.gitignore` compris — dans
  //     le checkout live (`~/.claude`), 363 `.md` non suivis contre 127 suivis :
  //     `projects/*/memory/*.md` écrits par `/reflect`, `memory/candidates/*`,
  //     `plugins/marketplaces/**` vendorés d'un dépôt étranger, `cache/`,
  //     `backups/`. La prochaine passe de `/reflect` qui distille un candidat
  //     sur la maturation ferait rougir `npm test` en désignant un fichier que
  //     le dépôt ne versionne pas, que le message ci-dessous interdit
  //     d'exempter, et que rien n'empêche de réapparaître. C'est aussi ce que
  //     l'en-tête de ce fichier interdit nommément (l. 28-34 : « Ne JAMAIS
  //     élargir au-delà … un test d'un repo qui va lire les fichiers d'un autre
  //     est un couplage qu'on ne maintiendra pas »). La liste vient donc de
  //     `git ls-files --cached --others --exclude-standard` : les suivis, PLUS
  //     le non-suivi NON ignoré — ce dernier étant le seul moment où un porteur
  //     est réellement *introduit* (même choix que le `git grep --untracked`
  //     déjà utilisé ~1 400 lignes plus haut, gardes `error`/`status`
  //     comprises).
  //
  // (b) L'enroulement. La prose de ce dépôt est justifiée à la main à ~78
  //     colonnes : un porteur dont la coupure tombe entre « cinq » et
  //     « contrôles » est le cas ORDINAIRE, pas une pathologie. Le motif tolère
  //     donc n'importe quel blanc entre les deux mots (`\s+`, qui couvre le
  //     `\n`) et se cherche sur le fichier ENTIER, pas ligne par ligne — le
  //     numéro de ligne rapporté étant recalculé depuis l'index du match.
  //     ⚠️ Mutation : écrire « ses cinq\ncontrôles » dans un `.md` non exempté
  //     → rouge (vert avec l'ancienne version ligne-à-ligne).
  const EXEMPTS_CINQ_CONTROLES = ['specs/skill-93.md', 'specs/skill-94.md'];
  const NOMBRE_PERIME_RE = /(?:cinq|5)\s+contrôles/g;

  // ⚠️ `platir` serait ici une FAUSSE bonne idée : il rendrait le motif
  // insensible à l'enroulement, mais détruirait les `\n` dont le numéro de
  // ligne rapporté est calculé. D'où `\s+` DANS le motif plutôt qu'un
  // aplatissement de l'opérande (cf. le ⛔ de l'en-tête du helper).
  function listerMdDuDepot() {
    const res = spawnSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
    expect(
      res.error,
      `git ls-files n'a pas pu s'exécuter (${res.error && res.error.message}) — ` +
        `ce test n'a RIEN vérifié.`
    ).toBeUndefined();
    expect(
      res.status,
      `git ls-files a rendu un code de sortie inattendu (${res.status}, stderr: ` +
        `${res.stderr}) — ce test n'a RIEN vérifié.`
    ).toBe(0);
    const fichiers = (res.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(
      fichiers.length,
      `git ls-files n'a rendu AUCUN .md — ce test n'a RIEN vérifié.`
    ).toBeGreaterThan(0);
    return [...new Set(fichiers)].sort();
  }

  it(`aucun .md du dépôt ne cite le nombre périmé « cinq contrôles » (hors les deux exemptés)`, () => {
    const fautifs = [];
    for (const rel of listerMdDuDepot()) {
      if (EXEMPTS_CINQ_CONTROLES.includes(rel)) continue;
      const raw = readNorm(rel);
      const re = new RegExp(NOMBRE_PERIME_RE.source, 'g');
      let m;
      while ((m = re.exec(raw)) !== null) {
        const ligne = raw.slice(0, m.index).split('\n').length;
        fautifs.push(`${rel}:${ligne}`);
      }
    }
    expect(
      fautifs,
      `Porteur(s) du nombre périmé de contrôles de maturation : ` +
        `${fautifs.join(', ')}. La méthode en porte SEPT depuis SKILL-94 ` +
        `(§ D1/D2). Seuls specs/skill-93.md (compte rendu d'un ticket livré) ` +
        `et specs/skill-94.md (qui cite la formule d'origine dans son ` +
        `§ Problème) sont exemptés — l'exemption est une liste fermée de deux ` +
        `chemins, ne l'élargis pas en motif.`
    ).toEqual([]);
  });

  // --- L1.4d (SKILL-100) — le noyau compact : projection, pas copie --------
  //
  // SKILL-97 avait écrit « ce pointeur ne résume rien — la méthode n'a qu'un
  // domicile » : ce ticket revient dessus. Sept lignes remontent dans
  // `CLAUDE.md`, un titre par contrôle, sans justification ni exemple. Le
  // risque que ce test existe pour attraper : deux copies d'un même texte
  // divergent en silence — un titre reformulé d'un côté, pas de l'autre.
  //
  // `NOYAU_HEADING_RE` cible la même sous-section `###` que le pointeur
  // existant (L1.4b ne la touche pas) : les sept lignes y sont insérées.
  const NOYAU_HEADING_RE = /^### Maturation — la méthode vit dans une règle, pas ici/;

  // Extrait, EN SÉQUENCE depuis le début du corps, les items numérotés
  // CONTIGUS À PARTIR DE 1 (continuation indentée comprise, l'item N+1 doit
  // valoir EXACTEMENT N+1). Sert les DEUX côtés — reprise de gate, finding 2 :
  // l'ancienne extraction du noyau était ligne-à-ligne et ne survivait pas à
  // un re-enroulement purement éditorial du titre 7. Ici, une continuation
  // (`/^\s+\S/`, ligne indentée non numérotée) rejoint l'item qui la précède,
  // aplatie par `platir` — jamais l'inverse : la ⛔ de `platir` (helper)
  // interdit de l'appliquer à la RECHERCHE de structure (le motif `^\d+\.`
  // ci-dessous porte sur les lignes BRUTES, non aplaties).
  //
  // La borne d'arrêt sert AUSSI de garde anti-régression (finding 5) : dès
  // que la séquence casse (numéro qui saute, ou ligne qui n'est ni un item
  // ni sa continuation) après le premier item, l'extraction s'arrête — même
  // doctrine que `corpsListe` côté règle (bornée au premier `#### `),
  // transposée à un côté qui n'a pas ce marqueur. Une prose reformatée en
  // `1. / 2. / 3.` PLUS LOIN dans la même sous-section (ex. les « trois cas »
  // sous le ⛔) est donc toujours précédée d'au moins une ligne non numérotée
  // et non indentée (le paragraphe qui l'introduit) : cette ligne rompt la
  // séquence avant que la fausse liste ne soit atteinte.
  //
  // Cette même contiguïté résout le finding 4 (numérotation, pas seulement
  // ordre) : un item renuméroté (ex. `6, 7` → `7, 8`) casse la séquence
  // attendue et n'est simplement plus COLLECTÉ — la longueur rendue baisse,
  // et la comparaison de longueur en aval rougit pour la bonne raison.
  function extraireItemsNumerotesContigus(corps) {
    const lignes = corps.split('\n');
    const items = [];
    for (let i = 0; i < lignes.length; i++) {
      const mNum = /^(\d+)\.\s+(\S.*)$/.exec(lignes[i]);
      if (mNum) {
        const numero = Number(mNum[1]);
        const attendu = items.length === 0 ? 1 : items[items.length - 1].numero + 1;
        if (numero !== attendu) break;
        let texte = mNum[2];
        let j = i + 1;
        while (j < lignes.length && /^\s+\S/.test(lignes[j])) {
          texte += ' ' + lignes[j].trim();
          j++;
        }
        items.push({ numero, texte: platir(texte).trim() });
        i = j - 1;
        continue;
      }
      if (items.length > 0) break;
    }
    return items;
  }

  // Titres CÔTÉ RÈGLE : la première phrase en gras de chaque item numéroté de
  // `corpsListe`. Le COMPTE est DÉRIVÉ, jamais réécrit à la main (finding 6 —
  // même doctrine que le voisin ligne ~3046 : « la borne haute est donc
  // DÉRIVÉE du comptage, jamais réécrite à la main » ; le nombre SEPT reste
  // vérifié par ailleurs par l'`it()` dédié « la méthode de maturation porte
  // SEPT contrôles distincts », pas ici).
  function titresRegle() {
    const corps = extractSubsection(readNorm(MATURATION_FILE), MATURATION_HEADING_RE);
    expect(
      corps,
      `${MATURATION_FILE} : "### Méthode de maturation" introuvable — la ` +
        `règle a perdu la section que ${CLAUDE_FILE} désigne (SKILL-97).`
    ).not.toBeNull();
    const liste = corpsListe(corps);
    const n = (liste.match(/^\d+\.\s+\*\*/gm) || []).length;
    const titres = [];
    for (let k = 1; k <= n; k++) {
      const bloc = extractControle(liste, k);
      expect(
        bloc,
        `${MATURATION_FILE} : contrôle ${k} introuvable — impossible d'en ` +
          `extraire le titre.`
      ).not.toBeNull();
      const m = /^\d+\.\s+\*\*([\s\S]*?)\*\*/.exec(bloc);
      expect(
        m,
        `${MATURATION_FILE} : le contrôle ${k} ne commence pas par un titre ` +
          `en gras — rien à comparer au noyau de ${CLAUDE_FILE}.`
      ).not.toBeNull();
      titres.push(platir(m[1]).trim());
    }
    return titres;
  }

  // Titres CÔTÉ NOYAU : les items numérotés CONTIGUS depuis 1 sous
  // `### Maturation — la méthode vit dans une règle, pas ici` dans
  // `CLAUDE.md`. Pas de `**` attendu ici (SKILL-100 § Portée 1 : « une ligne
  // par contrôle, son titre seul »).
  function titresNoyau() {
    const corps = extractSubsection(readNorm(CLAUDE_FILE), NOYAU_HEADING_RE);
    expect(
      corps,
      `${CLAUDE_FILE} : "### Maturation — la méthode vit dans une règle, pas ` +
        `ici" introuvable — le noyau n'a plus d'adresse.`
    ).not.toBeNull();
    return extraireItemsNumerotesContigus(corps).map((it) => it.texte);
  }

  // ⚠️ Mutations qui doivent rougir (SKILL-100 § Tests, une par une, + deux
  // ajoutées à la reprise de gate) :
  // 1. reformuler un titre dans `rules/maturation.md` sans toucher `CLAUDE.md` ;
  // 2. reformuler un titre dans `CLAUDE.md` sans toucher la règle ;
  // 3. retirer une des sept lignes du noyau (six contre sept) ;
  // 4. réordonner deux lignes du noyau — `toEqual` sur un tableau compare
  //    l'ORDRE, pas seulement l'ensemble : une comparaison ensembliste
  //    laisserait passer une numérotation mensongère, et les contrôles sont
  //    cités par leur NUMÉRO dans le rituel de fermeture d'escalade ;
  // 5. re-enrouler le titre 7 du noyau sur deux lignes (contenu identique,
  //    wrap purement éditorial) → DOIT rester vert (finding 2) ;
  // 6. renuméroter les deux derniers items du noyau (`6, 7` → `7, 8`) → DOIT
  //    rougir (finding 4), pas silencieusement passer.
  it(`${CLAUDE_FILE} : le noyau des sept titres est une PROJECTION du texte de ${MATURATION_FILE}, pas une copie`, () => {
    const attendus = titresRegle();
    const trouves = titresNoyau();
    expect(
      trouves.length,
      `${CLAUDE_FILE} : ${trouves.length} ligne(s) numérotée(s) trouvée(s), ` +
        `contiguës depuis 1, dans le noyau — ${attendus.length} attendue(s) ` +
        `(dérivé de ${MATURATION_FILE}).`
    ).toBe(attendus.length);
    expect(
      trouves,
      `${CLAUDE_FILE} : le noyau des sept titres diverge, dans l'ORDRE, du ` +
        `texte de ${MATURATION_FILE} (SKILL-100).`
    ).toEqual(attendus);
  });

  // --- L1.4d, suite (SKILL-109) — le préambule cesse d'énumérer -----------
  //
  // SKILL-104 a ajouté une QUATRIÈME section à `rules/maturation.md`
  // (« Portée conventionnelle ») sans toucher le préambule de CLAUDE.md, qui
  // continuait d'en énumérer TROIS — un aiguillage faux. La règle porte
  // toujours SEPT contrôles (invariant vérifié par ailleurs). Ce ticket remplace
  // l'énumération par une formule non close (D1 de specs/skill-109.md) :
  // « globale : elle porte tout ce qu'exige ce geste, et rien d'autre — les
  // contrôles ci-dessous n'en sont qu'une part. »
  //
  // Préambule, ISOLÉ : le corps de `NOYAU_HEADING_RE` (déjà déclaré en
  // L1.4d), borné au premier item numéroté (`/^\d+\.\s/`) — jamais la
  // sous-section entière, dont le ⛔ sous la liste parle de cross-repo, de
  // `specs/**/*.md` et de `..`, hors sujet ici.
  // ⚠️ `corps` peut être `null` (titre introuvable) OU vide (`''`, titre
  // immédiatement suivi d'un autre titre — le corps a été déplacé ailleurs) :
  // les deux DOIVENT rougir explicitement, jamais en silence via un
  // `TypeError` ou un `.includes()` trivialement faux sur une chaîne vide
  // (doctrine `__tests__/helpers/prompt-blocks.js` : « on renvoie `null`, que
  // l'appelant traduit en rouge EXPLICITE — jamais une chaîne vide »).
  function preambuleNoyau() {
    const corps = extractSubsection(readNorm(CLAUDE_FILE), NOYAU_HEADING_RE);
    expect(
      corps,
      `${CLAUDE_FILE} : "### Maturation — la méthode vit dans une règle, pas ` +
        `ici" introuvable — le noyau n'a plus d'adresse.`
    ).not.toBeNull();
    const lignes = corps.split('\n');
    const idx = lignes.findIndex((l) => /^\d+\.\s/.test(l));
    const brut = (idx === -1 ? lignes : lignes.slice(0, idx)).join('\n');
    expect(
      brut.trim().length > 0,
      `${CLAUDE_FILE} : le préambule du noyau est VIDE — son corps a été ` +
        `déplacé ailleurs, ou le titre est immédiatement suivi d'un autre ` +
        `titre.`
    ).toBe(true);
    return brut;
  }

  // Mutation-témoin : retirer « — les contrôles ci-dessous n'en sont qu'une
  // part » → rouge sur la seconde assertion seule, la première restant verte.
  //
  // ⚠️ Assertions de CONTENU (pas de structure) : `platir` avant `.includes()`
  // (doctrine `__tests__/helpers/prompt-blocks.js`), pour ne pas dépendre du
  // point d'enroulement à ~78 colonnes de la prose de ce dépôt.
  it(`${CLAUDE_FILE} : le préambule du noyau porte la formule non close (SKILL-109)`, () => {
    const preambule = platir(preambuleNoyau());
    expect(
      preambule.includes("ce qu'exige ce geste, et rien d'autre"),
      `${CLAUDE_FILE} : le préambule du noyau ne dit plus ce que ` +
        `${MATURATION_FILE} EST (« elle porte ce qu'exige ce geste, et rien ` +
        `d'autre ») — l'aiguillage a perdu sa première moitié (D1).`
    ).toBe(true);
    expect(
      preambule.includes("n'en sont qu'une part"),
      `${CLAUDE_FILE} : le préambule du noyau ne dit plus que les sept ` +
        `contrôles ci-dessous ne sont qu'une PART de ce que porte ` +
        `${MATURATION_FILE} — sans cette moitié, un lecteur qui voit sept ` +
        `titres numérotés conclut que la règle EST ces sept contrôles (D1).`
    ).toBe(true);
  });

  // Mutation-témoin : recoller l'énumération d'origine → rouge, et le
  // message nomme la locution retrouvée. Assertion BORNÉE au préambule de
  // CLAUDE.md, jamais au dépôt : les deux locutions restent vivantes et
  // légitimes dans `commands/mature.md`, `commands/reflect.md` et une
  // dizaine de specs. `platir` avant `.includes()`, même raison que ci-dessus
  // — l'énumération d'origine enjambe une ligne (« le rituel de\nfermeture »)
  // et l'assertion non aplatie la manquerait.
  it(`${CLAUDE_FILE} : le préambule du noyau n'inventorie plus ce que porte ${MATURATION_FILE} (SKILL-109)`, () => {
    const preambule = platir(preambuleNoyau());
    expect(
      preambule.includes('rituel de fermeture'),
      `${CLAUDE_FILE} : le préambule du noyau contient encore « rituel de ` +
        `fermeture » — l'énumération périmée (SKILL-104 a ajouté une ` +
        `quatrième section sans qu'elle en tienne compte) est revenue.`
    ).toBe(false);
    expect(
      preambule.includes('échelle de choix du modèle'),
      `${CLAUDE_FILE} : le préambule du noyau contient encore « échelle de ` +
        `choix du modèle » — l'énumération périmée (SKILL-104 a ajouté une ` +
        `quatrième section sans qu'elle en tienne compte) est revenue.`
    ).toBe(false);
  });

  // --- L1.5 — les sept passages retirés (volet A) ---------------------------
  //
  // Critère de retrait : le passage EXPLIQUE une mécanique qui a quitté le
  // skill (elle vit dans `tools/sdd/preflight.mjs` ou dans le générateur
  // d'agent-defs, tenue par LEURS tests). L'orchestrateur ne fait plus que
  // lire un champ du JSON : le piège documenté ne lui est plus atteignable.
  //
  // ⚠️ Mutation, pour chacun : recoller le paragraphe retiré → rouge.
  const PASSAGES_RETIRES = [
    ['P1 — Étape 1 : méta-résidu du tilde-piège', 'Le tilde-piège'],
    ['P2 — Étape 3.5 : justification du -C interne à l’outil', "n'est pas décoratif"],
    ['P3 — Étape 4.5 : algorithme de dérivation du worktree', "Le suffixe est l'ID en minuscules."],
    ['P4 — Étape 1.1 : comment l’outil scanne', 'dérivée de la machine'],
    ['P5a — Étape 6 : tableau de correspondance', 'palier officiel'],
    ['P5b — Étape 6 : description du générateur', 'Ces agent-defs sont **générés**'],
    ['P6 — Étape 6.1 : moitié explicative de la nuance transcription', 'ne pas sur-vendre le fix'],
    ['P7 — Étape 5.5 : mode de défaillance et sa parenthèse méta', 'il serait mangé'],
  ];

  for (const [label, anchor] of PASSAGES_RETIRES) {
    it(`${label} — "${anchor}" est absent de ${SDD_FILE}`, () => {
      expect(
        readNorm(SDD_FILE).includes(anchor),
        `${SDD_FILE} contient de nouveau "${anchor}" — cette prose explique une ` +
          `mécanique qui a quitté le skill ; elle est payée à CHAQUE invocation ` +
          `par tout orchestrateur, et le piège qu'elle documente n'est plus ` +
          `atteignable par lui (specs/skill-27.md, volet A).`
      ).toBe(false);
    });
  }

  // --- L1.6 — ce qui doit SURVIVRE au retrait ------------------------------
  //
  // Une compression trop zélée doit rougir ici.

  // ⚠️ Mutation : supprimer une section encore référencée (typiquement
  // l'Étape 1.1, citée par § Arguments et par l'Étape 4) → rouge. Les DEUX
  // bornes d'une plage `Étapes N à M` sont résolues.
  it(`${SDD_FILE} : toute référence "Étape N" pointe sur un titre existant`, () => {
    const raw = readNorm(SDD_FILE);
    const titles = new Set(
      [...raw.matchAll(/^##\s*Étape ([0-9]+(?:\.[0-9]+)?)/gm)].map((m) => m[1])
    );
    expect(
      titles.size,
      `${SDD_FILE} : aucun titre "## Étape N" — ce test n'a rien vérifié.`
    ).toBeGreaterThan(0);

    const refRe = /Étapes?\s+((?:[0-9]+(?:\.[0-9]+)?)(?:\s*(?:à|et|,)\s*[0-9]+(?:\.[0-9]+)?)*)/g;
    const refs = new Set();
    for (const m of raw.matchAll(refRe)) {
      for (const part of m[1].split(/\s*(?:à|et|,)\s*/)) refs.add(part);
    }
    const orphelines = [...refs].filter((r) => !titles.has(r));
    expect(
      orphelines,
      `${SDD_FILE} renvoie à ${JSON.stringify(orphelines)} sans qu'un titre ` +
        `"## Étape N" correspondant existe — une section encore citée a été ` +
        `supprimée par la compression.`
    ).toEqual([]);
  });

  // ⚠️ Mutation : réduire l'Étape 1.1 à son titre → rouge.
  it(`${SDD_FILE} : l'Étape 1.1 garde ses deux faits opératoires`, () => {
    const step11 = extractSection(readNorm(SDD_FILE), /^##\s*Étape 1\.1\b/);
    expect(step11, `${SDD_FILE} n'a plus de section "## Étape 1.1".`).not.toBeNull();
    expect(
      /cross-repo/.test(step11) && /Étape 5/.test(step11),
      `${SDD_FILE} : l'Étape 1.1 ne dit plus que la bascule en cross-repo est ` +
        `automatique MAIS confirmée par le récap de l'Étape 5.`
    ).toBe(true);
    expect(
      /relaie ce message et stoppe/i.test(step11),
      `${SDD_FILE} : l'Étape 1.1 ne prescrit plus « relaie ce message et ` +
        `stoppe » quand le ticket est introuvable — le geste est parti avec ` +
        `l'explication.`
    ).toBe(true);
  });

  // ⚠️ Mutation : emporter le geste avec sa justification → rouge.
  it(`${SDD_FILE} : l'Étape 3.5 garde guards.specOnMain et ses deux branches`, () => {
    const step35 = extractSection(readNorm(SDD_FILE), /^##\s*Étape 3\.5\b/);
    expect(step35, `${SDD_FILE} n'a plus de section "## Étape 3.5".`).not.toBeNull();
    expect(step35).toContain('guards.specOnMain');
    expect(
      /`true`\s*→/.test(step35) && /`false`\s*→/.test(step35),
      `${SDD_FILE} : l'Étape 3.5 ne porte plus ses deux branches (\`true\` → ` +
        `continuer, \`false\` → stopper) — le garde-fou ne prescrit plus rien.`
    ).toBe(true);
    expect(/stopper/i.test(step35)).toBe(true);
  });

  // ⚠️ Même mutation, même raison.
  //
  // ⚠️ SKILL-54 — CIBLE DE LECTURE REPOINTÉE, assertion inchangée. Le corps de
  // l'Étape 4.5 a quitté le skill pour `steps/cross-repo.md` (chargement
  // paresseux : l'orchestrateur ne le lit qu'en mode cross-repo). Les deux
  // garde-fous qu'exigeait SKILL-27 sont exactement les mêmes, sur le même
  // texte, à sa nouvelle adresse — rien n'est relâché : ce qui bouge est le
  // fichier lu, pas ce qui est vérifié. Même geste, et même borne, que le
  // repointage du helper `etape645` d'`aggregator-wiring.test.js`
  // (specs/skill-54.md, D5.a).
  //
  // ⛔ Ne PAS résoudre ce repointage en cherchant dans l'union du skill et de
  // `steps/` : chercher dans deux fichiers rouvre le faux-négatif « la présence
  // ailleurs masque la disparition » (famille I1 ci-dessus). Une assertion lit
  // UN fichier — celui qui porte le comportement.
  //
  // ⚠️ SKILL-106 : troisième garde-fou ajouté (`guards.branchFree`), aucun
  // retiré — le titre et l'assertion passent de « deux » à « trois ».
  it(`steps/cross-repo.md : l'Étape 4.5 garde ses trois assertions de garde-fou`, () => {
    const step45 = extractSection(readNorm('steps/cross-repo.md'), /^##\s*Étape 4\.5\b/);
    expect(
      step45,
      `steps/cross-repo.md n'a plus de section "## Étape 4.5".`
    ).not.toBeNull();
    expect(step45).toContain('guards.worktreeUnderTarget');
    expect(step45).toContain('guards.worktreePathFree');
    expect(step45).toContain('guards.branchFree');
  });

  // ⚠️ Mutation : retirer le paragraphe entier au lieu de sa moitié
  // explicative → rouge. L'impératif survit au retrait de la nuance.
  it(`${SDD_FILE} : l'Étape 6.1 garde l'impératif <SHA_IMPL> verbatim`, () => {
    const step61 = extractSection(readNorm(SDD_FILE), /^##\s*Étape 6\.1\b/);
    expect(step61, `${SDD_FILE} n'a plus de section "## Étape 6.1".`).not.toBeNull();
    const paragraphs = step61.split('\n\n');
    expect(
      paragraphs.some((p) => p.includes('<SHA_IMPL>') && /verbatim/i.test(p)),
      `${SDD_FILE} : aucun paragraphe de l'Étape 6.1 ne réunit \`<SHA_IMPL>\` et ` +
        `« verbatim » — la copie du SHA vers le prompt du relecteur (Étape 6.3) ` +
        `est manuelle, et c'est le seul endroit qui l'encadre.`
    ).toBe(true);
  });

  // ⚠️ Mutation : vider le commentaire du bloc bash → rouge.
  it(`${SDD_FILE} : l'Étape 5.5 garde le ⛔ de son commentaire bash et le mot sed`, () => {
    const raw = readNorm(SDD_FILE);
    const step55 = extractSection(raw, /^##\s*Étape 5\.5\b/);
    expect(step55, `${SDD_FILE} n'a plus de section "## Étape 5.5".`).not.toBeNull();
    const comments = step55
      .split('\n')
      .filter((l) => l.trimStart().startsWith('#'))
      .join('\n');
    expect(
      comments.includes('⛔'),
      `${SDD_FILE} : le commentaire du bloc bash de l'Étape 5.5 a perdu son ⛔ — ` +
        `l'interdiction « aucun dollar suivi d'un chiffre » n'est plus écrite là ` +
        `où on la lirait.`
    ).toBe(true);
    expect(
      comments.includes('sed'),
      `${SDD_FILE} : le commentaire du bloc bash de l'Étape 5.5 ne justifie plus ` +
        `le recours à \`sed\` — un correcteur y remettrait un awk positionnel.`
    ).toBe(true);
  });
});

describe('N1 (SKILL-58) — commands/reflect.md nomme le chemin absolu du pool global', () => {
  // Test de FORME (specs/skill-58.md § Tests). Avant SKILL-58, la destination
  // `global` du palier `candidate` (SKILL-17) était décrite par DÉRIVATION du
  // cwd (« mémoire de claude-config, son propre `projects/<…>/memory/` ») —
  // une description qu'aucune session ne résout jamais vers le même dossier
  // (specs/skill-58.md, § Cause racine). Deux invariants à ne pas perdre en
  // silence : le mineur NOMME un chemin absolu, et il ne redécrit plus la
  // destination par la dérivation fautive.
  const FILE = 'commands/reflect.md';
  const STEP1_RE = /^##\s*Étape 1\b/;

  // Chemin absolu attendu : $HOME/.claude/memory/candidates (les deux formes
  // `$HOME/.claude/…` et `~/.claude/…` désignent le même chemin dans ce repo,
  // cf. le motif déjà utilisé par D2/SKILL-07-08 plus haut — on tolère les
  // deux graphies plutôt que d'en figer une seule).
  const ABSOLUTE_POOL_RE = /(\$HOME|~)\/\.claude\/memory\/candidates/;

  // Ancré à la SECTION `## Étape 1` (comme I1 sur ce même fichier cible, cf.
  // son commentaire d'ouverture — finding de gate SKILL-58 : une assertion
  // whole-file laisserait une mention posée ailleurs, ex. le bloc bash de
  // l'Étape 5 ou le template de Récap, masquer la disparition de l'info à
  // l'endroit où le mineur charge réellement ses entrées).
  //
  // ⚠️ Mutation : retirer du corps de l'Étape 1 toute mention de
  // `$HOME/.claude/memory/candidates` (ou `~/.claude/memory/candidates`),
  // même si elle survit ailleurs dans le fichier → rouge.
  it(`${FILE} nomme, dans son étape « Lire » (Étape 1), le chemin absolu du pool global`, () => {
    const raw = readCommandFile(FILE);
    const step1 = extractSection(raw, STEP1_RE);
    expect(step1, `${FILE} n'a pas de section « ## Étape 1 ».`).not.toBeNull();
    expect(
      ABSOLUTE_POOL_RE.test(step1),
      `${FILE} : l'Étape 1 ne nomme plus le chemin absolu du pool global ` +
        `(\`$HOME/.claude/memory/candidates\` ou \`~/.claude/memory/candidates\`) — ` +
        `le mineur ne sait plus où lire ce pool (specs/skill-58.md).`
    ).toBe(true);
  });

  // Assertion NÉGATIVE (specs/skill-58.md § Tests), calibrée sur la
  // formulation RÉELLEMENT fautive d'avant SKILL-58 (celle qu'a remplacée le
  // correctif de ce ticket dans commands/reflect.md), pas sur une variante
  // artificielle : « Sur un projet **global** (claude-config), les candidats
  // tagués `global` s'accumulent dans ce même pool — c'est voulu (…) » — un
  // paragraphe qui lie la portée `global` à un pool/une accumulation SANS
  // jamais nommer de chemin absolu à côté (le pool visé était en réalité
  // `projects/<clé>/memory/`, du Pré-requis, jamais cité littéralement DANS ce
  // paragraphe précis). Un motif qui exigeait un littéral `projects/<…>/` DANS
  // le même paragraphe ne l'aurait donc jamais attrapé (finding de gate
  // SKILL-58, vérifié : offenders = [] sur ce texte avec l'ancien motif). Le
  // motif retenu ci-dessous est rejoué ligne suivante contre ce texte exact,
  // pour prouver qu'il rougit réellement dessus (SDD, « les tests doivent
  // rater ») plutôt que de l'affirmer en commentaire.
  const FAUTIVE_TEXT_BEFORE_FIX =
    'Sur un projet **global** (claude-config), les candidats tagués `global` ' +
    "s'accumulent dans ce même pool — c'est voulu (le scan cross-projet reste " +
    'SKILL-20).';

  function fautiveParagraphs(raw) {
    return raw
      .split(/\r?\n\r?\n/)
      .filter((p) => /`global`/.test(p) && /(pool|s'accumulent)/i.test(p) && !ABSOLUTE_POOL_RE.test(p));
  }

  // Mutation-témoin REJOUÉE (pas seulement documentée) : le prédicat doit
  // rougir sur le texte réel d'avant-correctif, sinon il ne prouve rien.
  it('le prédicat de non-régression rougit bien sur le texte réel d\'avant SKILL-58', () => {
    expect(
      fautiveParagraphs(FAUTIVE_TEXT_BEFORE_FIX).length,
      `Le prédicat ne détecte pas la formulation fautive réelle d'avant SKILL-58 ` +
        `— il ne garderait donc pas la régression qu'il prétend fermer.`
    ).toBeGreaterThan(0);
  });

  // ⚠️ Mutation : réintroduire un paragraphe qui lie `global` à un pool/une
  // accumulation sans jamais nommer le chemin absolu à côté → rouge.
  it(`${FILE} ne décrit plus la destination global par un pool sans chemin absolu`, () => {
    const raw = readCommandFile(FILE);
    const offenders = fautiveParagraphs(raw);
    expect(
      offenders,
      `${FILE} redécrit la destination \`global\` par un pool/une accumulation ` +
        `sans jamais nommer de chemin absolu — c'est le défaut que SKILL-58 ` +
        `corrige (specs/skill-58.md, § Cause racine) : ${JSON.stringify(offenders)}`
    ).toEqual([]);
  });

  // Retiré (finding de gate, reprise SKILL-20, #12) : l'assertion qui vivait
  // ici (« ${FILE} référence toujours SKILL-20 », whole-file `/SKILL-20/`)
  // était devenue vacue. Elle contrôlait, au moment où N1 (SKILL-58) a été
  // écrit, que le § « Mode projet uniquement » — vrai alors, SKILL-20 hors
  // scope — restait accompagné de son renvoi. SKILL-20 EST maintenant ce
  // ticket : le jeton « SKILL-20 » apparaît 5+ fois ailleurs dans le fichier
  // (titre, intro, § Pré-requis, Étape 1, Étape 2…) pour des raisons qui
  // n'ont RIEN à voir avec ce que N1 (SKILL-58, le chemin du pool global)
  // protège — supprimer TOUT le § Scan cross-projet laisserait ce test vert
  // (vérifié). Une assertion qui ne peut plus rougir sur aucune régression
  // plausible du dispositif qu'elle nomme ne garde rien : mieux vaut la
  // retirer que la laisser sous ce nom (elle induirait un relecteur en erreur
  // sur ce qu'elle couvre). La couverture réelle du § Scan cross-projet vit
  // maintenant dans la famille O1 ci-dessous.
});

describe('O1 (SKILL-20) — mode global par défaut + scan cross-projet en mode explicite', () => {
  // Test de FORME du skill commands/reflect.md (specs/skill-20.md § Tests).
  // Une assertion par décision (D1-D6), chacune avec sa mutation-témoin
  // documentée. ⛔ Aucun test sur le CONTENU du pool global (§ Décision de la
  // spec : il est vide, un tel test serait vert par vacuité). Ce ticket teste
  // la FORME du skill, pas des données — même discipline que I1/N1 sur ce même
  // fichier.
  const FILE = 'commands/reflect.md';
  const SCAN_SECTION_RE = /^##\s*Scan cross-projet\b/;

  // Comme extractSection mais s'arrête au prochain `## ` OU `### ` — pour
  // isoler une SOUS-section précise (ex. « ### Dossiers orphelins ») sans
  // absorber la sous-section suivante. Même fonction que celle de J1/SKILL-19
  // sur ce même fichier de test, non partagée (D3 des helpers : chaque test
  // déclare sa propre liste de contrôle, cf. helpers/prompt-blocks.js).
  function extractSubsection(raw, headingRe) {
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
      if (/^#{2,3}\s/.test(lines[j])) break;
      out.push(lines[j]);
    }
    return out.join('\n');
  }

  // Test D1 — le scan n'est pas le défaut. ⚠️ Mutation-témoin OBLIGATOIRE ici
  // (specs/skill-20.md, § Tests) : c'est l'assertion la plus facile à rendre
  // verte par accident, puisque le mot « scan » apparaîtra de toute façon
  // ailleurs dans le fichier (ex. le titre de la nouvelle section elle-même).
  //
  // ⚠️ Vérifié en écrivant ce test : une première version en co-présence
  // WHOLE-FILE (scan + mode explicite + jamais + défaut n'importe où) restait
  // VERTE après avoir vidé le paragraphe d'intro de sa négation — le bullet du
  // § Règles strictes (« Mode … actifs par défaut. Le scan … mode explicite …
  // jamais le déclenchement … ») réunit, À LUI SEUL, les quatre mêmes mots
  // (rejoué et confirmé : rouge attendu resté vert). On ANCRE donc au premier
  // PARAGRAPHE de la section `## Scan cross-projet` elle-même — celui qui
  // porte la déclaration opérative « ne s'active que sur demande / jamais le
  // défaut » — pas au whole-file.
  // ⚠️ Mutation : retirer « jamais le défaut » du premier paragraphe de la
  // section « ## Scan cross-projet » (en laissant le reste du fichier intact,
  // y compris le bullet de Règles strictes) → rouge (rejoué : confirmé).
  it(`${FILE} dit, dans sa section « Scan cross-projet », que ce mode est explicite et jamais le défaut (D1)`, () => {
    const raw = readCommandFile(FILE);
    const scanSection = extractSection(raw, SCAN_SECTION_RE);
    expect(
      scanSection,
      `${FILE} n'a pas de section « ## Scan cross-projet » (specs/skill-20.md, D1).`
    ).not.toBeNull();
    const firstParagraph = scanSection.split(/\r?\n\r?\n/)[0] || '';
    expect(
      /scan/i.test(firstParagraph) &&
        /(mode explicite|ne s'active que sur demande)/i.test(firstParagraph) &&
        /jamais/i.test(firstParagraph) &&
        /d[ée]faut/i.test(firstParagraph),
      `${FILE} : le premier paragraphe de la section Scan cross-projet ne réunit ` +
        `plus « scan », « mode explicite »/« ne s'active que sur demande » et ` +
        `« jamais »/« défaut » — le scan cross-projet pourrait se lire comme un ` +
        `comportement par défaut, ce que D1 interdit explicitement ` +
        `(specs/skill-20.md, D1). Paragraphe lu : ${JSON.stringify(firstParagraph)}`
    ).toBe(true);
  });

  // Test D2 — les deux populations se clusterisent séparément. Ancré à la
  // SECTION `## Étape 2` (comme I1/N1 sur ce même fichier) : le seuil doit
  // être dit « séparé »/« distinctement » à L'ENDROIT où le clustering a lieu,
  // pas ailleurs dans le fichier.
  // ⚠️ Mutation : retirer de l'Étape 2 la phrase sur la séparation des deux
  // populations → rouge.
  it(`${FILE} dit que le seuil se compte séparément dans chaque population (D2, Étape 2)`, () => {
    const raw = readCommandFile(FILE);
    const step2 = extractSection(raw, /^##\s*Étape 2\b/);
    expect(
      step2,
      `${FILE} n'a pas de section « ## Étape 2 » — l'étape « Clusteriser » a ` +
        `disparu (specs/skill-20.md, D2).`
    ).not.toBeNull();
    expect(
      /(s[ée]par[ée]ment|distinctement)/i.test(step2) && /population/i.test(step2),
      `${FILE} : le corps de l'Étape 2 ne dit plus que le seuil se compte ` +
        `séparément dans chaque population — le pool global et le pool du ` +
        `projet pourraient se retrouver fusionnés avant clustering ` +
        `(specs/skill-20.md, D2).`
    ).toBe(true);
  });

  // Test D3 — le seuil du scan est en projets DISTINCTS.
  //
  // ⚠️ Revue (finding de gate, reprise SKILL-20, #4a) : une première version
  // cherchait « distinct(s) » dans TOUTE la section Scan cross-projet — or ce
  // mot y apparaît à QUATRE endroits (intro, deux fois DANS le paragraphe du
  // seuil lui-même — la phrase-titre ET sa phrase de clôture « deux dans deux
  // projets distincts, après repli » — et dans « Lecture en deux temps »). La
  // mutation documentée à l'origine (remplacer seulement « projets DISTINCTS »
  // par « occurrences » dans la phrase-titre) restait donc VERTE — rejoué,
  // confirmé — parce que la phrase de clôture, DANS LE MÊME PARAGRAPHE,
  // répète déjà « distincts ». On ANCRE au PARAGRAPHE qui porte le seuil
  // (celui qui commence par « Le seuil se compte ») plutôt qu'à toute la
  // section — mais la mutation-témoin RÉELLE doit retirer « distinct(s) » des
  // DEUX phrases de ce paragraphe pour rougir, pas d'une seule : rejoué avec
  // les deux retirées, confirmé rouge.
  // ⚠️ Mutation : dans le paragraphe du seuil, remplacer À LA FOIS
  // « projets DISTINCTS » (phrase-titre) ET « deux projets distincts »
  // (phrase de clôture) par une formulation sans « distinct » (en laissant les
  // mentions de « distincts » intactes ailleurs dans la section) → rouge
  // (rejoué : confirmé). Retirer une SEULE des deux occurrences ne suffit pas
  // — l'autre porte encore le concept, ce qui est le comportement voulu du
  // texte (redondance délibérée dans le même paragraphe), pas un trou du test.
  it(`${FILE} compte le seuil du scan en projets distincts, pas en occurrences (D3)`, () => {
    const raw = readCommandFile(FILE);
    const scanSection = extractSection(raw, SCAN_SECTION_RE);
    expect(
      scanSection,
      `${FILE} n'a pas de section « ## Scan cross-projet » (specs/skill-20.md, D3-D6).`
    ).not.toBeNull();
    const paragraphs = scanSection.split(/\r?\n\r?\n/);
    const seuilParagraph = paragraphs.find((p) => /le seuil se compte/i.test(p));
    expect(
      seuilParagraph,
      `${FILE} : aucun paragraphe de la section Scan cross-projet ne commence par ` +
        `« Le seuil se compte » — le garde-fou D3 a disparu (specs/skill-20.md, D3).`
    ).toBeDefined();
    expect(
      /distincts?/i.test(seuilParagraph),
      `${FILE} : le paragraphe du seuil (« Le seuil se compte … ») ne contient ` +
        `plus « distinct(s) » — il pourrait se relire comme comptant des ` +
        `occurrences plutôt que des projets distincts (specs/skill-20.md, D3). ` +
        `Paragraphe lu : ${JSON.stringify(seuilParagraph)}`
    ).toBe(true);
  });

  // Test D4 — lecture en deux temps : `description` d'abord, corps différé.
  //
  // ⚠️ Revue (finding de gate, reprise SKILL-20, #4b) : une première version
  // cherchait « description » ET « corps » n'importe où dans TOUTE la section
  // Scan cross-projet — or « description » y apparaît aussi dans « Critère de
  // récurrence » (un propos différent : le JUGEMENT de similarité, pas
  // l'ORDRE de lecture) et dans l'intro. La mutation documentée (retirer la
  // mention de « description » comme ce que lit la passe de corrélation)
  // laissait donc ces deux autres occurrences faire passer le test au vert —
  // rejoué, confirmé vert, donc faux. On ANCRE au PARAGRAPHE unique qui
  // déclare l'ORDRE de lecture lui-même (celui qui commence par « La passe de
  // corrélation ne lit que »), qui réunit déjà `description` ET `corps` dans
  // la MÊME phrase.
  // ⚠️ Mutation : retirer la mention de « description » de CE paragraphe
  // précis (en laissant les autres mentions de « description » intactes
  // ailleurs dans la section) → rouge (rejoué : confirmé).
  it(`${FILE} lit "description" d'abord, le corps seulement si apparié (D4)`, () => {
    const raw = readCommandFile(FILE);
    const scanSection = extractSection(raw, SCAN_SECTION_RE);
    expect(scanSection).not.toBeNull();
    const paragraphs = scanSection.split(/\r?\n\r?\n/);
    const lectureParagraph = paragraphs.find((p) => /la passe de corr[ée]lation ne lit que/i.test(p));
    expect(
      lectureParagraph,
      `${FILE} : aucun paragraphe de la section Scan cross-projet ne commence par ` +
        `« La passe de corrélation ne lit que » — la lecture en deux temps a ` +
        `disparu (specs/skill-20.md, D4).`
    ).toBeDefined();
    expect(
      /description/i.test(lectureParagraph),
      `${FILE} : le paragraphe de lecture ne nomme plus « description » comme ` +
        `ce que lit la passe de corrélation (specs/skill-20.md, D4). Paragraphe ` +
        `lu : ${JSON.stringify(lectureParagraph)}`
    ).toBe(true);
    expect(
      /corps/i.test(lectureParagraph),
      `${FILE} : le paragraphe de lecture ne mentionne plus le « corps » comme ` +
        `lecture différée (specs/skill-20.md, D4). Paragraphe lu : ` +
        `${JSON.stringify(lectureParagraph)}`
    ).toBe(true);
  });

  // Test D5 — les dossiers écartés sont nommés dans le rapport.
  //
  // ⚠️ Revue (finding de gate, reprise SKILL-20, #5) : une première version
  // cherchait « écarté(s) » + « nomme » n'importe où dans TOUTE la section
  // Scan cross-projet — TAUTOLOGIQUE : le § « Critère de récurrence » contient
  // déjà « la correspondance exacte du slug `name:` est **écartée** » et
  // « ne la **nomment** presque jamais pareil », qui satisfont à eux seuls la
  // co-présence — vérifié en supprimant TOUTE la sous-section
  // « ### Dossiers orphelins » : le test restait vert. On ANCRE donc à la
  // SOUS-section `### Dossiers orphelins` elle-même (via `extractSubsection`,
  // qui s'arrête au prochain `##`/`###`), qui ne partage aucun mot avec le
  // § Critère de récurrence.
  // ⚠️ Mutation : supprimer toute la sous-section « ### Dossiers orphelins »
  // → rouge (rejoué : confirmé — l'ancienne version restait verte sur cette
  // même mutation, c'est le défaut que cette version ferme).
  it(`${FILE} dit que le rapport nomme les dossiers orphelins écartés (D5)`, () => {
    const raw = readCommandFile(FILE);
    const orphelins = extractSubsection(raw, /^###\s*Dossiers orphelins\b/);
    expect(
      orphelins,
      `${FILE} n'a pas de sous-section « ### Dossiers orphelins » — le garde-fou ` +
        `D5 a disparu (specs/skill-20.md, D5).`
    ).not.toBeNull();
    expect(
      /[ée]cart[ée]s?/i.test(orphelins) && /nomme/i.test(orphelins),
      `${FILE} : la sous-section Dossiers orphelins ne réunit plus « écarté(s) » ` +
        `et « nomme » — le rapport pourrait sauter des dossiers orphelins en ` +
        `silence (specs/skill-20.md, D5).`
    ).toBe(true);
  });

  // Test D6 — le scan ne déplace rien sans validation, et le re-routage
  // DÉPLACE (pas ne copie).
  // ⚠️ Mutation (a) : retirer « aucun déplacement sans validation » → rouge.
  // ⚠️ Mutation (b) : remplacer « déplace » par « copie » dans le paragraphe du
  // re-routage effectif → rouge (la co-présence déplace+pas-copie disparaît).
  it(`${FILE} ne déplace rien sans validation, et le re-routage déplace (pas copie) (D6)`, () => {
    const raw = readCommandFile(FILE);
    const scanSection = extractSection(raw, SCAN_SECTION_RE);
    expect(scanSection).not.toBeNull();
    expect(
      /validation/i.test(scanSection) && /(aucun d[ée]placement|ne d[ée]place rien)/i.test(scanSection),
      `${FILE} : la section Scan cross-projet ne dit plus « aucun déplacement » ` +
        `+ « validation » — le garde-fou D6 a disparu (specs/skill-20.md, D6).`
    ).toBe(true);
    const paragraphs = scanSection.split(/\r?\n\r?\n/);
    const hasMoveNotCopy = paragraphs.some(
      (p) => /d[ée]place/i.test(p) && /ne le\s*\*{0,2}copie pas\*{0,2}|\(il ne le/i.test(p)
    );
    expect(
      hasMoveNotCopy,
      `${FILE} : aucun paragraphe de la section Scan cross-projet ne dit que le ` +
        `re-routage effectif DÉPLACE le fichier (et ne le copie pas) ` +
        `(specs/skill-20.md, D6).`
    ).toBe(true);
  });

  // Test — le chemin du pool global apparaît dans § Pré-requis. ⚠️ Ne duplique
  // PAS N1 (SKILL-58) : N1 assert déjà la présence du chemin absolu dans
  // l'Étape 1 (là où le mineur charge réellement ses entrées). CETTE
  // assertion-ci porte sur la SECTION Pré-requis (là où le skill DOCUMENTE la
  // localisation des dossiers mémoire, avant toute étape d'exécution) —
  // section distincte, propos distinct (specs/skill-20.md, § Tests, dernier
  // point).
  // ⚠️ Mutation : retirer du corps de « ## Pré-requis » toute mention de
  // `$HOME/.claude/memory/candidates` (ou `~/.claude/memory/candidates`),
  // même si elle survit dans l'Étape 1 → rouge.
  it(`${FILE} nomme le chemin absolu du pool global dans § Pré-requis`, () => {
    const raw = readCommandFile(FILE);
    const prerequis = extractSection(raw, /^##\s*Pr[ée]-requis\b/);
    expect(
      prerequis,
      `${FILE} n'a pas de section « ## Pré-requis ».`
    ).not.toBeNull();
    expect(
      /(\$HOME|~)\/\.claude\/memory\/candidates/.test(prerequis),
      `${FILE} : la section Pré-requis ne nomme plus le chemin absolu du pool ` +
        `global — la § Pré-requis du § Portée de specs/skill-20.md (D1) a disparu.`
    ).toBe(true);
  });
});

describe('O1 (SKILL-54) — chargement paresseux : les sections conditionnelles vivent dans steps/', () => {
  // specs/skill-54.md, § Décision. Quatre sections du skill n'étaient JAMAIS
  // lues dans un cycle donné (les blocs cross-repo quand le mode est
  // « même repo », le corps de l'agrégation quand le dosage est `light`) et
  // pesaient pourtant à CHAQUE tour de l'orchestrateur, qui relit son skill en
  // entier. Leur corps est parti dans `steps/*.md` — un dossier dont le lecteur
  // est le MÊME orchestrateur, au MÊME moment du cycle (D1) : ce qui change est
  // le moment de la lecture, à la demande au lieu d'à chaque tour. Ce n'est donc
  // pas le déménagement vers `prompts/` que verrouille S3 de SKILL-27 (dont le
  // lecteur, lui, serait un sous-agent).
  //
  // ⚠️ Chaque assertion porte en commentaire la MUTATION qui doit la faire
  // rougir (convention de ce repo).
  const SKILL = 'commands/sdd-run-ticket.md';
  const STEPS_CROSS = 'steps/cross-repo.md';
  const STEPS_REVIEW_DEEP = 'steps/review-deep.md';

  const readO1 = (rel) => readCommandFile(rel).replace(/\r\n/g, '\n');

  // Les quatre sections déplacées, DÉCLARÉES ICI (D3 : jamais dérivées du
  // fichier contrôlé). Pour chacune :
  //   - `headingRe`   : le titre resté dans le skill (le retirer casserait les
  //                     renvois « Étape N » que L1.6 résout déjà) ;
  //   - `cible`       : le `steps/*.md` qui porte désormais le corps ;
  //   - `conditionRe` : la condition de lecture, que le pointeur doit énoncer —
  //                     sans elle, l'orchestrateur lit les quatre fichiers à
  //                     chaque cycle et la compression est annulée ;
  //   - `ancreCorps`  : une ancre du CORPS déplacé, vérifiée absente du skill
  //                     ET présente dans la cible. Chaque ancre est unique dans
  //                     le skill d'avant retrait (vérifié à l'écriture) : un
  //                     motif partagé rendrait l'assertion négative
  //                     ininterprétable.
  const SECTIONS_DEPLACEES = [
    {
      label: 'Étape 4.5',
      headingRe: /^##\s*Étape 4\.5\b/,
      cible: STEPS_CROSS,
      conditionRe: /cross-repo/i,
      ancreCorps: 'guards.worktreeUnderTarget',
    },
    {
      label: 'Étape 5.7',
      headingRe: /^##\s*Étape 5\.7\b/,
      cible: STEPS_CROSS,
      conditionRe: /cross-repo/i,
      ancreCorps: 'Procédure — celle appliquée à la main six fois',
    },
    {
      label: 'Variante cross-repo',
      headingRe: /^###\s*Variante cross-repo\b/,
      cible: STEPS_CROSS,
      conditionRe: /cross-repo/i,
      ancreCorps: 'hook start posé sur le checkout main du repo CIBLE',
    },
    {
      label: 'Étape 6.4.5',
      headingRe: /^##\s*Étape 6\.4\.5\b/,
      cible: STEPS_REVIEW_DEEP,
      conditionRe: /`deep`/,
      ancreCorps: 'a perdu un finding en amont',
    },
  ];

  // Un pointeur est un POINTEUR : condition + chemin + conduite en cas d'échec.
  // Le plafond de lignes non vides est la garde anti-ré-inflation — sans lui,
  // rien n'empêche le corps de revenir paragraphe par paragraphe sous le titre
  // « pointeur », et le seul filet restant serait PLAFOND_SKILL, qui ne dit pas
  // OÙ le fichier a regrossi. Le bloc `<!-- APPEL:aggregator -->` reste dans le
  // skill sous le pointeur de l'Étape 6.4.5 (D3) : la mesure ne compte donc que
  // les lignes AVANT le premier marqueur `<!-- APPEL:`.
  // 16 : les 3 lignes de fence + commande de résolution `homedir()` (convention
  // du dépôt, cf. l'assertion dédiée plus bas) sont incompressibles, et le
  // pointeur de 6.4.5 porte en plus la prescription complète du chemin `light`.
  const POINTEUR_MAX_LIGNES = 16;

  // ⚠️ LE POINTEUR, C'EST CE QUI PRÉCÈDE LE BLOC D'APPEL — jamais la section
  // entière. `extractSection` s'arrête au `##` suivant, donc la section
  // `## Étape 6.4.5` embarque le bloc `<!-- APPEL:aggregator -->` resté sur
  // place (D3), lequel porte DÉJÀ « ⛔ Si tu ne peux pas lire ce fichier,
  // ARRÊTE-TOI et signale-le » pour SON propre mode d'emploi. Assertée sur la
  // section entière, la garde « le pointeur dit quoi faire si la lecture
  // échoue » était donc satisfaite par le bloc seul : vérifié, on retire la
  // phrase du pointeur et le test reste VERT. Or la spec désigne ce point comme
  // « le SEUL mode de défaillance neuf qu'introduit ce ticket » — et le seul
  // des quatre pointeurs à cohabiter avec un bloc d'appel était précisément
  // celui dont la garde ne gardait rien.
  const pointeurTexte = (section) => section.split('\n<!-- APPEL:')[0];

  function pointeur(section) {
    return pointeurTexte(section)
      .split('\n')
      .filter((l) => l.trim() !== '' && l.trim() !== '---');
  }

  for (const { label, headingRe, cible, conditionRe, ancreCorps } of SECTIONS_DEPLACEES) {
    // ⚠️ Mutation : retirer le chemin `steps/…` du pointeur (« le corps de cette
    // étape a été déplacé ») → rouge. Un pointeur qui ne nomme pas sa cible
    // laisse l'orchestrateur la chercher, ou sauter l'étape.
    it(`${SKILL} : le pointeur de « ${label} » nomme ${cible}`, () => {
      const section = extractSection(readO1(SKILL), headingRe);
      expect(
        section,
        `${SKILL} n'a plus de section « ${label} » — le titre doit RESTER ` +
          `(les renvois « Étape N » du skill le résolvent), seul son corps part.`
      ).not.toBeNull();
      expect(
        pointeurTexte(section).includes(cible),
        `${SKILL} : le pointeur de « ${label} » ne nomme pas ${cible} — ` +
          `l'orchestrateur n'a aucun moyen de retrouver le corps de la section.`
      ).toBe(true);
    });

    // ⚠️ Mutation : remplacer la commande de résolution par un chemin littéral
    // (`$HOME/.claude/steps/…`, ou un `~/…`) → rouge. C'est la convention DÉJÀ
    // épinglée par la famille 8 d'`impl-templates-coherence` sur les prompts
    // d'appel, et pour une raison qui vaut ici mot pour mot : l'outil `Read`
    // exige un chemin ABSOLU et ne développe ni `$HOME` ni `~`. Un pointeur qui
    // écrit `$HOME/.claude/steps/cross-repo.md` fait échouer la lecture, donc
    // déclenche sa propre clause d'arrêt — le cycle s'arrête avant le récap de
    // l'Étape 5, à chaque cycle cross-repo, et avant l'agrégation à chaque
    // cycle `deep`. Défaut réel du premier jet de ce ticket.
    it(`${SKILL} : le pointeur de « ${label} » résout son chemin par homedir(), jamais en littéral`, () => {
      const p = pointeurTexte(extractSection(readO1(SKILL), headingRe));
      expect(
        p.includes('homedir()'),
        `${SKILL} : le pointeur de « ${label} » ne porte pas la commande de ` +
          `résolution par require('os').homedir() — l'orchestrateur doit deviner ` +
          `un chemin absolu, ou passer à Read une chaîne que Read refuse.`
      ).toBe(true);
      expect(
        /~\//.test(p) || /\$HOME/.test(p),
        `${SKILL} : le pointeur de « ${label} » donne un chemin littéral ` +
          `(\`~/…\` ou \`$HOME/…\`) — ni l'un ni l'autre n'est développé par ` +
          `l'outil Read, qui exige un chemin absolu.`
      ).toBe(false);
    });

    // ⚠️ Mutation : retirer la condition du pointeur (« lis toujours ce
    // fichier ») → rouge. Sans condition, les quatre fichiers sont lus à chaque
    // cycle : le coût revient, déplacé d'un tour à l'autre.
    it(`${SKILL} : le pointeur de « ${label} » énonce sa condition de lecture`, () => {
      const section = extractSection(readO1(SKILL), headingRe);
      expect(section).not.toBeNull();
      expect(
        conditionRe.test(pointeurTexte(section)),
        `${SKILL} : le pointeur de « ${label} » n'énonce plus la condition ` +
          `(${conditionRe}) sous laquelle son corps doit être lu.`
      ).toBe(true);
    });

    // ⚠️ Mutation : retirer la consigne d'arrêt → rouge. C'est le SEUL mode de
    // défaillance neuf de ce ticket (specs/skill-54.md, § Portée) : un pointeur
    // muet en cas d'échec transforme une lecture ratée en étape silencieusement
    // sautée. Même exigence que la famille 8 d'`impl-templates-coherence` sur
    // les prompts d'appel.
    it(`${SKILL} : le pointeur de « ${label} » dit quoi faire si la lecture échoue`, () => {
      const p = pointeurTexte(extractSection(readO1(SKILL), headingRe));
      expect(
        p.includes('ARRÊTE-TOI'),
        `${SKILL} : le pointeur de « ${label} » ne porte pas l'ordre d'arrêt ` +
          `(ARRÊTE-TOI) en cas de lecture impossible.`
      ).toBe(true);
      expect(
        /si tu ne peux pas.{0,40}lire/is.test(p),
        `${SKILL} : le pointeur de « ${label} » n'énonce pas le cas « lecture ` +
          `impossible » — l'étape serait sautée en silence.`
      ).toBe(true);
    });

    // ⚠️ Mutation : recoller le corps sous le titre → rouge. C'est l'assertion
    // qui constate le retrait lui-même.
    it(`${SKILL} : le corps de « ${label} » a bien quitté le skill`, () => {
      expect(
        readO1(SKILL).includes(ancreCorps),
        `${SKILL} contient de nouveau « ${ancreCorps} » — le corps de ` +
          `« ${label} » est revenu dans le skill, que l'orchestrateur relit à ` +
          `CHAQUE tour, y compris les cycles qui ne le liront jamais.`
      ).toBe(false);
    });

    // ⚠️ Mutation : supprimer le corps au lieu de le déplacer → rouge. Sans
    // cette assertion, les trois précédentes resteraient vertes sur une
    // compression qui aurait PERDU la consigne au lieu de la ranger.
    it(`${cible} porte le corps de « ${label} »`, () => {
      expect(
        readO1(cible).includes(ancreCorps),
        `${cible} ne contient pas « ${ancreCorps} » : le corps de « ${label} » ` +
          `n'a pas été déplacé, il a été perdu.`
      ).toBe(true);
    });

    // ⚠️ Mutation : laisser trois paragraphes d'explication sous le titre →
    // rouge. Le pointeur doit rester un pointeur.
    it(`${SKILL} : le pointeur de « ${label} » tient en ≤ ${POINTEUR_MAX_LIGNES} lignes`, () => {
      const section = extractSection(readO1(SKILL), headingRe);
      expect(section).not.toBeNull();
      const lignes = pointeur(section);
      expect(
        lignes.length,
        `${SKILL} : le pointeur de « ${label} » fait ${lignes.length} lignes ` +
          `non vides — ce qui dépasse appartient à ${cible}, pas au skill.`
      ).toBeLessThanOrEqual(POINTEUR_MAX_LIGNES);
    });
  }

  // --- Le cas particulier de l'Étape 6.4.5 : cohabitation annoncée ----------
  //
  // Des quatre pointeurs, c'est le seul à cohabiter avec un bloc d'appel : les
  // blocs `APPEL:` restent TOUS dans le skill (D3), `<!-- APPEL:aggregator -->`
  // compris, alors que le corps de l'étape qui l'entoure est parti. La lecture
  // fait donc un aller-retour — skill → steps/review-deep.md → skill — et le
  // pointeur doit l'annoncer, sinon rien ne le fait.
  //
  // ⚠️ SKILL-111 : ils sont SIX depuis ce ticket (`<!-- APPEL:impl-fix -->`,
  // Étape 6.5), pas cinq. D3 ne plafonne pas leur nombre — il dit où ils
  // vivent : dans le skill. Le compte figé dans le message d'échec ci-dessous
  // envoyait relire `specs/skill-54.md`, qui en compte cinq à SA date, sans
  // moyen de savoir si le sixième est une entorse ou une extension légitime.

  // ⚠️ Mutation : déplacer le bloc `<!-- APPEL:aggregator -->` dans
  // `steps/review-deep.md` avec le corps → rouge. Il est épinglé au skill par
  // `impl-templates-coherence.test.js` (contrôle croisé bloc d'appel ↔
  // prompts/aggregator.md), qui lit le skill ENTIER.
  it(`${SKILL} garde le marqueur <!-- APPEL:aggregator --> sur sa propre ligne`, () => {
    const lignes = readO1(SKILL).split('\n');
    const trouve = lignes.filter((l) => l.trim() === '<!-- APPEL:aggregator -->');
    expect(
      trouve.length,
      `${SKILL} : le marqueur <!-- APPEL:aggregator --> n'est plus présent ` +
        `exactement une fois sur sa propre ligne (${trouve.length} occurrence(s)) ` +
        `— TOUS les blocs d'appel restent dans le skill (specs/skill-54.md, D3 ; ` +
        `ils sont six depuis SKILL-111, D3 n'en plafonne pas le nombre).`
    ).toBe(1);
  });

  // ⚠️ Mutation : rédiger le pointeur de 6.4.5 comme les trois autres, sans un
  // mot sur le bloc resté sur place → rouge. La lecture ferait un aller-retour
  // que rien n'annonce.
  it(`${SKILL} : le pointeur de l'Étape 6.4.5 annonce la cohabitation avec APPEL:aggregator`, () => {
    const section = extractSection(readO1(SKILL), /^##\s*Étape 6\.4\.5\b/);
    expect(section).not.toBeNull();
    const avantAppel = pointeurTexte(section);
    expect(
      avantAppel.includes('APPEL:aggregator'),
      `${SKILL} : le pointeur de l'Étape 6.4.5 ne nomme pas le bloc ` +
        `APPEL:aggregator resté sous lui.`
    ).toBe(true);
    expect(
      /reste ici|reste dans ce fichier|ne quitte pas/i.test(avantAppel),
      `${SKILL} : le pointeur de l'Étape 6.4.5 nomme le bloc d'appel sans dire ` +
        `qu'il RESTE dans le skill — le lecteur ignore où le trouver après ` +
        `être allé lire le corps ailleurs.`
    ).toBe(true);
  });

  // --- Le chemin `light` ne lit RIEN : sa prescription doit rester ici ------
  //
  // Le chargement paresseux ne doit pas retirer du contenu au chemin qui,
  // précisément, n'est pas censé charger le fichier. L'Étape 6.4 (non déplacée)
  // renvoie la définition de `<FINDINGS_BRUTS>` à l'Étape 6.4.5 ; un cycle
  // `light` y arrive, lit « saute cette étape », n'ouvre pas
  // `steps/review-deep.md` — et doit malgré tout en ressortir avec `R = U` et
  // la valeur de `<FINDINGS_BRUTS>`, dont l'Étape 6.6 a besoin pour sa ligne
  // « Contrôle : U uniques = U disposés ».
  //
  // ⚠️ Mutation : réduire le pointeur à « **En dosage `light`, saute cette étape
  // entière** : un seul rapport, rien à fusionner. » (l'état du premier jet de
  // ce ticket) → rouge. C'était une perte réelle : la suite de la phrase
  // d'origine était la seule prescription opératoire du chemin `light` à cet
  // endroit.
  it(`${SKILL} : le pointeur de l'Étape 6.4.5 garde la prescription complète du chemin light`, () => {
    const p = pointeurTexte(extractSection(readO1(SKILL), /^##\s*Étape 6\.4\.5\b/));
    expect(
      /`R = U`/.test(p) && p.includes('<FINDINGS_BRUTS>'),
      `${SKILL} : le pointeur de l'Étape 6.4.5 ne dit plus au dosage \`light\` ` +
        `que \`R = U\` ni ce que devient \`<FINDINGS_BRUTS>\` — or ce chemin a ` +
        `interdiction d'ouvrir steps/review-deep.md, il n'a aucun autre endroit ` +
        `où l'apprendre.`
    ).toBe(true);
    // ⚠️ `\s+`, pas une espace nue : « va directement à l'Étape\n6.5 » est un
    // wrap éditorial normal de ce fichier, et un motif mono-espace rougirait
    // sur une reformulation qui n'a rien changé (constaté à l'écriture).
    expect(
      /Étape\s+6\.5/.test(p),
      `${SKILL} : le pointeur de l'Étape 6.4.5 ne dit plus au dosage \`light\` ` +
        `où aller ensuite.`
    ).toBe(true);
  });

  // --- Un seul fichier pour trois pointeurs : lu une fois, pas trois --------
  //
  // La Décision fait lire ces fichiers « une fois, une fois la condition
  // connue ». Trois pointeurs visent `steps/cross-repo.md` ; s'ils ordonnent
  // chacun une lecture intégrale sans savoir que les autres existent, le même
  // texte entre trois fois dans le contexte puis est relu à chaque tour — le
  // poste exact que ce ticket vise, réintroduit par sa propre correction.
  //
  // ⚠️ Mutation : retirer de l'un des deux pointeurs suivants la mention « même
  // fichier » / « déjà lu » → rouge.
  for (const [label, headingRe] of [
    ['Étape 5.7', /^##\s*Étape 5\.7\b/],
    ['Variante cross-repo', /^###\s*Variante cross-repo\b/],
  ]) {
    it(`${SKILL} : le pointeur de « ${label} » n'ordonne pas une relecture du fichier déjà lu`, () => {
      const p = pointeurTexte(extractSection(readO1(SKILL), headingRe));
      expect(
        /même fichier/i.test(p) && /déjà lu/i.test(p),
        `${SKILL} : le pointeur de « ${label} » vise steps/cross-repo.md sans ` +
          `dire que c'est le MÊME fichier, DÉJÀ LU par un pointeur antérieur — ` +
          `l'orchestrateur le recopie une fois de plus dans son contexte.`
      ).toBe(true);
    });
  }

  // --- La porte de confirmation n'est pas dans le fichier : elle est dite ---
  //
  // La découpe par fichier a rendu contiguës deux étapes que le skill sépare
  // par le récap de l'Étape 5 et le hook `start` de l'Étape 5.5. Lire l'Étape
  // 4.5 met désormais le `git worktree add` de l'Étape 5.7 sous les yeux de
  // l'orchestrateur, avant que l'utilisateur ait confirmé quoi que ce soit.
  //
  // ⚠️ Mutation : retirer l'avertissement du fichier (ou du pointeur de 4.5) →
  // rouge. Sans lui, le seul garde-fou restant est allusif, et il est DANS le
  // bloc qu'on veut ne pas exécuter trop tôt.
  it(`${STEPS_CROSS} sépare « lire l'Étape 5.7 » de « l'exécuter »`, () => {
    const raw = readO1(STEPS_CROSS);
    const paragraphes = raw.split('\n\n').filter((p) => p.includes('⛔'));
    expect(
      paragraphes.some(
        (p) => /Étape 5\.7/.test(p) && /(confirmation|réponse de l.utilisateur|Étape 5\b)/i.test(p)
      ),
      `${STEPS_CROSS} : aucun ⛔ n'avertit que l'Étape 5.7 se LIT ici mais ne ` +
        `s'EXÉCUTE qu'après la confirmation de l'Étape 5 — un worktree et une ` +
        `branche peuvent être montés pour un cycle que l'utilisateur refusera.`
    ).toBe(true);
  });

  // ⚠️ Mutation : retirer la même mise en garde du pointeur de l'Étape 4.5 →
  // rouge. Elle est écrite AUX DEUX endroits délibérément : c'est le pointeur
  // qui déclenche la lecture anticipée, c'est donc lui qui doit la borner, et
  // le fichier lu doit la redire à l'endroit exact où le bloc apparaît.
  it(`${SKILL} : le pointeur de l'Étape 4.5 interdit d'exécuter l'Étape 5.7 par anticipation`, () => {
    const p = pointeurTexte(extractSection(readO1(SKILL), /^##\s*Étape 4\.5\b/));
    expect(
      /Étape 5\.7/.test(p) && /n.exécute rien/i.test(p),
      `${SKILL} : le pointeur de l'Étape 4.5 fait lire la procédure de création ` +
        `de l'Étape 5.7 sans interdire de l'exécuter tout de suite.`
    ).toBe(true);
  });

  // --- L'Étape 1.1 est explicitement RESTÉE (D5.b) --------------------------
  //
  // La première rédaction de la Décision la faisait partir avec les blocs
  // cross-repo. Elle en est ressortie : sa SECONDE issue — « ticket trouvé
  // nulle part → relaie le message et stoppe » — vaut dans les DEUX modes, et
  // c'est en la lisant que l'orchestrateur apprend que le mode ne découle pas
  // mécaniquement de l'emplacement du ticket. Une section qu'il faut lire pour
  // savoir dans quel mode on est n'est pas une section « jamais lue en
  // même-repo » : elle n'est pas conditionnelle, donc elle ne se charge pas
  // paresseusement.
  //
  // ⚠️ Mutation : remplacer le corps de l'Étape 1.1 par un pointeur vers
  // `steps/cross-repo.md` → rouge. C'est la mutation exacte que D5.b interdit.
  it(`${SKILL} : l'Étape 1.1 garde son corps et ne délègue à aucun steps/`, () => {
    const step11 = extractSection(readO1(SKILL), /^##\s*Étape 1\.1\b/);
    expect(step11, `${SKILL} n'a plus de section "## Étape 1.1".`).not.toBeNull();
    expect(
      step11.includes('steps/'),
      `${SKILL} : l'Étape 1.1 délègue son corps à un fichier steps/ — elle a ` +
        `été classée conditionnelle à tort (specs/skill-54.md, D5.b).`
    ).toBe(false);
    expect(
      /cross-repo/.test(step11) && /nulle part/i.test(step11),
      `${SKILL} : l'Étape 1.1 ne porte plus ses DEUX issues (ticket trouvé dans ` +
        `$HOME/.claude, et ticket trouvé nulle part) — c'est la seconde, valable ` +
        `dans les deux modes, qui interdit de la charger paresseusement.`
    ).toBe(true);
  });

  // --- Les fichiers cibles : présents et autonomes --------------------------

  for (const rel of [STEPS_CROSS, STEPS_REVIEW_DEEP]) {
    // ⚠️ Mutation : supprimer le fichier → rouge (les pointeurs mèneraient à
    // une lecture impossible, donc à un arrêt, à chaque cycle concerné).
    it(`${rel} existe et n'est pas vide`, () => {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} est absent.`).toBe(true);
      expect(readO1(rel).trim().length).toBeGreaterThan(0);
    });

    // ⚠️ Mutation : ouvrir le fichier sur « suite de l'Étape 4.5 du skill » →
    // rouge. Un fichier chargé à la demande est lu SEUL : s'il renvoie au skill
    // pour se comprendre, l'aller-retour recommence, et l'orchestrateur relit
    // ce qu'il venait d'éviter.
    //
    // ⚠️ Le motif vise le FICHIER du skill (`sdd-run-ticket.md`), pas la chaîne
    // `sdd-run-ticket` nue : `steps/cross-repo.md` porte l'exemple de bout en
    // bout d'un cycle, dont la première ligne EST l'invocation
    // `/sdd-run-ticket SKILL-09`. Un motif nu ferait rougir un contenu
    // parfaitement autonome — une commande citée n'est pas un renvoi (constaté
    // en écrivant ce test : rouge sur le premier jet).
    it(`${rel} est autonome — il ne renvoie pas au skill pour se comprendre`, () => {
      const raw = readO1(rel);
      expect(
        /sdd-run-ticket\.md/.test(raw),
        `${rel} nomme le FICHIER du skill — il n'est pas autonome.`
      ).toBe(false);
      expect(
        /(dans|voir|cf\.?|revois|relis)\s+le skill/i.test(raw),
        `${rel} renvoie au skill pour se comprendre — un fichier chargé à la ` +
          `demande doit se suffire à lui-même.`
      ).toBe(false);
    });

    // ⚠️ Mutation : commencer le fichier par de la prose sans titre → rouge. Le
    // titre de section EST ce qui rend le fichier lisible seul : c'est lui qui
    // dit de quelle étape on parle.
    it(`${rel} ouvre sur un titre de section Markdown`, () => {
      const premiere = readO1(rel).split('\n').find((l) => l.trim() !== '');
      expect(
        /^#{1,3}\s+\S/.test(premiere || ''),
        `${rel} n'ouvre pas sur un titre Markdown (première ligne non vide : ` +
          `${JSON.stringify(premiere)}).`
      ).toBe(true);
    });

  }

  // --- SKILL-68, D3 : deixis + `APPEL:`, garde-fou ÉTROIT ---------------------
  //
  // D3 de SKILL-54 garantit qu'aucun bloc `APPEL:` ne vit dans `steps/*.md`
  // (ils restent tous les cinq dans le skill) : une phrase d'un `steps/*.md`
  // qui mentionne un marqueur `APPEL:` avec une deixis relative (`ci-dessous`,
  // `ci-dessus`, `ce bloc`) est donc fausse par construction, quel que soit
  // l'ordre du texte (c'est le défaut réel de SKILL-68).
  //
  // ⚠️ Reprise (gate de ce ticket, finding 1) : la liste des fichiers examinés
  // vient de la LECTURE DU DOSSIER, jamais d'un tableau de deux noms en dur.
  // D3 motive ce garde-fou par « empêcher LE PROCHAIN déplacement de rouvrir
  // le défaut » — un déplacement futur crée un `steps/*.md` DE PLUS, qui doit
  // tomber sous ce garde-fou sans action. Même convention que
  // `mesureDossier()` (__tests__/skill-size-ceiling-coherence.test.js:157-166).
  const STEPS_DIR = 'steps';
  const stepsMarkdownNames = () =>
    fs
      .readdirSync(path.join(REPO_ROOT, STEPS_DIR))
      .filter((n) => n.endsWith('.md'))
      .sort();
  const stepsMarkdownFiles = () => stepsMarkdownNames().map((n) => `${STEPS_DIR}/${n}`);

  // ⚠️ Mutation : figer cette liste à un tableau de deux noms en dur → rouge
  // le jour où un troisième `steps/*.md` apparaît, alors qu'il entrerait
  // autrement en silence, HORS garde-fou (même antipattern documenté par
  // `skill-size-ceiling-coherence.test.js`:267-286).
  it('la liste des steps/*.md couverts par le garde-fou D3 vient de la lecture du dossier', () => {
    const surDisque = stepsMarkdownNames();
    expect(
      surDisque.length,
      `${STEPS_DIR}/ ne contient aucun .md — ce garde-fou n'a rien vérifié.`
    ).toBeGreaterThan(0);
    expect(stepsMarkdownFiles().map((r) => r.slice(STEPS_DIR.length + 1))).toEqual(surDisque);
  });

  // ⚠️ Reprise (gate de ce ticket, finding 2) : scope = la PHRASE, pas le
  // paragraphe. Le premier jet scopait au paragraphe (coupé sur ligne vide),
  // ce qui fusionnait tout un bloc ``` ``` en une SEULE unité — forçant à
  // exclure les blocs de code entiers du contrôle, donc à ne plus rien y
  // examiner. Ici, une « phrase » est un groupe de lignes non vides où
  // chaque ligne de CONTINUATION est indentée STRICTEMENT plus que la
  // première ligne du groupe — la convention de ce dépôt pour signaler un
  // retour à la ligne SANS ouvrir une nouvelle assertion (item de liste qui
  // se poursuit, ligne de transcript qui se poursuit). Une ligne à
  // indentation égale ou moindre ouvre un NOUVEAU groupe : c'est ce qui
  // sépare, dans `steps/cross-repo.md`, `Spec : … (relatif au repo
  // ci-dessus)` de `agent lancé sans isolation, prompt d'appel
  // APPEL:impl-cross (…)` — deux groupes distincts d'un même bloc de
  // transcript, jamais fusionnés, sans qu'aucun bloc de code ne soit exclu.
  const splitIntoPhrases = (text) => {
    const lignes = text.split('\n');
    const groupes = [];
    let courant = null;
    let indentCourant = 0;
    for (const ligne of lignes) {
      if (ligne.trim() === '') {
        courant = null;
        continue;
      }
      const indent = ligne.length - ligne.trimStart().length;
      if (courant !== null && indent > indentCourant) {
        courant.push(ligne);
      } else {
        courant = [ligne];
        indentCourant = indent;
        groupes.push(courant);
      }
    }
    return groupes.map((g) => g.join('\n'));
  };

  for (const rel of stepsMarkdownFiles()) {
    // ⚠️ Mutation-témoin obligatoire (spec SKILL-68, § Tests), vérifiée à
    // l'écriture de ce test : restaurer la formulation « le bloc
    // `<!-- APPEL:aggregator -->` ci-dessous » dans steps/review-deep.md fait
    // rougir cette assertion sur ce fichier. Sans cette vérification,
    // l'assertion pourrait être verte pour la mauvaise raison (motif qui ne
    // matche jamais) — le défaut que SKILL-54 a lui-même livré au premier
    // jet. Vérifié une seconde fois (gate de ce ticket, finding 2) : la même
    // mutation appliquée DANS un bloc de code de `steps/cross-repo.md`
    // (`APPEL:impl-cross (le bloc ci-dessous, …)`) rougit également —
    // aucun bloc n'est plus exclu du contrôle.
    it(`${rel} : aucune phrase mentionnant un marqueur \`APPEL:\` ne porte de deixis relative`, () => {
      const phrases = splitIntoPhrases(readO1(rel));
      const enFaute = phrases.filter(
        (p) => /APPEL:/.test(p) && /\b(ci-dessous|ci-dessus|ce bloc)\b/i.test(p)
      );
      expect(
        enFaute,
        `${rel} : une phrase mentionne un marqueur \`APPEL:\` avec une deixis ` +
          `relative (ci-dessous/ci-dessus/ce bloc) — ce bloc ne vit jamais dans ` +
          `steps/*.md (D3 de SKILL-54), la deixis est donc fausse par ` +
          `construction. Phrase(s) en cause : ${JSON.stringify(enFaute)}`
      ).toEqual([]);
    });
  }
});

describe('P1 (SKILL-75) — send.md justifie l’exception « no tests » sans chiffre', () => {
  // specs/skill-75.md. `< 5 s` était vrai sur un dépôt à 4 fichiers (SKILL-65)
  // et faux ici (25 fichiers, ~10 s) — un chiffre qu'aucun test ne garde est
  // condamné à mentir tôt ou tard sur au moins un des dépôts qui consomment ce
  // skill. Remplacé par une justification qualitative : la NATURE des tests
  // (intégrité de sources typées, sans DB ni dev server), pas leur durée.
  const FILE = 'commands/send.md';
  const raw = readCommandFile(FILE).replace(/\r\n/g, '\n');

  // Mutation qui doit rougir : réintroduire un chiffre de durée, sous
  // N'IMPORTE QUELLE forme (ex. remettre `< 5 s`, `~10 s`, mais aussi
  // `Rapides (5 s)` ou `coût de 5 secondes` — un nombre suivi de `s`/`secondes`,
  // avec ou sans `<`/`~` devant). Finding 1 (reprise) : la première version de
  // ce garde ne rougissait QUE si le chiffre était introduit par `<` ou `~` —
  // un ticket qui réécrit la phrase sans ce préfixe (ex. « Rapides (5 s). »)
  // passait au vert avec le chiffre condamné réintroduit.
  it('ne contient plus aucune justification chiffrée de durée', () => {
    const DUREE_CHIFFREE_RE = /\b\d+(?:[.,]\d+)?\s*(?:s\b|secondes?\b)/i;
    expect(
      DUREE_CHIFFREE_RE.test(raw),
      `${FILE} : une justification chiffrée de durée subsiste (ex. "< 5 s", ` +
        `"~10 s", "5 s" ou "5 secondes") — specs/skill-75.md exige une ` +
        `formulation qualitative, vraie sur tous les dépôts consommateurs, ` +
        `pas seulement sur celui à 4 fichiers de SKILL-65.`
    ).toBe(false);
  });

  // Mutation qui doit rougir : ne corriger qu'un des deux passages (retirer la
  // justification qualitative de l'Étape 0 OU de l'Étape 3.5).
  it('porte la justification qualitative (nature des tests) aux deux endroits — Étape 0 et Étape 3.5', () => {
    const etape0 = extractSection(raw, /^##\s*Étape 0\b/);
    const etape35 = extractSection(raw, /^##\s*Étape 3\.5\b/);

    const NATURE_RE =
      /int[ée]grit[ée].*sources|sans DB ni dev server|nature (de|des) (ces )?tests/i;

    expect(
      NATURE_RE.test(etape0),
      `${FILE} : l'Étape 0 ne porte plus la justification qualitative ` +
        `(nature des tests — intégrité de sources, sans DB ni dev server).`
    ).toBe(true);
    expect(
      NATURE_RE.test(etape35),
      `${FILE} : l'Étape 3.5 ne porte plus de justification qualitative pour ` +
        `« en cas de doute, le relancer systématiquement » — la recommandation ` +
        `doit survivre à la reformulation, portée par autre chose qu'une durée.`
    ).toBe(true);
  });

  // Mutation qui doit rougir : retirer le contrat à trois issues de l'Étape 0
  // ou de l'Étape 3.5 (verte / sélection vide / rouge).
  it('conserve le contrat à trois issues des Étapes 0 et 3.5 (non-régression de comportement)', () => {
    const etape0 = extractSection(raw, /^##\s*Étape 0\b/);
    const etape35 = extractSection(raw, /^##\s*Étape 3\.5\b/);

    for (const [label, section] of [
      ['Étape 0', etape0],
      ['Étape 3.5', etape35],
    ]) {
      expect(
        /verte/i.test(section) &&
          /s[ée]lection vide/i.test(section) &&
          /rouge/i.test(section),
        `${FILE} : ${label} a perdu une des trois issues (verte / sélection ` +
          `vide / rouge) — SKILL-75 est éditorial, il ne doit pas toucher au ` +
          `comportement de /send.`
      ).toBe(true);
    }
  });
});
