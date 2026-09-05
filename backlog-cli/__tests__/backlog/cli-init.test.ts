import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { runBacklogCommand } from "@/lib/backlog/cli";

// INFRA-14 — Commandes d'adoption + lecture sans board (init/list/render-md/help/
// self-update), tolérance no-op et surface unifiée du hook. Effets fs bornés sous
// un répertoire temp ; aucune dépendance node_modules (cœur pur fs).

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

describe("backlog init (N1)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "backlog-init-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("N1 — init crée .gitattributes + backlog.json vide et imprime la cheatsheet", async () => {
    const r = await runBacklogCommand(["init"], { root });
    expect(r.code).toBe(0);

    const ga = await readFile(path.join(root, ".gitattributes"), "utf8");
    expect(ga).toContain("backlog.json text eol=lf");

    const snap = JSON.parse(await readFile(path.join(root, "backlog.json"), "utf8"));
    expect(snap.tickets).toEqual([]);

    // cheatsheet imprimée → commandes clés visibles
    for (const cmd of ["new", "mature", "list"]) expect(r.stdout).toContain(cmd);
  });

  it("N1b — init n'écrase pas un .gitattributes existant et ne duplique pas la ligne", async () => {
    await writeFile(path.join(root, ".gitattributes"), "*.png binary\n", "utf8");
    await runBacklogCommand(["init"], { root });
    let ga = await readFile(path.join(root, ".gitattributes"), "utf8");
    expect(ga).toContain("*.png binary");
    expect(ga).toContain("backlog.json text eol=lf");

    // re-init : pas de doublon de la ligne backlog.json
    await runBacklogCommand(["init"], { root });
    ga = await readFile(path.join(root, ".gitattributes"), "utf8");
    expect(ga.match(/backlog\.json text eol=lf/g)?.length).toBe(1);
  });

  it("N1 — après init, new enchaîne (projet enabled)", async () => {
    await runBacklogCommand(["init"], { root });
    const r = await runBacklogCommand(["new", "FOO-01", "--epic", "e"], { root });
    expect(r.code).toBe(0);
    expect(await exists(path.join(root, "specs", "foo-01.md"))).toBe(true);
  });

  it("N1c — init --with-test dépose une garde de cohérence (contenu, pas un stub)", async () => {
    const r = await runBacklogCommand(["init", "--with-test"], { root });
    expect(r.code).toBe(0);
    const check = await readFile(path.join(root, "backlog-check.mjs"), "utf8");
    expect(check).toContain("--porcelain"); // c'est bien la garde git
    expect(check).toContain("snapshot");
  });

  it("BLG-02 — le script généré garde existsSync + exit 0 avant execFileSync du bundle", async () => {
    await runBacklogCommand(["init", "--with-test"], { root });
    const check = await readFile(path.join(root, "backlog-check.mjs"), "utf8");
    expect(check).toContain("existsSync");
    expect(check).toContain("process.exit(0)");
    // la garde doit précéder le premier execFileSync (bundle absent → skip avant tout appel)
    const guardIdx = check.indexOf("existsSync(tool)");
    const execIdx = check.indexOf("execFileSync(\"node\"");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(execIdx);
    // non-régression : le bundle présent, on invoque toujours snapshot
    expect(check).toMatch(/execFileSync\("node", \[tool, "snapshot"\]/);
  });

  it("BLG-02 — bundle absent : le script sort proprement (exit 0, pas de throw)", async () => {
    await runBacklogCommand(["init", "--with-test"], { root });
    const checkPath = path.join(root, "backlog-check.mjs");
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn(process.execPath, [checkPath], {
          cwd: root,
          env: {
            ...process.env,
            HOME: path.join(root, "no-such-home"),
            USERPROFILE: path.join(root, "no-such-home"),
          },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("sautée");
  });
});

describe("tolérance no-op (N6)", () => {
  let root: string;
  beforeEach(async () => {
    // répertoire vierge : NI specs/ NI backlog.json → non backlog-enabled
    root = await mkdtemp(path.join(os.tmpdir(), "backlog-noop-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  for (const argv of [["list"], ["new", "X-01"], ["snapshot"]]) {
    it(`N6 — ${argv[0]} dans un projet non-enabled → exit 0 no-op, rien créé`, async () => {
      const r = await runBacklogCommand(argv, { root });
      expect(r.code).toBe(0);
      expect(`${r.stdout}${r.stderr}`).toMatch(/init/i);
      expect(await exists(path.join(root, "backlog.json"))).toBe(false);
      expect(await exists(path.join(root, "specs"))).toBe(false);
    });
  }

  it("N6 — hook dans un projet non-enabled → exit 0 no-op", async () => {
    const r = await runBacklogCommand(["hook", "merge"], { root });
    expect(r.code).toBe(0);
  });

  it("N6 — help marche partout (universel)", async () => {
    const r = await runBacklogCommand(["help"], { root });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("new");
  });
});

describe("list / render-md / help (N2, N3, N7)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "backlog-list-"));
    await mkdir(path.join(root, "specs"), { recursive: true });
    await runBacklogCommand(["new", "AAA-01", "--epic", "e"], { root }); // maturing
    await runBacklogCommand(["new", "BBB-02", "--epic", "e"], { root });
    await runBacklogCommand(["set", "BBB-02", "status=parked"], { root });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("N2 — list groupe par statut dans l'ordre d'affichage", async () => {
    const r = await runBacklogCommand(["list"], { root });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("AAA-01");
    expect(r.stdout).toContain("BBB-02");
    // À maturer (maturing) avant Parked dans STATUS_DISPLAY_ORDER
    expect(r.stdout.indexOf("AAA-01")).toBeLessThan(r.stdout.indexOf("BBB-02"));
  });

  it("N3 — help liste les commandes", async () => {
    const r = await runBacklogCommand(["help"], { root });
    expect(r.code).toBe(0);
    for (const cmd of ["new", "set", "mature", "snapshot", "init", "list", "epic"]) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it("N7 — render-md régénère specs/backlog.md avec sentinel", async () => {
    const r = await runBacklogCommand(["render-md"], { root });
    expect(r.code).toBe(0);
    const md = await readFile(path.join(root, "specs", "backlog.md"), "utf8");
    expect(md).toContain("INFRA-10"); // sentinel référence INFRA-10
    expect(md).toContain("AAA-01");
  });
});

// self-update (N8 + BLG-04) — déplacé dans self-update-cli.test.ts, cf. celui-ci.

describe("hook via surface unifiée (N9)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "backlog-hookcmd-"));
    await mkdir(path.join(root, "specs"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("N9 — hook ship applique merged → shipped", async () => {
    await runBacklogCommand(["new", "ZZZ-01", "--epic", "e"], { root });
    await runBacklogCommand(
      [
        "mature",
        "ZZZ-01",
        "--model",
        "opus",
        "--effort",
        "think",
        "--review",
        "light",
        "--date",
        "2026-06-12",
      ],
      { root },
    );
    await runBacklogCommand(["set", "ZZZ-01", "status=merged"], { root });

    const r = await runBacklogCommand(["hook", "ship"], { root });
    expect(r.code).toBe(0);

    const snap = JSON.parse(await readFile(path.join(root, "backlog.json"), "utf8"));
    expect(snap.tickets.find((t: { id: string }) => t.id === "ZZZ-01").status).toBe(
      "shipped",
    );
  });
});
