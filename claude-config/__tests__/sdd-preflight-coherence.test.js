// Tests de l'outil autonome tools/sdd/preflight.mjs (SKILL-13, étendu SKILL-14).
//
// SDD (D3, specs/skill-13.md ; D3, specs/skill-14.md) : le CLAUDE.md global
// impose de LISTER les cas de test de chaque fonction exportée, orchestrateur
// CLI compris. Ce fichier couvre EXHAUSTIVEMENT les cas (a)…(g) de
// specs/skill-13.md D3 pour resolveTicket, resolveTargetRoot, determineMode,
// deriveWorktreePath, checkSpecOnMain et main(argv) verbe `resolve` — PUIS les
// cas (a)…(k) de specs/skill-14.md D3 pour locateImplementer et main(argv)
// verbe `locate` — sur des arborescences `specs/` de FIXTURES TEMPORAIRES
// (jamais le repo réel), comme la spec l'exige.
//
// ⚠️ SKILL-14 : les nouveaux cas (locateImplementer, verbe `locate`) doivent
// RATER D'ABORD (le verbe n'existe pas encore) — étape 2 du SDD. Les cas
// SKILL-13 existants (resolveTicket, resolve, etc.) doivent rester VERTS tout
// du long (D3 cas (k) — garde anti-régression du dispatcher).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import {
  toPosixPath,
  normalizePath,
  resolveTicket,
  resolveTargetRoot,
  determineMode,
  deriveWorktreePath,
  checkSpecOnMain,
  locateImplementer,
  main,
} from '../tools/sdd/preflight.mjs';

// --- Utilitaires de fixtures ------------------------------------------------

const tmps = [];
function mkTmp(prefix = 'sdd-preflight-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
}

// Helper de COMPARAISON de chemins réutilisant la vraie fonction exportée
// `normalizePath` (pas de réimplémentation dupliquée). L'oracle INDÉPENDANT de
// `normalizePath`/`toPosixPath` — celui qui ne les fait pas passer par
// eux-mêmes des deux côtés d'une assertion — vit dans le describe dédié
// « toPosixPath / normalizePath » plus bas, en égalité de chaîne exacte.
const norm = normalizePath;

