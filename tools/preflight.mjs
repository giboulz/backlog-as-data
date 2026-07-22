#!/usr/bin/env node
// tools/sdd/preflight.mjs — Preflight autonome de /sdd-run-ticket (SKILL-13,
// étendu SKILL-14).
//
// Sort la MÉCANIQUE DÉTERMINISTE du skill commands/sdd-run-ticket.md (résolution
// du ticket, tranchage du mode, dérivation du chemin de worktree, garde-fous)
// vers du CODE TESTÉ. Le skill lit le JSON émis ici et DÉCIDE (récap, choix de
// template, arrêt sur garde-fou) ; l'outil CONSTATE et CALCULE — il ne spawne
// aucun agent, ne monte aucun worktree, n'écrit nulle part.
//
// ⚠️ AUTONOME (D1, specs/skill-13.md) : n'importe RIEN du bundle
// tools/backlog/backlog.mjs (bundle généré, interdit d'y toucher). Node pur,
// sans dépendance runtime. Le seul contact avec le backlog reste ce que le skill
// fait déjà : invoquer `backlog hook start` (inchangé, hors de cet outil).
//
// Contrat CLI (D2, specs/skill-13.md) :
//   node tools/sdd/preflight.mjs resolve --ticket <ID> --session-root <chemin> [--repo <chemin>]
// → un seul objet JSON sur stdout, ou message + code non nul sur erreur.
//
// SKILL-14 (D2, specs/skill-14.md) — second verbe, Étape 6.1 du skill :
//   node tools/sdd/preflight.mjs locate --ticket <ID> --mode <same-repo|cross-repo> \
//        --session-root <chemin> [--worktree <chemin>]
// → localise le worktree de l'implémenteur et lit son SHA PROGRAMMATIQUEMENT
// (jamais en recopiant une prose). Même contrat JSON, même invariant
// d'autonomie ; le verbe `resolve` n'est pas modifié par cet ajout.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// --- Normalisation de chemins -----------------------------------------------

// Vers du POSIX affichable : séparateurs `\` → `/`, MSYS `/c/…` → `c:/…`, sans
// slash final. Conserve la CASSE d'origine du lecteur (pour l'affichage et les
// commandes git du skill).
export function toPosixPath(p) {
  if (!p) return '';
  let s = String(p).replace(/\\/g, '/');
  const m = /^\/([A-Za-z])\//.exec(s);
  if (m) s = m[1] + ':/' + s.slice(3);
  return s.replace(/\/+$/, '');
}

// Pour COMPARER deux chemins : toPosixPath + drive en minuscule. On ne
// minuscule QUE le lecteur (spec D3 : « séparateurs, casse du lecteur »), jamais
// tout le chemin — le reste est sensible à la casse sous Linux (CI).
export function normalizePath(p) {
  return toPosixPath(p).replace(/^([A-Za-z]):/, (_m, d) => d.toLowerCase() + ':');
}

function isUnder(child, parent) {
  const c = normalizePath(child);
  const par = normalizePath(parent);
  return c === par || c.startsWith(par + '/');
}

// --- Parsing frontmatter (sous-ensemble YAML mono-ligne) --------------------
//
// Reprend le parsing clé/valeur de l'Étape 1 du skill : PAS de regex dynamique
// (git-bash mange les backslashes doubles), lecture indifférente d'une clé de
// niveau 0 et d'une clé du bloc `exec:` (comparaison sur la clé TRIMÉE). CRLF
// toléré (le `.trim()` retire un `\r` final).

function frontmatterOf(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return m ? m[1] : null;
}

function getKey(fm, key) {
  for (const line of fm.split('\n')) {
    const t = line.trim();
    const i = t.indexOf(':');
    if (i === -1) continue;
    if (t.slice(0, i).trim() === key) return t.slice(i + 1).trim();
  }
  return '';
}

