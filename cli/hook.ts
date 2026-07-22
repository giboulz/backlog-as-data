import type { TicketStatus } from "./ticket-frontmatter";

// INFRA-11 — Cœur PUR du cycle automatique de la moitié-arrière du backlog
// (`todo → wip → merged → shipped`). Aucune I/O, aucun git : c'est la coquille
// `scripts/backlog-hook.ts` qui rassemble les données et applique les transitions.
// Testé exhaustivement (K1-K6) sans toucher au disque.

/** Événements émis par les skills de cycle de vie (cf. spec INFRA-11). */
export type HookEvent = "start" | "merge" | "ship";

export const HOOK_EVENTS = ["start", "merge", "ship"] as const satisfies readonly HookEvent[];

/** Vue minimale d'un ticket nécessaire pour planifier : id + statut courant. */
export interface HookTicket {
  id: string;
  status: TicketStatus;
}

/** Une mutation de statut à appliquer. `from`/`to` documentent l'intention. */
export interface Transition {
  id: string;
  from: TicketStatus;
  to: TicketStatus;
}

export interface PlanInput {
  /** L'ensemble des tickets frontmatter connus (déjà scannés). */
  tickets: HookTicket[];
  /** Ids `[A-Z]+-…` apparus dans l'historique de main (utile au seul `merge`). */
  mainIds?: string[];
  /** Cible du `start` (id passé par `/sdd-run-ticket`). */
  id?: string;
}

/**
 * Planifie les transitions induites par `event` sur l'état courant.
 *
 * Fonction **pure et idempotente** : ne renvoie que les transitions dont le
 * `from` est bien le statut courant. Re-jouer un event sur l'état déjà transité
 * renvoie `[]`. Un id absent de `tickets` (legacy pré-INFRA-10) → no-op silencieux.
 *
 * - `start <id>` : `todo → wip` pour cet id, ssi son statut est `todo`.
 * - `merge`      : tout `wip` dont l'id ∈ `mainIds` → `merged`.
 * - `ship`       : tout `merged` → `shipped` (le `/deploy` pousse tout main).
 */
export function planTransitions(event: HookEvent, input: PlanInput): Transition[] {
  const { tickets, mainIds = [], id } = input;

  switch (event) {
    case "start": {
      if (!id) return [];
      const target = tickets.find((t) => t.id === id);
      if (!target || target.status !== "todo") return [];
      return [{ id: target.id, from: "todo", to: "wip" }];
    }
    case "merge": {
      const inMain = new Set(mainIds);
      return tickets
        .filter((t) => t.status === "wip" && inMain.has(t.id))
        .map((t) => ({ id: t.id, from: "wip", to: "merged" }));
    }
    case "ship": {
      return tickets
        .filter((t) => t.status === "merged")
        .map((t) => ({ id: t.id, from: "merged", to: "shipped" }));
    }
    default: {
      // Exhaustivité : tout nouvel event doit être traité explicitement.
      const _exhaustive: never = event;
      void _exhaustive;
      return [];
    }
  }
}
