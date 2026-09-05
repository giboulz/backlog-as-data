import type { EpicFrontmatter } from "./epic-frontmatter";
import { serializeEpicFile } from "./epic-frontmatter";
import type { Surface, TicketFrontmatter } from "./ticket-frontmatter";

// INFRA-12 — Cœur PUR du codemod migrate-epics (testé : E6-E9). Aucune I/O, aucun
// import des modules à supprimer (roadmap.data.ts, possibilites-parser.ts) : les
// entrées sont décrites par des interfaces structurelles locales que les valeurs
// réelles (RoadmapChain, PossibiliteActive…) satisfont — le test survit à la
// suppression de ces modules.

/** Membre de chaîne tel que listé dans roadmap.data.ts (structurellement). */
export interface MigrationTicketRef {
  id: string;
  surface?: Surface;
  blockedBy?: string[];
  note?: string;
}

/** Chaîne actée de roadmap.data.ts (structurellement compatible RoadmapChain). */
export interface MigrationChain {
  id: string;
  kind: "phase" | "chain";
  number: number | null;
  title: string;
  objective: string;
  residue?: string;
  tickets: MigrationTicketRef[];
}

/** Candidate non-actée de possibilites.md (structurellement compatible PossibiliteActive). */
export interface MigrationCandidate {
  id: string;
  title: string;
  source: string;
  valeur: string;
  signal: string;
}

/** Entrée archivée de possibilites.md (structurellement compatible PossibiliteArchivee). */
export interface MigrationArchive {
  id: string;
  raison: string;
  doNotReopenWithout: string;
}

/** Patch appliqué au frontmatter d'un ticket membre d'une chaîne. */
export interface TicketPatch {
  epic: string;
  surface?: Surface;
  blockedBy?: string[];
}

export interface EpicFile {
  /** Slug de fichier (lowercké) — chemin = `specs/epics/<fileSlug>.md`. */
  fileSlug: string;
  frontmatter: EpicFrontmatter;
  body: string;
}

/** Nom de fichier d'épic : id lowercké (D10). */
export function epicFileSlug(id: string): string {
  return id.toLowerCase();
}

/** Replie tout blanc (dont newlines) en espaces simples → scalaire single-line. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function bulletList(items: string[]): string {
  return items.map((l) => `- ${l}`).join("\n");
}

/**
 * Corps d'un épic de chaîne : titre + notes per-ticket (D12 — les `note` de
 * RoadmapTicketRef, rendues nulle part, sont préservées ici plutôt que dans les
 * ~130 frontmatters).
 */
function chainBody(chain: MigrationChain): string {
  const noted = chain.tickets.filter((t) => t.note);
  const sections = [`# ${chain.title}`];
  if (noted.length > 0) {
    sections.push(
      "## Notes par ticket",
      bulletList(noted.map((t) => `${t.id} — ${collapse(t.note!)}`)),
    );
  }
  return `\n${sections.join("\n\n")}\n`;
}

/** E6 — une chaîne roadmap.data.ts → un épic `started: true`. */
export function chainToEpic(chain: MigrationChain, order: number): EpicFile {
  const frontmatter: EpicFrontmatter = {
    id: chain.id,
    type: "epic",
    kind: chain.kind,
    title: collapse(chain.title),
    ...(chain.kind === "phase" && chain.number !== null
      ? { number: chain.number }
      : {}),
    phase: "à-venir",
    started: true,
    abandoned: false,
    order,
    objective: collapse(chain.objective),
    ...(chain.residue ? { residue: collapse(chain.residue) } : {}),
  };
  return { fileSlug: epicFileSlug(chain.id), frontmatter, body: chainBody(chain) };
}

/** E6/E8 — patches `epic:`/`surface:`/`blockedBy:` à poser sur les tickets membres. */
export function ticketPatchesForChain(chain: MigrationChain): Map<string, TicketPatch> {
  const patches = new Map<string, TicketPatch>();
  for (const t of chain.tickets) {
    patches.set(t.id, {
      epic: chain.id,
      ...(t.surface ? { surface: t.surface } : {}),
      ...(t.blockedBy && t.blockedBy.length > 0 ? { blockedBy: t.blockedBy } : {}),
    });
  }
  return patches;
}

/**
 * E8/E9 — applique un patch au frontmatter d'un ticket, idempotent (re-appliquer
 * le même patch produit le même frontmatter). N'écrase que les champs portés par
 * le patch ; le reste du frontmatter est conservé.
 */
export function applyTicketPatch(
  fm: TicketFrontmatter,
  patch: TicketPatch,
): TicketFrontmatter {
  return {
    ...fm,
    epic: patch.epic,
    ...(patch.surface ? { surface: patch.surface } : {}),
    ...(patch.blockedBy && patch.blockedBy.length > 0
      ? { blockedBy: patch.blockedBy }
      : {}),
  };
}

/** E7 — une candidate possibilites.md → un épic `phase: possibilité`, sans membre. */
export function candidateToEpic(c: MigrationCandidate, order: number): EpicFile {
  const frontmatter: EpicFrontmatter = {
    id: c.id,
    type: "epic",
    kind: "chain",
    title: collapse(c.title),
    phase: "possibilité",
    started: false,
    abandoned: false,
    order,
    objective: collapse(c.valeur) || collapse(c.title),
    // EC2 : un épic non-done/non-abandonné porte un residue. Pour une candidate,
    // « ce qui manque » = le signal de promotion (l'événement qui ferait dire GO).
    residue: collapse(c.signal) || "Candidate non actée — décision produit.",
  };
  const body = `\n# ${c.title}\n\n_Source : ${c.source}_\n\n## Valeur\n\n${c.valeur}\n\n## Signal de promotion\n\n${c.signal}\n`;
  return { fileSlug: epicFileSlug(c.id), frontmatter, body };
}

/** Une archive possibilites.md → un épic `abandoned: true` (mémoire des décisions). */
export function archiveToEpic(a: MigrationArchive, order: number): EpicFile {
  const frontmatter: EpicFrontmatter = {
    id: a.id,
    type: "epic",
    kind: "chain",
    title: a.id,
    phase: "possibilité",
    started: false,
    abandoned: true,
    order,
    objective: collapse(a.raison),
    // residue non requis : un épic abandonné est exempté d'EC2.
  };
  const body = `\n# ${a.id}\n\n## Raison de l'archivage\n\n${a.raison}\n\n_Ne pas rouvrir sans ${a.doNotReopenWithout}._\n`;
  return { fileSlug: epicFileSlug(a.id), frontmatter, body };
}

/** Sérialise un EpicFile (frontmatter + corps) prêt à écrire. */
export function renderEpicFile(epic: EpicFile): string {
  return serializeEpicFile(epic.frontmatter, epic.body);
}
