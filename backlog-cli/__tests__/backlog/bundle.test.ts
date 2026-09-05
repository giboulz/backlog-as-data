import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildBundle } from "../../scripts/build-backlog.mjs";

// INFRA-14 (N4-N5) — Le bundle est le LIVRABLE d'adoption : il doit tourner en
// `node` nu (aucun node_modules dans le projet cible) et n'embarquer que des
// built-ins node (zod inliné). On build vers un temp, puis on l'exécute dans un
// répertoire projet vierge — exactement la condition d'un nouveau projet.

let bundlePath: string;
let outDir: string;

beforeAll(async () => {
  outDir = await mkdtemp(path.join(os.tmpdir(), "backlog-bundle-"));
  bundlePath = await buildBundle({ outfile: path.join(outDir, "backlog.mjs") });
}, 60_000);

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

const run = (cwd: string, ...args: string[]): { code: number; out: string } => {
  try {
    const out = execFileSync("node", [bundlePath, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
};

describe("bundle backlog.mjs", () => {
  it("N4 — tourne en node nu : init → new → snapshot → list", async () => {
    const proj = await mkdtemp(path.join(os.tmpdir(), "backlog-proj-"));
    try {
      expect(run(proj, "init").code).toBe(0);
      expect(run(proj, "new", "DEMO-01", "--epic", "e").code).toBe(0);
      expect(run(proj, "snapshot").code).toBe(0);
      const list = run(proj, "list");
      expect(list.code).toBe(0);
      expect(list.out).toContain("DEMO-01");

      const snap = JSON.parse(await readFile(path.join(proj, "backlog.json"), "utf8"));
      expect(snap.tickets.find((t: { id: string }) => t.id === "DEMO-01")).toBeTruthy();
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });

  it("N5 — auto-suffisant : aucun import/require hors built-ins node:", async () => {
    const code = await readFile(bundlePath, "utf8");
    expect(code).not.toMatch(/from\s+["']zod["']/);
    expect(code).not.toMatch(/require\(\s*["']zod["']\s*\)/);

    // tout specifier d'import/require résiduel doit être un built-in `node:`
    const specifiers: string[] = [];
    for (const m of code.matchAll(/(?:import\s[^"']*from|export\s[^"']*from)\s*["']([^"']+)["']/g)) {
      specifiers.push(m[1]!);
    }
    for (const m of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
      specifiers.push(m[1]!);
    }
    const external = specifiers.filter((s) => !s.startsWith("node:"));
    expect(external).toEqual([]);
  });
});
