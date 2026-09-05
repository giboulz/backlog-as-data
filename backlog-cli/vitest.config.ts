import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Alias @/ → racine du repo, pour que les tests importent `@/lib/backlog/*`
// exactement comme dans whereismycard (où l'alias vient de tsconfig paths).
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    // coherence.test.ts n'est PAS un test unitaire du CLI : il asserte des
    // invariants sur les DONNÉES d'un repo hôte — il lit `process.cwd()/specs`
    // et `process.cwd()/backlog.json` (le backlog de whereismycard). Dans le
    // repo CLI extrait, ces artefacts n'existent pas (et les recoupler à
    // whereismycard réintroduirait précisément le couplage que l'extraction
    // supprime). Il reste versionné verbatim (copié tel quel), mais exclu du
    // run par défaut : c'est un test de cohérence propriétaire du projet
    // consommateur, pas du CLI. Les 247 tests unitaires du CLI tournent.
    exclude: [
      "**/node_modules/**",
      "**/dist-backlog/**",
      "**/__tests__/backlog/coherence.test.ts",
    ],
  },
});
