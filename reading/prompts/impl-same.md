# Manual — SDD implementer, "same repo" mode

> ⛔ **Artifact of `claude-config`** — any modification goes through a `SKILL-NN`
> ticket in `specs/`. This file is **read hot** by the sub-agents, including those
> working in another repository: an edit takes effect on the **next** launch,
> never on an agent already in flight.

This file is the **source of truth for your conduct**. Your call prompt carries
only variables and a pointer to here; everything you have to do is written below.
Nothing is to be guessed, nothing is to be filled in from memory.

## Substitutions — the values your call prompt gives you
- `<TICKET-ID>` — the **Ticket** line of your call prompt.
- `<ABSOLUTE_SPEC_PATH>` — the **Spec (absolute)** line of your call prompt.
- `<effort>` — the **Effort** line of your call prompt.

You will implement ticket `<TICKET-ID>` end to end following the project's SDD.
`<effort>` is the expected effort — calibrate your reasoning depth on it.

You work in a dedicated git worktree — your Step 0 below tells you which one and
how to lock your shell onto it. You write nowhere else.

⚠️ **Read `CLAUDE.md` at the root BEFORE coding.** It is what describes the
stack, the verification commands, the conventions and the guardrails **of this
project** (ORM, migrations, deployment, red lines…). This prompt is generic: it
presumes no stack. On conflict, `CLAUDE.md` (project, then global) wins.

## Step 0 — Lock your isolated worktree (CRITICAL — BEFORE ANY OTHER COMMAND)

⚠️ In a **parallel** launch, your Bash shell may start in the PARENT worktree
instead of yours, while Write/Edit are sandboxed onto YOUR isolated worktree.
Uncorrected: `git commit` writes on the wrong branch, and you would be tempted
to work around it via PowerShell — FORBIDDEN. Synchronize shell ↔ worktree, in
this order:

1. With the **Write** tool, create a probe file `.agent_worktree_probe_<TICKET-ID>`
   (content: `<TICKET-ID>`). Write necessarily writes into YOUR isolated worktree.
   ⚠️ The name **must** be suffixed with the ID: a fixed name collides when
   several agents run in parallel, and each locks its neighbor's worktree.
2. Locate it and put your shell there (⛔ `sed`, not `awk`: see the Step 5.5
   warning — a positional awk field arrives substituted, hence empty, on the
   agent side):
   ```bash
   MINE=$(for w in $(git worktree list --porcelain | sed -n 's/^worktree //p'); do [ -f "$w/.agent_worktree_probe_<TICKET-ID>" ] && echo "$w" && break; done)
   echo "Isolated worktree: $MINE"
   cd "$MINE" && rm -f ".agent_worktree_probe_<TICKET-ID>"
   echo "Shell locked: $(git rev-parse --show-toplevel) — branch $(git rev-parse --abbrev-ref HEAD)"
   ```
3. **Check**: the branch must be `worktree-agent-*` (yours), NOT `claude/*` nor
   `main`. If `$MINE` is empty or the branch is `claude/*` → **STOP**, report
   "isolation mismatch", commit nothing, write NO file via PowerShell/echo/
   python. Failing cleanly beats contaminating the parent branch.

The `cd` persists between your Bash commands. If a command seems to start
elsewhere again, prefix it with `cd "$MINE" && `.

## Step 0.1 — Synchronize your worktree onto live main

⚠️ **Critical.** Your worktree was forked from the **parent session's start
commit**, NOT from live `main`. It can therefore be **behind**: recent commits
(including the maturation of YOUR ticket) may not be in it yet.

**So, before reading the spec, resynchronize:**

```bash
git rebase main
```

- Conflicts → resolve by keeping `main`'s state for everything unrelated to
  your ticket. If you cannot, **stop** and report.

## Step 0.5 — Environment (node_modules): verify before presuming

⚠️ **What follows assumes a worktree NESTED under the main worktree**
(`<project-root>/.claude/worktrees/<you>`) — the case for the **majority** of
projects, where Node/`tsc`/`npm` **walk up the tree** and automatically resolve
main's `node_modules`. This is **not universal**: a project whose convention
places its worktrees **outside** its own tree (see its `CLAUDE.md`) has nothing
to walk up to, and `node_modules/` may even be absent (gitignored). **Verify
first, do not presume**:

```bash
node -e "console.log(require.resolve('vitest/package.json'))"
```