function writeSpec(root, relFile, frontmatter, { crlf = false, body = '# body\n' } = {}) {
  const abs = path.join(root, relFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  let content = '---\n' + frontmatter + '\n---\n\n' + body;
  if (crlf) content = content.replace(/\n/g, '\r\n');
  fs.writeFileSync(abs, content);
  return abs;
}

function gitAvailable() {
  const r = spawnSync('git', ['--version']);
  return !r.error && r.status === 0;
}
const itGit = gitAvailable() ? it : it.skip;

// git init minimal dans un répertoire DÉJÀ EXISTANT (nom imposé par
// l'appelant, ex. `.claude`) — le symbolic-ref avant le premier commit
// garantit la branche `main` quelle que soit la version de git (défaut
// master vs main).
function initRepoAt(root) {
  fs.mkdirSync(root, { recursive: true });
  spawnSync('git', ['init', root]);
  spawnSync('git', ['-C', root, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  spawnSync('git', ['-C', root, 'config', 'user.email', 't@example.com']);
  spawnSync('git', ['-C', root, 'config', 'user.name', 'Test']);
  spawnSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false']);
  return root;
}

// Init d'un dépôt git de fixture jetable (nom choisi par mkTmp) — dérive de
// initRepoAt() pour que toute évolution de la recette (ex. un futur `git
// config` ajouté après coup) profite aux DEUX helpers sans double entretien.
function initRepo() {
  return initRepoAt(mkTmp('sdd-git-'));
}
function commitAll(root, msg = 'init') {
  spawnSync('git', ['-C', root, 'add', '-A']);
  spawnSync('git', ['-C', root, 'commit', '-m', msg, '--no-gpg-sign']);
}

// Frontmatter d'un ticket maturé, exec au niveau 0.
function ticketFM(id, over = {}) {
  const f = {
    id,
    title: 'x',
    type: 'ticket',
    status: 'todo',
    priority: 'should',
    model: 'opus',
    effort: 'ultrathink',
    review: 'deep',
    matured: '2026-07-22',
    ...over,
  };
  return [
    `id: ${f.id}`,
    `title: ${f.title}`,
    `type: ${f.type}`,
    `status: ${f.status}`,
    `priority: ${f.priority}`,
    `model: ${f.model}`,
    `effort: ${f.effort}`,
    `review: ${f.review}`,
    `matured: ${f.matured}`,
  ].join('\n');
}

let savedHome;
let savedUserProfile;
beforeEach(() => {
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
});
afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  for (const d of tmps.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});
function setHome(dir) {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
}

// ============================================================================
// toPosixPath / normalizePath — oracle INDÉPENDANT (égalité de chaîne exacte)
// ============================================================================
//
// Ces deux fonctions sont EXPORTÉES → le CLAUDE.md global impose un test dédié
// (D3 : « un test manquant sur une fonction exportée est une régression »). Les
// assertions ci-dessous sont en égalité EXACTE, jamais round-trippées à travers
// la fonction testée : c'est ce qui rend falsifiables l'invariant de casse
// (critique sous Linux CI) et la branche MSYS `/c/…` → `c:/…` que les fixtures
// natives `mkdtempSync` n'atteignent jamais.
describe('toPosixPath(p)', () => {
  it('convertit les backslashes en `/` en PRÉSERVANT la casse du lecteur', () => {
    expect(toPosixPath('C:\\Users\\Moi\\Proj')).toBe('C:/Users/Moi/Proj');
  });

  it('branche MSYS `/c/…` → `c:/…` (drive collé, casse d’entrée conservée)', () => {
    expect(toPosixPath('/c/Users/moi')).toBe('c:/Users/moi');
    expect(toPosixPath('/C/Users/moi')).toBe('C:/Users/moi');
  });

  it('strippe le(s) slash(es) final(aux)', () => {
    expect(toPosixPath('/c/Users/moi/')).toBe('c:/Users/moi');
    expect(toPosixPath('C:\\Users\\moi\\')).toBe('C:/Users/moi');
  });

  it('chaîne vide / falsy → ""', () => {
    expect(toPosixPath('')).toBe('');
    expect(toPosixPath(undefined)).toBe('');
  });
});

describe('normalizePath(p)', () => {
  it('minuscule le LECTEUR uniquement, JAMAIS les segments hors-lecteur', () => {
    // L'invariant de sécurité : `Moi`/`Proj` restent capitalisés. Une
    // « simplification » qui minusculerait tout le chemin ferait rougir ceci.
    expect(normalizePath('C:/Users/Moi/Proj')).toBe('c:/Users/Moi/Proj');
    expect(normalizePath('C:\\Users\\Moi')).toBe('c:/Users/Moi');
  });

  it('réconcilie MSYS et backslashes en une seule forme comparable', () => {
    expect(normalizePath('/C/Users/moi')).toBe('c:/Users/moi');
    expect(normalizePath('C:\\Users\\moi\\')).toBe('c:/Users/moi');
  });

  it('deux chemins POSIX ne différant QUE par la casse d’un segment hors-lecteur restent DISTINCTS', () => {
    // Scénario Linux CI : deux repos distincts `Proj` vs `proj`. Si
    // normalizePath minusculait tout, ces deux valeurs deviendraient égales et
    // determineMode renverrait à tort same-repo.
    expect(normalizePath('/home/moi/Proj')).not.toBe(normalizePath('/home/moi/proj'));
  });

  it('deux chemins ne différant QUE par la casse du LECTEUR sont ÉGAUX', () => {
    expect(normalizePath('C:/x/y')).toBe(normalizePath('c:/x/y'));
  });
});

// ============================================================================
// resolveTicket(root, id)
// ============================================================================
describe('resolveTicket(root, id)', () => {
  it('(a) ticket présent (type: ticket + id) → objet complet', () => {
    const root = mkTmp();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    const r = resolveTicket(root, 'FOO-01');
    expect(r).not.toBeNull();
    expect(r.file).toBe('specs/foo-01.md');
    expect(r.status).toBe('todo');
    expect(r.priority).toBe('should');
    expect(r.model).toBe('opus');
    expect(r.effort).toBe('ultrathink');
    expect(r.review).toBe('deep');
    expect(r.matured).toBe('2026-07-22');
  });

  it('(b) fichier au nom NON déductible de l’ID, trouvé par scan du frontmatter', () => {
    const root = mkTmp();
    writeSpec(root, 'specs/weird-name-xyz.md', ticketFM('FOO-01'));
    const r = resolveTicket(root, 'FOO-01');
    expect(r).not.toBeNull();
    expect(r.file).toBe('specs/weird-name-xyz.md');
  });

  it('(c) type != ticket est ignoré', () => {
    const root = mkTmp();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01', { type: 'epic' }));
    expect(resolveTicket(root, 'FOO-01')).toBeNull();
  });

  it('(d) id absent → null', () => {
    const root = mkTmp();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    expect(resolveTicket(root, 'BAR-99')).toBeNull();
  });

  it('(e) clé du bloc exec: (model/effort/review) lue malgré l’indentation', () => {
    const root = mkTmp();
    const fm = [
      'id: FOO-01',
      'type: ticket',
      'status: todo',
      'priority: should',
      'exec:',
      '  model: sonnet',
      '  effort: think-hard',
      '  review: light',
      '  matured: 2026-07-22',
    ].join('\n');
    writeSpec(root, 'specs/foo-01.md', fm);
    const r = resolveTicket(root, 'FOO-01');
    expect(r).not.toBeNull();
    expect(r.model).toBe('sonnet');
    expect(r.effort).toBe('think-hard');
    expect(r.review).toBe('light');
    expect(r.matured).toBe('2026-07-22');
  });

  it('(f) CRLF toléré (fixture avec \\r\\n)', () => {
    const root = mkTmp();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'), { crlf: true });
    const r = resolveTicket(root, 'FOO-01');
    expect(r).not.toBeNull();
    expect(r.status).toBe('todo');
    expect(r.model).toBe('opus');
    expect(r.review).toBe('deep');
  });

  it('(g) review absent → champ vide (défaut posé par le consommateur, pas ici)', () => {
    const root = mkTmp();
    const fm = [
      'id: FOO-01',
      'type: ticket',
      'status: todo',
      'priority: should',
      'model: opus',
      'effort: ultrathink',
      'matured: 2026-07-22',
    ].join('\n');
    writeSpec(root, 'specs/foo-01.md', fm);
    const r = resolveTicket(root, 'FOO-01');
    expect(r).not.toBeNull();
    expect(r.review).toBe('');
  });

  it('scanne récursivement les sous-dossiers de specs/', () => {
    const root = mkTmp();
    writeSpec(root, 'specs/sub/deep/foo-01.md', ticketFM('FOO-01'));
    const r = resolveTicket(root, 'FOO-01');
    expect(r).not.toBeNull();
    expect(r.file).toBe('specs/sub/deep/foo-01.md');
  });

  it('specs/ absent → null (pas d’exception)', () => {
    const root = mkTmp();
    expect(resolveTicket(root, 'FOO-01')).toBeNull();
  });
});

// ============================================================================
// resolveTargetRoot(sessionRoot, id, repoFlag)
// ============================================================================
describe('resolveTargetRoot(sessionRoot, id, repoFlag)', () => {
  it('(a) ticket dans sessionRoot → cette racine, source: "session"', () => {
    const session = mkTmp('sdd-session-');
    setHome(mkTmp('sdd-home-'));
    writeSpec(session, 'specs/foo-01.md', ticketFM('FOO-01'));
    const r = resolveTargetRoot(session, 'FOO-01', null);
    expect(r).not.toBeNull();
    expect(norm(r.targetRoot)).toBe(norm(session));
    expect(r.source).toBe('session');
  });

  it('(b) absent de session, présent dans $HOME/.claude → source: "harness"', () => {
    const session = mkTmp('sdd-session-');
    const home = mkTmp('sdd-home-');
    setHome(home);
    writeSpec(path.join(home, '.claude'), 'specs/foo-01.md', ticketFM('FOO-01'));
    const r = resolveTargetRoot(session, 'FOO-01', null);
    expect(r).not.toBeNull();
    expect(norm(r.targetRoot)).toBe(norm(path.join(home, '.claude')));
    expect(r.source).toBe('harness');
  });

  it('(c) repoFlag fourni et valide → cette racine, source: "flag"', () => {
    const session = mkTmp('sdd-session-');
    const flag = mkTmp('sdd-flag-');
    setHome(mkTmp('sdd-home-'));
    // Le ticket est AUSSI dans la session : le flag doit néanmoins l'emporter.
    writeSpec(session, 'specs/foo-01.md', ticketFM('FOO-01'));
    writeSpec(flag, 'specs/foo-01.md', ticketFM('FOO-01'));
    const r = resolveTargetRoot(session, 'FOO-01', flag);
    expect(r).not.toBeNull();
    expect(norm(r.targetRoot)).toBe(norm(flag));
    expect(r.source).toBe('flag');
  });

  it('(d) repoFlag fourni mais ticket absent → null, SANS fallback harness', () => {
    const session = mkTmp('sdd-session-');
    const flag = mkTmp('sdd-flag-'); // pas de ticket ici
    const home = mkTmp('sdd-home-');
    setHome(home);
    // Le ticket EXISTE dans le harness : la preuve du « pas de fallback » est
    // qu'on renvoie quand même null (le flag désactive toute autre recherche).
    writeSpec(path.join(home, '.claude'), 'specs/foo-01.md', ticketFM('FOO-01'));
    const r = resolveTargetRoot(session, 'FOO-01', flag);
    expect(r).toBeNull();
  });

  it('(e) introuvable partout → null', () => {
    const session = mkTmp('sdd-session-');
    setHome(mkTmp('sdd-home-')); // home sans .claude/specs
    const r = resolveTargetRoot(session, 'FOO-01', null);
    expect(r).toBeNull();
  });

  it('ne confond pas harness et session quand ils sont identiques', () => {
    // session == $HOME/.claude et le ticket n'y est pas : pas de double-scan.
    const home = mkTmp('sdd-home-');
    setHome(home);
    const session = path.join(home, '.claude');
    fs.mkdirSync(session, { recursive: true });
    const r = resolveTargetRoot(session, 'FOO-01', null);
    expect(r).toBeNull();
  });
});

// ============================================================================
// determineMode(targetRoot, sessionRoot)
// ============================================================================
describe('determineMode(targetRoot, sessionRoot)', () => {
  it('(a) racines identiques → same-repo', () => {
    expect(determineMode('/c/Users/moi/proj', '/c/Users/moi/proj')).toBe('same-repo');
  });

  it('(b) racines différentes → cross-repo', () => {
    expect(determineMode('/c/Users/moi/.claude', '/c/Users/moi/proj')).toBe('cross-repo');
  });

  it('(c) normalisation Windows (séparateurs + casse du lecteur) → identiques', () => {
    expect(determineMode('C:\\Users\\moi\\.claude', 'c:/Users/moi/.claude')).toBe('same-repo');
    // MSYS /c/ vs C:\ également réconciliés
    expect(determineMode('/c/Users/moi/.claude', 'C:\\Users\\moi\\.claude')).toBe('same-repo');
    // slash final non significatif
    expect(determineMode('/c/Users/moi/proj/', '/c/Users/moi/proj')).toBe('same-repo');
  });

  it('la casse d’un segment HORS-lecteur reste significative → cross-repo (invariant Linux CI)', () => {
    // Deux repos distincts sous Linux (pas de lecteur) : `Proj` ≠ `proj`. Si la
    // normalisation minusculait tout, ceci renverrait à tort same-repo et le
    // skill spawnerait l'agent sur le mauvais arbre.
    expect(determineMode('/home/moi/Proj', '/home/moi/proj')).toBe('cross-repo');
  });

  itGit('racine hors dépôt git (mais existante sur disque) → repli sur la comparaison de chemins, sans throw', () => {
    // Mutation-témoin : faire propager l'erreur de spawnSync (--git-common-dir
    // en échec) au lieu du repli → rouge (throw au lieu d'un mode décidable).
    const a = mkTmp('sdd-notrepo-a-');
    const b = mkTmp('sdd-notrepo-b-');
    expect(() => determineMode(a, a)).not.toThrow();
    expect(determineMode(a, a)).toBe('same-repo');
    expect(determineMode(a, b)).toBe('cross-repo');
  });
});

// ============================================================================
// determineMode — le mode se décide sur le DÉPÔT, pas sur les chemins (SKILL-44)
// ============================================================================
describe('determineMode — décision sur le dépôt (SKILL-44)', () => {
  itGit('le cas qui a produit ce ticket : worktree de R en session, main de R en cible → same-repo, worktreePath/branch null', () => {
    // Mutation-témoin : rétablir la comparaison de chemins (normalizePath sur
    // targetRoot/sessionRoot directement) → rouge, le mode redevient cross-repo
    // puisque les racines de travail diffèrent. C'est le cas vécu sur BLG-07.
    setHome(mkTmp('sdd-home-'));
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root);
    const wtParent = mkTmp('sdd-wtroot-');
    const wt = path.join(wtParent, 'session-wt');
    const add = spawnSync('git', ['-C', root, 'worktree', 'add', wt, '-b', 'session-branch']);
    expect(add.status, `git worktree add a échoué: ${add.stderr}`).toBe(0);

    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', wt, '--repo', root]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.mode).toBe('same-repo');
    expect(out.worktreePath).toBeNull();
    expect(out.branch).toBeNull();
  });

  itGit('non-régression : vrai cross-repo (dépôts distincts) reste cross-repo', () => {
    // Mutation-témoin : comparer les --git-common-dir SANS les résoudre en
    // absolu (les deux valent littéralement ".git") → rouge, tout devient
    // same-repo. C'est l'erreur symétrique annoncée au § Décision 1 de la spec.
    setHome(mkTmp('sdd-home-'));
    const sessionRepo = initRepo(); // dépôt A, sans le ticket
    const targetRepo = initRepo(); // dépôt B, distinct, avec le ticket
    writeSpec(targetRepo, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(targetRepo);

    const r = main([
      'resolve',
      '--ticket',
      'FOO-01',
      '--session-root',
      sessionRepo,
      '--repo',
      targetRepo,
    ]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.mode).toBe('cross-repo');
    expect(out.worktreePath).not.toBeNull();
    expect(out.branch).not.toBeNull();
  });

  itGit('non-régression : cas nominal, mêmes racines → same-repo', () => {
    setHome(mkTmp('sdd-home-'));
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root);
    expect(determineMode(root, root)).toBe('same-repo');
  });

  // Racine sous forme MSYS (`/c/…`) — `git` natif ne traduit pas ce chemin en
  // l'absence de shell (spawnSync est sans shell). SKILL-44 finding 3 : sans
  // normalisation `toPosixPath` avant le `-C`, `gitCommonDir` échoue
  // SILENCIEUSEMENT sur la forme MSYS, `determineMode` retombe sur la
  // comparaison de chemins, et le défaut BLG-07 revient par cette porte.
  (process.platform === 'win32' ? itGit : it.skip)(
    'racine MSYS (`/c/…`) : worktree de R en session (forme MSYS) vs main de R en cible → same-repo',
    () => {
      // Mutation-témoin : passer `root` brut à `spawnSync` (sans toPosixPath)
      // dans gitCommonDir → rouge, `git -C /c/…` échoue et le mode retombe en
      // cross-repo par la comparaison de chemins.
      setHome(mkTmp('sdd-home-'));
      const root = initRepo();
      writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
      commitAll(root);
      const wtParent = mkTmp('sdd-wtroot-');
      const wt = path.join(wtParent, 'session-wt-msys');
      const add = spawnSync('git', ['-C', root, 'worktree', 'add', wt, '-b', 'session-branch-msys']);
      expect(add.status, `git worktree add a échoué: ${add.stderr}`).toBe(0);

      const posix = toPosixPath(wt);
      const driveMatch = /^([A-Za-z]):\//.exec(posix);
      expect(driveMatch, `chemin de fixture sans lecteur : ${posix}`).not.toBeNull();
      const msysSession = '/' + driveMatch[1].toLowerCase() + posix.slice(driveMatch[1].length + 1);

      expect(determineMode(root, msysSession)).toBe('same-repo');
    }
  );
});

// ============================================================================
// deriveWorktreePath(targetRoot, id) — SKILL-85 : racine nommée d'après le
// dépôt cible, plus aucune lecture des worktrees existants (D1/D2,
// specs/skill-85.md ; amende le cas (d) de la D3 de specs/skill-13.md).
// ============================================================================

// Répertoire de fixture au nom IMPOSÉ (ex. `.foo`, `.claude`), sous un parent
// temporaire jetable — pour les cas où le slug dépend du basename exact.
function mkNamedDir(name) {
  const parent = mkTmp('sdd-parent-');
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function addOrigin(root, url) {
  spawnSync('git', ['-C', root, 'remote', 'add', 'origin', url]);
}

describe('deriveWorktreePath(targetRoot, id)', () => {
  itGit(
    'le cas qui a produit le ticket : la racine porte le nom du dépôt visé (remote origin), pas le répertoire',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      // Placé dans un tmp `sdd-target-…` — nom SANS rapport avec le slug attendu.
      const target = initRepo();
      addOrigin(target, 'https://github.com/giboulz/personal-hub.git');
      const r = deriveWorktreePath(target, 'SDD-99');
      expect(r.underTarget).toBe(false);
      expect(norm(r.worktreePath)).toBe(norm(path.join(home, 'personal-hub-wt', 'sdd-99')));
      // Mutation-témoin : rétablir le repli `claude-config-wt` en dur → rouge.
    }
  );

  itGit(
    'régression du cas (d) : un worktree hors-arborescence existant, sous une racine étrangère, n’est plus recopié',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      const target = initRepo();
      addOrigin(target, 'https://example.com/team/hote.git');
      writeSpec(target, 'specs/foo-01.md', ticketFM('FOO-01'));
      commitAll(target);
      // Worktree hors-arborescence existant, sous une racine ÉTRANGÈRE — trace
      // exacte de `~/claude-config-wt/sdd-12` sous `personal-hub`.
      const foreignParent = mkTmp('sdd-foreign-claude-config-wt-');
      const existing = path.join(foreignParent, 'existing');
      const add = spawnSync('git', ['-C', target, 'worktree', 'add', existing]);
      expect(add.status, `git worktree add a échoué: ${add.stderr}`).toBe(0);
      const r = deriveWorktreePath(target, 'BAR-02');
      // La dérivation ne relit PAS la racine étrangère : elle rend $HOME/hote-wt.
      expect(norm(r.worktreePath)).toBe(norm(path.join(home, 'hote-wt', 'bar-02')));
      expect(norm(path.dirname(r.worktreePath))).not.toBe(norm(foreignParent));
      expect(r.underTarget).toBe(false);
      // Mutation-témoin : réintroduire la boucle du cas (d) → rouge.
    }
  );

  itGit(
    'non-régression : `claude-config` garde sa racine, au caractère près',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      const target = mkNamedDir('.claude');
      initRepoAt(target);
      addOrigin(target, 'https://github.com/giboulz/claude-config.git');
      const r = deriveWorktreePath(target, 'SKILL-85');
      expect(norm(r.worktreePath)).toBe(norm(path.join(home, 'claude-config-wt', 'skill-85')));
      // Mutation-témoin : dériver du basename AVANT le distant → la règle 2
      // (basename `.claude`, point de tête retiré) gagnerait la course sans
      // jamais consulter le distant → `claude-wt` (PAS `claude-config-wt`) → rouge.
    }
  );

  itGit(
    'racine MSYS (`/c/…`) non normalisée avant `-C` : le distant est quand même lu, pas de repli silencieux',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      const target = initRepo();
      addOrigin(target, 'https://github.com/giboulz/claude-config.git');
      // Forme MSYS du même chemin (`/c/Users/...`) — jamais traduite par le
      // binaire git natif : sans toPosixPath, `-C` échoue et repoSlug retombe
      // SILENCIEUSEMENT sur le basename (fixture `sdd-git-…`, pas
      // `claude-config`).
      const msysTarget = toPosixPath(target).replace(/^([A-Za-z]):\//, (_m, d) => '/' + d.toLowerCase() + '/');
      const r = deriveWorktreePath(msysTarget, 'SKILL-85');
      expect(norm(r.worktreePath)).toBe(norm(path.join(home, 'claude-config-wt', 'skill-85')));
      // Mutation-témoin : passer `targetRoot` brut (sans toPosixPath) à
      // `git -C` dans repoSlug → `-C` échoue sur la forme MSYS → repli
      // basename(fixture) → rouge.
    }
  );

  it('repli 2 (pas de remote) : cible n’est pas un dépôt git → basename-wt, aucun throw', () => {
    const home = mkTmp('sdd-home-');
    setHome(home);
    const target = mkTmp('sdd-target-');
    const r = deriveWorktreePath(target, 'FOO-01');
    expect(r.underTarget).toBe(false);
    expect(norm(r.worktreePath)).toBe(
      norm(path.join(home, path.basename(target) + '-wt', 'foo-01'))
    );
    // Mutation-témoin : supprimer la règle 2 (basename), retomber directement
    // sur le défaut 'repo' → rouge (basename(target) n'a pas de point de tête
    // ici : c'est le cas « dossier à point de tête » ci-dessous qui isole
    // spécifiquement le `.replace(/^\.+/, '')`).
  });

  itGit(
    'repli 2 (pas de remote) : dépôt jetable sans origin, dossier à point de tête → point retiré du slug',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      const target = mkNamedDir('.foo');
      initRepoAt(target);
      // Pas de remote origin.
      const r = deriveWorktreePath(target, 'FOO-01');
      expect(norm(r.worktreePath)).toBe(norm(path.join(home, 'foo-wt', 'foo-01')));
      // Mutation-témoin : laisser passer le point de tête → `.foo-wt` → rouge.
    }
  );

  it('repli 3 (défaut de dernier recours) : racine de lecteur (basename vide) → `repo-wt`, aucun throw', () => {
    const home = mkTmp('sdd-home-');
    setHome(home);
    const driveRoot = path.parse(os.homedir()).root;
    expect(() => deriveWorktreePath(driveRoot, 'FOO-01')).not.toThrow();
    const r = deriveWorktreePath(driveRoot, 'FOO-01');
    expect(norm(r.worktreePath)).toBe(norm(path.join(home, 'repo-wt', 'foo-01')));
    // Mutation-témoin : remplacer le défaut `'repo'` par une autre valeur
    // (ex. `'root'`) → rouge.
  });

  it('(b) dérivation qui tomberait sous la cible → underTarget: true (REFUS)', () => {
    const home = mkTmp('sdd-home-');
    setHome(home);
    // cible == home : `home` n'est pas un dépôt git → le slug retombe sur la
    // règle 2 (basename(home)) — peu importe LEQUEL, $HOME/<slug>-wt/<id> est
    // alors SOUS la cible dans ce cas dégénéré, quel que soit le slug retenu.
    const r = deriveWorktreePath(home, 'FOO-01');
    expect(r.underTarget).toBe(true);
  });

  it('(c) suffixe = ID en minuscules (chemin + branche)', () => {
    setHome(mkTmp('sdd-home-'));
    const target = mkTmp('sdd-target-');
    const r = deriveWorktreePath(target, 'SKILL-13');
    expect(r.branch).toBe('claude/skill-13');
    expect(norm(r.worktreePath).endsWith('/skill-13')).toBe(true);
  });

  // --- SKILL-107 : forme scp de l'URL, et prédicat de slug élargi ----------

  itGit(
    'SKILL-107 D1 : le cas qui a produit le ticket — forme scp plate (`git@hôte:dépôt.git`, aucun `/`)',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      // Cible dans un répertoire au nom SANS rapport (`sdd-git-…`).
      const target = initRepo();
      addOrigin(target, 'git@gitlab.internal:dotfiles.git');
      const r = deriveWorktreePath(target, 'FOO-01');
      expect(norm(r.worktreePath)).toBe(norm(path.join(home, 'dotfiles-wt', 'foo-01')));
      // Mutation-témoin : retirer la passe scp (les deux lignes `colonIdx` de
      // `repoSlug`), D2 INCHANGÉE → le slug `git@gitlab.internal:dotfiles`
      // porte un `:`, désormais interdit par D2, donc rejeté : repli sur le
      // basename de la cible (`sdd-git-…`, PAS
      // `git@gitlab.internal:dotfiles-wt` — cette valeur-là n'apparaît que si
      // D1 ET D2 sont révoquées ensemble, cf. § Vérification 1) → rouge
      // (mesuré, finding de revue SKILL-107).
    }
  );

  itGit(
    'SKILL-107 D1 : la passe scp ne casse pas `ssh://…:<port>/…` (le découpage sur `/` doit précéder la passe `:`)',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      const target = initRepo();
      addOrigin(target, 'ssh://git@host:22/ns/repo.git');
      const r = deriveWorktreePath(target, 'FOO-01');
      expect(norm(r.worktreePath)).toBe(norm(path.join(home, 'repo-wt', 'foo-01')));
      // Mutation-témoin : remplacer le découpage sur `/` par un découpage
      // EXCLUSIF sur `:` (`url.split(':').filter(Boolean).pop()`, sans
      // re-découper sur `/`) → dernier segment `22/ns/repo.git`, `.git`
      // retiré → `22/ns/repo`, contient un `/`, rejeté → repli basename
      // (`sdd-git-…`, PAS `repo-wt`) → rouge (mesuré, finding de revue
      // SKILL-107 : PAS une simple inversion d'ordre des deux passes — les
      // deux passes, correctement re-découpées chacune, sont commutatives ;
      // seul le remplacement de la primaire par la secondaire mord).
    }
  );

  itGit(
    'SKILL-107 D1 : forme scp AVEC namespace (`git@hôte:ns/dépôt.git`)',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      const target = initRepo();
      addOrigin(target, 'git@host:ns/repo.git');
      const r = deriveWorktreePath(target, 'FOO-01');
      expect(norm(r.worktreePath)).toBe(norm(path.join(home, 'repo-wt', 'foo-01')));
      // Mutation-témoin : remplacer le découpage sur `/` par un découpage
      // EXCLUSIF sur `:` (`url.split(':').filter(Boolean).pop()`, sans
      // re-découper sur `/`) → dernier segment `ns/repo.git`, `.git` retiré →
      // `ns/repo`, contient un `/`, rejeté → repli basename (`sdd-git-…`, PAS
      // `repo-wt`) → rouge (mesuré, finding de revue SKILL-107 — c'est la
      // MÊME mutation que celle du cas `ssh://…:<port>/…` ci-dessus, pas
      // « retirer le `.filter(Boolean)` » : ce geste-là est un no-op sur les
      // six URL du corpus).
    }
  );

  itGit(
    'SKILL-107 D2 : un caractère réservé Windows dans le slug du distant fait passer à la règle 2 (basename)',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      const target = mkNamedDir('hote-clair');
      initRepoAt(target);
      addOrigin(target, 'https://example.com/team/re?po.git');
      const r = deriveWorktreePath(target, 'FOO-01');
      expect(norm(r.worktreePath)).toBe(norm(path.join(home, 'hote-clair-wt', 'foo-01')));
      // Mutation-témoin : rétablir l'énumération fermée de SKILL-85 (vide, `.`,
      // `..`, séparateur de chemin) → `re?po` jugé utilisable → rouge.
    }
  );

  itGit(
    'SKILL-107 D2 : le chemin rendu est créable — caractère réservé RÉVÉLÉ par la passe scp (D1×D2, oracle Windows-seul)',
    () => {
      // ⚠️ PAS le fixture scp « propre » du cas fondateur (:650) : une fois la
      // passe scp appliquée, `dotfiles` ne porte aucun caractère interdit, et
      // le mkdirSync qui suit ne discrimine alors QUE la révocation conjointe
      // de D1 et D2 (déjà couverte, plus précisément, par l'égalité de chemin
      // du cas fondateur) — finding de revue SKILL-107. Ce fixture-ci imbrique
      // un `?` APRÈS le `:` scp, pour que D2 seule soit ce qui protège.
      const home = mkTmp('sdd-home-');
      setHome(home);
      const target = initRepo();
      addOrigin(target, 'git@host:re?po.git');
      const r = deriveWorktreePath(target, 'FOO-01');
      // D1 extrait `re?po` (après le `:`) ; D2 le juge inutilisable (`?`) et
      // fait retomber sur le basename de la cible (`sdd-git-…`), créable.
      expect(norm(r.worktreePath)).toBe(
        norm(path.join(home, path.basename(target) + '-wt', 'foo-01'))
      );
      expect(() =>
        fs.mkdirSync(path.dirname(r.worktreePath), { recursive: true })
      ).not.toThrow();
      // Mutation-témoin : rétablir l'énumération fermée de SKILL-85 (D2 seule
      // affaiblie, D1 inchangée) → `re?po` jugé utilisable → chemin
      // `<home>/re?po-wt/foo-01` → `mkdirSync` lève `EINVAL` → rouge (mesuré,
      // finding de revue SKILL-107 — CETTE fois la mutation isole bien D2).
    }
  );

  itGit(
    'SKILL-107 D2 : le chemin rendu est créable — caractère réservé dans le distant (oracle Windows-seul)',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      const target = mkNamedDir('hote-clair');
      initRepoAt(target);
      addOrigin(target, 'https://example.com/team/re?po.git');
      const r = deriveWorktreePath(target, 'FOO-01');
      expect(() =>
        fs.mkdirSync(path.dirname(r.worktreePath), { recursive: true })
      ).not.toThrow();
      // Mutation-témoin : tout affaiblissement de D2 → `EINVAL` → rouge.
    }
  );

  itGit(
    'SKILL-107 § Hors-scope : un remote en chemin local Windows reste rejeté (frontière — la règle 1 n\'est pas découpée sur `\\`)',
    () => {
      const home = mkTmp('sdd-home-');
      setHome(home);
      const target = mkTmp('sdd-target-');
      initRepoAt(target);
      addOrigin(target, 'C:\\Users\\gibou\\mirrors\\foo');
      const r = deriveWorktreePath(target, 'FOO-01');
      expect(norm(r.worktreePath)).toBe(
        norm(path.join(home, path.basename(target) + '-wt', 'foo-01'))
      );
      // Mutation-témoin : découper aussi sur `\` → `foo-wt` → rouge.
    }
  );
});

