import { z } from "zod";

// INFRA-08 — Backlog-as-data. Schéma frontmatter d'un ticket : l'état devient un
// champ, plus jamais un emplacement. Parser/serializer hand-rollés (région bornée,
// fencée, schéma figé), validation Zod, invariant exec vérifié à la main.

export const TICKET_STATUSES = [
  "parked",
  "maturing",
  "todo",
  "wip",
  "merged",
  "shipped",
  "wont",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["must", "should", "could"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

// `fable` : Claude Fable 5 (2026-06), tier au-dessus d'opus — réservé aux
// tickets où la correction prime sur le coût (ex. migration irréversible).
export const EXEC_MODELS = ["fable", "opus", "sonnet", "haiku"] as const;
export type ExecModel = (typeof EXEC_MODELS)[number];

export const EXEC_EFFORTS = ["none", "think", "think-hard", "ultrathink"] as const;
export type ExecEffort = (typeof EXEC_EFFORTS)[number];

// INFRA-30 — dosage de la gate de revue (`/sdd-run-ticket`, cf. INFRA-31),
// décidé à la maturation comme `model`/`effort`. Optionnel : champ absent =
// `light` par convention du CONSOMMATEUR (INFRA-31), pas un défaut écrit ici.
export const EXEC_REVIEWS = ["none", "light", "deep"] as const;
export type ExecReview = (typeof EXEC_REVIEWS)[number];

// INFRA-12 — Annotations de pilotage migrées depuis RoadmapTicketRef (ex-
// roadmap.data.ts). `surface` distingue privé/public (un public non livré = signal
// flywheel/SEO) ; `blockedBy` porte le gating (garde EC/G2). Optionnelles : ne
// concernent que les ~130 tickets rattachés à un épic.
export const SURFACES = ["private", "public", "infra", "data"] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * Statuts qui exigent un bloc `exec` (= maturés). Invariant amendé par INFRA-10
 * (D1) : `shipped` n'exige plus `exec` — les 365 tickets historiques migrés
 * depuis backlog.md ont été livrés sans maturation tracée. Le cycle INFRA-11
 * (`todo → wip → merged → shipped`) garantit l'`exec` sur tout shipped récent.
 */
export const EXEC_REQUIRED_STATUSES = [
  "todo",
  "wip",
  "merged",
] as const satisfies readonly TicketStatus[];

const EXEC_REQUIRED_SET = new Set<string>(EXEC_REQUIRED_STATUSES);

export function isExecRequired(status: TicketStatus): boolean {
  return EXEC_REQUIRED_SET.has(status);
}

/** `exec` toléré : requis (maturés) ou optionnel (`shipped` historique). */
export function isExecAllowed(status: TicketStatus): boolean {
  return EXEC_REQUIRED_SET.has(status) || status === "shipped";
}

/** Clés de frontmatter dont la valeur est un objet imbriqué (un niveau). */
const NEST_KEYS = new Set<string>(["exec"]);

/**
 * Clés dont le scalaire comma-séparé est splitté en `string[]` à la lecture
 * (D7 — le sous-ensemble YAML reste sans liste au niveau syntaxe : `blockedBy: A, B`
 * est un scalaire, pas une liste YAML).
 */
const LIST_KEYS = new Set<string>(["blockedBy"]);

/** Bijection clé ASCII → label FR affiché (CLI typable, affichage français). */
export const STATUS_LABELS: Record<TicketStatus, string> = {
  parked: "Parked",
  maturing: "À maturer",
  todo: "Todo",
  wip: "WIP",
  merged: "Mergé",
  shipped: "Livré",
  wont: "Won't",
};

/**
 * Ordre d'affichage cycle-de-vie (maturing → … → wont) — source UNIQUE consommée
 * par le board (`BacklogView`) ET la vue générée (`render-md`). `satisfies` impose
 * une permutation EXHAUSTIVE de `TICKET_STATUSES` : ajouter un statut sans l'insérer
 * ici casse la compilation, au lieu de le faire disparaître silencieusement d'une
 * des deux vues (`TICKET_STATUSES`, lui, ouvre par `parked` — pas réutilisable tel quel).
 */
export const STATUS_DISPLAY_ORDER = [
  "maturing",
  "todo",
  "wip",
  "merged",
  "shipped",
  "parked",
  "wont",
] as const satisfies readonly TicketStatus[];

// Garde-fou d'exhaustivité : longueurs égales + permutation (toute valeur de
// TICKET_STATUSES présente). Vérifié au chargement du module (coût nul).
{
  const set = new Set<string>(STATUS_DISPLAY_ORDER);
  if (set.size !== TICKET_STATUSES.length || TICKET_STATUSES.some((s) => !set.has(s))) {
    throw new Error("STATUS_DISPLAY_ORDER doit être une permutation de TICKET_STATUSES");
  }
}

// Source unique de la grammaire d'id de ticket (`SCOPE` + ≥1 segment) : sert à
// la fois à la validation ancrée (`ID_RE`) et à l'extraction depuis du texte libre
// (`extractTicketIds`, utilisé par le hook `merge`). Un seul endroit à faire
// évoluer si la grammaire change. Multi-segment géré : `SEO-HUB-CURATED`.
const ID_BODY = "[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+";
const ID_RE = new RegExp(`^${ID_BODY}$`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Extrait les ids de ticket mentionnés dans un texte libre (sujets/corps de
 * commits → hook `merge`). Dédupliqué, ordre d'apparition. Capture l'id **complet**
 * y compris ses segments multiples (`SEO-HUB-CURATED`), contrairement à un naïf
 * `SCOPE-SEGMENT` qui les tronquerait et raterait la correspondance.
 */
export function extractTicketIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(new RegExp(`\\b${ID_BODY}\\b`, "g"))) {
    ids.add(m[0]);
  }
  return [...ids];
}

/**
 * INFRA-23 — Id de ticket porté par un nom de fichier de spec. `cmdNew` écrit
 * `<id>.md` en minuscules : la relation nom↔id est donc réversible. `"value-40.md"`
 * → `"VALUE-40"`. `null` quand le nom ne correspond PAS à la grammaire d'id, ce qui
 * écarte de fait les specs de **domaine** (`backlog.md`, `value.md`, `mcp.md` —
 * mono-segment, donc jamais un ticket). Pur, ne throw jamais.
 */
export function ticketIdFromSpecFilename(name: string): string | null {
  if (typeof name !== "string" || !name.toLowerCase().endsWith(".md")) return null;
  const base = name.slice(0, -".md".length).toUpperCase();
  return ID_RE.test(base) ? base : null;
}

/** Échappe les métacaractères regex (défensif : un préfixe d'id valide n'en porte pas). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * INFRA-23 — Prochain id libre du même préfixe que `id`, compte tenu des ids `taken`
 * (typiquement ceux présents sur main). `("VALUE-40", ["VALUE-40"…"VALUE-45"])` →
 * `"VALUE-46"`. Pur, déterministe, insensible à l'ordre de `taken`.
 *
 * `null` si le dernier segment de `id` n'est **pas numérique** : la grammaire admet le
 * multi-segment nommé (`SEO-HUB-CURATED`) pour lequel un « successeur » n'a pas de sens
 * — on refuse alors sans suggérer plutôt que d'inventer. Le padding du segment demandé
 * est conservé (`VALUE-06` → `VALUE-07`) mais jamais tronqué (`INFRA-99` → `INFRA-100`).
 */
export function nextFreeTicketId(id: string, taken: string[]): string | null {
  const m = /^(.*)-(\d+)$/.exec(typeof id === "string" ? id : "");
  // Les groupes 1/2 sont garantis par le match ; les defaults satisfont
  // `noUncheckedIndexedAccess` sans assertion `!` (le garde ci-dessous couvre l'impossible).
  const prefix = m?.[1];
  const numRaw = m?.[2];
  if (prefix === undefined || numRaw === undefined) return null;
  const scopeRe = new RegExp(`^${escapeRe(prefix)}-(\\d+)$`, "i");
  // Au-delà du PLUS HAUT pris, jamais dans un trou : réutiliser un numéro libéré (ticket
  // supprimé/renuméroté) rouvrirait la confusion que ce garde-fou existe pour fermer —
  // l'historique peut déjà porter un `feat(SCOPE-41): …` pour autre chose. Les trous sont
  // gratuits. `taken` vide → l'id demandé est déjà le suivant libre.
  let next = Number.parseInt(numRaw, 10);
  for (const t of Array.isArray(taken) ? taken : []) {
    const tm = scopeRe.exec(typeof t === "string" ? t : "")?.[1];
    if (tm !== undefined) next = Math.max(next, Number.parseInt(tm, 10) + 1);
  }
  return `${prefix}-${String(next).padStart(numRaw.length, "0")}`;
}

// INFRA-18 — scope conventionnel `type(<scope>): …`. Pour un commit
// d'implémentation le scope EST l'id de ticket (`feat(GROWTH-01): …`) ; un commit
// de cycle backlog (`chore(backlog): start GROWTH-02`) a pour scope `backlog`,
// pas un id. Le marqueur breaking `!` (`feat(X)!: …`) est toléré.
// INFRA-25 — seuls feat/fix (les commits d'implémentation par convention SDD, cf.
// /sdd-run-ticket : « feat(<ID>): … » ou « fix(<ID>): … ») promeuvent un ticket.
// chore/docs/refactor/test scopés à un id (ex. maturation `chore(PKG-04): …`)
// sont désormais ignorés.
const COMMIT_SCOPE_RE = /^(?:feat|fix)\(([^)]+)\)!?:/;

