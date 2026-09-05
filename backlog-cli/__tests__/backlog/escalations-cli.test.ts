import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBacklogCommand } from "@/lib/backlog/cli";

// BLG-08 (finding #11, reprise) — vivait dans cli.test.ts ; déplacé ici pour
// correspondre au fichier qui câble réellement le verbe,
// lib/backlog/escalations-cli.ts (règle du dépôt : un fichier neuf de lib/ a
// son __tests__/**/*.test.ts correspondant dans le MÊME commit — parité
// self-update-cli.ts / self-update-cli.test.ts).

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "backlog-escalations-cli-"));
  await mkdir(path.join(root, "specs"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("backlog CLI — escalations (BLG-08)", () => {
  const specFile = (name: string) => path.join(root, "specs", name);

  // R1 — `escalations` atteint le module et rend une escalade ouverte.
  it("R1 — escalations liste une escalade ouverte", async () => {
    await writeFile(
      specFile("skill-90.md"),
      "---\nid: SKILL-90\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### E1 — un souci\nconstat…\n",
      "utf8",
    );
    const r = await runBacklogCommand(["escalations"], { root });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("SKILL-90");
    expect(r.stdout).toContain("skill-90.md");
  });

  // R2 — `escalations --all` inclut aussi les closes.
  it("R2 — escalations --all inclut les escalades closes", async () => {
    await writeFile(
      specFile("skill-91.md"),
      "---\nid: SKILL-91\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### E1 — un souci\nconstat…\n",
      "utf8",
    );
    await runBacklogCommand(
      ["escalations", "close", "SKILL-91", "--by", "SKILL-92", "--date", "2026-08-24"],
      { root },
    );
    const open = await runBacklogCommand(["escalations"], { root });
    expect(open.stdout).not.toContain("SKILL-91");

    const all = await runBacklogCommand(["escalations", "--all"], { root });
    expect(all.code).toBe(0);
    expect(all.stdout).toContain("SKILL-91");
    expect(all.stdout).toContain("SKILL-92");
  });

  // R3 — `escalations close … --by …` atteint le module et rend un code de sortie.
  it("R3 — escalations close écrit le marqueur et rend code 0", async () => {
    await writeFile(
      specFile("skill-93.md"),
      "---\nid: SKILL-93\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### E1 — un souci\nconstat…\n",
      "utf8",
    );
    const r = await runBacklogCommand(
      ["escalations", "close", "SKILL-93", "--by", "SKILL-94", "--date", "2026-08-24"],
      { root },
    );
    expect(r.code).toBe(0);
    const raw = await readFile(specFile("skill-93.md"), "utf8");
    expect(raw).toContain("→ Traitée par SKILL-94 (2026-08-24).");
  });

  // R4 — close sans --date échoue (la date n'est jamais inventée).
  it("R4 — escalations close sans --date échoue", async () => {
    await writeFile(
      specFile("skill-95.md"),
      "---\nid: SKILL-95\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### E1 — un souci\nconstat…\n",
      "utf8",
    );
    const r = await runBacklogCommand(
      ["escalations", "close", "SKILL-95", "--by", "SKILL-96"],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/--date/);
  });

  // R5 — le verbe apparaît dans `help`.
  it("R5 — escalations apparaît dans help", async () => {
    const r = await runBacklogCommand(["help"], { root });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("escalations");
  });

  // R6 (finding #4) — un positionnel superflu sur `escalations` (forme naturelle
  // « je veux filtrer sur ce ticket ») est REFUSÉ, jamais absorbé en silence.
  it("R6 — escalations SKILL-X (positionnel superflu) échoue", async () => {
    const r = await runBacklogCommand(["escalations", "SKILL-46"], { root });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/positionnel/);
  });

  // R7 (finding #4) — même garde sur `close` : un tag tapé en positionnel (sans
  // son drapeau --which) est refusé au lieu d'être jeté.
  it("R7 — escalations close <ID> <tag superflu> --by … --date … échoue", async () => {
    await writeFile(
      specFile("skill-79.md"),
      "---\nid: SKILL-79\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### E1 — première\nc\n\n### E3 — deuxième\nc\n",
      "utf8",
    );
    const r = await runBacklogCommand(
      ["escalations", "close", "SKILL-79", "E3", "--by", "SKILL-80", "--date", "2026-08-24"],
      { root },
    );
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/positionnel/);
  });

  // Test 8 (spec BLG-11) — l'avertissement D2 va sur stderr, stdout ne contient
  // que la liste des escalades, et le code de retour reste 0 (D3).
  it("test 8 — l'avertissement D2 va sur stderr, stdout inchangé, code 0", async () => {
    await writeFile(
      specFile("skill-56.md"),
      "---\nid: SKILL-56\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### Finding 2 de la gate — E1\nconstat…\n",
      "utf8",
    );
    const r = await runBacklogCommand(["escalations"], { root });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("skill-56.md");
    expect(r.stderr).toContain("Finding 2 de la gate — E1");
    expect(r.stdout).not.toContain("Finding 2 de la gate — E1");
    expect(r.stdout).toBe("aucune escalade ouverte.");
  });

  // Test 9 (spec BLG-11) — même comportement d'avertissement avec --all.
  it("test 9 — --all rend le même avertissement", async () => {
    await writeFile(
      specFile("skill-56.md"),
      "---\nid: SKILL-56\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### Finding 2 de la gate — E1\nconstat…\n",
      "utf8",
    );
    const r = await runBacklogCommand(["escalations", "--all"], { root });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("skill-56.md");
    expect(r.stderr).toContain("Finding 2 de la gate — E1");
  });

  // Test 7 (spec BLG-11, repris côté câblage — finding #2) — deux touches
  // dans deux fichiers → 2 lignes de stderr, dans un ordre déterministe
  // (byCodeUnit sur ticketId). Exerce directement `formatWarnings` avec plus
  // d'une entrée : un `sortByTicketFileLine` retiré côté CLI ferait rougir
  // CE test (contrairement aux tests 8/9, à une seule touche).
  it("test 7 — deux avertissements sur stderr, dans l'ordre déterministe par ticketId", async () => {
    await writeFile(
      specFile("skill-99.md"),
      "---\nid: SKILL-99\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### Finding — E1\nc\n",
      "utf8",
    );
    await writeFile(
      specFile("skill-56.md"),
      "---\nid: SKILL-56\ntype: ticket\nstatus: shipped\n---\n\n## Escalades (D10)\n\n### Finding 2 de la gate — E1\nconstat…\n",
      "utf8",
    );
    const r = await runBacklogCommand(["escalations"], { root });
    expect(r.code).toBe(0);
    const stderrLines = r.stderr.split("\n");
    expect(stderrLines).toHaveLength(2);
    expect(stderrLines[0]).toContain("skill-56.md");
    expect(stderrLines[1]).toContain("skill-99.md");
  });
});
