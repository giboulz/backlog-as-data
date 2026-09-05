import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  planTransitions,
  type HookTicket,
} from "@/lib/backlog/hook";
import { runBacklogHook, runBacklogCommand } from "@/lib/backlog/cli";
import { parseTicketFile } from "@/lib/backlog/ticket-frontmatter";

// INFRA-11 — Cœur pur `planTransitions` (K1-K6) + intégration `runBacklogHook` (K7).

const t = (id: string, status: HookTicket["status"]): HookTicket => ({ id, status });

describe("planTransitions (cœur pur)", () => {
  // K1 — start id sur un ticket todo → todo → wip.
  it("K1 — start sur un todo planifie todo → wip", () => {
    const tickets = [t("INFRA-11", "todo"), t("INFRA-09", "shipped")];
    expect(planTransitions("start", { tickets, id: "INFRA-11" })).toEqual([
      { id: "INFRA-11", from: "todo", to: "wip" },
    ]);
  });

  // K2 — start id sur un ticket non-todo (ex. wip) → [] (skip).
  it("K2 — start sur un non-todo ne planifie rien", () => {
    const tickets = [t("INFRA-11", "wip")];
    expect(planTransitions("start", { tickets, id: "INFRA-11" })).toEqual([]);
  });

  // K3 — merge : un wip ∈ mainIds → merged ; un wip hors mainIds → inchangé.
  it("K3 — merge ne promeut que les wip présents dans mainIds", () => {
    const tickets = [t("INFRA-11", "wip"), t("INFRA-12", "wip"), t("INFRA-09", "todo")];
    expect(
      planTransitions("merge", { tickets, mainIds: ["INFRA-11", "INFRA-09"] }),
    ).toEqual([{ id: "INFRA-11", from: "wip", to: "merged" }]);
  });

  // K4 — ship : tout merged → shipped ; les autres statuts inchangés.
  it("K4 — ship promeut tous les merged", () => {
    const tickets = [
      t("INFRA-11", "merged"),
      t("INFRA-12", "merged"),
      t("INFRA-09", "todo"),
      t("INFRA-08", "shipped"),
    ];
    expect(planTransitions("ship", { tickets })).toEqual([
      { id: "INFRA-11", from: "merged", to: "shipped" },
      { id: "INFRA-12", from: "merged", to: "shipped" },
    ]);
  });

  // K5 — no-op legacy : un id absent de tickets → aucune transition, pas d'erreur.
  it("K5 — un id absent ne produit aucune transition (legacy no-op)", () => {
    const tickets = [t("INFRA-11", "todo")];
    // start sur un id inconnu
    expect(planTransitions("start", { tickets, id: "LEGACY-99" })).toEqual([]);
    // merge avec un mainId qui ne matche aucun ticket
    expect(planTransitions("merge", { tickets, mainIds: ["LEGACY-99"] })).toEqual([]);
  });

  // K6 — idempotence : re-jouer le même event sur l'état résultant → [].
  it("K6 — re-jouer l'event sur l'état déjà transité ne planifie rien", () => {
    // start : après todo → wip, re-start sur wip → []
    const afterStart = [t("INFRA-11", "wip")];
    expect(planTransitions("start", { tickets: afterStart, id: "INFRA-11" })).toEqual([]);
    // merge : après wip → merged, re-merge sur merged → []
    const afterMerge = [t("INFRA-11", "merged")];
    expect(
      planTransitions("merge", { tickets: afterMerge, mainIds: ["INFRA-11"] }),
    ).toEqual([]);
    // ship : après merged → shipped, re-ship sur shipped → []
    const afterShip = [t("INFRA-11", "shipped")];
    expect(planTransitions("ship", { tickets: afterShip })).toEqual([]);
  });
});

describe("runBacklogHook (intégration CLI)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "backlog-hook-"));
    await mkdir(path.join(root, "specs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // K7 — ship applique réellement merged → shipped via le CLI et régénère backlog.json.
  it("K7 — runBacklogHook ship applique merged → shipped", async () => {
    await runBacklogCommand(["new", "INFRA-77", "--epic", "backlog-as-data"], { root });
    await runBacklogCommand(
      [
        "mature",
        "INFRA-77",
        "--model",
        "opus",
        "--effort",
        "think",
        "--review",
        "light",
        "--date",
        "2026-06-08",
      ],
      { root },
    );
    await runBacklogCommand(["set", "INFRA-77", "status=merged"], { root });

    const res = await runBacklogHook("ship", { root });

    expect(res.warnings).toEqual([]);
    expect(res.applied).toEqual([{ id: "INFRA-77", from: "merged", to: "shipped" }]);

    const fm = parseTicketFile(
      await readFile(path.join(root, "specs", "infra-77.md"), "utf8"),
    ).frontmatter;
    expect(fm.status).toBe("shipped");

    const snap = JSON.parse(await readFile(path.join(root, "backlog.json"), "utf8"));
    expect(
      snap.tickets.find((x: { id: string }) => x.id === "INFRA-77").status,
    ).toBe("shipped");
  });

  // K7b — événement sur un id présent mais pas dans le bon statut → warn ciblé, aucune mutation.
  it("K7b — start sur un ticket pas-todo n'applique rien et warn", async () => {
    await runBacklogCommand(["new", "INFRA-77", "--epic", "e"], { root }); // maturing

    const res = await runBacklogHook("start", { root, id: "INFRA-77" });

    expect(res.applied).toEqual([]);
    expect(res.warnings.join(" ")).toMatch(/INFRA-77/);
    const fm = parseTicketFile(
      await readFile(path.join(root, "specs", "infra-77.md"), "utf8"),
    ).frontmatter;
    expect(fm.status).toBe("maturing");
  });
});