/**
 * Ids de ticket qui sont le **scope d'un commit d'implémentation**, à partir des
 * **sujets** de commits (un par ligne). Sert au hook `merge` : un ticket n'est
 * `merged` que si son code est sur la branche (`type(<id>): …`), pas sur un
 * simple `chore(backlog): start <id>` ni une mention en corps. Dédupliqué,
 * ordre d'apparition.
 */
export function extractScopedTicketIds(subjects: string[]): string[] {
  const ids = new Set<string>();
  for (const subject of subjects) {
    const scope = subject.match(COMMIT_SCOPE_RE)?.[1];
    if (scope && ID_RE.test(scope)) ids.add(scope);
  }
  return [...ids];
}

const execSchema = z.object({
  model: z.enum(EXEC_MODELS),
  effort: z.enum(EXEC_EFFORTS),
  review: z.enum(EXEC_REVIEWS).optional(),
  matured: z.string().regex(DATE_RE, "date attendue au format YYYY-MM-DD"),
});

const baseSchema = z.object({
  id: z.string().regex(ID_RE, "id de ticket invalide (attendu SCOPE-NN, ex. INFRA-08)"),
  /**
   * Titre lisible du board (INFRA-10 D4). UNE ligne, déjà trimée : le frontmatter
   * est un sous-ensemble YAML une-ligne (pas de multi-ligne), et le parser trim au
   * re-lecture — une valeur non trimée ou multi-ligne casserait le round-trip (H3)
   * ou le fichier (clé injectée). On refuse à la validation plutôt que de muter en
   * silence.
   */
  title: z
    .string()
    .min(1)
    .refine((s) => s.trim() === s, "title: pas d'espaces de tête/queue")
    .refine((s) => !/[\r\n]/.test(s), "title: doit tenir sur une seule ligne")
    .optional(),
  type: z.literal("ticket"),
  status: z.enum(TICKET_STATUSES),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  epic: z.string().min(1).optional(),
  // INFRA-12 — annotations de pilotage (ex-RoadmapTicketRef). `blockedBy` est un
  // tableau d'ids (issu d'un scalaire comma-séparé, cf. LIST_KEYS) ; `note` reste
  // mono-ligne (round-trip-sûr, le parser est single-line).
  surface: z.enum(SURFACES).optional(),
  blockedBy: z.array(z.string().regex(ID_RE, "blockedBy: id invalide")).min(1).optional(),
  note: z
    .string()
    .min(1)
    .refine((s) => !/[\r\n]/.test(s), "note: doit tenir sur une seule ligne")
    .optional(),
  exec: execSchema.optional(),
});

