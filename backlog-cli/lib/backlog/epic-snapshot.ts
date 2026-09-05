import type { EpicFrontmatter, EpicKind, EpicPhase } from "./epic-frontmatter";
import { byCodeUnit } from "./snapshot";

// INFRA-12 — Projection dénormalisée des épics (specs/epics/*.md) lue par
// /admin/planning (INFRA-09), analogue de backlog.json. Ne porte que les FAITS
// manuels + l'éditorial : le statut et les membres sont DÉRIVÉS au render en
// joignant ce snapshot à backlog.json par le champ `epic:` (read-time).

/** Un épic scanné = frontmatter + chemin (relatif racine repo). */
export interface EpicSnapshotSource {
  frontmatter: EpicFrontmatter;
  file: string;
}

export interface SnapshotEpic {
  id: string;
  kind: EpicKind;
  title: string;
  number?: number | null;
  phase: EpicPhase;
  started: boolean;
  abandoned: boolean;
  order: number;
  objective: string;
  residue?: string;
  /** Chemin relatif repo, slashs `/` (déterminisme Windows/Linux). */
  file: string;
}

export interface EpicsSnapshot {
  generatedFrom: "frontmatter";
  epics: SnapshotEpic[];
}

/** Ordre déterministe : `order` croissant, départage par id (code-unit). */
function compareEpics(a: SnapshotEpic, b: SnapshotEpic): number {
  if (a.order !== b.order) return a.order - b.order;
  return byCodeUnit(a.id, b.id);
}

export function buildEpicsSnapshot(sources: EpicSnapshotSource[]): EpicsSnapshot {
  const epics: SnapshotEpic[] = sources
    .map(({ frontmatter: e, file }) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      ...(e.number !== undefined ? { number: e.number } : {}),
      phase: e.phase,
      started: e.started,
      abandoned: e.abandoned,
      order: e.order,
      objective: e.objective,
      ...(e.residue ? { residue: e.residue } : {}),
      file: file.replace(/\\/g, "/"),
    }))
    .sort(compareEpics);

  return { generatedFrom: "frontmatter", epics };
}

/** Sérialisation stable (clés ordonnées, newline final) pour des diffs git propres. */
export function serializeEpicsSnapshot(snap: EpicsSnapshot): string {
  return `${JSON.stringify(snap, null, 2)}\n`;
}
