import { runBacklogCommand } from "../lib/backlog/cli";

// INFRA-08 — Wrapper mince. Toute la logique est dans lib/backlog/cli.ts (testé).
// INFRA-14 — sert aussi de POINT D'ENTRÉE du bundle global : `process.argv[1]`
// (le .mjs en cours) est transmis comme `selfPath` pour que `self-update` sache
// quel fichier réinstaller dans ~/.claude/tools/backlog/.
async function main() {
  const result = await runBacklogCommand(process.argv.slice(2), {
    root: process.cwd(),
    selfPath: process.argv[1],
  });
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exit(result.code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