// ============================================================================
// checkSpecOnMain(targetRoot, specPath)
// ============================================================================
describe('checkSpecOnMain(targetRoot, specPath)', () => {
  itGit('(a) spec + statut maturé (todo) sur main → true', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01', { status: 'todo' }));
    commitAll(root);
    expect(checkSpecOnMain(root, 'specs/foo-01.md')).toBe(true);
  });

  itGit('statut wip sur main → true aussi', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01', { status: 'wip' }));
    commitAll(root);
    expect(checkSpecOnMain(root, 'specs/foo-01.md')).toBe(true);
  });

  itGit('(b) spec absente de main → false', () => {
    const root = initRepo();
    writeSpec(root, 'specs/other.md', ticketFM('OTHER-01'));
    commitAll(root);
    expect(checkSpecOnMain(root, 'specs/foo-01.md')).toBe(false);
  });

  itGit('(c) spec présente mais statut maturing sur main → false', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01', { status: 'maturing' }));
    commitAll(root);
    expect(checkSpecOnMain(root, 'specs/foo-01.md')).toBe(false);
  });

  itGit('spec seulement dans le working tree (pas commitée sur main) → false', () => {
    const root = initRepo();
    writeSpec(root, 'specs/seed.md', ticketFM('SEED-01'));
    commitAll(root);
    // Ajoutée après le commit, jamais sur main.
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01', { status: 'todo' }));
    expect(checkSpecOnMain(root, 'specs/foo-01.md')).toBe(false);
  });
});

