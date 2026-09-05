import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { runBacklogCommand } from "@/lib/backlog/cli";

// INFRA-14 (N8) — self-update (bundle + guide dans ~/.claude/tools/backlog/).
// BLG-04 (finding 2 + 6, reprise) — vivait dans cli-init.test.ts ; déplacé ici
// pour correspondre au fichier qui les câble réellement,
// lib/backlog/self-update-cli.ts (règle du dépôt : un fichier neuf de lib/ a
// son __tests__/**/*.test.ts correspondant dans le MÊME commit).

describe("self-update (N8)", () => {
  let root: string;
  let dest: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "backlog-su-src-"));
    dest = await mkdtemp(path.join(os.tmpdir(), "backlog-su-dst-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  });

  it("N8 — self-update copie le .mjs + écrit README.md", async () => {
    const src = path.join(root, "backlog.mjs");
    await writeFile(src, "// fake bundle\n", "utf8");
    const r = await runBacklogCommand(
      ["self-update", "--source", src, "--dest", dest],
      { root },
    );
    expect(r.code).toBe(0);
    expect(await readFile(path.join(dest, "backlog.mjs"), "utf8")).toContain("fake bundle");
    const readme = await readFile(path.join(dest, "README.md"), "utf8");
    // c'est bien le vrai guide d'adoption (ADOPTION_README), pas n'importe quel
    // texte contenant « backlog » : emplacement global + commande self-update.
    expect(readme).toContain(".claude/tools/backlog");
    expect(readme).toContain("self-update");
  });

  it("N8 — self-update refuse une source non-.mjs", async () => {
    const src = path.join(root, "backlog.ts");
    await writeFile(src, "// not a bundle\n", "utf8");
    const r = await runBacklogCommand(
      ["self-update", "--source", src, "--dest", dest],
      { root },
    );
    expect(r.code).not.toBe(0);
  });

  it("N8 — self-update refuse --dest sans valeur (n'installe pas dans ./true/)", async () => {
    const src = path.join(root, "backlog.mjs");
    await writeFile(src, "// fake bundle\n", "utf8");
    // `--dest` en dernier, sans valeur → INFRA-33 : parseFlags refuse en amont
    // (avant, il renvoyait "true" et le bundle s'installait dans ./true/).
    const r = await runBacklogCommand(["self-update", "--source", src, "--dest"], { root });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("--dest attend une valeur");
  });

  // BLG-04 (D4) — `dest` n'est PAS un dépôt git : détection impossible, enveloppée,
  // n'affecte ni le code ni stdout. C'est le cas que la suite existante (N8, ci-dessus)
  // exerce déjà sans le vérifier explicitement sur stderr — on le verrouille ici.
  it("BLG-04 — dest hors dépôt git → exit 0, stderr vide (D4)", async () => {
    const src = path.join(root, "backlog.mjs");
    await writeFile(src, "// fake bundle\n", "utf8");
    const r = await runBacklogCommand(
      ["self-update", "--source", src, "--dest", dest],
      { root },
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("bundle installé");
  });
});

// BLG-04 (D1-D2) — dest DANS un dépôt git réel : sanity du câblage, dépôt sali
// deux fois de suite pour dessiner le cas « le second self-update ne salit que le
// README (bundle inchangé) », précédent explicite du § Tests (BLG-07).
describe("self-update — dépôt sali (BLG-04)", () => {
  let src: string;
  let gitRoot: string;
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: gitRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

  beforeEach(async () => {
    src = await mkdtemp(path.join(os.tmpdir(), "backlog-su2-src-"));
    gitRoot = await mkdtemp(path.join(os.tmpdir(), "backlog-su2-git-"));
    git(["init", "-b", "main"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "t"]);
    await writeFile(path.join(gitRoot, "seed.txt"), "seed\n", "utf8");
    git(["add", "-A"]);
    git(["commit", "-m", "seed"]);
  });

  afterEach(async () => {
    await rm(src, { recursive: true, force: true });
    await rm(gitRoot, { recursive: true, force: true });
  });

  it("BLG-04 — écriture dans un dépôt git non commité → exit 3, commande de commit exécutable et scopée, stdout inchangé", async () => {
    const bundle = path.join(src, "backlog.mjs");
    await writeFile(bundle, "// fake bundle\n", "utf8");
    const destDir = path.join(gitRoot, "tools", "backlog");

    // Finding 3 (reprise) — travail en cours SANS RAPPORT, déjà staged, dans le
    // même dépôt (scénario réel : l'utilisateur committe dans `~/.claude`,
    // `git add commands/backlog.md`, PUIS lance `npm run backlog:install`). La
    // commande rendue ne doit JAMAIS l'embarquer.
    await writeFile(path.join(gitRoot, "unrelated.txt"), "en cours\n", "utf8");
    git(["add", "unrelated.txt"]);

    const r = await runBacklogCommand(
      ["self-update", "--source", bundle, "--dest", destDir],
      { root: src },
    );
    expect(r.code).toBe(3);
    // D1 — le message de succès sur stdout reste INCHANGÉ (même contenu que le
    // cas D4, ci-dessus) : le geste a réussi, et un consommateur de stdout ne
    // doit pas voir sa sortie muter.
    expect(r.stdout).toContain("bundle installé");
    expect(r.stdout).not.toContain("commit");
    // `git rev-parse --show-toplevel` rend des chemins à slashs AVANT (comportement
    // git normal, indépendant de l'OS) : normalise avant de comparer au gitRoot du test.
    expect(r.stderr).toContain(gitRoot.split(path.sep).join("/"));
    expect(r.stderr).toContain("tools/backlog/backlog.mjs");
    expect(r.stderr).toContain("tools/backlog/README.md");

    // Finding 1 (reprise) — DEUX commandes AUTONOMES sur deux lignes, jamais
    // chaînées par « && » (absent de Windows PowerShell 5.1, le shell par défaut
    // d'une partie des postes : la ligne enchaînée y serait un parse error). On
    // les exécute ligne par ligne, comme un utilisateur qui colle un bloc
    // multi-lignes dans SON terminal — quel qu'il soit, sans dépendre de « && ».
    const gitLines = r.stderr.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("git "));
    expect(gitLines).toHaveLength(2);
    // Tokenize à la main (pas de shell) : ces lignes sont volontairement
    // exécutées SANS passer par un interpréteur de shell, pour prouver
    // qu'elles ne dépendent d'aucun shell particulier — argument central du
    // finding 1 (reprise).
    const tokenize = (line: string): string[] =>
      (line.match(/"[^"]*"|\S+/g) ?? []).map((t) =>
        t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t,
      );
    for (const line of gitLines) {
      expect(line).not.toContain("&&");
      const [, ...gitArgs] = tokenize(line);
      execFileSync("git", gitArgs, { stdio: ["ignore", "pipe", "pipe"] });
    }

    // Les deux fichiers du bundle sont commités (plus dans le statut) ; seul le
    // fichier SANS RAPPORT, resté staged, y apparaît encore — preuve que la
    // commande n'a jamais touché à autre chose que les deux chemins écrits.
    const status = git(["status", "--porcelain"]);
    expect(status.trim()).toBe("A  unrelated.txt");
    // La commande de commit était SCOPÉE : le fichier sans rapport n'est pas
    // parti dans le commit du bundle (finding 3).
    const lastCommitFiles = git(["show", "--stat", "--format=", "HEAD"]);
    expect(lastCommitFiles).not.toContain("unrelated.txt");
    expect(git(["diff", "--cached", "--name-only"]).trim()).toBe("unrelated.txt");
  });

  it("BLG-04 — dépôt déjà propre après commit (rejouer self-update sans changement) → exit 0", async () => {
    const bundle = path.join(src, "backlog.mjs");
    await writeFile(bundle, "// fake bundle\n", "utf8");
    const destDir = path.join(gitRoot, "tools", "backlog");
    const first = await runBacklogCommand(
      ["self-update", "--source", bundle, "--dest", destDir],
      { root: src },
    );
    expect(first.code).toBe(3);
    git(["add", "-A"]);
    git(["commit", "-m", "install"]);

    // D5 — même contenu réinstallé : rien de nouveau à commiter, pas de signal.
    const second = await runBacklogCommand(
      ["self-update", "--source", bundle, "--dest", destDir],
      { root: src },
    );
    expect(second.code).toBe(0);
    expect(second.stderr).toBe("");
  });
});
