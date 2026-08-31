# CLI source (verbatim)

This folder is the **verbatim** TypeScript source of the backlog CLI, extracted
from its own repository's `lib/backlog/`. Comments are in French — the design
rationale they carry is covered in English in the [root README](../README.md).

(The first extraction took this code out of the application project that was its
first user. The CLI has since been split into a standalone repository, which is
now the canonical source — the bundle at `~/.claude/tools/backlog/backlog.mjs` is
one of its build artifacts, and this folder is a copy of it.)

| File | Role |
|---|---|
| `ticket-frontmatter.ts` | Ticket schema (Zod), statuses/priorities/exec enums, the bounded YAML-subset parser + round-trip-safe serializer, ticket-id grammar, commit-scope extraction |
| `snapshot.ts` | Frontmatter → `backlog.json` projection (deterministic, sorted, cross-OS stable) |
| `render-md.ts` | Snapshot → `specs/backlog.md` readable view, with the generated-file sentinel lock |
| `hook.ts` | Pure lifecycle-hook core: `start`/`merge`/`ship` → planned transitions (idempotent, exhaustively testable without I/O) |
| `cli.ts` | Command dispatch: `new` / `mature` / `set` / `brief` / `snapshot` / `init` / `list` / `render-md` / `escalations` / `epic` / `help` / `self-update` / `hook` — declarative flag parsing, guards (duplicate ids, ids already taken on main) |
| `set-fields.ts` | The mutable fields of `set`, beyond `status`: `title` (single-line, trimmed) and `blockedBy` (a dependency annotation, no gating) |
| `ticket-brief.ts`, `brief-sections.ts` | The `brief` verb: scaffolds a spec's core sections (bug/feature shape), idempotent, overridable per project |
| `escalations.ts`, `escalations-cli.ts` | Reads the E1/E3 escalations logged in spec bodies, lists the open ones, and inserts the closure marker. A heading that carries an `E1`/`E3` token without starting with it is reported on stderr rather than silently dropped |
| `adoption-readme.ts` | The cheatsheet and adoption README the CLI prints/installs |
| `decision-extract.ts` | Extracts decision fields (date + triggers) from parked/wont ticket bodies |
| `self-update-cli.ts`, `self-update-report.ts` | Reinstalls the bundle, and reports the repository it just dirtied — a ready-to-run commit command and a distinct exit code, so a silent install cannot go unnoticed |
| `epic-*.ts` | Epic-level counterpart (a second frontmatter store for epics, projected to `epics.json`) — included for completeness, not discussed in the writeup |

Build note: in the source system this compiles with `tsc` (strict) and is
bundled by esbuild into a single self-contained `backlog.mjs`, installed once
at `~/.claude/tools/backlog/` (`self-update` verb). Only runtime dependency:
`zod`. The test suite (parser round-trip, snapshot determinism, hook planning
K1-K6, CLI dispatch, escalation parsing, plus the coherence tests that run in the
`/send` guard) lives alongside the source in that repository and is larger than
the code it covers; it is not extracted here.
