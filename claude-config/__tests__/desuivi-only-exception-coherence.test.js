// SKILL-66 — `git commit --only <chemin>` rejoue le WORKING TREE des chemins
// nommés, pas l'index : un `git rm --cached <chemin>` (dont tout l'effet est
// dans l'index) est donc DÉFAIT par le `--only` qui suit (specs/skill-66.md,
// § Problème).
//
// ⚠️ Mesure indépendante, rejouée pour CE ticket (pas supposée d'après
// specs/skill-39.md § E1) : dépôt jetable, `settings.json` suivi ET modifié,
// `.gitignore` le portant déjà, `git rm --cached settings.json`, puis
// `git diff --cached --name-status | cat -A` → `D^Isettings.json$` (statut
// `D`, UNE tabulation, le chemin — PAS deux espaces, le format de
// `git status --short`, cf. finding 3 de la gate de reprise du 2026-08-25).
// Commit sans pathspec ensuite : `git ls-files -- settings.json` vide,
// `1 file changed, 1 deletion(-)`. Rendu dans le commit de correction de la
// gate, pas seulement ici.
//
// Décision (specs/skill-66.md, § Décision) : PAS un assouplissement général de
// `--only` (D1) — une exception BORNÉE au seul geste où working tree et index
// divergent par construction, le dé-suivi (D2), documentée dans
// `commands/sdd-run-ticket.md` § Règles strictes (D4), avec une assertion
// bloquante en remplacement du drapeau (D3).
//
// ⚠️ Chaque assertion porte en commentaire la MUTATION qui doit la faire
// rougir (convention de ce repo, reprise d'escalation-wiring-coherence.test.js). Ancres
// déclarées ICI, en dur.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNormalized, sectionEntre } from './helpers/prompt-blocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SDD_FILE = 'commands/sdd-run-ticket.md';

const readSkill = () => readNormalized(REPO_ROOT, SDD_FILE);

// Bornée à "## Règles strictes" → "## Cas d'usage typique" (specs/skill-66.md,
// § Portée : « c'est là qu'un opérateur va lire ce qu'il a le droit de
// faire »). Éviter une regex non scopée sur un fichier de plus de mille
// lignes (leçon SKILL-26, finding 4, citée par escalation-wiring-coherence.test.js).
const reglesStrictes = (raw) =>
  sectionEntre(raw, '## Règles strictes', "## Cas d'usage typique", SDD_FILE);

// Bornée au SEUL bullet de l'exception, PAS toute § Règles strictes — sinon
// un mot de blocage ("STOP", "**stopper**") déjà présent ailleurs dans la
// section (gate de revue, Étape 6.6.5 citée ligne 1413/1472) satisfait
// trivialement une regex non scopée (finding 2 de la gate de reprise du
// 2026-08-25).
const exceptionBullet = (raw) =>
  sectionEntre(
    raw,
    '- **Exception au `--only`',
    "- Si une étape échoue",
    SDD_FILE
  );

// Bornée au bullet "Ne jamais écrire dans un checkout live", juste au-dessus
// de l'exception — pour vérifier (test 5, SKILL-70) que l'interdit général
// reste entier, sans dépendre du bullet de l'exception lui-même.
const checkoutLiveBullet = (raw) =>
  sectionEntre(
    raw,
    '- **Ne jamais écrire dans un checkout live.**',
    "- **Exception au `--only`",
    SDD_FILE
  );

