import { promises as fs } from "node:fs";
import path from "node:path";
import {
  discoverTickets,
  err,
  MD_SKIPPED_WARN,
  ok,
  parseFlags,
  relFile,
  writeArtifacts,
  type CliResult,
  type FlagSpec,
} from "./cli";
import {
  serializeTicketFile,
  TICKET_KINDS,
  type TicketKind,
} from "./ticket-frontmatter";
import { scaffoldSections, type BriefSection } from "./brief-sections";
import type { SnapshotSource } from "./snapshot";

// INFRA-41 — `ticket brief <ID>` : format de maturation de ticket commun,
// DÉCLARÉ et lu par l'outil (jamais reverse-engineeré d'un exemple). Trois pièces
// vivent ici : la constante de sections par défaut, le lecteur d'override projet,
// et la commande. Le scaffolding pur est partagé (`scaffoldSections`) avec
// `epic brief`.

/** Placeholder posé sous chaque section scaffoldée (aligné sur `epic brief`). */
export const DEFAULT_PLACEHOLDER = "_(à remplir)_";

const section = (heading: string): BriefSection => ({
  heading,
  placeholder: DEFAULT_PLACEHOLDER,
});

/**
 * Source UNIQUE de la structure de corps de spec ticket : deux jeux `core`
 * (tirés par le `kind`) + un menu `optional` partagé (jamais auto-posé). Défaut
 * global opinioné, surchargeable par projet (cf. `.claude/ticket-sections.json`).
 *
 * - `feature.core` : calé sur le flux SDD (Problème → Décision → … → Vérification).
 * - `bug.core` : ouverture orientée diagnostic (Symptôme → Cause racine → Correction).
 * - `optional` : menu commun situationnel.
 */
export const TICKET_SPEC_SECTIONS = {
  feature: {
    core: [
      section("Problème"),
      section("Décision"),
      section("Portée"),
      section("Hors-scope"),
      section("Tests"),
      section("Vérification"),
    ],
  },
  bug: {
    core: [
      section("Symptôme"),
      section("Cause racine"),
      section("Correction attendue"),
      section("Portée"),
      section("Tests"),
      section("Vérification"),
    ],
  },
  optional: [
    "Fichiers touchés",
    "Critères d'acceptation",
    "Modèle de données",
    "Contrats d'interface",
    "Spec domaine",
    "Dépend de",
  ],
} as const;

/** Kind effectif : `kind` absent du frontmatter = `feature` (rétro-compat). */
export function effectiveKind(kind: TicketKind | undefined): TicketKind {
  return kind ?? "feature";
}

/** Forme (tolérante) d'un override projet : chaque clé = liste de titres de sections. */
export type TicketSectionsOverride = {
  feature?: unknown;
  bug?: unknown;
  optional?: unknown;
};

/**
 * Sections core à poser pour `kind`, compte tenu d'un éventuel override projet.
 * Pur : `override` est la donnée déjà lue (ou `null`). L'override d'un kind = une
 * LISTE de titres (strings) → chaque titre reçoit le placeholder par défaut.
 * Override absent / kind non surchargé / valeur non-liste → repli sur le défaut global.
 */
export function resolveCoreSections(
  kind: TicketKind,
  override: TicketSectionsOverride | null,
): BriefSection[] {
  const raw = override?.[kind];
  if (Array.isArray(raw)) {
    const custom = raw
      .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
      .map((h) => section(h.trim()));
    // Repli sur le défaut si l'override d'un kind ne produit AUCUNE section valide
    // (array vide, ou éléments tous non-string) : sinon on répondrait « 0 section
    // scaffoldée » en code 0, l'utilisateur croyant son brief posé alors que rien
    // ne l'est. Le repli ne doit pas être réservé au cas « pas un tableau du tout ».
    if (custom.length > 0) return custom;
  }
  return [...TICKET_SPEC_SECTIONS[kind].core];
}

/**
 * Lit `.claude/ticket-sections.json` sous `root` (parallèle à la lecture de
 * `.claude/deploy.md`). Tolérant : fichier absent / illisible / JSON invalide →
 * `null` (repli sur le défaut global), jamais fatal.
 */
export async function readTicketSectionsOverride(
  root: string,
): Promise<TicketSectionsOverride | null> {
  try {
    const raw = await fs.readFile(
      path.join(root, ".claude", "ticket-sections.json"),
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as TicketSectionsOverride;
    }
    return null;
  } catch {
    return null;
  }
}

const BRIEF_FLAGS: FlagSpec = { kind: "value" };

/**
 * `ticket brief <ID> [--kind bug|feature]` : scaffolde le `*.core` correspondant
 * au `kind` du ticket (ou `--kind` en override ponctuel) dans le corps de la spec.
 * Idempotent et non destructif (comme `epic brief`). Régénère backlog.json +
 * specs/backlog.md du même geste.
 */
export async function cmdTicketBrief(
  args: string[],
  root: string,
  specsDir: string,
): Promise<CliResult> {
  const parsed = parseFlags(args, BRIEF_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { positionals, flags } = parsed.value;
  const id = positionals[0];
  if (!id) return err("usage: brief <ID> [--kind bug|feature]");
  if (flags.kind && !(TICKET_KINDS as readonly string[]).includes(flags.kind)) {
    return err(`--kind attendu parmi ${TICKET_KINDS.join("|")} → « ${flags.kind} »`);
  }

  const { tickets } = await discoverTickets(specsDir);
  const matches = tickets.filter((t) => t.frontmatter.id === id);
  if (matches.length === 0) return err(`${id} introuvable`);
  if (matches.length > 1) {
    return err(
      `${id} ambigu : ${matches.length} fichiers portent cet id (${matches
        .map((m) => m.relPath)
        .join(", ")}) — corrige le doublon avant de scaffolder`,
    );
  }
  const target = matches[0]!;

  const kind = effectiveKind((flags.kind as TicketKind | undefined) ?? target.frontmatter.kind);
  const override = await readTicketSectionsOverride(root);
  const sections = resolveCoreSections(kind, override);
  const nextBody = scaffoldSections(target.body, sections);

  await fs.writeFile(
    target.filePath,
    serializeTicketFile(target.frontmatter, nextBody),
    "utf8",
  );
  const sources: SnapshotSource[] = tickets.map((t) => ({
    frontmatter: t.frontmatter,
    file: relFile(root, t.filePath),
    body: t.frontmatter.id === id ? nextBody : t.body,
  }));
  const { mdSkipped } = await writeArtifacts(root, sources);
  return ok(
    `${id} → brief ${kind} scaffoldé (${sections.length} sections)${mdSkipped ? MD_SKIPPED_WARN : ""}`,
  );
}