function walkMd(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // dir absent → aucun fichier, pas d'exception
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// --- Fonctions pures exportées ----------------------------------------------

// resolveTicket(root, id) → {file,status,priority,model,effort,review,matured} | null
// Scanne le specs/ de `root` et retourne le premier fichier dont le frontmatter
// porte `type: ticket` ET `id: <id>`. `file` est relatif à `root`, en `/`.
export function resolveTicket(root, id) {
  const specsDir = path.join(root, 'specs');
  for (const f of walkMd(specsDir)) {
    let content;
    try {
      content = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const fm = frontmatterOf(content);
    if (!fm) continue;
    if (getKey(fm, 'type') !== 'ticket') continue;
    if (getKey(fm, 'id') !== id) continue;
    return {
      file: path.relative(root, f).split(path.sep).join('/'),
      status: getKey(fm, 'status'),
      priority: getKey(fm, 'priority'),
      model: getKey(fm, 'model'),
      effort: getKey(fm, 'effort'),
      review: getKey(fm, 'review'),
      matured: getKey(fm, 'matured'),
    };
  }
  return null;
}

function harnessRoot() {
  return path.join(os.homedir(), '.claude');
}

// resolveTargetRoot(sessionRoot, id, repoFlag) → {targetRoot, source} | null
// Ordre : repoFlag (exclusif, aucun fallback) > session > harness ($HOME/.claude).
export function resolveTargetRoot(sessionRoot, id, repoFlag) {
  if (repoFlag) {
    // Flag fourni : on ne cherche QUE là. Absent ici = définitif (pas de
    // fallback harness — D3 cas d).
    if (resolveTicket(repoFlag, id)) return { targetRoot: repoFlag, source: 'flag' };
    return null;
  }
  if (resolveTicket(sessionRoot, id)) return { targetRoot: sessionRoot, source: 'session' };
  const harness = harnessRoot();
  if (normalizePath(harness) !== normalizePath(sessionRoot) && resolveTicket(harness, id)) {
    return { targetRoot: harness, source: 'harness' };
  }
  return null;
}

// determineMode(targetRoot, sessionRoot) → "same-repo" | "cross-repo"
export function determineMode(targetRoot, sessionRoot) {
  return normalizePath(targetRoot) === normalizePath(sessionRoot) ? 'same-repo' : 'cross-repo';
}

function gitWorktreeRoots(targetRoot) {
  const r = spawnSync('git', ['-C', targetRoot, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim())
    .filter(Boolean);
}

// deriveWorktreePath(targetRoot, id) → {worktreePath, branch, underTarget}
// Convention `$HOME/claude-config-wt/<id-minuscule>` HORS arborescence cible ;
// branche `claude/<id-minuscule>`. Si la cible possède déjà un worktree
// hors-arborescence, sa racine (dirname) est réutilisée (D3 cas d) ; sinon la
// convention par défaut s'applique.
export function deriveWorktreePath(targetRoot, id) {
  const suffix = String(id).toLowerCase();
  const branch = 'claude/' + suffix;
  let racineWt = null;
  for (const w of gitWorktreeRoots(targetRoot)) {
    if (!isUnder(w, targetRoot)) {
      racineWt = path.dirname(w);
      break;
    }
  }
  if (!racineWt) racineWt = path.join(os.homedir(), 'claude-config-wt');
  const worktreePath = path.join(racineWt, suffix);
  return {
    worktreePath: toPosixPath(worktreePath),
    branch,
    underTarget: isUnder(worktreePath, targetRoot),
  };
}

// checkSpecOnMain(targetRoot, specPath) → bool
// La spec existe sur `main:<specPath>` du repo CIBLE ET son statut y vaut
// `todo|wip` (Étape 3.5). `-C targetRoot` non décoratif : jamais le main de la
// session.
export function checkSpecOnMain(targetRoot, specPath) {
  const exists = spawnSync('git', ['-C', targetRoot, 'cat-file', '-e', `main:${specPath}`], {
    encoding: 'utf8',
  });
  if (exists.status !== 0) return false;
  const show = spawnSync('git', ['-C', targetRoot, 'show', `main:${specPath}`], {
    encoding: 'utf8',
  });
  if (show.status !== 0 || typeof show.stdout !== 'string') return false;
  const fm = frontmatterOf(show.stdout);
  if (!fm) return false;
  const status = getKey(fm, 'status');
  return status === 'todo' || status === 'wip';
}

// statusGate : projette le statut du cycle sur le verdict lu par le skill.
function statusGate(status) {
  switch (status) {
    case 'todo':
      return 'ok';
    case 'wip':
      return 'wip';
    case 'merged':
    case 'shipped':
      return 'already-shipped';
    case 'maturing':
      return 'not-matured';
    case 'parked':
    case 'wont':
      return 'parked';
    default:
      return 'not-matured'; // statut vide/inconnu : frontmatter incohérent → non prêt
  }
}

// --- SKILL-14 : localisation du worktree implémenteur + SHA -----------------

function commitSubjectAt(worktreePath) {
  const r = spawnSync('git', ['-C', worktreePath, 'log', '-1', '--pretty=%s'], {
    encoding: 'utf8',
  });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return r.stdout.replace(/\r?\n$/, '');
}

function shaAt(worktreePath) {
  const r = spawnSync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return r.stdout.trim();
}

// Un ticket matche le sujet ssi la parenthèse fermante suit immédiatement —
// exclut les homonymes de préfixe (FOO-01 ne matche pas un sujet portant
// (FOO-010), D3 cas c).
function subjectMatchesTicket(subject, ticketId) {
  return typeof subject === 'string' && subject.includes(`(${ticketId})`);
}

const notFound = () => ({ found: false, worktree: null, sha: null, commitSubject: null });

// locateImplementer({ sessionRoot, ticketId, mode, worktreePath })
//   → { found, worktree, sha, commitSubject }
// Étape 6.1 de commands/sdd-run-ticket.md (D2/D3, specs/skill-14.md) :
// retrouve le worktree de l'implémenteur et lit son SHA PROGRAMMATIQUEMENT —
// jamais en recopiant une prose. `sha` sort toujours de `git rev-parse HEAD`,
// donc 40 caractères par construction.
//
// - same-repo : scanne TOUS les worktrees de `sessionRoot` (`git -C
//   sessionRoot worktree list`), retient le PREMIER dont le sujet HEAD porte
//   `(<ticketId>)`. `worktreePath` est ignoré (le harnais a attribué l'isolé,
//   on le découvre — D2).
// - cross-repo : `worktreePath` est REQUIS (le skill l'a créé, Étape 5.7) ; on
//   ne scanne PAS — on vérifie que son HEAD porte `(<ticketId>)`. Absent →
//   ERREUR LEVÉE (contrat violé par l'appelant, D3 cas g — distinct d'un
//   found:false, qui décrit un état de données légitime).
export function locateImplementer({ sessionRoot, ticketId, mode, worktreePath }) {
  if (mode === 'cross-repo') {
    if (!worktreePath) {
      throw new Error(
        'locateImplementer: --worktree est requis en mode cross-repo (Étape 5.7 du skill).'
      );
    }
    const subject = commitSubjectAt(worktreePath);
    if (!subjectMatchesTicket(subject, ticketId)) return notFound();
    return {
      found: true,
      worktree: toPosixPath(worktreePath),
      sha: shaAt(worktreePath),
      commitSubject: subject,
    };
  }

  // same-repo : `worktreePath` ignoré par construction, non lu ci-dessous.
  for (const w of gitWorktreeRoots(sessionRoot)) {
    const subject = commitSubjectAt(w);
    if (subjectMatchesTicket(subject, ticketId)) {
      return {
        found: true,
        worktree: toPosixPath(w),
        sha: shaAt(w),
        commitSubject: subject,
      };
    }
  }
  return notFound();
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ticket') out.ticket = argv[++i];
    else if (a === '--session-root') out.sessionRoot = argv[++i];
    else if (a === '--repo') out.repo = argv[++i];
    else if (a === '--mode') out.mode = argv[++i];
    else if (a === '--worktree') out.worktree = argv[++i];
    else out._.push(a);
  }
  return out;
}

const USAGE =
  '✗ Usage : preflight.mjs resolve --ticket <ID> --session-root <chemin> [--repo <chemin>]\n' +
  '       ou preflight.mjs locate --ticket <ID> --mode <same-repo|cross-repo> ' +
  '--session-root <chemin> [--worktree <chemin>]\n';

// mainResolve(args) — verbe `resolve` (SKILL-13). INCHANGÉ par SKILL-14 (D4,
// « hors du rewiring ») : même corps, seulement déplacé dans sa propre
// fonction pour que le dispatcher main() puisse brancher sur deux verbes.
function mainResolve(args) {
  if (!args.ticket || !args.sessionRoot) {
    return {
      code: 2,
      stderr: '✗ Arguments requis manquants : --ticket et --session-root.\n',
    };
  }
  const id = args.ticket;
  const sessionRoot = args.sessionRoot;
  let repoFlag = args.repo || null;

  if (repoFlag) {
    const v = spawnSync('git', ['-C', repoFlag, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    });
    if (v.status !== 0) {
      return {
        code: 1,
        stderr:
          `✗ --repo invalide : ${toPosixPath(repoFlag)} n'est pas un dépôt git ` +
          `(git -C … rev-parse --show-toplevel a échoué).\n`,
      };
    }
    repoFlag = v.stdout.trim();
  }

  const resolved = resolveTargetRoot(sessionRoot, id, repoFlag);
  if (!resolved) {
    if (repoFlag) {
      return {
        code: 1,
        stderr:
          `✗ Ticket ${id} introuvable dans ${toPosixPath(repoFlag)} (--repo).\n` +
          `  Racine scannée : ${toPosixPath(repoFlag)} — et elle seule : --repo désactive la recherche.\n` +
          `  → Mauvaise racine ? relance SANS --repo : le repo sera cherché tout seul.\n`,
      };
    }
    const harness = toPosixPath(harnessRoot());
    return {
      code: 1,
      stderr:
        `✗ Ticket ${id} introuvable (aucun specs/**/*.md avec type: ticket + id: ${id}).\n` +
        `  Racines scannées : ${toPosixPath(sessionRoot)} · ${harness}\n` +
        `  → Le ticket existe-t-il ? (backlog list)\n` +
        `  → Il vit dans un TROISIÈME repo ? relance avec --repo <chemin absolu>.\n`,
    };
  }

  const targetRoot = resolved.targetRoot;
  const info = resolveTicket(targetRoot, id); // garanti non-null (resolveTargetRoot l'a trouvé)
  const mode = determineMode(targetRoot, sessionRoot);

  let worktreePath = null;
  let branch = null;
  let worktreeUnderTarget = false;
  let worktreePathFree = true;
  if (mode === 'cross-repo') {
    const d = deriveWorktreePath(targetRoot, id);
    worktreePath = d.worktreePath;
    branch = d.branch;
    worktreeUnderTarget = d.underTarget;
    worktreePathFree = !fs.existsSync(worktreePath);
  }

  const specPath = info.file;
  const out = {
    ticket: id,
    found: true,
    targetRoot: toPosixPath(targetRoot),
    mode,
    specPath,
    absoluteSpecPath: toPosixPath(targetRoot) + '/' + specPath,
    status: info.status,
    model: info.model,
    effort: info.effort,
    // review absent → défaut `light` posé ICI, dans le consommateur (main), pas
    // dans la donnée (resolveTicket rend le champ vide).
    review: info.review || 'light',
    worktreePath,
    branch,
    guards: {
      specOnMain: checkSpecOnMain(targetRoot, specPath),
      statusGate: statusGate(info.status),
      worktreePathFree,
      worktreeUnderTarget,
    },
  };
  return { code: 0, stdout: JSON.stringify(out, null, 2) + '\n' };
}

// mainLocate(args) — verbe `locate` (SKILL-14, D2). Valide les arguments CLI
// puis délègue à locateImplementer (fonction pure, testée séparément) ; ne
// recalcule rien à la main.
function mainLocate(args) {
  if (!args.ticket || !args.mode || !args.sessionRoot) {
    return {
      code: 2,
      stderr:
        '✗ Arguments requis manquants : --ticket, --mode et --session-root sont ' +
        'tous les trois obligatoires pour `locate`.\n',
    };
  }
  if (args.mode !== 'same-repo' && args.mode !== 'cross-repo') {
    return {
      code: 2,
      stderr: `✗ --mode invalide : "${args.mode}" (attendu same-repo ou cross-repo).\n`,
    };
  }
  if (args.mode === 'cross-repo' && !args.worktree) {
    return {
      code: 2,
      stderr: '✗ --worktree est requis en mode cross-repo.\n',
    };
  }

  let result;
  try {
    result = locateImplementer({
      sessionRoot: args.sessionRoot,
      ticketId: args.ticket,
      mode: args.mode,
      worktreePath: args.worktree || null,
    });
  } catch (e) {
    return { code: 1, stderr: `✗ ${e.message}\n` };
  }

  const out = {
    ticket: args.ticket,
    found: result.found,
    worktree: result.worktree,
    sha: result.sha,
    commitSubject: result.commitSubject,
  };
  return { code: 0, stdout: JSON.stringify(out, null, 2) + '\n' };
}

// main(argv) → {code, stdout?, stderr?}
// Dispatcher : branche sur `args._[0]` (`resolve` ou `locate`, D1/SKILL-14).
// Compose les fonctions pures, émet le JSON, gère codes de sortie et messages
// d'erreur découvrables. Ne fait AUCUN process.exit ni console.log directement
// (testabilité) — le wrapper CLI en bas s'en charge.
export function main(argv) {
  const args = parseArgs(argv);
  const verb = args._[0];
  if (verb === 'resolve') return mainResolve(args);
  if (verb === 'locate') return mainLocate(args);
  return { code: 2, stderr: USAGE };
}

// Wrapper CLI : n'exécute main que si le module est lancé directement (pas
// importé par vitest).
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const r = main(process.argv.slice(2));
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.code);
}
