import {
  isExecAllowed,
  LIST_KEYS,
  parseListValue,
  TICKET_STATUSES,
  validateTicket,
  type TicketFrontmatter,
  type TicketStatus,
} from "./ticket-frontmatter";

// BLG-05 — Cœur PUR de `set <ID> clé=valeur` (D2). Prend le frontmatter lu,
// rend le frontmatter SUIVANT + une note de dématuration, sans toucher au
// disque, à git, ni à `writeArtifacts` : ces I/O restent dans `cmdSet`
// (`lib/backlog/cli.ts`), qui devient un appelant mince.
// BLG-03 — `blockedBy` rejoint la whitelist (D3). Le routage se fait sur
// `LIST_KEYS` (finding #4), pas sur `key === "blockedBy"` en dur : la
// grammaire (scalaire comma-séparé, `parseListValue`) vit dans
// `ticket-frontmatter.ts`, partagée avec le parseur — un futur ajout à
// `LIST_KEYS` rejoint automatiquement cette branche sans dupliquer la règle.

/** Champs mutables via `set`. Whitelist fermée : ajouter un champ est un
 *  geste délibéré, pas un « tant qu'on y est » (cf. § Hors-scope BLG-05). */
export const MUTABLE_FIELDS = ["status", "title", "blockedBy"] as const;
type MutableField = (typeof MUTABLE_FIELDS)[number];

function isMutableField(key: string): key is MutableField {
  return (MUTABLE_FIELDS as readonly string[]).includes(key);
}

export type FieldAssignmentResult =
  | { ok: true; next: TicketFrontmatter; note: string }
  | { ok: false; error: string };

/**
 * Applique `clé=valeur` sur `fm` et valide le résultat via `validateTicket`
 * (D3 — pas de second jeu de règles ici, en particulier pour `title`).
 *
 * - `status` : démature (retire `exec`) si la cible ne l'autorise plus
 *   (INFRA-10 D1 : `shipped` le conserve).
 * - `title` : posé tel quel ; zod refuse un vide, un espace de tête/queue,
 *   ou une valeur multi-ligne.
 * - clés de `LIST_KEYS` (`blockedBy`, BLG-03) : scalaire comma-séparé → ids
 *   trimmés, via `parseListValue` — la même grammaire que le parseur, quotes
 *   comprises (finding #4 : `blockedBy="SKILL-31"` est désormais accepté
 *   ici comme dans un `.md` écrit à la main). Valeur vide (D4) → clé
 *   RETIRÉE (asymétrie assumée avec `title`, qu'un vide refuse) ; valeur
 *   non-vide sans aucun id (ex. `,`) → refus, pour ne pas dé-gater en
 *   silence sur un hand-edit. Aucun contrôle d'existence des ids (D5) :
 *   c'est une annotation, pas un gate — un id cross-dépôt bien formé mais
 *   introuvable dans ce projet est un cas d'usage normal. La note signale
 *   explicitement un retrait (finding #3) : sans elle, `blockedBy=` sur un
 *   ticket qui n'en portait déjà aucun est indiscernable, en sortie CLI, du
 *   cas où l'annotation vient réellement d'être levée.
 * - champ inconnu : refus nommant la clé ET listant les champs mutables —
 *   sinon l'utilisateur reste devant le cul-de-sac que ce ticket ferme.
 */
export function applyFieldAssignment(
  fm: TicketFrontmatter,
  key: string,
  value: string,
): FieldAssignmentResult {
  if (!isMutableField(key)) {
    return {
      ok: false,
      error: `champ non mutable via set : « ${key} » (mutables : ${MUTABLE_FIELDS.join(", ")})`,
    };
  }

  if (LIST_KEYS.has(key)) {
    const { items, trimmed } = parseListValue(value);
    const next: Record<string, unknown> = { ...fm };
    let note = "";
    if (items.length > 0) {
      next[key] = items;
    } else if (trimmed === "") {
      if (key in next) {
        delete next[key];
        note = " (retiré)";
      }
    } else {
      return { ok: false, error: `${key} mal formé (aucun id valide) → « ${value} »` };
    }
    const res = validateTicket(next);
    if (!res.ok) return { ok: false, error: res.errors.join("\n") };
    return { ok: true, next: res.value, note };
  }

  // Trim asymétrique par champ (finding BLG-05 #4) : `status` est un enum
  // fermé — un espace/CR de queue (copié-collé, fichier lu sous Windows)
  // n'est jamais un statut fautif à signaler, trim depuis toujours. `title`
  // reste NON trim : c'est zod qui doit refuser un espace de tête/queue (D3),
  // pas ce module qui l'absorberait en silence avant que zod ne le voie.
  const effectiveValue = key === "status" ? value.trim() : value;
  const next: Record<string, unknown> = { ...fm, [key]: effectiveValue };
  let note = "";

  if (key === "status") {
    // Dématuration : passer vers un statut où `exec` est interdit le retire
    // (sinon le `set` serait un cul-de-sac pour tout ticket maturé). `shipped`
    // le CONSERVE (exec optionnel depuis INFRA-10 D1).
    const isKnownStatus = (TICKET_STATUSES as readonly string[]).includes(effectiveValue);
    if (next.exec && isKnownStatus && !isExecAllowed(effectiveValue as TicketStatus)) {
      delete next.exec;
      note = " (exec retiré : dématuration)";
    }
  }

  const res = validateTicket(next);
  if (!res.ok) return { ok: false, error: res.errors.join("\n") };

  return { ok: true, next: res.value, note };
}
