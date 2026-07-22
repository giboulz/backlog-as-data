import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  extractScopedTicketIds,
  isExecAllowed,
  nextFreeTicketId,
  parseTicketFile,
  serializeTicketFile,
  splitFrontmatter,
  STATUS_DISPLAY_ORDER,
  STATUS_LABELS,
  ticketIdFromSpecFilename,
  TICKET_STATUSES,
  validateTicket,
  type TicketFrontmatter,
  type TicketStatus,
} from "./ticket-frontmatter";
import {
  buildSnapshot,
  groupByStatus,
  serializeSnapshot,
  type SnapshotSource,
} from "./snapshot";
import { isGeneratedBacklogMd, renderBacklogMd } from "./render-md";
import {
  HOOK_EVENTS,
  planTransitions,
  type HookEvent,
  type Transition,
} from "./hook";
import { ADOPTION_README, CHEATSHEET } from "./adoption-readme";

// INFRA-08 — Cœur testable du CLI `backlog`. Effets fs bornés sous `root`.
// INFRA-14 — devenu le cœur du bundle global : gagne les commandes d'adoption
// (`init`/`list`/`render-md`/`help`/`self-update`) et accueille le `hook`
// (cycle INFRA-11) pour exposer UNE seule surface de dispatch. Le seul I/O git
// vit dans `readMainIdsFromGit` (lecture seule, jamais fatale). Les tickets sont
// localisés par scan du champ `id`, jamais par nom de fichier.

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const ok = (stdout: string): CliResult => ({ code: 0, stdout, stderr: "" });
export const err = (stderr: string): CliResult => ({ code: 1, stdout: "", stderr });

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string>;
}

/** `value` = le flag exige une valeur ; `boolean` = présence seule (jamais de valeur). */
export type FlagKind = "value" | "boolean";
export type FlagSpec = Readonly<Record<string, FlagKind>>;

export type ParseFlagsResult =
  | { ok: true; value: ParsedArgs }
  | { ok: false; error: string };

/**
 * Lecture de la spec en propriété **propre** : `spec["toString"]` renverrait la
 * fonction héritée d'`Object.prototype`, donc un `--toString` passerait pour un
 * flag déclaré et avalerait le token suivant — le silence même que ce ticket
 * supprime. Idem pour `constructor`, `valueOf`, `__proto__`…
 */
function flagKindOf(spec: FlagSpec, key: string): FlagKind | undefined {
  return Object.prototype.hasOwnProperty.call(spec, key) ? spec[key] : undefined;
}

/** Nom de flag d'un token `--k` ou `--k=v` ; `null` si ce n'est pas un flag. */
function flagKeyOf(token: string): string | null {
  if (!token.startsWith("--")) return null;
  const rest = token.slice(2);
  const eq = rest.indexOf("=");
  return eq === -1 ? rest : rest.slice(0, eq);
}

/**
 * INFRA-33 — parsing DÉCLARATIF : chaque commande passe la `spec` de ses flags.
 *
 * L'ancienne heuristique « le token suivant est une valeur s'il ne commence pas
 * par `--` » cumulait deux fautes : elle refusait une valeur légitime commençant
 * par `--` (un titre `--review …`), et elle inventait la chaîne `"true"` quand la
 * valeur manquait — laquelle passe le `z.string()` de `title`, donc créait un
 * ticket au titre absurde en code 0, sans le moindre signal.
 *
 * Avec la spec, les deux cas se distinguent : un flag `value` consomme le token
 * suivant QUEL QU'IL SOIT (d'où le titre en `--…` retrouvé), sauf si ce token est
 * lui-même un flag DÉCLARÉ de la commande — c'est alors l'oubli de valeur, et on
 * échoue. Corollaire : les flags inconnus sont refusés (c'est ce qui rend sûre la
 * consommation aveugle, et ça attrape les typos jusqu'ici avalées en silence) ;
 * l'échappement d'une valeur qui commence par un flag déclaré est `--k=v`.
 */
