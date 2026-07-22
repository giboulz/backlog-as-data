import { z } from "zod";
import { splitFrontmatter, stripQuotes, yamlScalar } from "./ticket-frontmatter";

// INFRA-12 — Épic-as-data. Dernière vague de backlog-as-data : l'appartenance
// d'un ticket à un épic devient un champ (`epic:`), et `roadmap.data.ts` +
// `possibilites.md` fusionnent en un store frontmatter `specs/epics/<id>.md`.
// Le statut reste DÉRIVÉ (lib/admin/roadmap-status.ts) — ce schéma ne porte que
// les FAITS manuels (engagement/maturation pré-démarrage) + l'éditorial.

export const EPIC_KINDS = ["phase", "chain"] as const;
export type EpicKind = (typeof EPIC_KINDS)[number];

// État manuel PRÉ-démarrage (axe Engagement) : une candidate non-actée
// (`possibilité`) vs une chaîne engagée mais pas encore amorcée (`à-venir`).
// Post-démarrage (`started: true`) ce champ n'est plus consulté : le statut
// passe à la dérivation 6-états.
export const EPIC_PHASES = ["possibilité", "à-venir"] as const;
export type EpicPhase = (typeof EPIC_PHASES)[number];

// id d'épic : soit un id de chaîne hérité (`COMBO`, `PHASE-1`, `RETENTION-01`,
// `ANALYTICS-V2`), soit un slug kebab (`backlog-as-data`). Casse conservée
// (D10, forward-only) ; le nom de fichier est lowercké séparément.
const EPIC_ID_RE = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/;

/** Clés de frontmatter épic dont la valeur est un booléen. */
const BOOL_KEYS = new Set<string>(["started", "abandoned"]);
/** Clés de frontmatter épic dont la valeur est un entier. */
const NUMBER_KEYS = new Set<string>(["order", "number"]);

const singleLine = (label: string) =>
  z
    .string()
    .min(1)
    .refine((s) => s.trim() === s, `${label}: pas d'espaces de tête/queue`)
    .refine((s) => !/[\r\n]/.test(s), `${label}: doit tenir sur une seule ligne`);

const baseSchema = z.object({
  id: z.string().regex(EPIC_ID_RE, "id d'épic invalide (ex. COMBO, backlog-as-data)"),
  type: z.literal("epic"),
  kind: z.enum(EPIC_KINDS),
  title: singleLine("title"),
  /** Ordinal de phase (PHASE-1/2/3) — affichage uniquement, null pour une chaîne. */
  number: z.number().int().nullable().optional(),
  phase: z.enum(EPIC_PHASES),
  /** Flag manuel : bascule du statut `phase` vers la dérivation 6-états. */
  started: z.boolean(),
  /** Flag manuel (= `won't` des épics) : terminal, prioritaire sur tout. */
  abandoned: z.boolean(),
  /** Ordre d'affichage global (repris de l'ordre de roadmap.data.ts). */
  order: z.number().int(),
  objective: singleLine("objective"),
  /** Travail produit restant, en clair. Obligatoire dès qu'un épic n'est pas terminé (EC2). */
  residue: singleLine("residue").optional(),
});

export type EpicFrontmatter = z.infer<typeof baseSchema>;

export type ValidateEpicResult =
  | { ok: true; value: EpicFrontmatter }
  | { ok: false; errors: string[] };

export function validateEpic(data: unknown): ValidateEpicResult {
  const res = baseSchema.safeParse(data);
  if (!res.success) {
    return {
      ok: false,
      errors: res.error.issues.map((issue) => {
        const path = issue.path.join(".");
        return `${path || "(root)"}: ${issue.message}`;
      }),
    };
  }
  const value = res.data;
  // Invariant (décision 2, règle 1) : `abandoned` est terminal — un épic
  // abandonné ne peut pas être simultanément `started` (le statut composé
  // donnerait `abandonné`, mais on refuse l'état incohérent à la source).
  if (value.abandoned && value.started) {
    return {
      ok: false,
      errors: ["abandoned: incompatible avec started:true (état terminal)"],
    };
  }
  return { ok: true, value };
}

/**
 * Parse le sous-ensemble YAML du frontmatter épic : scalaires de niveau 0
 * uniquement (pas d'imbrication, pas de liste, pas de multi-ligne). Coerce les
 * clés booléennes (`started`/`abandoned`) et numériques (`order`/`number`) ;
 * tout le reste reste chaîne (validé ensuite par Zod).
 */
function parseEpicYaml(fmRaw: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const content = line.trim();
    const colon = content.indexOf(":");
    if (colon === -1) {
      throw new Error(`frontmatter épic: ligne sans « : » → « ${line} »`);
    }
    const key = content.slice(0, colon).trim();
    const rawVal = stripQuotes(content.slice(colon + 1).trim());
    if (BOOL_KEYS.has(key)) {
      if (rawVal !== "true" && rawVal !== "false") {
        throw new Error(`frontmatter épic: ${key} attend true|false → « ${rawVal} »`);
      }
      data[key] = rawVal === "true";
    } else if (NUMBER_KEYS.has(key)) {
      if (rawVal === "null") {
        data[key] = null;
      } else {
        const n = Number(rawVal);
        if (!Number.isInteger(n)) {
          throw new Error(`frontmatter épic: ${key} attend un entier → « ${rawVal} »`);
        }
        data[key] = n;
      }
    } else {
      data[key] = rawVal;
    }
  }
  return data;
}

export function parseEpicFile(raw: string): {
  frontmatter: EpicFrontmatter;
  body: string;
} {
  const split = splitFrontmatter(raw);
  if (!split) {
    throw new Error("fichier épic sans frontmatter YAML (--- … ---)");
  }
  const data = parseEpicYaml(split.fmRaw);
  const res = validateEpic(data);
  if (!res.ok) {
    throw new Error(`frontmatter épic invalide :\n${res.errors.join("\n")}`);
  }
  return { frontmatter: res.value, body: split.body };
}

export function serializeEpicFile(fm: EpicFrontmatter, body: string): string {
  const lines: string[] = [
    `id: ${fm.id}`,
    `type: ${fm.type}`,
    `kind: ${fm.kind}`,
    `title: ${yamlScalar(fm.title)}`,
  ];
  if (fm.number !== undefined && fm.number !== null) {
    lines.push(`number: ${fm.number}`);
  }
  lines.push(
    `phase: ${fm.phase}`,
    `started: ${fm.started}`,
    `abandoned: ${fm.abandoned}`,
    `order: ${fm.order}`,
    `objective: ${yamlScalar(fm.objective)}`,
  );
  if (fm.residue) lines.push(`residue: ${yamlScalar(fm.residue)}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}
