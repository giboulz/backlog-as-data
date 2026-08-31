import path from "node:path";

// BLG-04 — Cœur PUR du signal « dépôt sali » de `self-update` (D1-D5). Aucune
// I/O, aucun `git` : l'état git (racine du dépôt + `git status --porcelain`) est
// INJECTÉ par l'appelant (cli.ts) — même précédent que `runBacklogHook`
// (hook.ts) : `mainIds` y est dérivé de git par l'appelant, cette fonction-ci
// n'y touche pas, donc reste exerçable contre des chaînes littérales.

export interface SelfUpdateGitState {
  /** Racine du dépôt git contenant les fichiers écrits (`git rev-parse --show-toplevel`). */
  repoRoot: string;
  /**
   * Sortie brute de `git status --porcelain`, lancée à la racine du dépôt,
   * NON scopée aux fichiers écrits : le dépôt peut porter d'autre état vivant
   * non lié (ex. `settings.json`, `scheduled-tasks/` de `claude-config`) — le
   * filtrage sur les chemins écrits se fait ici, pas côté appelant.
   */
  porcelain: string;
}

export interface SelfUpdateReport {
  /** Vide si rien à signaler (D4/D5) ; sinon le bloc à ajouter sur stderr. */
  message: string;
  /** 0 = rien à signaler ; 3 = au moins un des fichiers écrits est sale. */
  code: number;
}

const CLEAN: SelfUpdateReport = { message: "", code: 0 };

/** Chemin d'une ligne `git status --porcelain` : format `XY path` (chemin dès l'index 3). */
function porcelainPath(line: string): string | null {
  if (line.length < 4) return null;
  const p = line.slice(3).trim();
  return p || null;
}

/**
 * BLG-04 (D1-D5) — signal « dépôt sali » après un `self-update` qui a réussi à
 * écrire `writtenPaths`.
 *
 * `gitState` `null` (D4 — `destDir` hors dépôt git, `git` absent, ou appel
 * ayant échoué pour quelque raison que ce soit) → silence, code 0. Un
 * `porcelain` vide, ou ne mentionnant aucun des `writtenPaths`, rend aussi le
 * silence (D5) : le signal ne se déclenche QUE sur une divergence réelle
 * touchant les fichiers que `self-update` vient d'écrire — jamais sur « le
 * dépôt est sale » en général (l'état live non versionné d'un dépôt comme
 * `claude-config` ne doit pas crier à chaque install).
 *
 * Les chemins du porcelain sont relatifs à la RACINE DU DÉPÔT : `writtenPaths`
 * (absolus) sont rapprochés de `repoRoot`, jamais comparés par `basename`.
 */
export function buildSelfUpdateReport(
  writtenPaths: string[],
  gitState: SelfUpdateGitState | null,
): SelfUpdateReport {
  if (!gitState) return CLEAN;
  const { repoRoot, porcelain } = gitState;

  const dirtyRel = new Set(
    porcelain
      .split(/\r?\n/)
      .map(porcelainPath)
      .filter((p): p is string => p !== null),
  );

  const writtenRel = writtenPaths.map((p) =>
    path.relative(repoRoot, p).split(path.sep).join("/"),
  );
  const dirty = writtenRel.filter((rel) => dirtyRel.has(rel));
  if (dirty.length === 0) return CLEAN;

  const quoted = dirty.map((p) => `"${p}"`).join(" ");
  const message = [
    `⚠ self-update a modifié un dépôt git, pas encore commité : ${repoRoot}`,
    `  fichier(s) sali(s) : ${dirty.join(", ")}`,
    `  pour committer (deux commandes AUTONOMES, à lancer l'une après l'autre — pas`,
    `  de « && » : absent de PowerShell 5.1, le shell par défaut d'une partie des`,
    `  postes) :`,
    `    git -C "${repoRoot}" add ${quoted}`,
    `    git -C "${repoRoot}" commit -m "chore(backlog): self-update bundle" -- ${quoted}`,
  ].join("\n");
  return { message, code: 3 };
}
