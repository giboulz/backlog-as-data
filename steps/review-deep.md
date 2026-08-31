## Step 6.4.5 — Aggregating the findings (dosage `deep` only)

**At dosage `light`, skip this entire step**: a single report, nothing to merge —
`R = U`, go directly to Step 6.5 with that report as `<RAW_FINDINGS>`. Adding an
aggregator for a single report would cost a round-trip for zero deduplication.

**At dosage `deep`**, spawn the **blank aggregator** — it, not you, merges the
duplicates across the three reports: the merge is a judgment about a diff you
have not read, and you are not in a position to make it.

- `subagent_type: "sdd-reviewer"` — the **same** agent-def as the reviewers,
  reused solely for its pinning (`model: opus`, `effort: high`): D7 forbids
  creating a dedicated `sdd-aggregator`. `run_in_background: false`, **without**
  `isolation` (the aggregator re-reads no worktree).
- `prompt: <AGGREGATOR_PROMPT>` — the skill's `<!-- CALL:aggregator -->` block,
  copied in full, its placeholders filled in.
- ⚠️ **This spawn does NOT count in `<n_reviewers>`** (Steps 6.6 and 6.8): it is a
  **fourth** `Agent` call at `subagent_type: "sdd-reviewer"`, reused solely for
  its settings pinning — not one more reviewer. `<n_reviewers>` stays **3** in
  `deep` (**1** in `light`), never 4.

**Substitutions for this parameter**: `<AGGREGATOR_PROMPT>` → the
`CALL:aggregator` block, copied in full, its own placeholders filled in.

The aggregator returns three things: the **aggregated list** (`U` unique
findings, renumbered 1 to `U`, without attribution), the **correspondence** (each
raw finding → one unique) and a `TOTAL_UNIQUES: <U>` line. **Two mandatory
checks, before resuming the implementer — neither replaces the other**:

1. **No raw finding lost.** Every raw finding from each of the three reports
   (`R` = sum of the `TOTAL:` values read at Step 6.4) has a destination in the
   correspondence. If `R` raw ≠ the number of correspondence rows: **STOP** — the
   aggregator lost a finding upstream, and that is a silent dismissal.
2. **No unique lost between the correspondence and the list.** `TOTAL_UNIQUES`
   must equal the number of entries **actually present** in the aggregated list,
   and every index cited in the correspondence (1 to `U`) must match an entry
   present in the list. If either differs: **STOP** — the aggregator merged
   correctly but copied out an incomplete list; that is another form of the same
   silent dismissal, and counting only the correspondence rows (check 1) does not
   catch it.

If the aggregator **stops itself** (one of the three paths unreadable, empty, or
without a `TOTAL:` — `prompts/aggregator.md` § Step 1): this is **not** an
inadmissible report as at Step 6.4 — the three `TOTAL:` lines were already read
there successfully, in the reviewers' **output**. What happened is that this
particular reviewer did **not deposit** its file despite a valid output: its
deposit instruction is, like its read-only instruction, declarative. **Respawn
THAT reviewer, with the SAME `<REPORT_PATH>`**, wait for its new deposit, then
respawn the aggregator — same logic as Step 6.4's admissibility: this is not a
second round of review, it is a first deposit that did not happen.

At Step 6.5, `<RAW_FINDINGS>` becomes the **aggregated list**, as-is; `U` =
`TOTAL_UNIQUES`.

---

## Substitutions already resolved on entering this file

Two values used above without being resolved here: they are resolved earlier in
the cycle and arrive here as-is, never re-derived. Declared here so that this file
reads on its own.

**Substitutions**: `<REPORT_PATH>` — the report deposit path of **one** reviewer,
computed at Step 6.3 and passed to that reviewer in its call prompt;
`<RAW_FINDINGS>` — what Step 6.5 passes to the resumed implementer, whose value at
dosage `deep` is fixed by this very step.
