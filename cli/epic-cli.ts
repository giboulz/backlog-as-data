import { promises as fs } from "node:fs";
import path from "node:path";
import {
  parseEpicFile,
  serializeEpicFile,
  validateEpic,
  EPIC_KINDS,
  EPIC_PHASES,
  type EpicFrontmatter,
} from "./epic-frontmatter";
import { splitFrontmatter } from "./ticket-frontmatter";
import {
  buildEpicsSnapshot,
  serializeEpicsSnapshot,
  type EpicSnapshotSource,
} from "./epic-snapshot";
import {
  ok,
  err,
  parseFlags,
  pathExists,
  relFile,
  type CliResult,
  type FlagSpec,
} from "./cli";

// INFRA-12 — Cœur testable des sous-commandes `npm run backlog -- epic <…>` et de
// la génération de epics.json. Effets fs bornés sous `root`. La dérivation
// (statut, membres) n'a PAS de hook : elle est read-time côté board. Ces commandes
// ne mutent que les FAITS manuels (engagement/maturation pré-démarrage).

export interface EpicFileEntry {
  filePath: string;
  relPath: string;
  frontmatter: EpicFrontmatter;
  body: string;
}

export interface DiscoverEpicsResult {
  epics: EpicFileEntry[];
  invalid: { relPath: string; error: string }[];
}