export type TicketFrontmatter = z.infer<typeof baseSchema>;
export type TicketExec = z.infer<typeof execSchema>;

export type ValidateResult =
  | { ok: true; value: TicketFrontmatter }
  | { ok: false; errors: string[] };

export function validateTicket(data: unknown): ValidateResult {
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
  // Invariant central (amendé INFRA-10 D1) : exec requis pour todo/wip/merged,
  // optionnel pour shipped (historique migré), interdit pour parked/maturing/wont.
  if (isExecRequired(value.status) && !value.exec) {
    return {
      ok: false,
      errors: [`exec: requis pour le statut « ${value.status} »`],
    };
  }
  if (!isExecAllowed(value.status) && value.exec) {
    return {
      ok: false,
      errors: [
        `exec: interdit pour le statut « ${value.status} » (ticket pas encore maturé)`,
      ],
    };
  }
  return { ok: true, value };
}

/**
 * Détecte et isole le bloc frontmatter `--- … ---` en tête de fichier, sans
 * parser le YAML. Retourne null si le fichier ne commence pas par un fence.
 */
export function splitFrontmatter(
  raw: string,
): { fmRaw: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  return { fmRaw: m[1] ?? "", body: m[2] ?? "" };
}

export function stripQuotes(v: string): string {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse le sous-ensemble YAML utilisé par le frontmatter ticket : clés scalaires
 * de niveau 0 + un seul niveau d'imbrication (le bloc `exec:`). Aucune liste,
 * aucun multi-ligne — le texte libre est le corps, jamais le frontmatter.
 */
function parseYamlSubset(fmRaw: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let nestKey: string | null = null;
  for (const line of fmRaw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    const colon = content.indexOf(":");
    if (colon === -1) {
      throw new Error(`frontmatter: ligne sans « : » → « ${line} »`);
    }
    const key = content.slice(0, colon).trim();
    const val = stripQuotes(content.slice(colon + 1).trim());
    if (indent === 0) {
      if (LIST_KEYS.has(key)) {
        // Scalaire comma-séparé → string[]. `blockedBy:` vide = pas de blocage
        // (clé omise). Mais `blockedBy: ,` (valeur non-vide ne donnant aucun id)
        // = un-gating accidentel d'un hand-edit → on refuse plutôt que collapser
        // silencieusement en [].
        const items = val.split(",").map((s) => s.trim()).filter(Boolean);
        if (items.length > 0) {
          data[key] = items;
        } else if (val !== "") {
          throw new Error(`frontmatter: ${key} mal formé (aucun id valide) → « ${line} »`);
        }
        nestKey = null;
      } else if (val === "") {
        // Seules les clés objet connues (exec) ouvrent un bloc imbriqué ; une
        // autre clé à valeur vide est un scalaire vide (rejeté par Zod), pas un
        // objet implicite — évite le piège « première clé scalaire vide → {} ».
        if (NEST_KEYS.has(key)) {
          data[key] = {};
          nestKey = key;
        } else {
          data[key] = "";
          nestKey = null;
        }
      } else {
        data[key] = val;
        nestKey = null;
      }
    } else {
      if (!nestKey || typeof data[nestKey] !== "object" || data[nestKey] === null) {
        throw new Error(`frontmatter: imbrication inattendue → « ${line} »`);
      }
      (data[nestKey] as Record<string, unknown>)[key] = val;
    }
  }
  return data;
}

export function parseTicketFile(raw: string): {
  frontmatter: TicketFrontmatter;
  body: string;
} {
  const split = splitFrontmatter(raw);
  if (!split) {
    throw new Error("fichier sans frontmatter YAML (--- … ---)");
  }
  const data = parseYamlSubset(split.fmRaw);
  const res = validateTicket(data);
  if (!res.ok) {
    throw new Error(`frontmatter invalide :\n${res.errors.join("\n")}`);
  }
  return { frontmatter: res.value, body: split.body };
}

/**
 * Sérialise un scalaire libre (le `title`) de façon round-trip-sûre face au
 * strip des quotes du parser : une valeur entièrement encadrée de `"…"` (ou
 * `'…'`) serait amputée au re-parse → on l'enrobe de l'autre type de quote.
 */
export function yamlScalar(v: string): string {
  if (v.startsWith('"') && v.endsWith('"')) return `'${v}'`;
  if (v.startsWith("'") && v.endsWith("'")) return `"${v}"`;
  return v;
}

export function serializeTicketFile(
  fm: TicketFrontmatter,
  body: string,
): string {
  const lines: string[] = [
    `id: ${fm.id}`,
    ...(fm.title ? [`title: ${yamlScalar(fm.title)}`] : []),
    `type: ${fm.type}`,
    `status: ${fm.status}`,
  ];
  if (fm.priority) lines.push(`priority: ${fm.priority}`);
  if (fm.epic) lines.push(`epic: ${fm.epic}`);
  if (fm.surface) lines.push(`surface: ${fm.surface}`);
  if (fm.blockedBy && fm.blockedBy.length > 0) {
    lines.push(`blockedBy: ${fm.blockedBy.join(", ")}`);
  }
  if (fm.note) lines.push(`note: ${yamlScalar(fm.note)}`);
  if (fm.exec) {
    lines.push("exec:");
    lines.push(`  model: ${fm.exec.model}`);
    lines.push(`  effort: ${fm.exec.effort}`);
    if (fm.exec.review) lines.push(`  review: ${fm.exec.review}`);
    lines.push(`  matured: ${fm.exec.matured}`);
  }
  return `---\n${lines.join("\n")}\n---\n${body}`;
}
