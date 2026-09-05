import { describe, it, expect } from "vitest";
import {
  GENERATED_SENTINEL,
  isGeneratedBacklogMd,
  renderBacklogMd,
} from "@/lib/backlog/render-md";
import { buildSnapshot, type SnapshotSource } from "@/lib/backlog/snapshot";
import type { TicketFrontmatter } from "@/lib/backlog/ticket-frontmatter";

function src(
  id: string,
  status: TicketFrontmatter["status"],
  extra: Partial<TicketFrontmatter> = {},
): SnapshotSource {
  return {
    frontmatter: { id, type: "ticket", status, ...extra },
    file: `specs/${id.toLowerCase()}.md`,
    body: "",
  };
}

const SNAP = buildSnapshot([
  src("ALPHA-01", "todo", {
    title: "Ticket prêt",
    priority: "must",
    epic: "epic-a",
    exec: { model: "fable", effort: "max", matured: "2026-06-10" },
  }),
  src("BETA-02", "maturing", { title: "À mûrir", priority: "should" }),
  src("GAMMA-03", "shipped", { title: "Déjà livré" }),
  src("DELTA-04", "parked"),
]);

describe("render-md (INFRA-10 D5)", () => {
  // R1 — sentinel en tête, groupes dans l'ordre canonique, compteurs exacts.
  it("R1 — sentinel + groupes ordonnés + compteurs", () => {
    const out = renderBacklogMd(SNAP);
    expect(out.startsWith(GENERATED_SENTINEL)).toBe(true);
    expect(isGeneratedBacklogMd(out)).toBe(true);

    const headings = [...out.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      "À maturer (1)",
      "Todo (1)",
      "WIP (0)",
      "Mergé (0)",
      "Livré (1)",
      "Parked (1)",
      "Won't (0)",
    ]);
    // un backlog.md legacy n'est pas reconnu comme généré
    expect(isGeneratedBacklogMd("# Backlog\n\n## Must Have\n")).toBe(false);
  });

  // R2 — forme d'une entrée : id + titre en gras, annotations, lien vers le
  // fichier ticket (relatif à specs/, où vit backlog.md).
  it("R2 — entrée rendue avec annotations et lien spec", () => {
    const out = renderBacklogMd(SNAP);
    const todoLine = out
      .split("\n")
      .find((l) => l.includes("ALPHA-01"));
    expect(todoLine).toBeDefined();
    expect(todoLine).toContain("**ALPHA-01 — Ticket prêt**");
    expect(todoLine).toContain("must");
    expect(todoLine).toContain("epic-a");
    expect(todoLine).toContain("fable · max · 2026-06-10");
    expect(todoLine).toContain("](alpha-01.md)");

    // ticket sans titre → id seul en gras, pas de tiret orphelin
    const parkedLine = out.split("\n").find((l) => l.includes("DELTA-04"));
    expect(parkedLine).toContain("**DELTA-04**");
    expect(parkedLine).not.toContain("DELTA-04 — ");
  });

  // INFRA-30 — ticket AVEC review : l'annotation le porte, préfixé `review:`.
  it("INFRA-30 — annotation avec exec.review", () => {
    const snap = buildSnapshot([
      src("EPSILON-05", "todo", {
        title: "Ticket revu",
        exec: { model: "sonnet", effort: "high", review: "deep", matured: "2026-07-20" },
      }),
    ]);
    const out = renderBacklogMd(snap);
    const line = out.split("\n").find((l) => l.includes("EPSILON-05"));
    expect(line).toContain("sonnet · high · review:deep · 2026-07-20");
  });

  // INFRA-30 — ticket SANS review : annotation inchangée (garde anti-churn des
  // ~365 lignes historiques — ALPHA-01 dans SNAP n'a pas de review).
  it("INFRA-30 — annotation sans exec.review reste model · effort · matured", () => {
    const out = renderBacklogMd(SNAP);
    const line = out.split("\n").find((l) => l.includes("ALPHA-01"));
    expect(line).toContain("fable · max · 2026-06-10");
    expect(line).not.toContain("review:");
  });

  // R3 (INFRA-22) — le renderer est agnostique du projet : titre dérivé du nom
  // passé, aucun libellé ni lien codé en dur de whereismycard.
  it("R3 — titre paramétré par le nom de projet, pas de liens infra en dur", () => {
    const out = renderBacklogMd(SNAP, "personal-hub");
    expect(out).toContain("# Backlog — personal-hub (vue générée)");
    expect(out).not.toContain("Fetch");
    // les liens vers les specs internes de whereismycard ont disparu
    expect(out).not.toContain("infra-08");
    expect(out).not.toContain("infra-10.md");
  });

  // R4 (INFRA-22) — sans nom de projet, fallback neutre (rétro-compat).
  it("R4 — fallback neutre sans nom de projet", () => {
    const out = renderBacklogMd(SNAP);
    expect(out).toContain("# Backlog — projet (vue générée)");
  });

  // R5 (INFRA-35 D5) — l'en-tête (et le sentinel qui l'accompagne) ne codent
  // plus en dur `npm run backlog`, qui ne marche que sur whereismycard (le
  // script `backlog` n'existe pas dans le package.json de tous les projets
  // adoptants, ex. claude-config) — fichier généré entier couvert, sentinel
  // inclus (revue INFRA-35 : un premier correctif l'avait laissé de côté).
  it("R5 — fichier généré agnostique : pas de `npm run backlog` codé en dur", () => {
    const out = renderBacklogMd(SNAP, "claude-config");
    expect(out).not.toContain("npm run backlog");
  });

  // INFRA-37 — le tilde n'est pas expansé dans un argument par PowerShell (shell
  // par défaut de l'environnement) : toute commande `node ~/…` écrite dans l'en-tête
  // généré est inexécutable telle quelle pour la moitié des lecteurs. La forme
  // portable (vérifiée dans les deux shells) est `node "$HOME/…"`, guillemets compris.
  it("INFRA-37 — l'en-tête ne contient aucun `node ~/`, seulement la forme portable", () => {
    const out = renderBacklogMd(SNAP);
    expect(out).not.toContain("node ~/");
    expect(out).toContain('node "$HOME/.claude/tools/backlog/backlog.mjs"');
  });

  // INFRA-38 — reconnaissance robuste aux rewords de sentinel. INFRA-35 a changé
  // le libellé du sentinel sans rétro-compat → les vues générées avant se sont
  // figées (non reconnues → verrou D5 refuse de les régénérer). On reconnaît
  // désormais la STRUCTURE (« <!-- GÉNÉRÉ … NE PAS ÉDITER À LA MAIN … -->»), pas
  // le libellé exact : v1, v2 et tout reword futur sont reconnus ; la prose
  // legacy pré-migration (aucun commentaire de tête) reste protégée.
  it("INFRA-38 — un backlog.md au marqueur v1 (pré-INFRA-35) est reconnu", () => {
    const v1 =
      "<!-- GÉNÉRÉ par `npm run backlog` (INFRA-10) — NE PAS ÉDITER À LA MAIN. -->\n\n# Backlog\n";
    expect(isGeneratedBacklogMd(v1)).toBe(true);
  });

  it("INFRA-38 — le marqueur courant (v2) reste reconnu", () => {
    expect(isGeneratedBacklogMd(GENERATED_SENTINEL + "\n")).toBe(true);
  });

  it("INFRA-38 — la prose legacy pré-migration reste protégée", () => {
    expect(isGeneratedBacklogMd("# Backlog\n\n## Must Have\n")).toBe(false);
  });

  it("INFRA-38 — un reword futur du sentinel est reconnu (structure, pas libellé)", () => {
    const future =
      "<!-- GÉNÉRÉ (INFRA-99) — NE PAS ÉDITER À LA MAIN, nouveau blabla -->\n";
    expect(isGeneratedBacklogMd(future)).toBe(true);
  });
});