// ============================================================================
// main(argv) — CLI
// ============================================================================
describe('main(argv) — CLI', () => {
  itGit('(a) résolution complète same-repo → JSON attendu', () => {
    setHome(mkTmp('sdd-home-'));
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root);
    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', root]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.ticket).toBe('FOO-01');
    expect(out.found).toBe(true);
    expect(norm(out.targetRoot)).toBe(norm(root));
    expect(out.mode).toBe('same-repo');
    expect(out.specPath).toBe('specs/foo-01.md');
    expect(norm(out.absoluteSpecPath)).toBe(norm(root + '/specs/foo-01.md'));
    expect(out.status).toBe('todo');
    expect(out.model).toBe('opus');
    expect(out.effort).toBe('ultrathink');
    expect(out.review).toBe('deep');
    expect(out.worktreePath).toBeNull();
    expect(out.branch).toBeNull();
    expect(out.guards.specOnMain).toBe(true);
    expect(out.guards.statusGate).toBe('ok');
    expect(out.guards.worktreePathFree).toBe(true);
    expect(out.guards.worktreeUnderTarget).toBe(false);
    expect(out.guards.branchFree).toBe(true);
  });

  itGit('(b) résolution cross-repo → JSON avec worktreePath/branch non nuls', () => {
    setHome(mkTmp('sdd-home-'));
    const session = mkTmp('sdd-session-'); // repo de session (peu importe)
    const target = initRepo();
    writeSpec(target, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(target);
    const r = main([
      'resolve',
      '--ticket',
      'FOO-01',
      '--session-root',
      session,
      '--repo',
      target,
    ]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.mode).toBe('cross-repo');
    expect(out.branch).toBe('claude/foo-01');
    expect(out.worktreePath).not.toBeNull();
    expect(norm(out.worktreePath).endsWith('/foo-01')).toBe(true);
    expect(out.guards.specOnMain).toBe(true);
    expect(out.guards.worktreeUnderTarget).toBe(false);
    expect(out.guards.worktreePathFree).toBe(true);
    expect(out.guards.branchFree).toBe(true);
  });

  it('(c) ticket introuvable → code non nul + message nommant sessionRoot et $HOME/.claude', () => {
    const session = mkTmp('sdd-session-');
    const home = mkTmp('sdd-home-');
    setHome(home);
    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', session]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('FOO-01');
    expect(r.stderr).toContain('.claude');
    // Nomme les DEUX racines scannées (chemin en `/`, casse du lecteur préservée).
    expect(r.stderr).toContain(session.replace(/\\/g, '/'));
  });

  it('(c\') ticket introuvable → le message suggère aussi de synchroniser le worktree de session (SKILL-44)', () => {
    // Mutation-témoin : retirer cette branche du message → rouge.
    const session = mkTmp('sdd-session-');
    setHome(mkTmp('sdd-home-'));
    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', session]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('worktree');
    expect(r.stderr).toContain('rebase main');
  });

  it('(c\'\') la commande suggérée quote le chemin de session (SKILL-44 finding 5)', () => {
    // Mutation-témoin : retirer les guillemets autour du chemin → rouge. Un
    // chemin de session avec un espace casserait sinon la commande suggérée
    // à l'endroit même où le message dit « exécute-la ».
    const session = mkTmp('sdd-session with space-');
    setHome(mkTmp('sdd-home-'));
    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', session]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(`git -C "${session.replace(/\\/g, '/')}" rebase main`);
  });

  it('(c\'\'\') la commande suggérée n\'est plus `merge --ff-only` (SKILL-49) — mutation-témoin', () => {
    // Mutation-témoin : réintroduire `merge main --ff-only` → rouge. Cette
    // commande échoue en exit 128 (fast-forward impossible) sur le cas courant
    // mesuré au banc d'essai de specs/skill-49.md § Problème/3.
    const session = mkTmp('sdd-session-');
    setHome(mkTmp('sdd-home-'));
    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', session]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).not.toContain('merge main --ff-only');
    expect(r.stderr).not.toContain('ff-only');
  });

  it('(d) --repo invalide (pas un dépôt git) → erreur', () => {
    const session = mkTmp('sdd-session-');
    const notARepo = mkTmp('sdd-notrepo-');
    setHome(mkTmp('sdd-home-'));
    const r = main([
      'resolve',
      '--ticket',
      'FOO-01',
      '--session-root',
      session,
      '--repo',
      notARepo,
    ]);
    expect(r.code).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('--repo');
  });

  it('argument sous-commande manquant/incorrect → usage + code non nul', () => {
    const r = main(['--ticket', 'FOO-01']);
    expect(r.code).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('usage');
  });

  it('--ticket ou --session-root manquant → code non nul', () => {
    const r = main(['resolve', '--ticket', 'FOO-01']);
    expect(r.code).not.toBe(0);
  });

  itGit('review absent dans le frontmatter → JSON review défaut "light"', () => {
    setHome(mkTmp('sdd-home-'));
    const root = initRepo();
    const fm = [
      'id: FOO-01',
      'type: ticket',
      'status: todo',
      'priority: should',
      'model: opus',
      'effort: ultrathink',
      'matured: 2026-07-22',
    ].join('\n');
    writeSpec(root, 'specs/foo-01.md', fm);
    commitAll(root);
    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', root]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.review).toBe('light');
  });

  itGit('statusGate reflète le statut (maturing → not-matured)', () => {
    setHome(mkTmp('sdd-home-'));
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01', { status: 'maturing' }));
    commitAll(root);
    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', root]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('maturing');
    expect(out.guards.statusGate).toBe('not-matured');
    expect(out.guards.specOnMain).toBe(false); // maturing → pas maturé sur main
  });
});