export function parseFlags(args: string[], spec: FlagSpec): ParseFlagsResult {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  const known = Object.keys(spec);
  const expected = known.length
    ? `attendus : ${known.map((k) => `--${k}`).join(", ")}`
    : "cette commande n'accepte aucun flag";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }

    const rest = a.slice(2);
    const eq = rest.indexOf("=");
    const key = eq === -1 ? rest : rest.slice(0, eq);
    const kind = flagKindOf(spec, key);
    if (kind === undefined) {
      return { ok: false, error: `flag inconnu : --${key} (${expected})` };
    }

    // Forme `--k=v` : la valeur est explicite, le token suivant n'est jamais lu.
    if (eq !== -1) {
      if (kind === "boolean") {
        return { ok: false, error: `--${key} n'attend pas de valeur` };
      }
      const val = rest.slice(eq + 1);
      if (val === "") return { ok: false, error: `--${key} attend une valeur` };
      flags[key] = val;
      continue;
    }

    if (kind === "boolean") {
      flags[key] = "true";
      continue;
    }

    const next = args[i + 1];
    if (next === undefined) {
      return { ok: false, error: `--${key} attend une valeur` };
    }
    const nextKey = flagKeyOf(next);
    if (nextKey !== null && flagKindOf(spec, nextKey) !== undefined) {
      return {
        ok: false,
        error: `--${key} attend une valeur (« --${nextKey} » est un flag de cette commande) — pour une valeur qui commence par un flag, utilise --${key}=<valeur>`,
      };
    }
    flags[key] = next;
    i++;
  }
  return { ok: true, value: { positionals, flags } };
}

export interface TicketFile {
  filePath: string;
  relPath: string;
  frontmatter: TicketFrontmatter;
  body: string;
}

export interface DiscoverResult {
  tickets: TicketFile[];
  invalid: { relPath: string; error: string }[];
}

/**
 * Scan unique de specs/ : tout fichier au frontmatter `type: ticket` est lu et
 * validé. Les fichiers invalides vont dans `invalid` (le CLI reste utilisable —
 * un seul fichier corrompu ne bloque pas les autres commandes) ; le test de
 * cohérence H1 reste le garde-fou qui les fait échouer au `npm test` / deploy.
 */
