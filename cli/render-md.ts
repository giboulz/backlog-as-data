import { groupByStatus, type BacklogSnapshot, type SnapshotTicket } from "./snapshot";
import {
  STATUS_DISPLAY_ORDER,
  STATUS_LABELS,
} from "./ticket-frontmatter";
import { GLOBAL_TOOL_CMD } from "./adoption-readme";

// INFRA-10 (D5) — Rendu lisible de specs/backlog.md depuis le snapshot.
// backlog.md n'est PLUS une source : c'est un artefact généré, régénéré par
// toute mutation CLI en même temps que backlog.json. Personne ne le parse.

/**
 * Sentinel en première ligne du fichier généré. Double rôle de verrou :
 * le renderer refuse d'écraser un backlog.md qui ne le porte pas (la source
 * legacy pré-migration reste intouchable hors codemod), et le codemod refuse
 * de re-tourner sur un backlog.md qui le porte (M10).
 */
export const GENERATED_SENTINEL =
  "<!-- GÉNÉRÉ (INFRA-10/INFRA-35) — NE PAS ÉDITER À LA MAIN, voir l'en-tête ci-dessous. -->";

export function isGeneratedBacklogMd(raw: string): boolean {
  return raw.trimStart().startsWith(GENERATED_SENTINEL);
}

/** Lien relatif à specs/ (où vit backlog.md) depuis le chemin repo du ticket. */
function specRelative(file: string): string {
  return file.startsWith("specs/") ? file.slice("specs/".length) : `../${file}`;
}

function renderTicket(t: SnapshotTicket): string {
  const head = t.title ? `**${t.id} — ${t.title}**` : `**${t.id}**`;
  const annotations: string[] = [];
  if (t.priority) annotations.push(t.priority);
  if (t.epic) annotations.push(t.epic);
  if (t.exec) {
    const execParts = [
      t.exec.model,
      t.exec.effort,
      ...(t.exec.review ? [`review:${t.exec.review}`] : []),
      t.exec.matured,
    ];
    annotations.push(execParts.join(" · "));
  }
  const meta = annotations.length > 0 ? ` _(${annotations.join(" · ")})_` : "";
  return `- ${head}${meta} — [spec](${specRelative(t.file)})`;
}

/**
 * INFRA-22 — le renderer est partagé par tous les projets via le bundle global
 * (INFRA-14). Il ne code donc rien en dur de whereismycard : le titre dérive du
 * nom de projet (passé par le CLI), et l'en-tête ne référence plus les specs
 * internes infra-08/infra-10 (mortes hors whereismycard). Fallback neutre si
 * `projectName` est absent (rétro-compat de la signature).
 */
export function renderBacklogMd(
  snap: BacklogSnapshot,
  projectName?: string,
): string {
  const out: string[] = [
    GENERATED_SENTINEL,
    "",
    `# Backlog — ${projectName ?? "projet"} (vue générée)`,
    "",
    "> Artefact **généré** depuis le frontmatter des tickets (`specs/*.md`),",
    "> la source de vérité. Muter via `/backlog`, ou en CLI :",
    `> \`node ${GLOBAL_TOOL_CMD} <new|set|mature|snapshot>\` — jamais en éditant`,
    "> ce fichier.",
    "> Modèle d'états : `parked · maturing · todo · wip · merged · shipped · wont`",
    "> (+ `priority` = engagement MoSCoW, bloc `exec` = maturation).",
    `> Détail : \`node ${GLOBAL_TOOL_CMD} help\`.`,
    "",
  ];

  const byStatus = groupByStatus(snap.tickets);

  for (const status of STATUS_DISPLAY_ORDER) {
    const tickets = byStatus.get(status) ?? [];
    out.push(`## ${STATUS_LABELS[status]} (${tickets.length})`, "");
    if (tickets.length === 0) {
      out.push("_(vide)_", "");
      continue;
    }
    for (const t of tickets) out.push(renderTicket(t));
    out.push("");
  }

  return `${out.join("\n").trimEnd()}\n`;
}
