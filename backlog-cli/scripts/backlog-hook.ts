import { runBacklogCommand } from "../lib/backlog/cli";

// INFRA-11 / INFRA-14 — Délégué mince. La logique du hook vit désormais dans
// `lib/backlog/cli.ts` (`cmdHook`), pour entrer dans le bundle global et n'exposer
// qu'UNE surface de dispatch. Ce script conserve `npm run backlog:hook` côté
// whereismycard. Tolérance absolue : la commande `hook` sort toujours code 0.
async function main(): Promise<void> {
  const result = await runBacklogCommand(["hook", ...process.argv.slice(2)], {
    root: process.cwd(),
  });
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exit(result.code);
}

main().catch((e) => {
  process.stderr.write(
    `[backlog:hook] warn: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(0);
});