export async function discoverTickets(specsDir: string): Promise<DiscoverResult> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(specsDir, { recursive: true })) as string[];
  } catch {
    return { tickets: [], invalid: [] };
  }
  // Lectures en parallèle : specs/ contient ~590 .md après INFRA-10, relus à
  // CHAQUE commande — la boucle séquentielle coûtait des centaines de ms (Windows).
  // L'ordre du résultat n'a pas d'importance (buildSnapshot trie ; H2/findTarget
  // sont order-indépendants).
  const mdNames = names.filter(
    (n): n is string => typeof n === "string" && n.endsWith(".md"),
  );
  const tickets: TicketFile[] = [];
  const invalid: { relPath: string; error: string }[] = [];
  await Promise.all(
    mdNames.map(async (name) => {
      const filePath = path.join(specsDir, name);
      let raw: string;
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch {
        return;
      }
      const split = splitFrontmatter(raw);
      if (!split) return;
      if (!/^type:\s*ticket\s*$/m.test(split.fmRaw)) return;
      try {
        const { frontmatter, body } = parseTicketFile(raw);
        tickets.push({ filePath, relPath: name, frontmatter, body });
      } catch (e) {
        invalid.push({ relPath: name, error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );
  return { tickets, invalid };
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Chemin relatif au root, slashs normalisés (déterminisme cross-OS). */
export function relFile(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

const toSources = (tickets: TicketFile[], root: string): SnapshotSource[] =>
  tickets.map((t) => ({
    frontmatter: t.frontmatter,
    file: relFile(root, t.filePath),
    body: t.body,
  }));

/**
 * INFRA-10 (D5) — écrit la PAIRE d'artefacts générés : backlog.json + le rendu
 * lisible specs/backlog.md, d'un même geste (pas de commande render-md séparée
 * qu'on oublierait). Verrou : un specs/backlog.md existant SANS sentinel (source
 * legacy restaurée par un revert/conflit) n'est jamais écrasé en silence →
 * `mdSkipped: true`, que chaque commande surface en warning (sinon les deux
 * artefacts divergeraient sans le moindre signal).
 */
/**
 * INFRA-22 — nom de projet pour le titre de la vue générée (le renderer est
 * partagé par tous les projets, cf. render-md.ts). Dérivé de `package.json`
 * (`name`) ; fallback sur le basename du root. Lecture tolérante : package.json
 * absent/illisible/sans `name` → basename.
 */
async function projectName(root: string): Promise<string> {
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.join(root, "package.json"), "utf8"),
    ) as { name?: unknown };
    if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name.trim();
  } catch {
    // package.json absent ou illisible → fallback basename
  }
  return path.basename(root);
}

export async function writeArtifacts(
  root: string,
  sources: SnapshotSource[],
): Promise<{ mdSkipped: boolean }> {
  const snap = buildSnapshot(sources);
  await fs.writeFile(
    path.join(root, "backlog.json"),
    serializeSnapshot(snap),
    "utf8",
  );

  const mdPath = path.join(root, "specs", "backlog.md");
  let existing: string | null = null;
  try {
    existing = await fs.readFile(mdPath, "utf8");
  } catch {
    existing = null;
  }
  if (existing !== null && !isGeneratedBacklogMd(existing)) {
    return { mdSkipped: true };
  }
  await fs.writeFile(
    mdPath,
    renderBacklogMd(snap, await projectName(root)),
    "utf8",
  );
  return { mdSkipped: false };
}

/** Warning commun quand le verrou a sauté le rendu de specs/backlog.md. */
const MD_SKIPPED_WARN =
  " ⚠ specs/backlog.md non régénéré (fichier sans sentinel — verrou INFRA-10) : backlog.json et la vue lisible vont diverger, restaure une vue générée puis relance `npm run backlog -- snapshot`.";

/**
 * Localise l'unique ticket portant `id`. Refuse un id **ambigu** (≥2 fichiers
 * même id) au lieu d'en muter un au hasard et de laisser l'autre orphelin —
 * garde-fou au moment de la commande, complémentaire de H2 (test/deploy).
 */
function findTarget(
  tickets: TicketFile[],
  id: string,
): { ok: true; target: TicketFile } | { ok: false; message: string } {
  const matches = tickets.filter((t) => t.frontmatter.id === id);
  if (matches.length === 0) return { ok: false, message: `${id} introuvable` };
  if (matches.length > 1) {
    return {
      ok: false,
      message: `${id} ambigu : ${matches.length} fichiers portent cet id (${matches
        .map((m) => m.relPath)
        .join(", ")}) — corrige le doublon avant de muter`,
    };
  }
  return { ok: true, target: matches[0]! };
}

/** Sources snapshot où le frontmatter du ticket `id` est remplacé par `next`. */
function sourcesWith(
  tickets: TicketFile[],
  root: string,
  id: string,
  next: TicketFrontmatter,
): SnapshotSource[] {
  // Réutilise toSources (mapping TicketFile→SnapshotSource unique) en substituant
  // d'abord le frontmatter cible — pas de second mapping à garder en phase.
  return toSources(
    tickets.map((t) =>
      t.frontmatter.id === id ? { ...t, frontmatter: next } : t,
    ),
    root,
  );
}

const NEW_FLAGS: FlagSpec = { title: "value", epic: "value", priority: "value" };

async function cmdNew(
  args: string[],
  root: string,
  specsDir: string,
): Promise<CliResult> {
  const parsed = parseFlags(args, NEW_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { positionals, flags } = parsed.value;
  const id = positionals[0];
  if (!id) return err("usage: new <ID> [--title <t>] [--epic <e>] [--priority <p>]");

  const draft: Record<string, unknown> = { id, type: "ticket", status: "maturing" };
  if (flags.title) draft.title = flags.title;
  if (flags.epic) draft.epic = flags.epic;
  if (flags.priority) draft.priority = flags.priority;
  const res = validateTicket(draft);
  if (!res.ok) return err(res.errors.join("\n"));

  const { tickets } = await discoverTickets(specsDir);
  if (tickets.some((t) => t.frontmatter.id === id)) {
    return err(`${id} existe déjà`);
  }
  const filePath = path.join(specsDir, `${id.toLowerCase()}.md`);
  if (await pathExists(filePath)) {
    return err(`${path.basename(filePath)} existe déjà sur le disque`);
  }
  // INFRA-23 — 3e garde : les deux contrôles ci-dessus ne voient que CE worktree. Un id
  // peut y être libre et déjà livré sur main (branche forkée d'un main antérieur) — sans
  // cette garde la collision n'explose qu'au `/send`, en rebase add/add, au prix d'un
  // renumérotage complet. La suggestion tient compte des ids de main ET du worktree.
  const mainIds = ticketIdsOnMain(root, specsDir);
  if (mainIds.includes(id)) {
    const free = nextFreeTicketId(id, [
      ...mainIds,
      ...tickets.map((t) => t.frontmatter.id),
    ]);
    return err(`${id} existe déjà sur main${free ? ` — prochain id libre : ${free}` : ""}`);
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const newBody = `\n# ${id}\n`;
  await fs.writeFile(filePath, serializeTicketFile(res.value, newBody), "utf8");
  const { mdSkipped } = await writeArtifacts(root, [
    ...toSources(tickets, root),
    { frontmatter: res.value, file: relFile(root, filePath), body: newBody },
  ]);
  return ok(
    `créé ${path.relative(root, filePath)} (maturing)${mdSkipped ? MD_SKIPPED_WARN : ""}`,
  );
}

const MATURE_FLAGS: FlagSpec = {
  model: "value",
  effort: "value",
  review: "value",
  date: "value",
};

async function cmdMature(
  args: string[],
  root: string,
  specsDir: string,
): Promise<CliResult> {
  const parsed = parseFlags(args, MATURE_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { positionals, flags } = parsed.value;
  const id = positionals[0];
  if (!id) {
    return err(
      "usage: mature <ID> --model <m> --effort <e> --review <r> --date <YYYY-MM-DD>",
    );
  }
  if (!flags.model) return err("--model <fable|opus|sonnet|haiku> requis");
  if (!flags.effort) {
    return err("--effort <none|think|think-hard|ultrathink> requis");
  }
  if (!flags.review) return err("--review <none|light|deep> requis");
  if (!flags.date) {
    return err("--date <YYYY-MM-DD> requis (le script n'invente pas la date)");
  }

  const { tickets } = await discoverTickets(specsDir);
  const found = findTarget(tickets, id);
  if (!found.ok) return err(found.message);
  const target = found.target;

  const exec: Record<string, unknown> = {
    model: flags.model,
    effort: flags.effort,
    review: flags.review,
    matured: flags.date,
  };
  const next: Record<string, unknown> = {
    ...target.frontmatter,
    exec,
  };
  if (next.status === "maturing") next.status = "todo";
  const res = validateTicket(next);
  if (!res.ok) return err(res.errors.join("\n"));

  await fs.writeFile(target.filePath, serializeTicketFile(res.value, target.body), "utf8");
  const { mdSkipped } = await writeArtifacts(root, sourcesWith(tickets, root, id, res.value));
  return ok(`maturé ${id} → ${res.value.status}${mdSkipped ? MD_SKIPPED_WARN : ""}`);
}

async function cmdSet(
  args: string[],
  root: string,
  specsDir: string,
): Promise<CliResult> {
  const parsed = parseFlags(args, {});
  if (!parsed.ok) return err(parsed.error);
  const { positionals } = parsed.value;
  const id = positionals[0];
  const assignment = positionals[1];
  if (!id || !assignment) return err("usage: set <ID> status=<status>");
  const eq = assignment.indexOf("=");
  if (eq === -1) {
    return err(`assignation invalide : « ${assignment} » (attendu clé=valeur)`);
  }
  const key = assignment.slice(0, eq).trim();
  const val = assignment.slice(eq + 1).trim();
  if (key !== "status") {
    return err(`champ non mutable via set : « ${key} » (seul status l'est)`);
  }

  const { tickets } = await discoverTickets(specsDir);
  const found = findTarget(tickets, id);
  if (!found.ok) return err(found.message);
  const target = found.target;

  const next: Record<string, unknown> = { ...target.frontmatter, status: val };
  // Dématuration : passer vers un statut où `exec` est interdit le retire
  // (sinon le `set` serait un cul-de-sac pour tout ticket maturé). `shipped`
  // le CONSERVE (exec optionnel depuis INFRA-10 D1).
  let note = "";
  const isKnownStatus = (TICKET_STATUSES as readonly string[]).includes(val);
  if (next.exec && isKnownStatus && !isExecAllowed(val as TicketStatus)) {
    delete next.exec;
    note = " (exec retiré : dématuration)";
  }
  const res = validateTicket(next);
  if (!res.ok) return err(res.errors.join("\n"));

  await fs.writeFile(target.filePath, serializeTicketFile(res.value, target.body), "utf8");
  const { mdSkipped } = await writeArtifacts(root, sourcesWith(tickets, root, id, res.value));
  return ok(`${id} → ${val}${note}${mdSkipped ? MD_SKIPPED_WARN : ""}`);
}

async function cmdSnapshot(root: string, specsDir: string): Promise<CliResult> {
  const { tickets, invalid } = await discoverTickets(specsDir);
  // Anti-blocage (cf. C9) : on régénère depuis les valides même si un fichier est
  // corrompu. INFRA-13 : mais on ne masque plus le drop — stderr + exit ≠0, sinon
  // un ticket invalide disparaît silencieusement du board (vécu en INFRA-09).
  const { mdSkipped } = await writeArtifacts(root, toSources(tickets, root));
  const stdout = mdSkipped
    ? "backlog.json régénéré (specs/backlog.md legacy intact — verrou INFRA-10)"
    : "backlog.json + specs/backlog.md régénérés";
  if (invalid.length > 0) {
    const lines = invalid.map((i) => `  - ${i.relPath} : ${i.error}`).join("\n");
    return {
      code: 1,
      stdout,
      stderr: `${invalid.length} fichier(s) ticket invalide(s) exclu(s) du snapshot :\n${lines}`,
    };
  }
  return ok(stdout);
}

// ───────────────────────── INFRA-14 — adoption + lecture sans board ──────────

/**
 * Un projet est *backlog-enabled* dès qu'il a un `backlog.json` OU un `specs/` :
 * la condition de la tolérance no-op (décision §2). Dans un projet non-enabled,
 * toute commande sauf `init`/`help`/`hook` est un no-op signalé — jamais bloquant
 * pour `/send`/`/deploy` qui lancent le bundle sur TOUS les projets.
 */
async function isBacklogEnabled(root: string): Promise<boolean> {
  return (
    (await pathExists(path.join(root, "backlog.json"))) ||
    (await pathExists(path.join(root, "specs")))
  );
}

const NOT_ENABLED_MSG =
  "ce dossier n'est pas un projet backlog (ni backlog.json ni specs/) — lance `backlog init` d'abord.";

/** Garde de cohérence déposée par `init --with-test` (déléguée à l'outil global). */
const COHERENCE_CHECK_SCRIPT = `#!/usr/bin/env node
// Garde de cohérence backlog (INFRA-14 --with-test) : backlog.json doit refléter
// le frontmatter des specs/*.md. Régénère via l'outil global puis échoue si git
// voit un diff (à brancher dans la CI / un test de cohérence du projet).
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const tool = path.join(os.homedir(), ".claude", "tools", "backlog", "backlog.mjs");
execFileSync("node", [tool, "snapshot"], { stdio: "inherit" });
const diff = execFileSync("git", ["status", "--porcelain", "backlog.json", "specs/backlog.md"], {
  encoding: "utf8",
});
if (diff.trim()) {
  console.error("✗ backlog.json/backlog.md périmé — régénère (snapshot) puis committe.");
  process.exit(1);
}
console.log("✓ backlog cohérent.");
`;

const GA_LINE = "backlog.json text eol=lf";

const INIT_FLAGS: FlagSpec = { "with-test": "boolean" };

/** Amorce un projet : `.gitattributes` + `backlog.json` vide + `specs/` + cheatsheet. */
async function cmdInit(args: string[], root: string): Promise<CliResult> {
  const parsed = parseFlags(args, INIT_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { flags } = parsed.value;
  const created: string[] = [];

  // .gitattributes — append idempotent (ne jamais écraser ; ne pas dupliquer la ligne).
  const gaPath = path.join(root, ".gitattributes");
  let ga = "";
  try {
    ga = await fs.readFile(gaPath, "utf8");
  } catch {
    ga = "";
  }
  if (!ga.split(/\r?\n/).some((l) => l.trim() === GA_LINE)) {
    const sep = ga.length > 0 && !ga.endsWith("\n") ? "\n" : "";
    await fs.writeFile(gaPath, `${ga}${sep}${GA_LINE}\n`, "utf8");
    created.push(".gitattributes");
  }

  // backlog.json vide — ne pas écraser un projet déjà initialisé.
  const bjPath = path.join(root, "backlog.json");
  if (!(await pathExists(bjPath))) {
    await fs.writeFile(bjPath, serializeSnapshot(buildSnapshot([])), "utf8");
    created.push("backlog.json");
  }

  await fs.mkdir(path.join(root, "specs"), { recursive: true });

  if (flags["with-test"]) {
    const checkPath = path.join(root, "backlog-check.mjs");
    if (!(await pathExists(checkPath))) {
      await fs.writeFile(checkPath, COHERENCE_CHECK_SCRIPT, "utf8");
      created.push("backlog-check.mjs");
    }
  }

  const head = created.length
    ? `backlog initialisé (créé : ${created.join(", ")}).`
    : "backlog déjà initialisé (rien à créer).";
  return ok(`${head}\n\n${CHEATSHEET}`);
}

/** Vue terminal groupée par statut (`STATUS_DISPLAY_ORDER`), re-scan du frontmatter. */
async function cmdList(root: string, specsDir: string): Promise<CliResult> {
  const { tickets } = await discoverTickets(specsDir);
  const snap = buildSnapshot(toSources(tickets, root));
  if (snap.tickets.length === 0) return ok("aucun ticket (specs/ vide).");

  const byStatus = groupByStatus(snap.tickets);

  const lines: string[] = [];
  for (const status of STATUS_DISPLAY_ORDER) {
    const items = byStatus.get(status) ?? [];
    if (items.length === 0) continue;
    lines.push(`${STATUS_LABELS[status]} (${items.length})`);
    for (const t of items) {
      const ann = [t.priority, t.epic].filter(Boolean).join(" · ");
      lines.push(`  ${t.id}${t.title ? ` — ${t.title}` : ""}${ann ? ` (${ann})` : ""}`);
    }
  }
  return ok(lines.join("\n"));
}

/** Régénère uniquement la vue lisible `specs/backlog.md` (verrou sentinel respecté). */
async function cmdRenderMd(root: string, specsDir: string): Promise<CliResult> {
  const { tickets } = await discoverTickets(specsDir);
  const snap = buildSnapshot(toSources(tickets, root));
  const mdPath = path.join(root, "specs", "backlog.md");
  let existing: string | null = null;
  try {
    existing = await fs.readFile(mdPath, "utf8");
  } catch {
    existing = null;
  }
  if (existing !== null && !isGeneratedBacklogMd(existing)) {
    return ok("specs/backlog.md legacy (sans sentinel) — non régénéré (verrou INFRA-10).");
  }
  await fs.mkdir(path.join(root, "specs"), { recursive: true });
  await fs.writeFile(
    mdPath,
    renderBacklogMd(snap, await projectName(root)),
    "utf8",
  );
  return ok("specs/backlog.md régénéré.");
}

/**
 * Réinstalle le bundle dans `~/.claude/tools/backlog/` + y écrit le README global.
 * Source = le `.mjs` en cours d'exécution (`opts.selfPath` = `process.argv[1]`,
 * surchargeable `--source`) ; `--dest` cible un autre dossier (tests). Refuse une
 * source non-`.mjs` (garde anti-`self-update` depuis tsx en dev — copierait du TS).
 */
const SELF_UPDATE_FLAGS: FlagSpec = { source: "value", dest: "value" };

async function cmdSelfUpdate(
  args: string[],
  opts: { selfPath?: string },
): Promise<CliResult> {
  // INFRA-33 — le cas « `--source`/`--dest` passé sans valeur » (qui installait le
  // bundle dans `./true/`) est désormais refusé par parseFlags, plus ici au cas par cas.
  const parsed = parseFlags(args, SELF_UPDATE_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { flags } = parsed.value;
  const source = flags.source ?? opts.selfPath;
  if (!source) {
    return err("self-update : aucune source — lance depuis le bundle .mjs ou passe --source <file>.");
  }
  if (!source.endsWith(".mjs")) {
    return err(`self-update : source non-.mjs (${source}) — attendu le bundle backlog.mjs.`);
  }
  if (!(await pathExists(source))) {
    return err(`self-update : source introuvable (${source}).`);
  }
  const destDir = flags.dest ?? path.join(os.homedir(), ".claude", "tools", "backlog");
  await fs.mkdir(destDir, { recursive: true });
  const destBundle = path.join(destDir, "backlog.mjs");
  // Copie sautée si la source EST déjà la cible (réinstall depuis le global lui-même).
  if (path.resolve(source) !== path.resolve(destBundle)) {
    await fs.copyFile(source, destBundle);
  }
  await fs.writeFile(path.join(destDir, "README.md"), ADOPTION_README, "utf8");
  return ok(`bundle installé → ${destBundle}\nguide → ${path.join(destDir, "README.md")}`);
}

// ───────────────────────── INFRA-11 (migré INFRA-14) — hook du cycle auto ────

export interface HookResult {
  applied: Transition[];
  warnings: string[];
}

/**
 * Orchestrateur testable du cycle `todo → wip → merged → shipped` : scanne les
 * tickets, planifie via le cœur pur `planTransitions`, applique chaque transition
 * via `runBacklogCommand(["set", …])`. Ne lève jamais — un `set` échoué devient un
 * `warning`. `mainIds` est INJECTÉ (dérivé de git par l'appelant pour `merge`) :
 * cette fonction ne touche pas à git, donc reste exerçable contre un répertoire temp.
 */
export async function runBacklogHook(
  event: HookEvent,
  opts: { root: string; id?: string; mainIds?: string[] },
): Promise<HookResult> {
  const warnings: string[] = [];
  const applied: Transition[] = [];

  const specsDir = path.join(opts.root, "specs");
  const { tickets } = await discoverTickets(specsDir);
  const hookTickets = tickets.map((t) => ({
    id: t.frontmatter.id,
    status: t.frontmatter.status,
  }));

  const transitions = planTransitions(event, {
    tickets: hookTickets,
    mainIds: opts.mainIds,
    id: opts.id,
  });

  // `start` sur un id connu mais pas `todo` : warn ciblé (la règle « todo ? » reste
  // dans planTransitions). Id inconnu → no-op silencieux (legacy pré-INFRA-10).
  if (event === "start" && opts.id && transitions.length === 0) {
    const target = hookTickets.find((t) => t.id === opts.id);
    if (target) {
      warnings.push(`${opts.id} en statut « ${target.status} » (attendu « todo ») — skip`);
    }
  }

  for (const tr of transitions) {
    const res = await runBacklogCommand(["set", tr.id, `status=${tr.to}`], {
      root: opts.root,
    });
    if (res.code === 0) {
      applied.push(tr);
    } else {
      warnings.push(
        `${tr.id} : échec set status=${tr.to} — ${res.stderr.trim() || `code ${res.code}`}`,
      );
    }
  }

  return { applied, warnings };
}

/**
 * Ids `[A-Z]+-…` de l'historique de la **branche d'intégration courante** (`HEAD`).
 * Le `hook merge` tourne toujours avec cwd = ce checkout (cf. `/send` : `cd` dans le
 * worktree de la branche cible avant l'appel), donc `HEAD` EST la branche
 * d'intégration — qu'elle s'appelle `main`, `master` ou autre (INFRA-14 : marche
 * sur tout projet, pas seulement les repos `main`). Lecture seule, jamais fatale :
 * si `git` échoue (hors repo, pas de commit) → `[]`, le hook no-op.
 */
/**
 * INFRA-23 — Ids de ticket présents sur la branche d'INTÉGRATION nommée (`main`, repli
 * `master`), lus dans l'arbre git — sans toucher au worktree ni au checkout.
 *
 * Distinct de `readIntegrationBranchIds` (historique de `HEAD`) et c'est tout le point :
 * `new` tourne dans un worktree de **feature** dont le `HEAD` n'a justement PAS les tickets
 * livrés depuis le fork — d'où des ids « libres » ici et déjà pris sur main, dont la
 * collision n'explosait qu'au `/send` (rebase add/add). On interroge donc la branche par son
 * NOM, pas le HEAD courant.
 *
 * Lecture seule, jamais fatale : hors dépôt git · ni `main` ni `master` · `specs/` absent de
 * la ref → `[]`, et le garde-fou se saborde silencieusement (`new` reste utilisable partout,
 * y compris sur un projet non-git ou au tout premier ticket).
 */
function ticketIdsOnMain(root: string, specsDir: string): string[] {
  const rel = path.relative(root, specsDir).split(path.sep).join("/") || "specs";
  for (const ref of ["main", "master"]) {
    let out: string;
    try {
      out = execFileSync("git", ["ls-tree", "--name-only", `${ref}:${rel}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      continue; // ref absente / pas un repo → tenter le repli, sinon [] (tolérance)
    }
    return out
      .split(/\r?\n/)
      .map((l) => ticketIdFromSpecFilename(l.trim()))
      .filter((id): id is string => id !== null);
  }
  return [];
}

function readIntegrationBranchIds(root: string): string[] {
  let out: string;
  try {
    // INFRA-18 — sujets SEULS : un ticket n'est `merged` que si un commit
    // d'implémentation `type(<id>): …` est sur la branche (cf. extractScopedTicketIds).
    // L'ancien `%s%n%b` + extraction texte libre captait aussi `chore(backlog):
    // start <id>` et les mentions de corps → promotions prématurées.
    out = execFileSync("git", ["log", "HEAD", "--format=%s"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  return extractScopedTicketIds(out.split(/\r?\n/));
}

/**
 * Sous-commande `hook <start|merge|ship> [id]`. Tolérance INFRA-11 ABSOLUE :
 * sort TOUJOURS code 0 (warnings sur stderr, transitions sur stdout) — un projet
 * sans backlog ou un événement inconnu ne doit jamais casser `/send`/`/deploy`.
 */
async function cmdHook(args: string[], root: string): Promise<CliResult> {
  const [event, id] = args;
  if (!event || !(HOOK_EVENTS as readonly string[]).includes(event)) {
    return {
      code: 0,
      stdout: "",
      stderr: `[backlog:hook] warn: événement « ${event ?? "(aucun)"} » inconnu — attendu ${HOOK_EVENTS.join("|")}`,
    };
  }
  if (event === "start" && !id) {
    return { code: 0, stdout: "", stderr: "[backlog:hook] warn: `start` sans id — no-op" };
  }

  const mainIds = event === "merge" ? readIntegrationBranchIds(root) : [];
  const { applied, warnings } = await runBacklogHook(event as HookEvent, { root, id, mainIds });

  const out = applied.map((tr) => `[backlog:hook] ${tr.id} : ${tr.from} → ${tr.to}`);
  const errs = warnings.map((w) => `[backlog:hook] warn: ${w}`);
  if (applied.length === 0 && warnings.length === 0) {
    out.push(`[backlog:hook] ${event} : rien à faire`);
  }
  return { code: 0, stdout: out.join("\n"), stderr: errs.join("\n") };
}

export async function runBacklogCommand(
  argv: string[],
  opts: { root: string; selfPath?: string },
): Promise<CliResult> {
  const { root } = opts;
  const specsDir = path.join(root, "specs");
  const [cmd, ...rest] = argv;
  // Tolérance no-op (décision §2) : hors commandes universelles, une commande dans
  // un projet non-enabled est un no-op signalé (jamais d'écriture, jamais d'échec).
  // `init` amorce ; `help`/`self-update` ne dépendent pas du projet ; `hook` est
  // tolérant par construction (sort 0, no-op si aucun ticket).
  const ALWAYS_ALLOWED = new Set(["init", "help", "hook", "self-update"]);
  try {
    if (cmd && !ALWAYS_ALLOWED.has(cmd) && !(await isBacklogEnabled(root))) {
      return ok(NOT_ENABLED_MSG);
    }
    switch (cmd) {
      case "new":
        return await cmdNew(rest, root, specsDir);
      case "set":
        return await cmdSet(rest, root, specsDir);
      case "mature":
        return await cmdMature(rest, root, specsDir);
      case "snapshot":
        return await cmdSnapshot(root, specsDir);
      case "init":
        return await cmdInit(rest, root);
      case "list":
        return await cmdList(root, specsDir);
      case "render-md":
        return await cmdRenderMd(root, specsDir);
      case "help":
        return ok(CHEATSHEET);
      case "self-update":
        return await cmdSelfUpdate(rest, opts);
      case "hook":
        return await cmdHook(rest, root);
      case "epic": {
        // INFRA-12 — sous-commandes épic (lib/backlog/epic-cli). Import paresseux
        // pour éviter le cycle cli ↔ epic-cli au chargement du module.
        const { runEpicCommand } = await import("./epic-cli");
        return await runEpicCommand(rest, { root });
      }
      default:
        return {
          code: 2,
          stdout: "",
          stderr: `commande inconnue : « ${cmd ?? "(aucune)"} » — attendu new|set|mature|snapshot|init|list|render-md|help|self-update|hook|epic`,
        };
    }
  } catch (e) {
    return { code: 1, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
  }
}
