# /backlog — Mutate the backlog-as-data conversationally

**Thin** instruction wrapper over the **global backlog tool**:
`node "$TOOL" <cmd>` where `$TOOL = ~/.claude/tools/backlog/backlog.mjs`
(self-contained bundle, operates on the current project). All mutations go
through the CLI → **deterministic**, never a hand edit of `.md`/JSON. The back
half of the cycle (`wip → merged → shipped`) is set **automatically** by the
`hook` subcommand (cf. `/send`, `/deploy`, `/sdd-run-ticket`); this skill
covers the conversational **front half**.

> **Resolving `$TOOL`** (at the head of every bash command in this skill):
> ```bash
> TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
> ```
> The bundle operates on `process.cwd()` and **no-ops by itself** in a project
> without `backlog.json`/`specs/` (exit 0, message). **No `npm run backlog`
> required**: a project only needs its `specs/*.md` + `backlog.json` in git.
> (The source repo keeps a local TS equivalent.)

---

## Argument

Free text describing the desired mutation. Map it to **one** CLI command.

---

## Step 0 — Resolve the global tool

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
[ -f "$TOOL" ] || echo "✗ backlog tool absent — install it (node <source-repo>/dist-backlog/backlog.mjs self-update)"
```

- If `$TOOL` is absent: **stop**, display the install message above.
- Otherwise: the bundle itself handles the "project without a backlog" case
  (signaled no-op).

---

## Step 1 — Map the intent to the CLI

| Intent | Command |
|---|---|
| Create a ticket | `node "$TOOL" new <ID> [--epic <e>] [--priority <must\|should\|could>]` |
| Mature (→ `todo`) | `node "$TOOL" mature <ID> --model <fable\|opus\|sonnet\|haiku> --effort <none\|think\|think-hard\|ultrathink> --review <none\|light\|deep> --date <YYYY-MM-DD>` |
| Park | `node "$TOOL" set <ID> status=parked` |
| Abandon | `node "$TOOL" set <ID> status=wont` |
| Change status | `node "$TOOL" set <ID> status=<status>` |
| Regenerate `backlog.json` | `node "$TOOL" snapshot` |
| See the state (terminal) | `node "$TOOL" list` |
| Bootstrap a new project | `node "$TOOL" init` |

Valid statuses: `parked maturing todo wip merged shipped wont`.

**Important rules:**

- **The date is never invented by the CLI.** For `mature`, explicitly pass
  today's date (you know it from your context) as `--date YYYY-MM-DD`.
- **`--review` is required at maturation**, on the same footing as `--model`
  and `--effort`: maturing means deciding the **triplet**
  model/effort/review. It sets the dosage of `/sdd-run-ticket`'s review gate —
  `none` (no review), `light` (1 fresh-context reviewer), `deep` (3 fresh
  reviewers in parallel, each on the 4 axes). If the user does not specify it,
  **ask them** rather than choosing in their place: it is a maturation
  decision, not an execution detail.
- **When to choose `deep`.** `light` is the default. `deep` is bought when
  **missing a defect is expensive**: a single reviewer has **high variance**,
  and you pay for three samples to reduce it. Decisive criterion — *if this
  defect slipped through, would it be caught later?* A defect no test would
  catch, or that would become publicly visible, justifies `deep`. A defect
  that will blow up at the next use does not.
  These do **not** justify `deep`: the ticket's size, the spec's length, the
  number of files touched.
- **Rejected: the idea of a mandatory `--review-why`.** Do not re-propose it.
  Asking a model to justify its choice produces **post-hoc rationalization**,
  not deliberation. Empirical evidence: on a real ticket, the maturing agent
  chose `deep` and **was right**, while an argued second opinion said `light`
  and **was wrong** — a written justification would have distinguished
  neither.
- **`exec` invariant.** `exec` is required iff the status ∈
  `{todo,wip,merged,shipped}`. A `set` toward a non-matured status
  (`parked`/`wont`/`maturing`) **removes `exec` automatically**
  (dematuration); a `set` toward `todo`+ without `exec` is **refused** (mature
  first).
- **`priority` is NOT mutable via `set`** (the CLI only mutates `status`).
  Priority is fixed at creation (`new --priority`). Changing it later requires
  a CLI extension — report that rather than hand-editing the `.md`.
- **Back half = automatic.** Do not set `wip`/`merged`/`shipped` by hand
  except as an explicit correction: those transitions belong to the hook
  (`/sdd-run-ticket` → `wip`, `/send` → `merged`, `/deploy` → `shipped`).

---

## Step 2 — Execute and report

Run the command, display its `stdout`/`stderr`. On a non-zero exit, display
the CLI's error verbatim (messages are already clear) and do **not** work
around it by hand-editing files.

The CLI regenerates `backlog.json` on every mutation → coherence guaranteed
(coherence test). After the mutation, remind that committing the `.md` +
`backlog.json` remains to be done (via the normal SDD cycle) if the mutation
must reach main/prod.

---

## Examples

```
[user]   /backlog create RISK-04 in the cockpit epic, priority should
[skill]  node "$TOOL" new RISK-04 --epic cockpit --priority should
         ✓ created specs/risk-04.md (maturing)

[user]   /backlog mature RISK-04 as opus think-hard
[skill]  What review dosage? none / light / deep
[user]   light
[skill]  node "$TOOL" mature RISK-04 --model opus --effort think-hard --review light --date 2026-06-09
         ✓ matured RISK-04 → todo

[user]   /backlog park RISK-04
[skill]  node "$TOOL" set RISK-04 status=parked
         ✓ RISK-04 → parked (exec removed: dematuration)
```
