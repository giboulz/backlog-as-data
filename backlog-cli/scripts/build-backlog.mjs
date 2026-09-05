import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// INFRA-14 — Bundle le CLI backlog en un SEUL `backlog.mjs` self-contained : zod
// inliné, aucune dépendance runtime hors built-ins `node:`. Entrée =
// `scripts/backlog.ts` ; toutes les commandes (y compris `hook`) passent par
// `runBacklogCommand`, donc un point d'entrée unique suffit. Le bundle s'installe
// dans ~/.claude/tools/backlog/ (cf. `self-update`). Source canonique = `lib/`.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Build le bundle. `outfile` par défaut → `dist-backlog/backlog.mjs` (gitignoré).
 * Exporté pour que `bundle.test.ts` build vers un temp et exerce l'artefact.
 */
export async function buildBundle({ outfile } = {}) {
  const out = outfile ?? path.join(REPO, "dist-backlog", "backlog.mjs");
  await build({
    entryPoints: [path.join(REPO, "scripts", "backlog.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    outfile: out,
    banner: { js: "#!/usr/bin/env node" },
    legalComments: "none",
  });
  return out;
}

/**
 * Message d'aide affiché après un build direct pour guider la réinstallation.
 * Exporté pour être testable — ne contient aucun chemin absolu Windows.
 */
export function installHint() {
  return "Réinstalle globalement : npm run backlog:install";
}

// Exécution directe : `npm run backlog:build` / `node scripts/build-backlog.mjs`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildBundle()
    .then((out) => {
      console.log(`✓ backlog.mjs → ${out}`);
      console.log(`  ${installHint()}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