// SKILL-70 (finding 1 de la gate de reprise) : la pré-assertion (ligne 0) et
// l'issue de secours ajoutées par SKILL-70 portent CHACUNE leur propre
// "**bloquante**"/"**arrête-toi**" — un `toMatch` scopé au BULLET entier ne
// discrimine donc plus la phrase propre à la ligne 2 (celle que le test 2
// ci-dessous verrouille) : une mutation qui affaiblirait UNIQUEMENT cette
// phrase (« est **bloquante** » → « est indicative », « **arrête-toi** » →
// « note-le ») passerait au vert, satisfaite par les copies de la ligne 0 ou
// de l'issue de secours. Scopé à la clause propre à la ligne 2, bornée par
// « La ligne 2 est » (début) et « embarquerait » (fin, marqueur qui clôt sa
// phrase avant que l'issue de secours ne commence) — exclut par construction
// la ligne 0 (avant) et l'issue de secours (après).
const clauseLigne2 = (bullet) => {
  const start = bullet.indexOf('La ligne 2 est');
  expect(start, 'la clause "La ligne 2 est" est introuvable dans le bullet').toBeGreaterThanOrEqual(0);
  const endMarker = 'embarquerait';
  const endIdx = bullet.indexOf(endMarker, start);
  expect(
    endIdx,
    'le marqueur de fin "embarquerait" est introuvable après "La ligne 2 est"'
  ).toBeGreaterThan(start);
  return bullet.slice(start, endIdx + endMarker.length);
};

