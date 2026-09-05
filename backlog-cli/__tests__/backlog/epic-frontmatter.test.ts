import { describe, it, expect } from "vitest";
import {
  validateEpic,
  parseEpicFile,
  serializeEpicFile,
  type EpicFrontmatter,
} from "@/lib/backlog/epic-frontmatter";
import {
  buildEpicsSnapshot,
  serializeEpicsSnapshot,
} from "@/lib/backlog/epic-snapshot";

// INFRA-12 — schéma épic-as-data (E1, E2) + snapshot déterministe (E10).

const VALID: EpicFrontmatter = {
  id: "backlog-as-data",
  type: "epic",
  kind: "chain",
  title: "Backlog-as-data",
  phase: "à-venir",
  started: true,
  abandoned: false,
  order: 30,
  objective: "Faire du frontmatter la source de vérité du backlog.",
  residue: "Reste la vague épic (INFRA-12).",
};

describe("E1 — parse/validate d'un épic valide", () => {
  it("valide un frontmatter épic complet", () => {
    const res = validateEpic(VALID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.id).toBe("backlog-as-data");
  });

  it("garde les enums kind / phase (rejette une valeur hors enum)", () => {
    expect(validateEpic({ ...VALID, kind: "saga" }).ok).toBe(false);
    expect(validateEpic({ ...VALID, phase: "plus-tard" }).ok).toBe(false);
  });

  it("accepte un id de chaîne hérité (PHASE-1, ANALYTICS-V2) et un slug kebab", () => {
    expect(validateEpic({ ...VALID, id: "PHASE-1" }).ok).toBe(true);
    expect(validateEpic({ ...VALID, id: "ANALYTICS-V2" }).ok).toBe(true);
    expect(validateEpic({ ...VALID, id: "RETENTION-01" }).ok).toBe(true);
  });

  it("round-trip parse → serialize → parse (objective/residue à `:` interne préservés)", () => {
    const body = "\n# Backlog-as-data\n\nNote de valeur.\n";
    const fm: EpicFrontmatter = {
      ...VALID,
      objective: "Rendre la page deck intelligente : bracket d'abord.",
      residue: "Chaîne close 2026-05-29 : surfaces livrées.",
    };
    const serialized = serializeEpicFile(fm, body);
    const reparsed = parseEpicFile(serialized);
    expect(reparsed.frontmatter).toEqual(fm);
    expect(reparsed.body).toBe(body);
  });

  it("parse les booléens et l'entier (started/abandoned/order/number)", () => {
    const raw = serializeEpicFile(
      { ...VALID, kind: "phase", number: 2, started: false, phase: "possibilité" },
      "\n# X\n",
    );
    const { frontmatter } = parseEpicFile(raw);
    expect(frontmatter.started).toBe(false);
    expect(frontmatter.number).toBe(2);
    expect(typeof frontmatter.order).toBe("number");
  });
});

describe("E2 — abandoned exclut started", () => {
  it("refuse abandoned:true + started:true (état terminal incohérent)", () => {
    const res = validateEpic({ ...VALID, abandoned: true, started: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join("\n")).toMatch(/abandoned/i);
  });

  it("accepte abandoned:true seul (started:false)", () => {
    expect(validateEpic({ ...VALID, abandoned: true, started: false }).ok).toBe(true);
  });
});

describe("E10 — epics.json déterministe", () => {
  const src = (over: Partial<EpicFrontmatter> & { file: string }) => ({
    frontmatter: { ...VALID, ...over } as EpicFrontmatter,
    file: over.file,
  });

  it("trie par order croissant puis id, newline final", () => {
    const snap = buildEpicsSnapshot([
      src({ id: "COMBO", order: 60, file: "specs/epics/combo.md" }),
      src({ id: "PHASE-1", order: 10, file: "specs/epics/phase-1.md" }),
      src({ id: "ANALYTICS", order: 60, file: "specs/epics/analytics.md" }),
    ]);
    expect(snap.epics.map((e) => e.id)).toEqual(["PHASE-1", "ANALYTICS", "COMBO"]);
    const json = serializeEpicsSnapshot(snap);
    expect(json.endsWith("\n")).toBe(true);
  });

  it("normalise les backslashes Windows en slashs", () => {
    const snap = buildEpicsSnapshot([
      { frontmatter: VALID, file: "specs\\epics\\backlog-as-data.md" },
    ]);
    expect(snap.epics[0]!.file).toBe("specs/epics/backlog-as-data.md");
  });

  it("sérialisation stable (deux builds du même input → bytes identiques)", () => {
    const input = [
      src({ id: "BRAWL", order: 90, file: "specs/epics/brawl.md" }),
      src({ id: "PRICING", order: 50, file: "specs/epics/pricing.md" }),
    ];
    expect(serializeEpicsSnapshot(buildEpicsSnapshot(input))).toBe(
      serializeEpicsSnapshot(buildEpicsSnapshot(input)),
    );
  });
});