/** Scan de specs/epics/ : tout fichier au frontmatter `type: epic` lu et validé. */
export async function discoverEpics(epicsDir: string): Promise<DiscoverEpicsResult> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(epicsDir)) as string[];
  } catch {
    return { epics: [], invalid: [] };
  }
  const mdNames = names.filter((n) => n.endsWith(".md"));
  const epics: EpicFileEntry[] = [];
  const invalid: { relPath: string; error: string }[] = [];
  await Promise.all(
    mdNames.map(async (name) => {
      const filePath = path.join(epicsDir, name);
      let raw: string;
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch {
        return;
      }
      const split = splitFrontmatter(raw);
      if (!split) return;
      if (!/^type:\s*epic\s*$/m.test(split.fmRaw)) return;
      try {
        const { frontmatter, body } = parseEpicFile(raw);
        epics.push({ filePath, relPath: `specs/epics/${name}`, frontmatter, body });
      } catch (e) {
        invalid.push({
          relPath: `specs/epics/${name}`,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }),
  );
  return { epics, invalid };
}

const toEpicSources = (epics: EpicFileEntry[], root: string): EpicSnapshotSource[] =>
  epics.map((e) => ({ frontmatter: e.frontmatter, file: relFile(root, e.filePath) }));

/** Génère epics.json depuis les sources fournies (artefact, jamais canonique). */
export async function writeEpicsSnapshot(
  root: string,
  sources: EpicSnapshotSource[],
): Promise<void> {
  const snap = buildEpicsSnapshot(sources);
  await fs.writeFile(
    path.join(root, "epics.json"),
    serializeEpicsSnapshot(snap),
    "utf8",
  );
}

/** Régénère epics.json en re-scannant specs/epics/ (utilisé après chaque mutation). */
async function regenSnapshot(root: string, epicsDir: string): Promise<void> {
  const { epics } = await discoverEpics(epicsDir);
  await writeEpicsSnapshot(root, toEpicSources(epics, root));
}

function findEpic(
  epics: EpicFileEntry[],
  id: string,
): { ok: true; target: EpicFileEntry } | { ok: false; message: string } {
  const matches = epics.filter((e) => e.frontmatter.id === id);
  if (matches.length === 0) return { ok: false, message: `épic ${id} introuvable` };
  if (matches.length > 1) {
    return { ok: false, message: `épic ${id} ambigu (${matches.length} fichiers)` };
  }
  return { ok: true, target: matches[0]! };
}

async function writeEpicFile(target: EpicFileEntry, fm: EpicFrontmatter): Promise<void> {
  await fs.writeFile(target.filePath, serializeEpicFile(fm, target.body), "utf8");
}

const EPIC_NEW_FLAGS: FlagSpec = {
  kind: "value",
  number: "value",
  title: "value",
  objective: "value",
  residue: "value",
};
/** `epic set` / `start` / `abandon` : positionnels uniquement (cf. INFRA-33). */
const EPIC_NO_FLAGS: FlagSpec = {};

async function cmdEpicNew(
  args: string[],
  root: string,
  epicsDir: string,
): Promise<CliResult> {
  const parsed = parseFlags(args, EPIC_NEW_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { positionals, flags } = parsed.value;
  const id = positionals[0];
  if (!id) return err("usage: epic new <id> --kind <chain|phase> --title <t> [--objective <o>]");
  const kind = flags.kind ?? "chain";
  if (!(EPIC_KINDS as readonly string[]).includes(kind)) {
    return err(`--kind attendu parmi ${EPIC_KINDS.join("|")}`);
  }

  // Ordinal optionnel des phases (PHASE-1/2/3) : sans lui un `--kind phase`
  // s'affiche sans numéro dans le board.
  if (flags.number !== undefined && !INT_RE.test(flags.number)) {
    return err(`--number attend un entier → « ${flags.number} »`);
  }

  const { epics } = await discoverEpics(epicsDir);
  if (epics.some((e) => e.frontmatter.id === id)) return err(`épic ${id} existe déjà`);
  const order = epics.reduce((max, e) => Math.max(max, e.frontmatter.order), 0) + 10;

  const draft: EpicFrontmatter = {
    id,
    type: "epic",
    kind: kind as EpicFrontmatter["kind"],
    title: flags.title ?? id,
    ...(flags.number !== undefined ? { number: Number(flags.number) } : {}),
    phase: "possibilité",
    started: false,
    abandoned: false,
    order,
    objective: flags.objective ?? "(à préciser)",
    residue: flags.residue ?? "(à préciser)",
  };
  const res = validateEpic(draft);
  if (!res.ok) return err(res.errors.join("\n"));

  const filePath = path.join(epicsDir, `${id.toLowerCase()}.md`);
  // Garde de collision sur disque (parité avec cmdNew ticket) : l'unicité d'id
  // est sensible à la casse mais le nom de fichier est lowercké → sans ce check,
  // `epic new Foo` écraserait silencieusement un `foo.md` existant (id distinct
  // ou fichier au frontmatter invalide, donc absent de `epics`).
  if (await pathExists(filePath)) {
    return err(`${path.basename(filePath)} existe déjà sur le disque`);
  }
  await fs.mkdir(epicsDir, { recursive: true });
  await fs.writeFile(filePath, serializeEpicFile(res.value, `\n# ${draft.title}\n`), "utf8");
  await regenSnapshot(root, epicsDir);
  return ok(`créé ${path.relative(root, filePath)} (possibilité)`);
}

/** Forme d'un entier signé décimal (rejette "", "0x10", "1e3", "1.5"). */
const INT_RE = /^-?\d+$/;
/** Clés mutables dont la valeur est numérique (validées via INT_RE puis Number()). */
const NUMERIC_KEYS = new Set(["order", "number"]);
const MUTABLE_KEYS = new Set([
  "phase",
  "objective",
  "residue",
  "title",
  "order",
  "number",
  "kind",
]);

async function cmdEpicSet(
  args: string[],
  root: string,
  epicsDir: string,
): Promise<CliResult> {
  const parsed = parseFlags(args, EPIC_NO_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { positionals } = parsed.value;
  const id = positionals[0];
  const assignment = positionals[1];
  if (!id || !assignment) return err("usage: epic set <id> phase=<possibilité|à-venir>");
  const eq = assignment.indexOf("=");
  if (eq === -1) return err(`assignation invalide : « ${assignment} » (attendu clé=valeur)`);
  const key = assignment.slice(0, eq).trim();
  const val = assignment.slice(eq + 1).trim();
  if (!MUTABLE_KEYS.has(key)) {
    return err(`champ non mutable via set : « ${key} » (${[...MUTABLE_KEYS].join(", ")})`);
  }
  if (key === "phase" && !(EPIC_PHASES as readonly string[]).includes(val)) {
    return err(`phase attendue parmi ${EPIC_PHASES.join("|")}`);
  }
  // `order`/`number` sont numériques : valider la forme entière AVANT Number() —
  // sinon `order=` (vide) donne Number("")===0, et `order=0x10`/`1e3` passent
  // z.int() en silence (16/1000), réordonnant l'épic sans erreur.
  if (NUMERIC_KEYS.has(key) && !INT_RE.test(val)) {
    return err(`${key} attend un entier → « ${val} »`);
  }

  const { epics } = await discoverEpics(epicsDir);
  const found = findEpic(epics, id);
  if (!found.ok) return err(found.message);

  const next: Record<string, unknown> = { ...found.target.frontmatter };
  next[key] = NUMERIC_KEYS.has(key) ? Number(val) : val;
  const res = validateEpic(next);
  if (!res.ok) return err(res.errors.join("\n"));
  await writeEpicFile(found.target, res.value);
  await regenSnapshot(root, epicsDir);
  return ok(`${id} → ${key}=${val}`);
}

async function cmdEpicFlag(
  args: string[],
  root: string,
  epicsDir: string,
  mutate: (fm: EpicFrontmatter) => EpicFrontmatter,
  verb: string,
): Promise<CliResult> {
  const parsed = parseFlags(args, EPIC_NO_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { positionals } = parsed.value;
  const id = positionals[0];
  if (!id) return err(`usage: epic ${verb} <id>`);
  const { epics } = await discoverEpics(epicsDir);
  const found = findEpic(epics, id);
  if (!found.ok) return err(found.message);
  const res = validateEpic(mutate(found.target.frontmatter));
  if (!res.ok) return err(res.errors.join("\n"));
  await writeEpicFile(found.target, res.value);
  await regenSnapshot(root, epicsDir);
  return ok(`${id} → ${verb}`);
}

export async function runEpicCommand(
  argv: string[],
  opts: { root: string },
): Promise<CliResult> {
  const { root } = opts;
  const epicsDir = path.join(root, "specs", "epics");
  const [sub, ...rest] = argv;
  switch (sub) {
    case "new":
      return cmdEpicNew(rest, root, epicsDir);
    case "set":
      return cmdEpicSet(rest, root, epicsDir);
    case "start":
      return cmdEpicFlag(rest, root, epicsDir, (fm) => ({ ...fm, started: true }), "start");
    case "abandon":
      return cmdEpicFlag(
        rest,
        root,
        epicsDir,
        (fm) => ({ ...fm, abandoned: true, started: false }),
        "abandon",
      );
    case "epic-snapshot": {
      await regenSnapshot(root, epicsDir);
      return ok("epics.json régénéré");
    }
    default:
      return {
        code: 2,
        stdout: "",
        stderr: `sous-commande épic inconnue : « ${sub ?? "(aucune)"} » — attendu new|set|start|abandon|epic-snapshot`,
      };
  }
}
