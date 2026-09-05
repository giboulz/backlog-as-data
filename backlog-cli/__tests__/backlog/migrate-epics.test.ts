import { describe, it, expect } from "vitest";
import {
  chainToEpic,
  candidateToEpic,
  archiveToEpic,
  ticketPatchesForChain,
  applyTicketPatch,
  renderEpicFile,
  epicFileSlug,
  type MigrationChain,
  type MigrationCandidate,
} from "@/lib/backlog/epic-migration";
import { parseEpicFile } from "@/lib/backlog/epic-frontmatter";
import {
  parseTicketFile,
  serializeTicketFile,
  type TicketFrontmatter,
} from "@/lib/backlog/ticket-frontmatter";

// INFRA-12 — codemod épic-as-data (E6-E9). Logique pure, fixtures.

const CHAIN: MigrationChain = {
  id: "COMBO",
  kind: "chain",
  number: null,
  title: "Combo Awareness — surface combo deck-level",
  objective: "Fermer la boucle moat patch → version → diff public.",
  residue: "Épic promu 2026-05-29 : stories à maturer.",
  tickets: [
    { id: "COMBO-01", surface: "public" },
    {
      id: "COMBO-03",
      surface: "public",
      blockedBy: ["COMBO-01", "COMBO-05"],
      note: "Phase 1 — teaser fork public → redirection wizard.",
    },
  ],
};

const PHASE: MigrationChain = {
  id: "PHASE-2",
  kind: "phase",
  number: 2,
  title: "Upgrade Planner",
  objective: "Faire de Fetch autre chose qu'un Moxfield avec versions.",
  tickets: [{ id: "DECK-IMPROVE-01" }],
};

describe("E6 — chaîne roadmap.data.ts → 1 fichier épic + epic: sur ses tickets", () => {
  it("produit un épic started:true avec kind/title/objective/residue", () => {
    const epic = chainToEpic(CHAIN, 60);
    expect(epic.fileSlug).toBe("combo");
    expect(epic.frontmatter).toMatchObject({
      id: "COMBO",
      type: "epic",
      kind: "chain",
      started: true,
      abandoned: false,
      phase: "à-venir",
      order: 60,
    });
    expect(epic.frontmatter.objective).toMatch(/Fermer la boucle/);
    expect(epic.frontmatter.residue).toMatch(/Épic promu/);
  });

  it("préserve l'ordinal `number` d'une phase", () => {
    expect(chainToEpic(PHASE, 30).frontmatter.number).toBe(2);
    expect(chainToEpic(CHAIN, 60).frontmatter.number).toBeUndefined();
  });

  it("le fichier épic re-parse proprement (round-trip)", () => {
    const raw = renderEpicFile(chainToEpic(CHAIN, 60));
    const { frontmatter } = parseEpicFile(raw);
    expect(frontmatter.id).toBe("COMBO");
    expect(frontmatter.started).toBe(true);
  });

  it("préserve les notes per-ticket dans le corps de l'épic (D12)", () => {
    const raw = renderEpicFile(chainToEpic(CHAIN, 60));
    expect(raw).toMatch(/## Notes par ticket/);
    expect(raw).toMatch(/COMBO-03 — Phase 1 — teaser fork/);
  });

  it("pose epic: sur chaque ticket membre", () => {
    const patches = ticketPatchesForChain(CHAIN);
    expect(patches.get("COMBO-01")!.epic).toBe("COMBO");
    expect(patches.get("COMBO-03")!.epic).toBe("COMBO");
    expect(patches.size).toBe(2);
  });
});

describe("E7 — candidate possibilites.md → épic phase: possibilité, sans membre", () => {
  const candidate: MigrationCandidate = {
    id: "PACKAGE",
    title: "Card Packages partageables",
    source: "compétition (Moxfield, Archidekt)",
    valeur: "Groupes de cartes réutilisables insérables en 1 clic.",
    signal: "≥ 5 decks publics avec patterns communs, OU retour utilisateur.",
  };

  it("produit un épic non démarré, non abandonné, avec residue (EC2)", () => {
    const epic = candidateToEpic(candidate, 110);
    expect(epic.frontmatter).toMatchObject({
      id: "PACKAGE",
      type: "epic",
      phase: "possibilité",
      started: false,
      abandoned: false,
    });
    expect(epic.frontmatter.residue).toMatch(/decks publics/);
    expect(epic.frontmatter.objective.length).toBeGreaterThan(0);
  });

  it("ne génère AUCUN patch ticket (candidate sans membre)", () => {
    // candidateToEpic ne renvoie pas de patch : l'appartenance se fera quand des
    // tickets porteront epic: PACKAGE, jamais via une liste.
    const epic = candidateToEpic(candidate, 110);
    expect(epic.fileSlug).toBe("package");
    expect(parseEpicFile(renderEpicFile(epic)).frontmatter.started).toBe(false);
  });
});

describe("E8 — blockedBy/surface per-ticket migrés sur le frontmatter ticket", () => {
  it("applique surface + blockedBy au frontmatter et round-trip propre", () => {
    const base: TicketFrontmatter = {
      id: "COMBO-03",
      type: "ticket",
      status: "shipped",
    };
    const patched = applyTicketPatch(base, ticketPatchesForChain(CHAIN).get("COMBO-03")!);
    expect(patched.epic).toBe("COMBO");
    expect(patched.surface).toBe("public");
    expect(patched.blockedBy).toEqual(["COMBO-01", "COMBO-05"]);

    const reparsed = parseTicketFile(serializeTicketFile(patched, "\n# COMBO-03\n"));
    expect(reparsed.frontmatter.blockedBy).toEqual(["COMBO-01", "COMBO-05"]);
    expect(reparsed.frontmatter.surface).toBe("public");
  });
});

describe("E9 — idempotence : re-run → aucun changement", () => {
  it("renderEpicFile est déterministe", () => {
    expect(renderEpicFile(chainToEpic(CHAIN, 60))).toBe(
      renderEpicFile(chainToEpic(CHAIN, 60)),
    );
    expect(renderEpicFile(archiveToEpic({ id: "ARCHIVE-01", raison: "r", doNotReopenWithout: "x" }, 900))).toBe(
      renderEpicFile(archiveToEpic({ id: "ARCHIVE-01", raison: "r", doNotReopenWithout: "x" }, 900)),
    );
  });

  it("appliquer deux fois le même patch produit le même fichier ticket", () => {
    const base: TicketFrontmatter = { id: "COMBO-01", type: "ticket", status: "shipped" };
    const patch = ticketPatchesForChain(CHAIN).get("COMBO-01")!;
    const once = serializeTicketFile(applyTicketPatch(base, patch), "\n# x\n");
    const twice = serializeTicketFile(
      applyTicketPatch(parseTicketFile(once).frontmatter, patch),
      "\n# x\n",
    );
    expect(twice).toBe(once);
  });

  it("epicFileSlug est stable et lowercké (D10)", () => {
    expect(epicFileSlug("ANALYTICS-V2")).toBe("analytics-v2");
    expect(epicFileSlug("backlog-as-data")).toBe("backlog-as-data");
  });
});