// ============================================================================
// main(argv) — garde-fou branchFree (SKILL-106)
// ============================================================================
//
// § Cause racine, specs/skill-106.md : `refs/heads/<branch>` doit être
// CRÉABLE, pas seulement absente. Fixtures : dépôts git jetables, `$HOME`
// simulé, démontés en fin de test (pattern déjà en place ci-dessus).
describe('main(argv) — garde-fou branchFree (SKILL-106)', () => {
  itGit('branche absente → branchFree: true', () => {
    // Mutation-témoin : inverser le sens du prédicat → rouge.
    setHome(mkTmp('sdd-home-'));
    const session = mkTmp('sdd-session-');
    const target = initRepo();
    writeSpec(target, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(target);
    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', session, '--repo', target]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.mode).toBe('cross-repo');
    expect(out.guards.branchFree).toBe(true);
  });

  itGit(
    'le cas qui a produit le ticket : branche orpheline après `worktree remove` → worktreePathFree ET branchFree divergent',
    () => {
      // Mutation-témoin : câbler `branchFree` sur `worktreePathFree`
      // (`branchFree = worktreePathFree` au lieu de `branchIsCreatable(...)`)
      // → rouge. ⚠️ Gate de reprise, finding 6 : `branchFree =
      // fs.existsSync(worktreePath)` (sans négation) est rattrapé par l'`it`
      // PRÉCÉDENT (« branche absente »), pas par celui-ci — dans CETTE fixture,
      // le chemin a été supprimé par `worktree remove`, donc `fs.existsSync`
      // vaut déjà `false`, la valeur attendue ; seule l'aliasing sur
      // `worktreePathFree` (qui vaut `true` ici, chemin libre) diverge de la
      // valeur attendue (`branchFree: false`).
      setHome(mkTmp('sdd-home-'));
      const session = mkTmp('sdd-session-');
      const target = initRepo();
      writeSpec(target, 'specs/foo-01.md', ticketFM('FOO-01'));
      commitAll(target);
      const wtParent = mkTmp('sdd-wtroot-');
      const wt = path.join(wtParent, 'orphan');
      const add = spawnSync('git', ['-C', target, 'worktree', 'add', wt, '-b', 'claude/foo-01', 'main']);
      expect(add.status, `git worktree add a échoué: ${add.stderr}`).toBe(0);
      const remove = spawnSync('git', ['-C', target, 'worktree', 'remove', wt]);
      expect(remove.status, `git worktree remove a échoué: ${remove.stderr}`).toBe(0);

      const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', session, '--repo', target]);
      expect(r.code, `stderr: ${r.stderr}`).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.guards.worktreePathFree).toBe(true);
      expect(out.guards.branchFree).toBe(false);
    }
  );

  itGit('branche checkoutée dans un worktree vivant → branchFree: false', () => {
    // Mutation-témoin : n'interroger que `git worktree list` → vert ici,
    // rouge sur le cas précédent — la paire des deux `it` rend cette
    // mutation détectable.
    setHome(mkTmp('sdd-home-'));
    const session = mkTmp('sdd-session-');
    const target = initRepo();
    writeSpec(target, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(target);
    const wtParent = mkTmp('sdd-wtroot-');
    const wt = path.join(wtParent, 'alive');
    const add = spawnSync('git', ['-C', target, 'worktree', 'add', wt, '-b', 'claude/foo-01', 'main']);
    expect(add.status, `git worktree add a échoué: ${add.stderr}`).toBe(0);

    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', session, '--repo', target]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.guards.branchFree).toBe(false);
  });

  itGit('conflit D/F : une branche `claude` nue → branchFree: false', () => {
    // Mutation-témoin : revenir à `git rev-parse --verify --quiet
    // refs/heads/<branch>` → sort en 1, branchFree: true → rouge. C'est LA
    // mutation qui distingue « la branche est absente » de « la référence est
    // créable » (§ Cause racine, specs/skill-106.md).
    setHome(mkTmp('sdd-home-'));
    const session = mkTmp('sdd-session-');
    const target = initRepo();
    writeSpec(target, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(target);
    const branchNue = spawnSync('git', ['-C', target, 'branch', 'claude']);
    expect(branchNue.status, `git branch claude a échoué: ${branchNue.stderr}`).toBe(0);

    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', session, '--repo', target]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.branch).toBe('claude/foo-01');
    const verify = spawnSync('git', ['-C', target, 'rev-parse', '--verify', '--quiet', 'refs/heads/claude/foo-01']);
    expect(verify.status).toBe(1); // absente au sens de rev-parse — et pourtant non créable
    expect(out.guards.branchFree).toBe(false);
  });

  itGit('mode same-repo → branchFree: true sans appel git, même avec une branche `claude/foo-01` déjà présente', () => {
    // Mutation-témoin : sortir le calcul du bloc `if (mode === 'cross-repo')`
    // EN Y DÉRIVANT AUSSI la branche (`'claude/' + id.toLowerCase()`) → rouge.
    // ⚠️ La sortir sans dériver la branche est un no-op : `branch` vaut `null`
    // en same-repo, et `refs/heads/null` est absente — le test resterait vert.
    setHome(mkTmp('sdd-home-'));
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root);
    const branchExistante = spawnSync('git', ['-C', root, 'branch', 'claude/foo-01']);
    expect(branchExistante.status, `git branch claude/foo-01 a échoué: ${branchExistante.stderr}`).toBe(0);

    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', root]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.mode).toBe('same-repo');
    expect(out.branch).toBeNull();
    expect(out.guards.branchFree).toBe(true);
  });
});

// ============================================================================
// locateImplementer({ sessionRoot, ticketId, mode, worktreePath }) — SKILL-14
// ============================================================================
//
// Étape 6.1 de commands/sdd-run-ticket.md : localiser le worktree de
// l'implémenteur et lire son SHA PROGRAMMATIQUEMENT (D2, specs/skill-14.md).
// Fixtures : dépôts git jetables avec worktrees RÉELS (même pattern que
// deriveWorktreePath (d) ci-dessus), jamais le repo réel.

// Crée un worktree hors-arborescence de `root`, y écrit un fichier et commite
// avec `msg` comme sujet — pour simuler le commit `feat/fix(<ID>): …` de
// l'implémenteur. Retourne le chemin du worktree créé.
function addImplementerWorktree(root, branch, msg) {
  const wtParent = mkTmp('sdd-wtroot-');
  const wt = path.join(wtParent, branch);
  const add = spawnSync('git', ['-C', root, 'worktree', 'add', wt, '-b', branch]);
  expect(add.status, `git worktree add a échoué: ${add.stderr}`).toBe(0);
  fs.writeFileSync(path.join(wt, 'marker.txt'), msg + '\n');
  commitAll(wt, msg);
  return wt;
}

describe('locateImplementer({ sessionRoot, ticketId, mode, worktreePath })', () => {
  itGit('(a) same-repo : un worktree dont le HEAD porte (<TICKET-ID>) → found:true', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root, 'init');
    const wt = addImplementerWorktree(root, 'claude/foo-01', 'feat(FOO-01): implémente le truc');
    const r = locateImplementer({
      sessionRoot: root,
      ticketId: 'FOO-01',
      mode: 'same-repo',
      worktreePath: null,
    });
    expect(r.found).toBe(true);
    expect(norm(r.worktree)).toBe(norm(wt));
    expect(r.sha).toHaveLength(40);
    expect(r.commitSubject).toBe('feat(FOO-01): implémente le truc');
  });

  itGit('(b) same-repo : aucun worktree ne matche → found:false', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root, 'init');
    addImplementerWorktree(root, 'claude/bar-02', 'feat(BAR-02): autre ticket');
    const r = locateImplementer({
      sessionRoot: root,
      ticketId: 'FOO-01',
      mode: 'same-repo',
      worktreePath: null,
    });
    expect(r.found).toBe(false);
    expect(r.worktree).toBeNull();
    expect(r.sha).toBeNull();
  });

  itGit('(c) same-repo : plusieurs worktrees, un seul porte le bon scope → sélectionne le bon', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root, 'init');
    // Homonyme partiel : FOO-01 ne doit PAS matcher via un sous-préfixe de FOO-010.
    addImplementerWorktree(root, 'claude/foo-010', 'feat(FOO-010): ticket voisin');
    const wtGood = addImplementerWorktree(root, 'claude/foo-01', 'feat(FOO-01): le bon');
    addImplementerWorktree(root, 'claude/bar-03', 'feat(BAR-03): sans rapport');
    const r = locateImplementer({
      sessionRoot: root,
      ticketId: 'FOO-01',
      mode: 'same-repo',
      worktreePath: null,
    });
    expect(r.found).toBe(true);
    expect(norm(r.worktree)).toBe(norm(wtGood));
    expect(r.commitSubject).toBe('feat(FOO-01): le bon');
  });

  itGit('(d) le `sha` rendu fait EXACTEMENT 40 caractères', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root, 'init');
    addImplementerWorktree(root, 'claude/foo-01', 'fix(FOO-01): correctif');
    const r = locateImplementer({
      sessionRoot: root,
      ticketId: 'FOO-01',
      mode: 'same-repo',
      worktreePath: null,
    });
    expect(r.found).toBe(true);
    expect(typeof r.sha).toBe('string');
    expect(r.sha.length).toBe(40);
  });

  itGit('(e) cross-repo : worktreePath fourni, son HEAD porte (<TICKET-ID>) → found:true + sha', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root, 'init');
    const wt = addImplementerWorktree(root, 'claude/foo-01', 'feat(FOO-01): cross-repo');
    const r = locateImplementer({
      sessionRoot: mkTmp('sdd-session-'), // repo de session, hors-sujet en cross-repo
      ticketId: 'FOO-01',
      mode: 'cross-repo',
      worktreePath: wt,
    });
    expect(r.found).toBe(true);
    expect(norm(r.worktree)).toBe(norm(wt));
    expect(r.sha).toHaveLength(40);
    expect(r.commitSubject).toBe('feat(FOO-01): cross-repo');
  });

  itGit('(f) cross-repo : worktreePath fourni mais son HEAD ne matche pas → found:false', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root, 'init');
    const wt = addImplementerWorktree(root, 'claude/foo-01', 'feat(BAR-99): mauvais ticket');
    const r = locateImplementer({
      sessionRoot: mkTmp('sdd-session-'),
      ticketId: 'FOO-01',
      mode: 'cross-repo',
      worktreePath: wt,
    });
    expect(r.found).toBe(false);
  });

  it('(g) worktreePath absent en cross-repo → erreur levée', () => {
    // Choix documenté (D3 cas g, « l'implémenteur tranche ») : une erreur LEVÉE,
    // pas un found:false — c'est une violation de contrat de l'appelant (le
    // skill DOIT fournir --worktree en cross-repo, Étape 5.7), pas un état de
    // données légitime comme (b)/(f).
    expect(() =>
      locateImplementer({
        sessionRoot: mkTmp('sdd-session-'),
        ticketId: 'FOO-01',
        mode: 'cross-repo',
        worktreePath: null,
      })
    ).toThrow();
  });
});

