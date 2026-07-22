# CLI source (verbatim)

This folder is the **verbatim** TypeScript source of the backlog CLI, extracted
from the host project's `lib/backlog/`. Comments are in French — the design
rationale they carry is covered in English in the [root README](../README.md).

| File | Role |
|---|---|
| `ticket-frontmatter.ts` | Ticket schema (Zod), statuses/priorities/exec enums, the bounded YAML-subset parser + round-trip-safe serializer, ticket-id grammar, commit-scope extraction |
| `snapshot.ts` | Frontmatter → `backlog.json` projection (deterministic, sorted, cross-OS stable) |
| `render-md.ts` | Snapshot → `specs/backlog.md` readable view, with the generated-file sentinel lock |
| `hook.ts` | Pure lifecycle-hook core: `start`/`merge`/`ship` → planned transitions (idempotent, exhaustively testable without I/O) |
| `cli.ts` | Command dispatch: `new` / `mature` / `set` / `snapshot` / `init` / `list` / `render-md` / `help` / `self-update` / `hook` — declarative flag parsing, guards (duplicate ids, ids already taken on main) |
| `adoption-readme.ts` | The cheatsheet and adoption README the CLI prints/installs |
| `decision-extract.ts` | Extracts decision fields (date + triggers) from parked/wont ticket bodies |
| `epic-*.ts` | Epic-level counterpart (a second frontmatter store for epics, projected to `epics.json`) — included for completeness, not discussed in the writeup |

Build note: in the source system this compiles with `tsc` (strict) and is
bundled by esbuild into a single self-contained `backlog.mjs`, installed once
at `~/.claude/tools/backlog/` (`self-update` verb). Only runtime dependency:
`zod`. The test suite (parser round-trip, snapshot determinism, hook planning
K1-K6, CLI dispatch, plus the coherence tests that run in the `/send` guard)
lives in the host project and is not extracted here — it leans on the host's
runner config.
