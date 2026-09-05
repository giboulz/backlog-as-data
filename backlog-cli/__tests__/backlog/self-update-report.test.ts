import { describe, it, expect } from "vitest";
import path from "node:path";
import { buildSelfUpdateReport } from "@/lib/backlog/self-update-report";

// BLG-04 — Cœur pur du signal « dépôt sali » de `self-update` (D1-D5). Aucun
// tmpdir, aucun dépôt git : `gitState` est injecté sur des chaînes littérales,
// précédent `runBacklogHook`/`planTransitions` (hook.ts).

const repoRoot = path.join("home", "user", ".claude");
const destDir = path.join(repoRoot, "tools", "backlog");
const writtenPaths = [
  path.join(destDir, "backlog.mjs"),
  path.join(destDir, "README.md"),
];

describe("buildSelfUpdateReport", () => {
  it("les deux fichiers sales → code 3, message nommant le dépôt et les deux chemins, commande de commit exécutable", () => {
    const porcelain = " M tools/backlog/README.md\n M tools/backlog/backlog.mjs";
    const r = buildSelfUpdateReport(writtenPaths, { repoRoot, porcelain });
    expect(r.code).toBe(3);
    expect(r.message).toContain(repoRoot);
    expect(r.message).toContain("tools/backlog/README.md");
    expect(r.message).toContain("tools/backlog/backlog.mjs");
    // Commande exécutable telle quelle : porte le chemin du dépôt ET les deux
    // chemins relatifs — pas juste une formulation type « pense à commiter ».
    // Finding 1 (reprise) — DEUX commandes AUTONOMES, jamais chaînées par « && » :
    // cet opérateur n'existe pas dans Windows PowerShell 5.1 (shell par défaut
    // d'une partie des postes), où la ligne enchaînée est un pur parse error.
    const gitLines = r.message.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("git "));
    expect(gitLines).toHaveLength(2);
    for (const line of gitLines) expect(line).not.toContain("&&");
    expect(gitLines.join("\n")).toContain(repoRoot);
    expect(gitLines.join("\n")).toContain("tools/backlog/README.md");
    expect(gitLines.join("\n")).toContain("tools/backlog/backlog.mjs");
    // Finding 3 (reprise) — le commit est SCOPÉ aux fichiers écrits (pathspec
    // après `-m`), jamais un commit nu qui embarquerait tout l'index (dangereux
    // sur le checkout live par défaut, `~/.claude`).
    const commitLine = gitLines.find((l) => l.includes("commit"))!;
    expect(commitLine).toContain(" -- ");
    expect(commitLine).toContain("tools/backlog/README.md");
    expect(commitLine).toContain("tools/backlog/backlog.mjs");
  });

  it("un seul des deux sale (README bougé seul, BLG-07) → code 3, un seul chemin listé", () => {
    const porcelain = " M tools/backlog/README.md";
    const r = buildSelfUpdateReport(writtenPaths, { repoRoot, porcelain });
    expect(r.code).toBe(3);
    expect(r.message).toContain("tools/backlog/README.md");
    expect(r.message).not.toContain("tools/backlog/backlog.mjs");
  });

  it("porcelain vide → code 0, message inchangé (D5)", () => {
    const r = buildSelfUpdateReport(writtenPaths, { repoRoot, porcelain: "" });
    expect(r.code).toBe(0);
    expect(r.message).toBe("");
  });

  it("porcelain non vide mais ne mentionnant aucun des deux fichiers écrits → code 0", () => {
    // claude-config a en permanence de l'état live non versionné (settings.json,
    // scheduled-tasks/) — filtrer sur les chemins ÉCRITS, pas sur « le dépôt est sale ».
    const porcelain = " M settings.json\n?? scheduled-tasks/foo.json";
    const r = buildSelfUpdateReport(writtenPaths, { repoRoot, porcelain });
    expect(r.code).toBe(0);
    expect(r.message).toBe("");
  });

  it("gitState null (D4 — hors dépôt / git absent / appel raté) → code 0, message inchangé", () => {
    const r = buildSelfUpdateReport(writtenPaths, null);
    expect(r.code).toBe(0);
    expect(r.message).toBe("");
  });

  it("chemins du porcelain relatifs à la racine du dépôt, pas à destDir : rapprochement correct", () => {
    // Mutation-témoin : comparer bêtement à basename accepterait un README.md
    // sali n'importe où dans le dépôt — ici un AUTRE README.md, ailleurs dans
    // le dépôt, ne doit PAS déclencher le signal.
    const porcelain = " M some/other/place/README.md";
    const r = buildSelfUpdateReport(writtenPaths, { repoRoot, porcelain });
    expect(r.code).toBe(0);
    expect(r.message).toBe("");
  });
});