describe('SKILL-66 — exception `--only` pour le dé-suivi, dans § Règles strictes', () => {
  // Test 1 (spec § Tests, point 1) : la séquence de D3 est présente —
  // `git rm --cached`, l'assertion `git diff --cached --name-status`, un
  // commit sans pathspec.
  // ⚠️ Mutation-témoin : retirer `git rm --cached` (ou l'assertion, ou la
  // mention "sans pathspec") du bullet → rouge.
  it('porte la séquence git rm --cached / git diff --cached --name-status / commit sans pathspec', () => {
    const bullet = exceptionBullet(readSkill());
    expect(bullet, 'git rm --cached absent du bullet').toMatch(/rm --cached/);
    expect(
      bullet,
      'assertion `git diff --cached --name-status` absente du bullet'
    ).toMatch(/diff --cached --name-status/);
    expect(
      /sans pathspec/i.test(bullet),
      'la prescription ne dit pas explicitement que le commit final est SANS pathspec'
    ).toBe(true);
  });

  // Test 2 (spec § Tests, point 2) : l'assertion est BLOQUANTE — on s'arrête
  // si la sortie n'est pas exactement `D` + TABULATION + `<chemin>` (le
  // format réel de `--name-status` — finding 3 de la gate de reprise : deux
  // espaces, comme dans une première version de ce texte, ne correspondent
  // jamais à sa sortie).
  // ⚠️ Mutation-témoin (finding 2 de la gate de reprise, RE-VÉRIFIÉ finding 1
  // de la gate de reprise SKILL-70 — voir `clauseLigne2` ci-dessus) : dans la
  // clause de la ligne 2 SEULE, remplacer "est **bloquante**" par
  // "est indicative" et "**arrête-toi**" par "note-le" → rouge. Un mot de
  // blocage déjà présent AILLEURS dans § Règles strictes (ex. "**stopper**"
  // du dernier bullet, "STOP" de la gate de revue) — ou, depuis SKILL-70,
  // dans la ligne 0 ou l'issue de secours du MÊME bullet — ne peut plus
  // satisfaire ce test : il est scopé à la clause de la ligne 2.
  it('énonce, dans le bullet de l’exception, que l’assertion est bloquante sur `D` + TAB + `<chemin>`', () => {
    const bullet = exceptionBullet(readSkill());
    expect(bullet, 'le format attendu D<TAB><chemin> a disparu du bullet').toMatch(
      /D<TAB><chemin>/
    );
    const clause = clauseLigne2(bullet);
    expect(
      clause,
      'la ligne 2 n’est plus qualifiée de "bloquante" dans SA propre clause'
    ).toMatch(/est \*\*bloquante\*\*/);
    expect(
      clause,
      '"**arrête-toi**" n’est plus l’instruction donnée en cas d’échec dans la clause de la ligne 2'
    ).toMatch(/\*\*arrête-toi\*\*/);
  });

  // Test 3 (spec § Tests, point 3) : la règle générale `--only` reste présente
  // et non affaiblie — DEUX ancrages distincts, tous deux vrais AVANT et
  // APRÈS ce ticket (finding 1 de la gate de reprise : le premier existait
  // déjà sur `main`, seule sa mention explicite `--only` a été ajoutée par ce
  // ticket ; le second, l'invocation réelle à l'Étape 5.5, était déjà là) :
  //   (a) le rappel, dans le bullet "checkout live" de § Règles strictes,
  //       juste au-dessus de l'exception ;
  //   (b) l'invocation RÉELLE du drapeau à l'Étape 5.5 (ligne ~450), HORS de
  //       § Règles strictes — c'est elle que la doctrine protège en pratique,
  //       pas seulement sa mention en prose.
  // ⚠️ Mutation-témoin (a) : retirer "(`--only`)" du bullet "checkout live" →
  // rouge.
  // ⚠️ Mutation-témoin (b), finding 1 de la gate de reprise : retirer
  // `--only` de la ligne `git -C "$MAIN" commit -q --only -m
  // "chore(backlog): start <TICKET-ID>" -- $PATHS` (Étape 5.5) → rouge,
  // INDÉPENDAMMENT de tout ce qui se passe dans § Règles strictes.
  it('verrouille la règle générale --only — rappel en § Règles strictes ET invocation réelle à l’Étape 5.5', () => {
    const raw = readSkill();
    // Prose Markdown enveloppée à ~80 colonnes : "de l'Étape" et "5.5" peuvent
    // tomber sur deux lignes différentes. On normalise les blancs (espaces ET
    // retours ligne) avant de matcher, pour ne dépendre d'AUCUN point de
    // rupture de ligne précis.
    const sectionFlat = reglesStrictes(raw).replace(/\s+/g, ' ');
    expect(
      sectionFlat,
      'le rappel "(`--only`)" du commit de backlog (Étape 5.5) a disparu du bullet "checkout live"'
    ).toMatch(/commit de backlog scopé \(`--only`\) de l['’]Étape 5\.5/);
    expect(
      raw,
      'l’invocation réelle --only de l’Étape 5.5 (hook de démarrage) a disparu ou a été affaiblie'
    ).toMatch(/commit -q --only -m "chore\(backlog\): start <TICKET-ID>" -- \$PATHS/);
  });

  // Test 4 (spec § Tests, point 4) : l'exception est BORNÉE au dé-suivi — le
  // texte ne présente JAMAIS le commit nu comme une option générale.
  // ⚠️ Mutation-témoin : remplacer "dé-suivi" par une formule générique →
  // rouge (absence du mot dé-suivi dans le bullet).
  // ⚠️ Mutation-témoin (finding 6 de la gate de reprise) : ajouter en fin de
  // bullet « Hors dé-suivi, un commit nu reste acceptable si tu as vérifié
  // l'index. » → la mention "commit nu" apparaît une TROISIÈME fois dans le
  // bullet (les deux occurrences légitimes du texte actuel sont la négation
  // de D1 et la description du risque qu'un commit nu ferait courir), et la
  // phrase ajoutée matche littéralement le motif interdit ci-dessous : rouge
  // sur les deux assertions.
  it('borne l’exception au dé-suivi — le bullet ne présente JAMAIS le commit nu comme une option générale', () => {
    const bullet = exceptionBullet(readSkill());
    expect(bullet, 'aucune mention de "dé-suivi" dans le bullet').toMatch(/dé-suivi/);
    expect(
      bullet,
      '`git rm --cached` doit être scopé au chemin nommé, pas laissé nu comme un geste générique'
    ).toMatch(/rm --cached <chemin>|rm --cached "?\$?\{?\w*chemin/i);
    // Normalisé (voir test 3) : la négation de D1 est enveloppée sur deux
    // lignes Markdown ("commit" / "nu si prudent"), invisible à une regex qui
    // suppose un simple espace.
    const flat = bullet.replace(/\s+/g, ' ');
    const occurrences = (flat.match(/commit nu/gi) || []).length;
    expect(
      occurrences,
      `"commit nu" apparaît ${occurrences} fois dans le bullet — devrait apparaître EXACTEMENT deux fois : ` +
        `la négation de D1 (« n'ouvre PAS de licence "commit nu si prudent" ») et la description du risque ` +
        `(« qu'un commit nu embarquerait »). Toute occurrence supplémentaire le présenterait comme une ` +
        `option générale hors dé-suivi.`
    ).toBe(2);
    expect(
      flat,
      'la négation explicite de D1 ("PAS de licence « commit nu si prudent »") a disparu du bullet'
    ).toMatch(/n['’]ouvre PAS de licence[^.]*commit nu si prudent/);
    expect(
      flat,
      'le bullet présente le commit nu comme "acceptable" hors dé-suivi — interdit par D1'
    ).not.toMatch(/commit nu reste acceptable|commit nu (est|reste) (une option|acceptable|permis)/i);
  });
});

// SKILL-70 — deux défauts cumulés du dé-suivi (specs/skill-70.md, § Cause
// racine) : l'unique instrument de détection (`git diff --cached
// --name-status`) n'était joué qu'APRÈS l'écriture du geste, et l'échec de
// l'assertion post-`rm` n'avait aucune issue légale. SKILL-70 avait corrigé
// le premier défaut par une pré-assertion (C1), toujours en place ci-dessous,
// et le second par une issue de secours nommée et bornée (C2, `git reset --
// <chemin>`).
//
// ⚠️ **C2 est RETIRÉE par SKILL-74** (arbitrage du 2026-08-25,
// specs/skill-66.md § D3) : l'issue de secours rouvrait une exception dans
// l'interdit du régime live, ce que l'arbitrage a explicitement écarté
// (« un interdit avec une exception se négocie ensuite ») au profit de la
// seule pré-assertion. Le geste `git reset -- <chemin>` reste NOMMÉ dans le
// bullet (spec § Correction attendue : « le consigner, pour que la question
// ne soit pas rouverte par ignorance »), mais uniquement comme geste
// EXAMINÉ ET ÉCARTÉ, jamais comme recours disponible — voir le describe
// SKILL-74 ci-dessous, dont le test « ne présente jamais reset … comme un
// geste AUTORISÉ ou PERMIS » verrouille cette distinction. L'ancien test 3 de
// CE bloc (qui exigeait `git reset -- <chemin>` comme « seul geste de secours
// autorisé ») a donc été RETIRÉ : il verrouillait exactement le geste que
// l'arbitrage écarte. Les tests 1, 2, 4 et 5 restent : ils verrouillent la
// pré-assertion elle-même (1, 2), l'absence de forme NUE de `reset`/`--hard`
// (4 — toujours pertinent : `reset -- <chemin>` reste nommé, mais borné) et
// la non-régression de l'interdit général (5), que SKILL-74 ne touche pas.
describe('SKILL-70 — pré-assertion (C1, en vigueur) ; issue de secours (C2, retirée par SKILL-74)', () => {
  // Test 1 (spec § Tests, point 1) : la pré-assertion existe et son critère
  // est "vide".
  // ⚠️ Mutation-témoin : retirer "VIDE" du commentaire de la ligne 0 → rouge.
  it('porte une pré-assertion `git diff --cached --name-status` dont le critère est VIDE', () => {
    const bullet = exceptionBullet(readSkill());
    expect(
      bullet,
      'aucune ligne `git diff --cached --name-status` ne porte le critère VIDE'
    ).toMatch(/diff --cached --name-status[^\n]*DOIT rendre VIDE/);
  });

  // Test 2 (spec § Tests, point 2) : la pré-assertion est ANTÉRIEURE au
  // `git rm --cached` dans le texte — un test d'ORDRE, pas de présence.
  // ⚠️ Mutation-témoin : déplacer la ligne 0 après la ligne 1 (rm --cached)
  // → rouge — la PREMIÈRE occurrence de l'assertion se retrouve après le
  // `rm --cached`.
  it('joue la pré-assertion AVANT `git rm --cached` dans le texte', () => {
    const bullet = exceptionBullet(readSkill());
    const idxAssertion = bullet.indexOf('diff --cached --name-status');
    // La commande RÉELLE de la séquence, pas sa mention en prose (qui la cite
    // plus tôt, dans "après un `git rm --cached <chemin>` — dont tout
    // l'effet…") : ancrée sur `git -C "$MAIN" rm --cached`, forme qui
    // n'apparaît que dans le bloc de code prescrit.
    const idxRm = bullet.indexOf('git -C "$MAIN" rm --cached');
    expect(idxAssertion, 'aucune occurrence de l’assertion trouvée').toBeGreaterThanOrEqual(0);
    expect(idxRm, 'aucune occurrence de la commande `git -C "$MAIN" rm --cached` trouvée').toBeGreaterThanOrEqual(0);
    expect(
      idxAssertion,
      'la première occurrence de l’assertion `diff --cached --name-status` n’est plus AVANT `rm --cached`'
    ).toBeLessThan(idxRm);
  });

  // RETIRÉ par SKILL-74 (arbitrage 2026-08-25, specs/skill-66.md § D3) :
  // l'ancien test 3 exigeait `git reset -- <chemin>` comme « seul geste de
  // secours autorisé ». L'arbitrage a écarté cette issue — voir le test
  // SKILL-74 ci-dessous, qui verrouille l'INVERSE : son ABSENCE.

  // Test 4 (spec § Tests, point 4) : l'issue de secours n'ouvre pas `reset`
  // en général — ni `reset` nu, ni `--hard` comme option.
  // ⚠️ Mutation-témoin : ajouter « un `git reset` suffit à nettoyer » → rouge
  // sur la première assertion (un `reset` non suivi de `--` apparaît).
  it('ne présente jamais `reset` nu ni `--hard` comme une option', () => {
    const bullet = exceptionBullet(readSkill());
    // Tout `reset` doit être immédiatement suivi de `--` (espace optionnel) —
    // la forme à pathspec, jamais nue.
    expect(
      bullet,
      'un `reset` apparaît sans être immédiatement suivi de `--` (forme nue, non bornée)'
    ).not.toMatch(/\breset\b(?!\s*--)/);
    // `--hard` ne peut apparaître QUE dans l'exemple qui prouve que git le
    // refuse (`reset --hard -- <chemin>` échoue en 128) — jamais présenté
    // comme une option.
    expect(
      bullet,
      '`--hard` apparaît sans être immédiatement suivi de ` -- <chemin>` (présenté comme une option, pas comme l’exemple qui prouve que git le refuse)'
    ).not.toMatch(/--hard(?!\s+--\s+<chemin>)/);
  });

  // Test 5 (spec § Tests, point 5) : non-régression — l'interdit général
  // `reset` / `checkout` / `stash` reste présent et non affaibli.
  // ⚠️ Mutation-témoin : retirer `reset` de la liste du bullet "checkout
  // live" → rouge.
  it('non-régression — l’interdit `reset`/`checkout`/`stash` du bullet "checkout live" reste entier', () => {
    const bullet = checkoutLiveBullet(readSkill());
    expect(bullet, '`checkout` a disparu de la liste des interdits').toMatch(/`checkout`/);
    expect(bullet, '`reset` a disparu de la liste des interdits').toMatch(/`reset`/);
    expect(bullet, '`stash` a disparu de la liste des interdits').toMatch(/`stash`/);
  });

  // La fenêtre résiduelle ENTRE L'ASSERTION FINALE ET LE COMMIT (C5) est
  // assumée et écrite, pas fermée — le ticket ne prétend pas la fermer
  // (specs/skill-70.md, § C5). ⚠️ SKILL-74 introduit une SECONDE fenêtre
  // résiduelle distincte (entre la pré-assertion et le `rm --cached`,
  // verrouillée par le describe SKILL-74 ci-dessous) : ce test-ci est
  // ANCRÉ sur « avant tout push », propre à la fenêtre 2→3 (finding 3 de la
  // gate de reprise SKILL-74 : un `toMatch(/fenêtre résiduelle/i)` nu ne
  // discrimine plus les deux, et resterait vert même si CETTE fenêtre-ci
  // disparaissait du texte tant que l'autre y est encore).
  // ⚠️ Mutation-témoin : retirer le paragraphe sur la fenêtre 2→3 (« avant
  // tout push ») → rouge.
  it('écrit que la fenêtre résiduelle entre l’assertion finale et le commit est assumée, pas fermée', () => {
    const bullet = exceptionBullet(readSkill());
    expect(
      bullet,
      'aucune mention de la fenêtre résiduelle entre l’assertion finale (ligne 2) et le commit (ligne 3) — ancre "avant tout push" absente'
    ).toMatch(/avant tout push/i);
  });
});

// SKILL-74 — arbitrage du 2026-08-25 (specs/skill-66.md, § D3) : la séquence
// gagne une PRÉ-assertion (ligne 0, avant toute écriture) au lieu de l'issue
// de secours `reset -- <chemin>` que SKILL-70 avait ajoutée. La fenêtre
// résiduelle entre la pré-assertion et le commit n'est PAS fermée par un
// geste de réparation — elle est assumée et écrite (specs/skill-66.md, § D3).
//
// Extraction dédiée : les trois lignes ci-dessous vérifient la SÉQUENCE au
// sens strict — le bloc de code à trois retours-arrière que le bullet de
// l'exception prescrit — et non toute la prose du bullet, qui cite
// légitimement "checkout"/"reset"/"stash" ailleurs (le rappel de l'interdit
// général, non touché par ce ticket).
function sequenceBlock(bullet) {
  const m = bullet.match(/```\n([\s\S]*?)```/);
  expect(m, 'aucun bloc de code (```) trouvé dans le bullet de l’exception').not.toBeNull();
  return m[1];
}

// Les lignes RÉELLEMENT exécutées de la séquence, dans l’ordre du texte —
// celles qui commencent par `git -C`, commentaires de fin de ligne exclus.
function sequenceCommands(block) {
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('git -C'));
}

describe('SKILL-74 — pré-assertion sans issue de secours (arbitrage 2026-08-25)', () => {
  // Test 1 (spec § Tests, point 1) : la séquence comporte une assertion AVANT
  // toute commande mutante — vérifié sur l’ORDRE des commandes, pas sur leur
  // présence.
  // ⚠️ Mutation-témoin : replacer le `rm --cached` en tête de la séquence (le
  // faire passer devant la pré-assertion) → rouge.
  it('joue l’assertion `diff --cached --name-status` avant toute commande mutante, dans la séquence', () => {
    const commands = sequenceCommands(sequenceBlock(exceptionBullet(readSkill())));
    expect(
      commands.length,
      'la séquence ne porte pas les 4 commandes `git -C "$MAIN" …` attendues'
    ).toBeGreaterThanOrEqual(4);
    expect(
      commands[0],
      'la première commande de la séquence n’est pas l’assertion `diff --cached --name-status`'
    ).toMatch(/diff --cached --name-status/);
    expect(
      commands[1],
      'la seconde commande de la séquence n’est pas `rm --cached` — la mutation doit venir APRÈS l’assertion'
    ).toMatch(/rm --cached/);
  });

  // Test 2 (spec § Tests, point 2) : la séquence ne contient ni `reset`, ni
  // `checkout`, ni `stash`, sous aucune forme.
  // ⚠️ Mutation-témoin : ajouter un `git reset -- <chemin>` comme issue de
  // secours ACTIVE dans le bloc de code → rouge.
  it('ne contient ni `reset`, ni `checkout`, ni `stash` dans la séquence (le bloc de code)', () => {
    const block = sequenceBlock(exceptionBullet(readSkill()));
    expect(block, '`reset` apparaît dans la séquence').not.toMatch(/\breset\b/);
    expect(block, '`checkout` apparaît dans la séquence').not.toMatch(/\bcheckout\b/);
    expect(block, '`stash` apparaît dans la séquence').not.toMatch(/\bstash\b/);
  });

  // Complément du test 2 : le § Correction attendue de specs/skill-74.md
  // interdit de RÉOUVRIR l'issue de secours « même en commentaire d'exemple »
  // — mais §, lui-même, exige de la CONSIGNER comme examinée et écartée
  // (« pour que la question ne soit pas rouverte par ignorance », finding 9
  // de la gate de reprise). Les deux ne se contredisent pas : la prose peut
  // NOMMER `git reset -- <chemin>` tant qu'elle ne le présente pas comme un
  // geste PERMIS. Le test porte donc sur la PRÉSENTATION (permis / écarté),
  // pas sur la seule présence du mot — un `not.toMatch` nu sur la présence
  // aurait forcé un renvoi anonyme (finding 9) ET aurait laissé passer une
  // réintroduction sur un chemin réel non littéral (finding 4, `<chemin>`
  // remplacé par `settings.json`) : `\S+` couvre les deux formes.
  // ⚠️ Mutation-témoin : ajouter, dans la prose (bloc de code ou pas), une
  // phrase qui présente `reset -- <chemin ou fichier réel>` comme « autorisé »
  // ou « permis » → rouge, y compris avec un chemin réel (`settings.json`).
  it('ne présente jamais `reset` (sous forme à pathspec) comme un geste AUTORISÉ ou PERMIS', () => {
    // Aplati (blancs ET retours ligne) — la prose est enveloppée à ~80
    // colonnes, "reset -- <chemin>" et "autorisé"/"permis" peuvent tomber sur
    // deux lignes Markdown distinctes (cf. test 3 de SKILL-66 ci-dessus,
    // même convention).
    // ⚠️ PAS de `\b` final après "autorisé" : en JS, `\b` sans le flag `u`
    // traite les lettres accentuées comme des non-mots — "autorisé" suivi
    // d'un espace ou d'une virgule ne satisfait donc JAMAIS un `\bautorisé\b`
    // (la position juste après le "é" n'est pas vue comme une frontière),
    // ce qui a fait passer au vert, en silence, une mutation réelle « reset
    // -- settings.json est le seul geste autorisé » lors du rejeu de ce
    // mutation-témoin (gate de reprise SKILL-74). `permis` n'a pas ce défaut
    // (il finit par une consonne ASCII) mais on retire le `\b` des DEUX pour
    // rester symétrique et ne pas dépendre de la lettre finale du mot.
    const flat = exceptionBullet(readSkill()).replace(/\s+/g, ' ');
    expect(
      flat,
      '`reset` (à pathspec) est présenté comme un geste autorisé/permis dans le bullet de l’exception'
    ).not.toMatch(/reset\s+--\s+\S+[^.]*\b(autorisé|permis)/i);
  });

  // Extraction du bloc de code de D3 (specs/skill-66.md) — même dispositif
  // que `sequenceBlock`/`sequenceCommands` ci-dessus, pour le fichier de
  // SPEC : les commandes de D3 n'ont pas de `-C "$MAIN"` (prescription
  // générique, pas l'invocation littérale de l'orchestrateur), donc le
  // filtre est sur `git ` seul.
  function d3Section(raw) {
    return sectionEntre(raw, '### D3 —', '### D4 —', 'specs/skill-66.md');
  }
  function d3Commands(d3) {
    const block = sequenceBlock(d3);
    return block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('git '));
  }

  // Test 3 (spec § Tests, point 3) : D3 (specs/skill-66.md) énonce
  // explicitement la fenêtre résiduelle — ANCRÉE sur la fenêtre 0→1 (celle
  // que SKILL-74 introduit), pas sur le mot "fenêtre résiduelle" nu : depuis
  // le finding 3 de la gate de reprise, D3 porte DEUX fenêtres distinctes
  // (0→1 introduite ici, 2→3 héritée de SKILL-70) — un `toMatch` non ancré
  // resterait vert si SEULE l'une des deux restait écrite.
  // ⚠️ Mutation-témoin : retirer ce passage de D3 (le point 1 de la liste des
  // fenêtres résiduelles) → rouge — cette assertion vise le texte que CE
  // ticket ajoute à D3, pas la fenêtre 2→3 préexistante (héritée de
  // SKILL-70, verrouillée séparément par le test SKILL-70 « avant tout
  // push » ci-dessus).
  it('D3 (specs/skill-66.md) énonce la fenêtre résiduelle entre la pré-assertion et le rm', () => {
    const d3 = d3Section(readNormalized(REPO_ROOT, 'specs/skill-66.md'));
    expect(
      d3,
      'D3 ne mentionne plus la fenêtre résiduelle entre la ligne 0 (pré-assertion) et le `rm --cached`'
    ).toMatch(/entre la ligne 0 et le `rm --cached`/i);
    expect(
      d3,
      'D3 ne dit plus explicitement que l’issue de secours (`reset`) a été examinée et écartée'
    ).toMatch(/écart/i);
  });

  // Test 1 de D3 (finding 7 de la gate de reprise) : le § Tests de
  // specs/skill-74.md porte explicitement sur « la séquence prescrite par
  // D3 » — pas seulement sur sa mise en conformité dans le skill. Sans ce
  // test, la mutation-témoin annoncée (« replacer le rm --cached en tête »)
  // rejouée sur D3 restait VERTE : seul le skill était verrouillé.
  // ⚠️ Mutation-témoin : dans le bloc de code de D3, replacer
  // `git rm --cached <chemin>` en tête (devant la pré-assertion) → rouge.
  it('D3 : la pré-assertion précède le `rm --cached`, dans l’ORDRE du bloc de code', () => {
    const commands = d3Commands(d3Section(readNormalized(REPO_ROOT, 'specs/skill-66.md')));
    expect(
      commands.length,
      'le bloc de code de D3 ne porte pas les 4 commandes `git …` attendues'
    ).toBeGreaterThanOrEqual(4);
    expect(
      commands[0],
      'la première commande du bloc de D3 n’est pas l’assertion `diff --cached --name-status`'
    ).toMatch(/diff --cached --name-status/);
    expect(
      commands[1],
      'la seconde commande du bloc de D3 n’est pas `rm --cached` — la mutation doit venir APRÈS l’assertion'
    ).toMatch(/rm --cached/);
  });

  // Test 2 de D3 (finding 7 de la gate de reprise) : même garde que sur le
  // skill, appliquée au bloc de code de D3 lui-même.
  // ⚠️ Mutation-témoin : ajouter `git reset -- <chemin>`, `git checkout` ou
  // `git stash` au bloc de code de D3 → rouge.
  it('D3 : le bloc de code ne contient ni `reset`, ni `checkout`, ni `stash`', () => {
    const block = sequenceBlock(d3Section(readNormalized(REPO_ROOT, 'specs/skill-66.md')));
    expect(block, '`reset` apparaît dans le bloc de code de D3').not.toMatch(/\breset\b/);
    expect(block, '`checkout` apparaît dans le bloc de code de D3').not.toMatch(/\bcheckout\b/);
    expect(block, '`stash` apparaît dans le bloc de code de D3').not.toMatch(/\bstash\b/);
  });
});
