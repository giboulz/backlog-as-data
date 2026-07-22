import {
  STATUS_LABELS,
  TICKET_STATUSES,
  type Surface,
  type TicketExec,
  type TicketFrontmatter,
  type TicketPriority,
  type TicketStatus,
} from "./ticket-frontmatter";
import { extractDecision, type DecisionFields } from "./decision-extract";

// INFRA-08 — Projection dénormalisée lue par /admin/planning (INFRA-09).
// Régénérable depuis le frontmatter, jamais canonique.
// INFRA-10 (D4) : gagne `title` (board lisible) et `file` (chemin du ticket).
// INFRA-15 : gagne `decision` (date + triggers ADR) pour les parked/wont, extrait
// du corps à la génération → l'onglet Décisions n'a plus à relire les fichiers.

/** Un ticket scanné = frontmatter + corps + chemin (relatif à la racine repo). */
export interface SnapshotSource {
  frontmatter: TicketFrontmatter;
  file: string;
  /** Corps du fichier (hors frontmatter) — source de `decision` pour parked/wont. */
  body: string;
}

export interface SnapshotTicket {
  id: string;
  status: TicketStatus;
  label: string;
  title?: string;
  priority?: TicketPriority;
  epic?: string;
  /** INFRA-12 — surface produit (privé/public…), consommée par la dérivation épic. */
  surface?: Surface;
  /** INFRA-12 — ids bloquants (gating), joints par le board sous l'épic. */
  blockedBy?: string[];
  scope: string;
  /** Chemin relatif repo, slashs `/` (déterminisme Windows/Linux). */
  file: string;
  exec?: TicketExec;
  /** ADR scannable (date + triggers), présent UNIQUEMENT pour parked/wont (INFRA-15). */
  decision?: DecisionFields;
}

/**
 * INFRA-16 — Dérive le titre depuis le premier H1 du corps.
 *
 * Convention attendue : `# <ID> — <Titre>` ou `# <ID> - <Titre>`.
 * - Cherche la première ligne commençant exactement par `# ` (pas `## `).
 * - Retire le préfixe `# `.
 * - Si le reste commence par `<id>` suivi d'un séparateur ` — ` (tiret cadratin)
 *   ou ` - ` (trait d'union), retire `id + séparateur`.
 * - Si le résultat après trim() est vide ou réduit à l'id seul → `undefined`.
 * - Gère CRLF : pas de `\r` résiduel dans le titre.
 * - Blockquotes et lignes vides avant le H1 sont ignorés (on cherche le 1ᵉʳ H1).
 */
export function deriveTitleFromBody(body: string, id: string): string | undefined {
  // Split tolérant CRLF
  const lines = body.split(/\r?\n/);

  // Trouve la première ligne de niveau H1 exact (commence par "# " mais pas "## ")
  const h1Line = lines.find((line) => /^# /.test(line));
  if (!h1Line) return undefined;

  // Retire le préfixe "# "
  let rest = h1Line.slice(2);

  // Retire le préfixe id + séparateur s'il est présent
  const tiretCadratin = ` — `; // " — "
  const traitUnion = ` - `;

  if (rest.startsWith(id + tiretCadratin)) {
    rest = rest.slice(id.length + tiretCadratin.length);
  } else if (rest.startsWith(id + traitUnion)) {
    rest = rest.slice(id.length + traitUnion.length);
  } else if (rest === id) {
    // H1 contient uniquement l'id, sans séparateur ni titre
    return undefined;
  }
  // Sinon : H1 ne commence pas par l'id → retourne tout le texte tel quel

  const title = rest.trim();
  return title.length > 0 ? title : undefined;
}

/** Statuts dont le corps porte une décision produit (onglet Décisions). */
const DECISION_STATUSES = new Set<TicketStatus>(["parked", "wont"]);

export interface BacklogSnapshot {
  generatedFrom: "frontmatter";
  tickets: SnapshotTicket[];
  stats: Record<TicketStatus, number>;
  scopes: string[];
}

/**
 * Préfixe de scope d'un id :
 * INFRA-08 → INFRA, EDHREC-01f → EDHREC, SEO-HUB-CURATED → SEO-HUB.
 */
export function extractScope(id: string): string {
  if (/-\d+[a-z]?$/.test(id)) {
    return id.replace(/-\d+[a-z]?$/, "");
  }
  return id.replace(/-[A-Za-z0-9]+$/, "") || id;
}

/** Comparateur d'ordre par code-unit (déterminisme cross-OS, diffs git stables). */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildSnapshot(sources: SnapshotSource[]): BacklogSnapshot {
  const sorted = [...sources].sort((a, b) =>
    byCodeUnit(a.frontmatter.id, b.frontmatter.id),
  );

  const snapTickets: SnapshotTicket[] = sorted.map(({ frontmatter: t, file, body }) => ({
    id: t.id,
    status: t.status,
    label: STATUS_LABELS[t.status],
    ...(() => { const title = t.title ?? deriveTitleFromBody(body, t.id); return title ? { title } : {}; })(),
    ...(t.priority ? { priority: t.priority } : {}),
    ...(t.epic ? { epic: t.epic } : {}),
    ...(t.surface ? { surface: t.surface } : {}),
    ...(t.blockedBy && t.blockedBy.length > 0 ? { blockedBy: [...t.blockedBy] } : {}),
    scope: extractScope(t.id),
    file: file.replace(/\\/g, "/"),
    ...(t.exec ? { exec: { ...t.exec } } : {}),
    // ADR embarqué pour les seuls parked/wont — évite ~34 lectures request-time
    // de l'onglet Décisions (INFRA-15). Absent ailleurs (pas de champ parasite).
    ...(DECISION_STATUSES.has(t.status) ? { decision: extractDecision(body) } : {}),
  }));

  const stats = Object.fromEntries(
    TICKET_STATUSES.map((s) => [s, 0]),
  ) as Record<TicketStatus, number>;
  for (const { frontmatter: t } of sorted) stats[t.status] += 1;

  const scopes = [...new Set(snapTickets.map((t) => t.scope))].sort(byCodeUnit);

  return { generatedFrom: "frontmatter", tickets: snapTickets, stats, scopes };
}

/** Sérialisation stable (clés ordonnées, newline final) pour des diffs git propres. */
export function serializeSnapshot(snap: BacklogSnapshot): string {
  return `${JSON.stringify(snap, null, 2)}\n`;
}

/**
 * Regroupe les tickets par statut (toutes les clés de `TICKET_STATUSES` présentes,
 * même vides ; valeurs dans l'ordre d'arrivée). Source UNIQUE du bucketing partagée
 * par le rendu Markdown (`render-md`) et la vue terminal (`backlog list`) — qu'ils
 * ne divergent jamais sur l'ordre ou un statut oublié (INFRA-14).
 */
export function groupByStatus(
  tickets: SnapshotTicket[],
): Map<TicketStatus, SnapshotTicket[]> {
  const byStatus = new Map<TicketStatus, SnapshotTicket[]>(
    TICKET_STATUSES.map((s) => [s, []]),
  );
  for (const t of tickets) byStatus.get(t.status)?.push(t);
  return byStatus;
}