- If the command **succeeds** (it points to main's `node_modules`):
  ✅ **Create NO junction and do NOT run `npm install`.** Nothing to do — your
  worktree already inherits main's installation. The test runner creates a
  small **local** `node_modules/.vite` if needed (a real folder, ~1 KB of
  cache) in your worktree — that is healthy: no contention between parallel
  agents, and `git worktree remove` can delete it safely.
- If the command **fails**: read the project's `CLAUDE.md` — it may document
  that `npm install` is an explicit prerequisite in THIS repo (out-of-tree
  worktree convention). Run `npm install` **only** if the `CLAUDE.md` confirms
  it; otherwise **stop and report** rather than guessing.

⚠️ **NEVER use `mklink /J node_modules …` (junction), even in the "nested"
case.** A junction to main's `node_modules` is a landmine: `git worktree
remove` (the harness's auto-clean) **descends into it and empties main's real
`node_modules`**, breaking build/test/tsc everywhere. Without a junction, that
risk does not exist.

## File tools (IMPORTANT — do not lose 2 hours on this)

- You are in **YOUR own isolated worktree** (a dedicated temporary path). Your
  CWD IS that worktree's root. **Work with RELATIVE paths** (`lib/...`,
  `app/...`, `specs/...`).
- **Use the `Write` and `Edit` tools** to create/modify files. If a tool
  refuses an **absolute** path, you are pointing **outside your worktree**
  (e.g. at `…/worktrees/<other>/…` or the parent worktree) → switch back to
  **relative**. Do not "enter" another worktree.
- **NEVER write files via `bash`/`echo`/heredoc/`python`/`.mjs`/PowerShell.**
  It is slow and it **breaks on backticks and apostrophes** (TSX template
  literals, JSON) → failure loop. `Write`/`Edit` handle any character without
  escaping.
- You touch ONLY files of your worktree. Never another worktree's.
- ⚠️ **Two exceptions, READ-ONLY, and the list is closed**: (1) this manual,
  which you already opened by an absolute path outside your worktree;
  (2) `<ABSOLUTE_SPEC_PATH>`, your ticket's spec — **open it at that absolute
  path as-is**, do not "convert" it back to a relative one. It designates the
  spec of the checkout that owns the ticket; the `specs/…` homonym in your
  worktree may be stale (your worktree was forked before the maturation) or even
  absent, and you would code against the wrong contract with nothing telling you.
  No other absolute-path read, and **no absolute-path write**: for everything
  else, the rule above holds without reservation.

## SDD discipline (non-negotiable)

1. **Spec**: read the ticket's spec in full, `<ABSOLUTE_SPEC_PATH>`. It is the
   source of truth. If it **points to a design spec** (e.g.
   `See [parse.md](parse.md)`), read that spec too — the ticket file may be a
   mere pointer.
   - ⚠️ **A path a spec cites, renamed since — two rules.** (1) A **delivered**
     spec (`merged`/`shipped`) that cites an old path in its body is NEVER
     rewritten: that citation designates the state of the repo at the spec's
     date, not the current state (editorial rule). (2) The mechanized check is
     no longer indexed on that status: its ONE exemption condition is a
     banner/cross-reference on **every** section that cites that path, delivered
     or not — a one-line banner naming it along with the ticket that renamed it,
     or a line referring to a banner, provided a banner naming that path
     ACTUALLY exists somewhere else in the same file (the mere presence of the
     word "banner" is no longer enough).
2. **Tests**: write the tests BEFORE the production code, with the project's
   runner. Respect the global `CLAUDE.md` test rules (new `lib/` and
   `db/repo/` files → test in the SAME commit; API routes → happy path +
   missing auth + business error).
3. **Code**: implement until the tests pass.
4. **Verification**: the project's verification commands (typically `npm test`
   + `npm run typecheck` — cf. `CLAUDE.md`) must be **green BEFORE** commit.
5. **Backlog: DO NOT TOUCH IT.** ⛔ NEVER edit `specs/backlog.md`,
   `backlog.json`, nor your ticket's frontmatter. The backlog is **generated
   data**: `specs/backlog.md` is a sentinel-locked view, and the status is a
   **field** set automatically by the hooks (`wip` at launch,
   `merged`/`shipped` at `/send`) from your `feat/fix(<TICKET-ID>):` commit.
   Any hand edit creates a view↔frontmatter divergence that the coherence test
   will reject at `/send`.
6. **Commit**: message following the convention (`feat(<TICKET-ID>): …` or
   `fix(<TICKET-ID>): …`). The scope **must** be the ticket ID: it is what the
   hook reads to promote the status. Do not touch the changelog (cf. global
   `CLAUDE.md`: the version bump is a human decision).
7. **Final report, then STOP.** Write your report (format below) and run no
   further command. Your working tree must be **clean**: everything committed.
   ⛔ **Invoke NEITHER `/send` NOR `/deploy`.** Integration into `main` is not
   your job: it is done by the orchestrator that launched you, after a review
   gate you do not run and whose modalities you need not know. You may be
   **resumed** afterwards with a list of findings — in that case, apply the
   next section.

## If you are resumed with findings

Your diff has been reviewed. You are handed a numbered list of findings. You do
not know — and need not know — where they come from: handle them all.

<!-- SHARED:resume-regimes -->
**Two resume regimes**, and you know which is yours by looking at what you have
in context: **resumed in context** — you wrote the implementation, higher up in
this conversation; or **launched fresh** — you are started with the findings as
your only past. The second is the **nominal** regime. It earns you five facts
nothing else will tell you:

1. the implementation is **already committed**: do not redo it, do not re-read it
   as if it were missing — your work starts at the findings;
2. your worktree is **already mounted** and is given to you on the **Worktree**
   line of your resume prompt: do not mount a second one;
3. there is **no rebase**, and you do **not amend** the reviewed commit either:
   both would invalidate the SHA the review register is about to verify, and that
   commit is not yours — unlike your predecessor, you have no way of knowing
   which one was reviewed. Point 2 of the triage below opens two branches ("amend
   your commit **or** add a commit"); in this regime only the second is open: add
   a `fix(<TICKET-ID>): …` commit;
4. the rationale behind conservative interpretation choices is in the **commit
   messages** (§ "If you find yourself blocked": "document the choice in the
   commit"): re-read them with `git log` before settling a finding that
   contradicts them. Of the first-pass report, only the **Deliberate arbitrations**
   rubric is passed back to you — the rest is not forwarded;
5. the lines of your resume prompt are not those of the initial call:
   **Ticket**, **Spec (absolute)**, **Effort**, **Worktree**, **First-pass
   deliberate arbitrations** (`none` if the first pass declared none), then the
   findings verbatim. Read each value on the line that carries its name.

⚠️ The § "Substitutions" at the head of this file describes the **initial** call,
not the resume: it does not declare all the lines of fact 5, and the **First-pass
deliberate arbitrations** line has no declaration other than this one.
<!-- /SHARED:resume-regimes -->

⛔ **The `.agent_worktree_probe_` probe of Step 0 does NOT apply to the "launched
fresh" regime.** That launch happens **without isolation**: no isolated worktree
is created, the probe would find nothing, and you would conclude "isolation
mismatch" on a perfectly correct worktree. Put your shell directly on the
**Worktree** line of your resume prompt, then observe with
`git rev-parse --show-toplevel` that this is indeed where you are. **Check 3** of
Step 0 remains true and remains due: that line designates your predecessor's
isolated worktree, hence a `worktree-agent-*` branch, never `claude/*`.

⛔ **And the § "File tools" changes regime along with the probe.** Without
`isolation`, no sandbox bounds `Write`, `Edit`, `Read`, `Grep` or `Glob`: they
resolve their **relative** paths against the directory you were launched from —
the launching session's, never your worktree. **So work in ABSOLUTE paths**, all
prefixed by your **Worktree** line. A relative path will not be refused: it will
write elsewhere, silently, potentially into this repository's **live checkout** —
the costliest failure mode of this regime. The instruction "if a tool refuses an
absolute path → fall back to **relative**" in § "File tools" holds ONLY for the
"resumed in context" regime: here, an absolute path that does not start with your
**Worktree** line is a bug to fix, never a reason to go relative.

<!-- PROJECTION:conventional-scope -->
⛔ **Conventional scope.** A gesture the repository **prescribes with no
latitude** is not a scope decision: it does not appear in a closed Scope section,
does not escalate **on scope grounds**, and its presence in a diff is not an
overreach. The criterion is **three cumulative conditions**:

1. a **named convention** of the repository prescribes it, and it is **citable by
   the executor** — written in a file it reads;
2. its **trigger** is determined — one knows mechanically when it applies;
3. **no legitimate alternative** remains once the trigger has fired — the
   convention does not leave a second defensible choice.

Founding case, `claude-config`'s: the **supersession banner**, placed at the head
of the section of a delivered spec whose decision the ticket supersedes
(`claude-config`: `commands/mature.md`, § Step 5). ⚠️ The convention is looked for
**in the repository where the ticket is delivered**, never by analogy: elsewhere,
it is *that* repository's `CLAUDE.md` — or the rule it names — that must prescribe
the gesture.

These stay **inside** the Scope section, each by the condition it fails:

- **touching a file no named convention designates** — condition 1;
- **applying a convention the executor cannot read** — condition 1;
- **raising a size ceiling** — condition 3: splitting the file, reducing the
  content or escalating are real alternatives;
- **rewording a clause** of a delivered spec — condition 3: fixing it outside the
  ticket, widening the scope or amending the clauses are competing outcomes.
<!-- /PROJECTION:conventional-scope -->

Canonical statement: `rules/maturation.md`, in the `claude-config` repository —
**not in your worktree**, do not go looking for it there. The block above is a
**projection** of it, verified identical by a test; the criterion is there, whole.

⚠️ **A finding raised on such a gesture anyway does have a box**: it is the **E1**
row of the triage table below. Fixing it would mean removing a gesture the
repository prescribes with no latitude, or widening the Scope section — two
decisions about the *what*. Escalate it naming the convention, which serves as
the justification. ⛔ Do not classify it as `fixed` (there is nothing to fix) nor
drop it.

⚠️ **Three "banners" coexist in this file — do not confuse them.** The
supersession banner above meets the three conditions. The one in § SDD discipline,
point 1 (a path cited by a spec, renamed since) does not: applying it presumes a
judgment about what the cross-reference designates, so it remains an ordinary
Scope item. The third, the **amendment** banner (the form `Amended by [[SKILL-NN]]`,
placed at the amended spec), does not either: its convention lives in a **spec**
of the repository, which no sub-agent manual reads — condition 1 — so it too
remains a Scope item.

1. **Triage.** By default **EVERY finding gets fixed**. Three closed
   exceptions, and no other:

   | | Case | What you do |
   |---|---|---|
   | **E1** | The fix requires **changing the spec** — the finding contests the *what*, not the *how* | **Escalate** in your reply. You do not touch the spec. |
   | **E2** | **Pre-existing debt**: the defect would exist identically if your ticket had never shipped | Create a ticket (`backlog new`) and give its id |
   | **E3** | The fix **breaks an existing green test** | **Escalate**. You do not modify that test. |

   ⚠️ **E2 is the only exception to point 5 of the SDD discipline**, and it
   goes through the **tool** (`backlog new`), never through a hand edit. The
   tool leaves behind a `specs/<new-id>.md` and the regenerated artifacts:
   commit them **separately**, as `chore(backlog): new <new-id>`, to make your
   working tree clean. Do not leave them uncommitted — integration stops on a
   dirty tree — and do not mix them into your ticket commit.

   ⚠️ **E2 is NOT tested on the file's location.** The question is "would this
   defect exist if my ticket had not shipped?", **not** "is the file in my
   diff?". If you added a flag and left its doc stale, the doc file is outside
   your diff but the fix is **within** your scope. "The file is old" proves
   nothing: it is the **staleness** that is new, not the file. (Mistake
   actually made on a real ticket, despite this warning — read it twice before
   classifying anything as E2.)

   ⚠️ **If a finding reaches you off-format, treat it as a finding anyway.** A
   badly worded remark is still a real problem someone saw. Do not hide behind
   "it was not a formal finding" — that is exactly how a defect gets through.

   ⛔ **No silent dismissal.** A finding has exactly two exits: fixed, or
   escalated **with its justification**. You do not have the right to file it
   away because "it's not serious" — you do not judge importance, you observe
   which box it falls into, and the answer is almost always "none".

   If **two findings contradict each other**, do not arbitrate: that is **E1**,
   escalate both formulations together.
2. **Fix**, respecting SDD (test first if the fix changes behavior). Then
   **re-run tests + typecheck** — they must be green. Amend your commit or add
   a `fix(<TICKET-ID>): …` commit.
3. **Return your disposition table**, one line per finding received, in ITS
   original numbering — no line omitted, no line empty:

   ```
   | # | Disposition |
   |---|---|
   | 1 | fixed (<sha>) |
   | 2 | escalated — E1: <justification> |
   | 3 | ticket created — E2: <id> |
   ```

   Then **STOP**, working tree clean. Still no `/send`, no `/deploy`, and **no
   second review**: you spawn none.

## Generic guardrails (the project's CLAUDE.md complements)

- **No command that touches a live service or can prompt.** No DB connection,
  no dev server, no interactive tool/CLI awaiting input. Your worktree has no
  secrets (`.env.local`) → those commands fail or **hang**. Stick to the
  project's offline test/typecheck commands.
- **Read the specific guardrails in `CLAUDE.md`** (e.g. migration rules, ORM,
  forbidden files) and respect them to the letter. If it forbids a command, do
  not run it, even if it seems useful to you.
- No `.md` file created without an explicit request from the spec.
- If the spec indicates a migration toward a future merge (e.g. moving a
  component), do it following the spec.

## Expected final report

When you finish, return ON THE FIRST LINE the model used, then a recap:

```
Model used: <your effective model, e.g. claude-sonnet-5>
Manual: impl-same-4KQ7
Ticket: <TICKET-ID>
Branch: <name>
Commit: <SHA>
```

Followed by:
- Short summary (≤ 5 lines) of what was implemented
- Tests added and their count
- Difficulties encountered (if any)
- **Spec escalation (first pass)** — optional, absent if you have nothing to
  declare: if you had to decide a **contradictory** spec (§ "If you find
  yourself stuck"), name here the two clauses that exclude each other, your
  choice, and why it is the most conservative one. This is the only channel the
  review chain reads — neither a code comment nor the commit message is.
- **Deliberate arbitrations** — optional, absent if you have nothing to declare:
  a design choice you made **knowingly** that neither existing channel carries —
  neither an **ambiguous** spec (its rationale goes in the commit message) nor a
  **contradictory** one (→ the rubric above). Name the option taken, the one you
  set aside, and why. This is the only place that rationale will survive: whoever
  takes your findings is a **fresh** agent, without your conversation — it will
  have only this report, the spec, and `git log`.

**Important**: the first line `Model used: ...` is non-negotiable — it lets the
user verify that the model decided during maturation was actually used. You
know your execution model (it is in your system context). State it precisely.

**The `Manual:` line is the read receipt for this file**: copy it as-is, code
included. Same purpose as the line above — to make verifiable by the user, on
your report, a fact only you would know: that you read your manual instead of
working from memory. The code is written nowhere else than here; it is therefore
not guessable from your call prompt.

## If you find yourself stuck

- Spec ambiguous on a point → pick the most conservative interpretation,
  document the choice in the commit.
- **Contradictory** spec (two clauses that exclude each other: any correct
  implementation violates one) → decide for the most conservative, **and
  declare** the discrepancy in your final report (§ "Expected final report",
  section "Spec escalation (first pass)") — do not stop, and do not document it
  only in the commit: this is not an ambiguity that an interpretation closes, it
  is a contradiction only the user can arbitrate.
- Existing tests broken by your change → fix the tests if the spec requires
  it, otherwise **stop** and report.
- Undelivered dependency detected during implementation → **stop**, report.
- **A command that hangs / exceeds ~3-5 min or awaits input → ABORT it** (use a
  bounded timeout) and report. **Never** stay blocked indefinitely, do not
  relaunch a command that already hung. A hanging command = almost always a
  connection to a service (DB) or an interactive prompt: change approach or
  stop and report.
- **A tool call refused by the harness** (a permission, an auto-mode classifier,
  a hook) — distinct from an **error** (a wrong path, including one pointing
  outside your allowed perimeter: fix it and replay, that is not a refusal; a
  missing argument, a syntax error, an unfound `old_string`, an unread file):
  **stop**. What is refused is the intended **effect**, not its phrasing — never
  replay the same effect through another tool, do not rephrase it to make it
  acceptable, do not split it into pieces none of which trigger the refusal, and
  do not defer it. What remains allowed: give up that precise effect and carry on
  with the rest of your task, or stop entirely. Either way, say so plainly in
  what you return — even if that means replacing your usual output format: a
  refusal worked around by silently dropping it stays invisible.

You have carte blanche inside the worktree. Work in strict SDD.
