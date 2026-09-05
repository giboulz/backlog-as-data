# backlog-cli (verbatim)

This folder mirrors the CLI's **own repository**: source, build chain, lockfile
and test suite, verbatim. Comments are in French — the design rationale they
carry is covered in English in the [root README](../README.md).

```bash
npm ci                    # ci, not install: zod is a caret dependency
npm test                  # 376 tests
npm run backlog:build     # → dist-backlog/backlog.mjs
```

**The build is reproducible.** With the published lockfile honoured, the bundle
comes out byte-for-byte identical to the one running on the author's machine —
676,831 bytes, checked with `cmp` at the time of the snapshot. That is why the
bundle itself is not published: you can produce it from the source next to you.
Resolving `zod` forward with `npm install` instead adds nearly 200 KB, silently.

Two notes on running the tests. On a cold first run under Windows, one git-backed
test can exceed its 5-second timeout while `git init` warms up in a temp
directory; re-run it. And `__tests__/backlog/coherence.test.ts` is **excluded
from the default run** by `vitest.config.ts` — it is not a test of the CLI but
one a *host* repository owns, reading `process.cwd()/specs` and
`process.cwd()/backlog.json`, which do not exist here.

(History, because the code comments refer to it: this CLI was first a folder
inside the application project that happened to be its first user, and its tests
leaned on that project's runner config. It has since been split into a standalone
repository, which is now the canonical source and what this folder mirrors.)

The source, file by file — all of it under [`lib/backlog/`](lib/backlog/):

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

Build note: this compiles with `tsc` (strict) and is bundled by esbuild into a
single self-contained `backlog.mjs`, installed once at `~/.claude/tools/backlog/`
by the `self-update` verb. Only runtime dependency: `zod`, inlined into the
bundle.

The test suite is in [`__tests__/backlog/`](__tests__/backlog/) — parser
round-trip, snapshot determinism, hook planning K1–K6, CLI dispatch, escalation
parsing, plus the host-owned coherence test that runs in the `/send` guard. It is
larger than the code it covers, which is the point.
