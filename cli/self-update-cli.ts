import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { ok, err, parseFlags, pathExists, type CliResult, type FlagSpec } from "./cli";
import { ADOPTION_README } from "./adoption-readme";
import { buildSelfUpdateReport, type SelfUpdateGitState } from "./self-update-report";

// BLG-04 (finding 6, reprise) — extrait de cli.ts (déjà à 945 lignes sur main,
// au-dessus du seuil de 800 posé par le CLAUDE.md global) pour ne pas l'y faire
// grossir davantage. Import paresseux depuis cli.ts (même précédent que
// epic-cli.ts/ticket-brief.ts : évite le cycle de chargement cli ↔ self-update-cli).

/**
 * Réinstalle le bundle dans `~/.claude/tools/backlog/` + y écrit le README global.
 * Source = le `.mjs` en cours d'exécution (`opts.selfPath` = `process.argv[1]`,
 * surchargeable `--source`) ; `--dest` cible un autre dossier (tests). Refuse une
 * source non-`.mjs` (garde anti-`self-update` depuis tsx en dev — copierait du TS).
 */
const SELF_UPDATE_FLAGS: FlagSpec = { source: "value", dest: "value" };

/**
 * BLG-04 (D3/D4) — état git de `destDir`, ENVELOPPÉ : `destDir` hors dépôt,
 * `git` absent, ou tout échec de l'appel → `null`, jamais une exception qui
 * ferait échouer l'installation. Deux appels git en lecture seule : la racine
 * du dépôt (pour rapprocher les chemins écrits, cf. self-update-report.ts) puis
 * son `status --porcelain` NON scopé (le filtrage sur les chemins écrits est le
 * rôle du cœur pur, pas de cet appel).
 */
function detectGitState(destDir: string): SelfUpdateGitState | null {
  try {
    const repoRoot = execFileSync("git", ["-C", destDir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!repoRoot) return null;
    // `-uall` : liste les fichiers un par un même dans un dossier NEUF entièrement
    // non suivi (sinon git condense en une seule ligne `?? tools/backlog/`, que le
    // rapprochement par fichier écrit ne peut jamais matcher — cas réel : la toute
    // première installation dans un dossier qui n'existait pas encore).
    const porcelain = execFileSync(
      "git",
      ["-C", repoRoot, "status", "--porcelain", "-uall"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return { repoRoot, porcelain };
  } catch {
    return null;
  }
}

export async function cmdSelfUpdate(
  args: string[],
  opts: { selfPath?: string },
): Promise<CliResult> {
  // INFRA-33 — le cas « `--source`/`--dest` passé sans valeur » (qui installait le
  // bundle dans `./true/`) est désormais refusé par parseFlags, plus ici au cas par cas.
  const parsed = parseFlags(args, SELF_UPDATE_FLAGS);
  if (!parsed.ok) return err(parsed.error);
  const { flags } = parsed.value;
  const source = flags.source ?? opts.selfPath;
  if (!source) {
    return err("self-update : aucune source — lance depuis le bundle .mjs ou passe --source <file>.");
  }
  if (!source.endsWith(".mjs")) {
    return err(`self-update : source non-.mjs (${source}) — attendu le bundle backlog.mjs.`);
  }
  if (!(await pathExists(source))) {
    return err(`self-update : source introuvable (${source}).`);
  }
  const destDir = flags.dest ?? path.join(os.homedir(), ".claude", "tools", "backlog");
  await fs.mkdir(destDir, { recursive: true });
  const destBundle = path.join(destDir, "backlog.mjs");
  // Copie sautée si la source EST déjà la cible (réinstall depuis le global lui-même).
  if (path.resolve(source) !== path.resolve(destBundle)) {
    await fs.copyFile(source, destBundle);
  }
  const destReadme = path.join(destDir, "README.md");
  await fs.writeFile(destReadme, ADOPTION_README, "utf8");

  // D1 — le message de succès reste inchangé sur stdout, quel que soit le signal.
  const stdout = `bundle installé → ${destBundle}\nguide → ${destReadme}`;
  // D2/D3 — le signal « dépôt sali » vient s'ajouter sur stderr, avec un code ≠ 0
  // (3) distinct de err() (1 = rien n'a été écrit). Cœur pur, état git injecté.
  const report = buildSelfUpdateReport([destBundle, destReadme], detectGitState(destDir));
  if (report.code === 0) return ok(stdout);
  return { code: report.code, stdout, stderr: report.message };
}