// ============================================================================
// main(argv) — verbe `locate` (SKILL-14)
// ============================================================================
describe('main(argv) — verbe `locate`', () => {
  itGit('(h) CLI same-repo → JSON attendu', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root, 'init');
    addImplementerWorktree(root, 'claude/foo-01', 'feat(FOO-01): via CLI');
    const r = main(['locate', '--ticket', 'FOO-01', '--mode', 'same-repo', '--session-root', root]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.ticket).toBe('FOO-01');
    expect(out.found).toBe(true);
    expect(out.sha).toHaveLength(40);
    expect(out.commitSubject).toBe('feat(FOO-01): via CLI');
  });

  itGit('(i) CLI cross-repo → JSON avec worktree/sha non nuls', () => {
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root, 'init');
    const wt = addImplementerWorktree(root, 'claude/foo-01', 'feat(FOO-01): via CLI cross-repo');
    const session = mkTmp('sdd-session-');
    const r = main([
      'locate',
      '--ticket',
      'FOO-01',
      '--mode',
      'cross-repo',
      '--session-root',
      session,
      '--worktree',
      wt,
    ]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.found).toBe(true);
    expect(norm(out.worktree)).toBe(norm(wt));
    expect(out.sha).toHaveLength(40);
  });

  it('(j) --ticket ou --mode manquant → code non nul + message', () => {
    const r1 = main(['locate', '--mode', 'same-repo', '--session-root', mkTmp('sdd-session-')]);
    expect(r1.code).not.toBe(0);
    const r2 = main(['locate', '--ticket', 'FOO-01', '--session-root', mkTmp('sdd-session-')]);
    expect(r2.code).not.toBe(0);
  });

  it('--worktree manquant en cross-repo → code non nul', () => {
    const r = main([
      'locate',
      '--ticket',
      'FOO-01',
      '--mode',
      'cross-repo',
      '--session-root',
      mkTmp('sdd-session-'),
    ]);
    expect(r.code).not.toBe(0);
  });

  it('--mode invalide (ni same-repo ni cross-repo) → code non nul', () => {
    const r = main([
      'locate',
      '--ticket',
      'FOO-01',
      '--mode',
      'nawak',
      '--session-root',
      mkTmp('sdd-session-'),
    ]);
    expect(r.code).not.toBe(0);
  });

  // (k) Garde anti-régression du dispatcher : le verbe `resolve` reste
  // inchangé. Les describe « main(argv) — CLI » ci-dessus (verbe resolve)
  // couvrent déjà ce cas en continu ; ce test réaffirme explicitement (k) au
  // même endroit que les nouveaux cas `locate`, pour qu'une régression du
  // dispatcher (ex. un `if` mal branché qui casserait resolve en ajoutant
  // locate) saute aux yeux ICI aussi, pas seulement dans un describe éloigné.
  itGit('(k) le verbe `resolve` reste inchangé après l’ajout de `locate`', () => {
    setHome(mkTmp('sdd-home-'));
    const root = initRepo();
    writeSpec(root, 'specs/foo-01.md', ticketFM('FOO-01'));
    commitAll(root, 'init');
    const r = main(['resolve', '--ticket', 'FOO-01', '--session-root', root]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.found).toBe(true);
    expect(out.mode).toBe('same-repo');
  });
});
