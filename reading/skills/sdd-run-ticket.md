# /sdd-run-ticket TICKET-ID — Launch an SDD sub-agent on a matured ticket

> **Translator's note.** This skill is published verbatim (translated) from a
> working system. References like `specs/skill-01.md`, `INFRA-31`, `SKILL-09`
> point to spec files of the **source system** (the skill itself is managed as
> tickets, in the same backlog-as-data model it serves) — they are kept as
> provenance. `claude-config` designates the versioned `~/.claude` repo that
> owns the global skills and tools.

Spawns a background sub-agent that implements a backlog ticket under the SDD
discipline (spec → tests → code → verify → commit), with the model decided
during maturation. **Then YOU, the orchestrator, run the review gate**: you
spawn the reviewers, you constate the worktree state, you launch a fresh
corrector on the findings, you write the register and you integrate.

⚠️ **This skill is not fire-and-forget.** It costs you **three round-trips**
(implementer → reviewers → implementer resumption) before integration. That is
the price of **attestation**: the evidence of review (reviewer count,
`git status`, register) is produced by you, not by the entity it audits. Accept
that cost or lower the dosage (`review: none`) — but do not shorten the loop by
delegating that evidence to the sub-agent.

**Backlog prerequisite (backlog-as-data)**: the ticket is a `specs/*.md` file
with a `type: ticket` frontmatter carrying an `exec:` block
(`model` / `effort` / `matured`) — i.e. a **matured** ticket (`status: todo`).
The source of truth is that **frontmatter**, never `specs/backlog.md` (a
generated view, locked by sentinel).

**Isolation prerequisite (critical)**: the sub-agent is spawned with
`isolation: "worktree"` → its worktree is created **from `main`**. It will see
ONLY what is committed on `main`. So the ticket **and** its spec must already be
on `main` before launch. A ticket matured only in a local worktree (uncommitted
edit, or unsent commit) is **invisible** to the sub-agent. The guard in
Step 3.5 blocks this case.

**Repo prerequisite (critical)**: the ticket does not necessarily belong to the
**session's** repo. The ownership rule (`specs/skill-01.md`) says a ticket opens
where its deliverable lives — so a ticket whose deliverable is a global skill
lives in `claude-config`, even when launched from a session opened elsewhere.
That does **not** mechanically switch to cross-repo mode: what decides is the
shared git repository (`git dir`) of the target root and the session root
(Step 1.2), not the ticket's location alone — a session already working inside a
`claude-config` worktree stays `same-repo`. When it genuinely is `cross-repo`,
`isolation: "worktree"` is **unusable**: it forks the session's repo, not the
ticket's. The skill then switches to **cross-repo mode** (Step 1.2): worktree
mounted by hand on the target repo, agent spawned **without** `isolation`.
Everything else in the skill — guards, hooks, review, `/send` — must then target
the **target repo**, never the session's. This is the central failure mode:
everything works, but in the wrong tree.

**Portability**: this skill is **generic**. It knows neither the stack nor the
guardrails of any given project — the project's `CLAUDE.md` is authoritative,
and the sub-agent is instructed to read it. Never reintroduce a
project-specific fact here (stack, ORM, host, particular files).

**Specs**: this file is an artifact of `claude-config` — any modification goes
through a `SKILL-NN` ticket in its `specs/`  (ownership rule:
`specs/skill-01.md`). The design of the **review gate** (the reviewer manual's
content, E1/E2/E3 escapes, dosage) is traced in `specs/infra-31.md` **of the
main project's repo** — predating that rule, cf. SKILL-01 § "What is NOT done".
The **caller inversion** (the orchestrator spawns the reviewers, not the
implementer) is traced in `specs/skill-06.md`.

---

## Arguments

`TICKET-ID` in `SCOPE-NN` format (e.g. `ANALYTICS-02S`, `LANDING-06`).
Case-sensitive — use uppercase as in the frontmatter.

`--repo <path>` — **optional**. Root of the repo that owns the ticket, when it
is not the session's (cf. "Repo prerequisite" above). If absent, the skill
resolves the repo on its own (Step 1.1) and only asks for this flag as a last
resort, displaying the path to put in it.

If `TICKET-ID` is absent: **stop**, display:
```
✗ Usage: /sdd-run-ticket TICKET-ID [--repo <path>] (e.g. /sdd-run-ticket ANALYTICS-02S)
```

---

## Step 0 — Prerequisites (verdict DEFERRED to Step 1.2)

Check the current branch — the **session** repo's:

```bash
git rev-parse --abbrev-ref HEAD
```

- If the branch is **not** `main`: nothing to report, continue.
- If the branch **is** `main`: ⚠️ **do not stop yet.** Hold the observation and
  go to Step 1 — the verdict depends on which repo owns the ticket, which is
  not known at this point (D3, SKILL-09):
  - ticket of the **session's** repo → Step 1.2 stops, with the message below:
    the sub-agent would fork this main and your final `/send` would
    fast-forward into it from a checkout that already is main;
    ```
    ✗ You are on main. Create a dedicated worktree or branch before launching an SDD agent.
    ```
  - ticket of **another** repo (cross-repo mode) → **non-blocking**: nothing
    will be written into the session's repo, whose branch has no influence on
    the rest. The guard that matters is then the branch assertion on the
    **target worktree** (Step 5.7), and it alone.

⛔ Never turn this tolerance into "we no longer check anything": in cross-repo,
the check is not removed, it is **moved** onto the tree the agent will actually
write to.

---

## Step 1 — Resolve the ticket via the preflight tool

All the **deterministic mechanics** — finding the file whose frontmatter carries
`type: ticket` + `id: TICKET-ID` (⚠️ the filename is NOT derivable from the ID:
`INFRA-08` lives in `specs/infra-08-backlog-frontmatter-cli.md`), reading its
status and its `exec:` block, deciding the mode, deriving the worktree, checking
the guards — is done by a **standalone tool**, `tools/sdd/preflight.mjs`
(property of `claude-config`). The skill calls it **once** and reads the JSON
fields; it recomputes nothing by hand.

```bash
PREFLIGHT="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','sdd','preflight.mjs'))")"
SESSION_ROOT="$(git rev-parse --show-toplevel)"
node "$PREFLIGHT" resolve --ticket "<TICKET-ID>" --session-root "$SESSION_ROOT"
```

If the user provided the `--repo` flag, add it as-is to the command (`--repo`
followed by the absolute path): the tool will search **only** that root.

The tool emits **a single JSON object** on stdout, or exits with a **non-zero
code** and a message that **it composes itself** (scanned roots named, `--repo`
flag). On error: **relay the message verbatim and stop** — it tells the truth
about what was scanned (a single root under `--repo`, two roots — session +
`$HOME/.claude` — otherwise).

JSON fields read, used throughout the rest of the skill:

| JSON field | Role |
|---|---|
| `found` | `true` on success (a failure already exits non-zero) |
| `targetRoot` | root of the repo **that owns the ticket** — see `<target_root>` |
| `specPath` | the ticket's spec, **relative to `targetRoot`** — see `<spec_path>` |
| `absoluteSpecPath` | absolute path of the spec (reused at Step 6) |
| `status` | lifecycle status (Step 1.5) |
| `model` / `effort` / `review` | exec block, read either at level 0 or under `exec:` (Step 2) |
| `mode` | `same-repo` \| `cross-repo` (Step 1.2) |
| `worktreePath` / `branch` | non-null in cross-repo (Step 4.5) |
| `guards.*` | guardrails (Steps 3.5, 4.5) |

**Substitutions resolved at this step**: `<target_root>` — the JSON's
`targetRoot` field, the root of the repo **that owns the ticket** (absolute);
every `git` command in later steps targets it, never the session's repo.
`<spec_path>` — the JSON's `specPath` field; wherever it reappears below
(Steps 3, 6), it is that literal, never retyped nor re-derived.

---

## Step 1.1 — Cross-repo resolution: the tool already scans the harness repo

Two outcomes, read from the Step 1 result:

- Ticket found in `$HOME/.claude` → the JSON's `targetRoot` points there. The
  `mode` does **not** follow mechanically: `same-repo` and `cross-repo` are both
  possible, and it is the `mode` field of Step 1.2 that decides, on the shared
  git repository (`git dir`) of `targetRoot` and `sessionRoot` — a session
  already working inside a `claude-config` worktree gets `same-repo` despite
  different path roots; a session in another repository gets `cross-repo`, as
  before. You do **not** have to re-ask for `--repo` — but the Step 5 recap
  displays the target repo in plain sight and expects an explicit confirmation,
  so no repo switch ever happens silently.
- Ticket nowhere → the tool exits non-zero with a message naming the roots
  actually scanned. **Relay that message and stop.**

---

## Step 1.2 — Decide the mode: read from the `mode` field

The mode is **no longer computed in prose**: it is the `mode` field of the
Step 1 JSON (`same-repo` \| `cross-repo`), already decided by the tool —
comparison of the shared git repository (`git dir`) of `targetRoot` and
`sessionRoot`, Windows normalization (separators, drive-letter case) included.
Two different **path** roots can share the same `git dir` (a worktree and the
main checkout of the same repo): those yield `same-repo`.

| `mode` | Consequences |
|---|---|
| `same-repo` (nominal) | the skill behaves as before SKILL-09: `isolation: "worktree"`, worktree probe, Steps 4.5 and 5.7 skipped, Step 6 sends the "same repo" call prompt directly |
| `cross-repo` | worktree mounted by you (Step 5.7), agent spawned **without** `isolation`, and **every** `git` command in the skill prefixed `git -C "<target_root>"` or `git -C "<worktree_path>"` |

**This is where the deferred verdict of Step 0 lands**: in `same-repo` mode, a
current branch of `main` **stops now**, with the Step 0 message. In cross-repo,
it is ignored.

Note: the `git -C "<target_root>"` blocks in later steps are written to hold
**in both modes** — including "same repo" mode: `<target_root>` is **not**
guaranteed equal to the session's root (a worktree and the main checkout of the
same repo share a `git dir` without sharing a path), so the `-C` is **never** a
no-op. It stays **mandatory in both modes**; there is nothing to remove.

⚠️ In cross-repo, the rule is mechanical: **a `git` command targets its repo
explicitly**, never by accident. A bare `git` command inherits your shell's
current directory — hence the session's repo — and will calmly answer about the
**wrong tree**: `git worktree list` will list the wrong repo's worktrees,
`git cat-file -e main:…` will look for the spec in the wrong `main`, and
nothing will flag it. That is exactly the defect this mode exists to prevent.

Two ways to target explicitly, and **only one of the two per step**:

| Way | Where | What makes it safe |
|---|---|---|
| `git -C "<target_root>"` / `git -C "<worktree_path>"` | Steps 1 to 6.6.5 | the repo is named in the command, your `cd` has no influence |
| `cd "<worktree_path>" && git …` | Step 6.7 **only** — including the commands `/send` prescribes and that 6.7 executes on its behalf | `/send` takes no repo argument: it reads the current directory at call time, both its own and that of every command it prescribes. The `cd` **of the command itself** is the targeting — never an earlier `cd`, not even a previous command's — and that holds command by command, not just at the step's entry: there is no single check that would cover the following ones |

⛔ Do not "fix" the `cd "<worktree_path>" && git …` commands of Step 6.7 (nor
those, derived from `send.md`, that 6.7 executes on its behalf) by replacing
their `cd &&` with a `-C`: the two forms are behaviorally equivalent here, but
`cd &&` is the only convention 6.7 uses — a `-C` would mix two styles in the same
step for no gain in safety, and would break the visual signature (audits, shape
tests) that distinguishes 6.7's commands from the rest of the skill.

---

## Step 1.5 — Check the status (it is a FIELD, not a section)

Read the `status` extracted at Step 1:

| `status` | Action |
|---|---|
| `todo` | ✅ nominal — continue |
| `wip` | ⚠️ already started — ask for confirmation (an agent may already be running) |
| `merged` / `shipped` | **stop**: `✗ TICKET-ID is already delivered (status: <status>). Nothing to code.` |
| `maturing` | **stop**: `✗ TICKET-ID is not matured (status: maturing, no model/effort/review triplet). → node "$HOME/.claude/tools/backlog/backlog.mjs" mature TICKET-ID --model <m> --effort <e> --review <none\|light\|deep> --date <YYYY-MM-DD>` |
| `parked` / `wont` | **stop**: `✗ TICKET-ID is <status> — it is not committed to. Nothing to code.` |

---

## Step 2 — Check the exec block (model / effort / review)

From the frontmatter (Step 1):

- `model` ∈ {`fable`, `opus`, `sonnet`, `haiku`} — otherwise **stop** with a
  message about the unrecognized model.
- `effort` ∈ {`low`, `medium`, `high`, `xhigh`, `max`} — drives the implementer
  sub-agent's **actual reasoning tier**. The `Agent` tool still takes no effort
  parameter; the only mechanical lever is the `effort:` field of a dedicated
  **agent definition**, which Step 6 selects from this value. Injecting the
  effort **into the prompt** survives as a harmless complement, but it is no
  longer the load-bearing mechanism. A value outside the enum → **stop**: the
  frontmatter was hand-edited, since the backlog tool's `mature` verb normalizes
  what it is given and only ever writes these five values. Way out: have it
  re-matured by the tool, not the file touched up.
- `review` ∈ {`none`, `light`, `deep`} — dosage of the **review gate**
  (Steps 6.2 to 6.6, which **you** run). **Absent field → `light`**: the
  default lives in the consumer, not in the data (the maturation stays valid
  without it, and historical tickets don't have it). A value **present but
  unknown** → **stop**, as for an unrecognized `model`: that is a hand-edited
  frontmatter.

| `review` | Effect |
|---|---|
| `none` | No gate — you integrate as soon as the implementer has returned its report |
| `light` *(default)* | 1 fresh-context reviewer, all 4 axes |
| `deep` | 3 fresh-context reviewers in parallel, all 4 axes each, different priority lens |

If `model` is empty while `status: todo`: the frontmatter is inconsistent (the
"exec required for todo/wip/merged" invariant does not hold) → **stop** and
report the offending file.

---

## Step 3 — Check that the spec exists

```bash
test -f "<target_root>/<spec_path>"
```

- If **absent**: **stop** (`✗ Ticket file <spec_path> not found on disk.`)

⚠️ `<spec_path>` is **relative to `<target_root>`** (Step 1). Testing it
relative to your current directory would test a file of the session's repo —
which is **not guaranteed to be `<target_root>`, even in `same-repo`**
(Step 1.2): it does not exist, or worse, exists and is not the right one.

Note: the ticket file **is** the spec. On some projects it contains the whole
design; on others it points to a domain spec (e.g. `See [parse.md](parse.md)`).
The sub-agent is instructed to follow that link.

---

## Step 3.5 — Guard: ticket + spec present on `main` (read from `guards.specOnMain`)

The sub-agent works in a worktree **created from `main`** → it will only see
what is committed on `main`. The Step 1 tool has already verified, on the
**target** repo's `main` (`git -C targetRoot`), that the spec exists there
**and** that its status there is `todo|wip`. Read the result in
`guards.specOnMain`:

- `true` → the maturation is indeed on `main`, continue.
- `false` → **stop**, display:
  ```
  ✗ TICKET-ID (or its matured status) is not on main yet.
    The sub-agent's worktree forks from main → it would not see the ticket.
    → Commit the maturation (specs/ + backlog.json), run /send, then relaunch this skill.
  ```

Note: this guard compares against `main`, not the current working tree. That is
**deliberate** — Step 1 finds the ticket locally, but it is the state of `main`
that matters for the sub-agent.

---

## Step 4 — Check dependencies

Search the ticket file's **body** for dependency patterns:
- `**Depends on**: TICKET-X` / `Depends on: TICKET-X` / `Depends on TICKET-X`
- `⛔ **Blocked** by TICKET-X`
- a `blockedBy: TICKET-X, TICKET-Y` frontmatter field

For each cited ticket, resolve its `status` **with the same resolver as
Step 1**, starting with `<target_root>`, and verify it is `merged` or
`shipped`.

⚠️ **A dependency may live in a DIFFERENT repo than the ticket citing it** —
this skill itself documents that case (a `SKILL-NN` ticket referring to a spec
of the main project). The resolver, though, scans one root at a time: it will
tell you "not found", never "elsewhere". Prescribed conduct, in this order:

1. not found on `<target_root>` → also search `$HOME/.claude` (the harness repo
   scanned by default by the Step 1.1 tool): same mechanics, same absence of
   configuration;
2. still not found → **do not ignore it silently** and do not presume it is
   delivered. Treat it as an **unresolved** dependency and ask for
   confirmation, saying where you looked:
   ```
   ⚠️ TICKET-ID depends on TICKET-X, not found in the scanned roots
      (<target_root> · $HOME/.claude) — status unknown, not necessarily undelivered.
      Launch anyway? (yes / no)
   ```

A dependency whose status is **unknown** is not a **delivered** dependency: the
silence would be the error, not the asking.

- If **one dependency is undelivered**: **ask for confirmation**:
  ```
  ⚠️ TICKET-ID depends on TICKET-X (status: <status>, not delivered yet).
     Launch anyway? (yes / no)
  ```
  If no → stop. If yes → continue.

---

## Step 4.5 — Target worktree path: read from the JSON (CROSS-REPO only)

**Pointer — conditional read.** ⛔ **`same-repo` mode: skip this step** (the
harness assigns the worktree, and the JSON's `worktreePath`/`branch` are `null`).
**In `cross-repo` mode**, the body of this step — and that of Step 5.7, and the
cross-repo variant example — lives in `steps/cross-repo.md`. Resolve its path,
then read it IN FULL with the `Read` tool:

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','steps','cross-repo.md'))"
```

⛔ If you cannot read that file, **STOP and report it** — do not guess what it
contains, and do not skip the step silently. ⛔ **Execute nothing of Step 5.7
now**: you read it here, you only play it in its turn, after the Step 5
confirmation.

---

## Step 5 — Recap before launch

```
Launching TICKET-ID in SDD:
  Model     : <model>
  Effort    : <effort>
  Review    : <review> (<n> fresh reviewer(s)) | none (no gate)
  Repo      : <target_root>   ← same repo as the session | ⚠️ CROSS-REPO
  Spec      : <spec_path> (relative to the repo above)
  Isolation : worktree (the sub-agent works in a dedicated worktree)
            | cross-repo: worktree mounted by me at <worktree_path>, agent WITHOUT isolation
  Mode      : background (notification when done)

The sub-agent will:
  1. Read the spec
  2. Write the tests
  3. Code until the tests pass
  4. Verify (tests + typecheck)
  5. Commit (feat/fix(TICKET-ID): …) then STOP

Then ME (orchestrator):
  6. Spawn <n> fresh reviewer(s) on its commit  ← unless review: none
  7. Constate the git status before/after the review
  8. Launch a fresh corrector on the raw findings; it triages, fixes, re-tests
  9. Write the review register and integrate via /send

The backlog status is set automatically (wip here, merged/shipped by /send) —
the sub-agent never touches it.

Proceed? (yes / no — default yes)
```

If the user explicitly answers `no` or `n` → stop. Otherwise continue.

⚠️ **The `Repo` line is not cosmetic**: it is the only place where the user
sees, BEFORE any side effect, in which tree the cycle will happen. A repo
switch decided by Step 1.1 must therefore **always** pass through this
confirmation — never skip Step 5 on the grounds that the repo was found
automatically.

---

## Step 5.5 — Backlog-as-data: `start` status (BEFORE spawning)

Set the `wip` status on the `main` checkout **before** spawning — so that the
sub-agent, whose worktree forks from `main`, already sees the ticket as `wip`,
and so that `/send`'s `merge` (which only promotes `wip`) has something to work
with. Set via the **global backlog tool**; guarded by its presence → total
no-op if absent, and the bundle no-ops itself in a project without a backlog.
The hook runs **with cwd = the TARGET repo's `main` checkout** (1st entry of
`git worktree list` **of the target repo**):

⚠️ **The `-C "<target_root>"` in the `MAIN` computation is the critical point
of this step** (D3, SKILL-09). Without it, `git worktree list` answers for the
session's repo: the hook would set `wip` — and **commit** — in the wrong repo,
where the id does not exist. The hook always exiting 0, you would see nothing;
the ticket would remain `todo` on the target side and `/send`'s `merge`, which
only promotes `wip`, would never promote it.

⚠️ **Commit SCOPED to the launched ticket only.** The main checkout is shared
(10-15 worktrees/sessions in parallel): committing all of `specs/` would sweep
up the `specs/*.md` **in progress in another session** (happened on
2026-07-17). `start` targets only one known id — so we name exactly its files.

```bash
# ⛔ NEVER write a dollar sign followed by a digit in this file: the skill
# renderer substitutes positional placeholders. A positional awk field thus
# arrives EMPTY on the agent side, and `MAIN` points to the wrong directory,
# silently. (This comment itself avoids quoting one literally — it would be
# eaten.) We use `sed`, which needs no placeholder.
MAIN=$(git -C "<target_root>" worktree list --porcelain | sed -n 's/^worktree //p' | head -1)
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
if [ -f "$TOOL" ]; then
  ( cd "$MAIN" && node "$TOOL" hook start "<TICKET-ID>" )
  PATHS="backlog.json specs/$(printf '%s' "<TICKET-ID>" | tr '[:upper:]' '[:lower:]').md"
  [ -f "$MAIN/specs/backlog.md" ] && PATHS="$PATHS specs/backlog.md"
  git -C "$MAIN" add -- $PATHS
  # `--only`: a bare `git commit` commits the WHOLE index — hence whatever a
  # neighboring session may have staged. `--only` restricts to the named paths.
  git -C "$MAIN" diff --cached --quiet -- $PATHS \
    || git -C "$MAIN" commit -q --only -m "chore(backlog): start <TICKET-ID>" -- $PATHS
fi
```

The hook always exits 0 (lifecycle-hook tolerance): it must **never** block the
launch. No commit if the ticket is not `todo` (already `wip`, or legacy).

⚠️ **The target repo's `main` checkout may be a LIVE checkout** — that is the
case for `claude-config`, whose `main` **is** the user's active configuration
(`$HOME/.claude`: the skills and settings the harness loads live). Two
consequences, to hold together:

- This step and the final `/send` write into it **by construction**: setting a
  backlog status and integrating into `main` means writing into `main`. It
  cannot be avoided — that is the definition of "delivering". What makes the
  write acceptable here is that it is **surgical and committed**: only the
  named paths (`--only`), only backlog artifacts, by you and never by an agent.
- Everything else is **forbidden** in that checkout: no `git checkout`,
  `reset`, `stash`, `clean`, no working-file writes, no `npm install`. A single
  one of those gestures modifies the user's live environment while they are
  using it. If the hook fails or leaves the tree dirty, **stop and report** —
  do not "repair" anything in there.

---

## Step 5.7 — Mount the target worktree (CROSS-REPO mode only)

**Pointer — conditional read.** ⛔ **In "same repo" mode, skip this step
entirely**: `isolation: "worktree"` does the job. **In `cross-repo` mode**, the
body of this step is in `steps/cross-repo.md` — **the same file as at Step 4.5**:
if you already read it there, you have it in front of you, do not re-read it.
Otherwise, resolve its path and read it IN FULL with the `Read` tool:

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','steps','cross-repo.md'))"
```

⛔ If you cannot read that file, **STOP and report it** — do not guess what it
contains, and do not skip the step silently.

---

## Step 6 — Phase 1: spawn the implementer

**Resolve the `subagent_type` — `exec.effort` → agent-def.** The `effort` is no
longer decorative: it picks the **agent definition** that carries the sub-agent's
real reasoning tier. The five agent-defs are named after their tier, hence an
identity, with no intermediate table:

> `subagent_type` = `sdd-impl-<effort>`

That is the `<subagent_type>` of the two blocks below. An `effort` outside Step
2's enum → **stop**, as at Step 2: it would produce a `subagent_type` that does
not exist.

⚠️ **`model` remains a PER-CALL override**, alongside the `subagent_type`: the
official documentation guarantees that the per-call `model` override "takes
precedence over the definition's model" — only the agent-def's `model` is
replaced, its `effort` **survives**. It is that composition which makes the
five-file design sufficient (one agent-def per tier, `model` free per call),
without a model×effort matrix. The `subagent_type` carries the effort; the
`model` parameter carries the model.

Invoke the `Agent` tool with these parameters — **"same repo" mode**:

```
Agent({
  subagent_type: "<subagent_type>",
  model: "<model>",
  isolation: "worktree",
  run_in_background: true,
  description: "SDD <TICKET-ID>",
  prompt: <PROMPT_TEMPLATE>
})
```

**Cross-repo mode**: the same parameters **without the `isolation` line**, and
with the **cross-repo** call prompt below (instead of the "same repo" one).

```
Agent({
  subagent_type: "<subagent_type>",
  model: "<model>",
  run_in_background: true,
  description: "SDD <TICKET-ID>",
  prompt: <PROMPT_TEMPLATE>
})
```

⛔ **Above all, do not leave `isolation: "worktree"` in cross-repo**: it would
create a worktree of the **session's** repo, the agent would land there, would
not find the spec — and, in the worst case, would code the ticket in the wrong
repository. That is precisely the incident that made this mode necessary. The
Step 5.7 worktree is the only place it must work, and it learns that from the
prompt.

⚠️ **Keep the worktree path it reports**: Step 6.5 launches a **fresh corrector**
on that same worktree — the agent's own identifier is not what the gate needs, the
tree holding the reviewed commit is.

Then **wait for its completion notification** before moving to Step 6.1. Spawn
no reviewer until the implementer has returned its report: they would have no
commit to review.

### Two call prompts, chosen by mode — the manual is a FILE

What you send is no longer a template to copy out: it is a **pointer**, a few
lines long. The implementer's complete manual — SDD, guardrails, findings
handling, report format — lives in `prompts/impl-same.md` and
`prompts/impl-cross.md`, which the sub-agent **reads itself** from the machine's
`.claude`. There is therefore nothing left to copy, hence nothing left to get
wrong: that is the entire point of the mechanism.

⛔ **NEVER copy a manual's content into a call prompt**, not even "so the agent
has it in front of it". Copying is precisely what this mechanism removes — the
copy that, past a session's 10th launch, was losing 30% of its mass (including
the "If you are resumed with findings" section) with nothing flagging it.

**"Same repo" mode** → the `<!-- CALL:impl-same -->` block. **"Cross-repo" mode**
→ the `<!-- CALL:impl-cross -->` block. Each block is complete and self-contained:
you substitute values into it and nothing else — you remove no line and add none.

<!-- CALL:impl-same -->
````
You are implementing a ticket in SDD. Here are your variables:

Ticket: <TICKET-ID>
Spec (absolute): <ABSOLUTE_SPEC_PATH>
Effort: <effort>

Your manual — SDD, guardrails, findings handling, report format — is a FILE,
outside your worktree. Resolve its path, then read it IN FULL with the Read tool
BEFORE any other action:

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','impl-same.md'))"
```

⛔ If you cannot read that file, STOP and report it. Do not improvise what comes
next and do not work from memory: everything you have to do is written there.
````

**Substitutions for this block — CLOSED list**: `<TICKET-ID>` (the skill's
argument) · `<ABSOLUTE_SPEC_PATH>` (the `absoluteSpecPath` field from Step 1 —
**never** a relative path nor a path built on the session's repo:
`<target_root>` is not guaranteed equal to the session's root, even in
`same-repo` (Step 1.2) — the agent could not open it, or worse, would open a
stale homonym) · `<effort>` (the frontmatter's effort, Step 2). Nothing else: one
more variable is a ticket, not a launch-time improvisation.

<!-- CALL:impl-cross -->
````
You are implementing a ticket in SDD. Here are your variables:

Ticket: <TICKET-ID>
Spec (absolute): <ABSOLUTE_SPEC_PATH>
Effort: <effort>
Worktree: <worktree_path>
Branch: <target_branch>

Your manual — SDD, guardrails, findings handling, report format — is a FILE,
outside your worktree. Resolve its path, then read it IN FULL with the Read tool
BEFORE any other action:

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','impl-cross.md'))"
```

⛔ If you cannot read that file, STOP and report it. Do not improvise what comes
next and do not work from memory: everything you have to do is written there.
````

**Substitutions for this block — CLOSED list**: the three of the previous block,
plus `<worktree_path>` and `<target_branch>` — both already resolved at Step 4.5,
copied as-is, never re-derived.

⚠️ **The review dosage is NOT injected into this prompt**, and that is
deliberate: the implementer must know neither the number of reviewers, nor the
prompt they receive, nor even whether there will be any. It can then no longer
attest to what it did not do — that is the whole point of the inversion.

---

## Step 6.1 — Locate the implementer's worktree and its SHA

Same principle as Step 1: this deterministic mechanic lives in the
`tools/sdd/preflight.mjs` tool (SKILL-13), which now carries a second verb,
`locate` (SKILL-14). The skill calls it and reads the JSON fields; it
recomputes nothing by hand.

⚠️ **Programmatically, never by transcribing** what the implementer wrote.
(Real failure mode that motivated this tool: a SHA transcribed with 39
characters instead of 40, which makes the reviewer's location assertion fail,
Step 6.3.)

```bash
PREFLIGHT="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','sdd','preflight.mjs'))")"
node "$PREFLIGHT" locate --ticket "<TICKET-ID>" --mode "<mode>" --session-root "<target_root>"
```

In `cross-repo` mode, add `--worktree "<worktree_path>"` (already resolved at
Step 4.5) to the command above: the tool **verifies** that precise worktree
instead of searching for one — same reason as Step 1.2, a `git` command targets
its repo explicitly. In cross-repo, a bare `git worktree list` would enumerate
the **session** repo's worktrees, where the implementer's commit does not
exist — you would conclude "nothing committed" about work well committed
elsewhere.

**Substitutions resolved at this step**: `<mode>` — the `mode` field of the
Step 1 JSON (already decided, Step 1.2), copied as-is.

The tool emits **a single JSON object** on stdout:

```
{ "ticket": "...", "found": true, "worktree": "...", "sha": "...", "commitSubject": "..." }
```

- **`found: false`** (not a code error): **stop**. Either the implementer
  committed nothing ("completed" report without a commit — happened), or its
  worktree disappeared. Spawn no reviewer, report it.
- **`found: true`** → `<WORKTREE_IMPL>` = the JSON's `worktree` field,
  `<SHA_IMPL>` = the JSON's `sha` field — both taken **as-is**, never retyped.

⚠️ **Transcription nuance — do not oversell the fix.** The tool removes the
risk at the SHA's **acquisition** (it comes out of `git`, 40 characters **by
construction**, no more implementer prose to transcribe) — but you, the
orchestrator, then **copy** `<SHA_IMPL>` into the reviewer's prompt
(Step 6.3): that copy remains manual, out of the tool's reach. Take
`<SHA_IMPL>` **verbatim from the JSON field**, never retyped from memory — the
"40 characters by construction" guarantee covers the acquisition, not the
transcription that follows.

These two values, `<WORKTREE_IMPL>` and `<SHA_IMPL>`, serve for the rest of
the gate (Steps 6.2 to 6.7).

---

## Step 6.2 — Review gate: dosage and starting state

**Dosage: the frontmatter's `review` (Step 2), `light` if the field is absent.**

If the dosage is `none` → **skip the rest of this step and Steps 6.3 to 6.6**.
⚠️ **Except Step 6.6.5**: if the implementer declared a spec escalation in its
first-pass report (its SECOND trigger source, § Step 6.6.5), go through 6.6.5
anyway before continuing — that is the ONLY case in which a `none` dosage still
reads a step between 6.2 and 6.7: without that detour, the signal would be lost
in precisely the dosage that has no downstream gate to catch it. Otherwise, go
directly to Step 6.7 (integration), **then to Step 6.8** (measurement): a `none`
cycle also produces its record, with `reviewed: false`. Without that pointer,
cycles without review would be the **only** ones recording nothing — exactly the
population you need to be able to count.

Otherwise, constate the starting state **yourself** — it is half of the
review's read-only guarantee:

```bash
git -C "<WORKTREE_IMPL>" status --porcelain
```

- **Non-empty** output: **stop**. The implementer left uncommitted work; the
  reviewed diff would not be that of `<SHA_IMPL>`. Report it, spawn no
  reviewer.

---

## Step 6.3 — Spawn the reviewers (YOU spawn them)

**Resolve the `subagent_type` — pinned, NOT session inheritance.** Each reviewer
is spawned with `subagent_type: "sdd-reviewer"` — a **generated** agent-def whose
frontmatter is `model: opus`, `effort: high`, with disk↔generator coherence locked
by a test, the same mechanism as the `sdd-impl-*` tiers of Step 6. **Do NOT pass a
`model` parameter to this call**: unlike the implementer (Step 6), the reviewer's
setting is **fixed**, carried by the agent-def itself — letting it inherit the
orchestrating session's model or effort is precisely the defect this closes. The
review's **power** therefore no longer depends on the session that launches
`/sdd-run-ticket`; only the **number** of reviewers (below) remains a dosage.

**At dosage `deep` only**, first compute one report path per reviewer,
`<REPORT_PATH>` — **OUTSIDE any repository** (a temporary directory, e.g.
`<tmpdir>/sdd-review-<TICKET-ID>-<n>-<suffix>.md`). Three rules, all necessary:

- **One file per reviewer, never a shared file**: with a shared file, one
  reviewer would read another's report and the independence of the draws — the
  entire value of the `deep` dosage — would be destroyed.
- **`<suffix>` is NEW on every execution of this step** (a timestamp, a PID, or a
  random value — never just `<TICKET-ID>-<n>`): a retry of the same ticket after
  an abort (dirty worktree at Step 6.2, inadmissible report at Step 6.4) must
  **never** reuse a path from a previous attempt, where a stale file could still
  be lying around — the Step 6.4.5 aggregator has no way of telling a fresh
  report from one left by an earlier launch at the same path.
- **At dosage `light`, compute NOTHING**: no aggregator will ever read that file
  (§ Step 6.4.5), writing it would be dead work every cycle.

That path is the value to substitute into the `CALL:reviewer-deep` block below;
**keep it**, Step 6.4.5 needs it.

With the `Agent` tool:

- `subagent_type: "sdd-reviewer"`, `run_in_background: false`
- ⚠️ **WITHOUT the `isolation` parameter** — the reviewer must land in the
  implementer's worktree. Giving it an isolated worktree would make it review
  another tree.
- `prompt: <REVIEWER_PROMPT>` — the dosage's **call prompt**: the
  `<!-- CALL:reviewer-light -->` block in `light`, the
  `<!-- CALL:reviewer-deep -->` block in `deep`.
  **Substitutions of this parameter**: `<REVIEWER_PROMPT>` → that block, copied
  in full, its own placeholders already filled in by you.
- `light` → **1** reviewer, who receives the 4 axes.
- `deep` → **3** reviewers **in parallel** (a single message, 3 `Agent` calls).
  Each also receives **the 4 axes** — never a subset — with a different
  **priority lens** ("start with axis 1", axis 2, axis 3). The axes are
  **not** a partition: `deep` does not buy three complementary coverages, it
  buys **three decorrelated draws** on the same diff, and it is their
  redundancy that catches the findings.

⛔ **Absolute prohibition on summarizing, justifying or commenting on the
implementer's work in this prompt.** You substitute ONLY mechanical values into
it. The reviewer must arrive blank on the diff: do not tell it an agent wrote
this code, do not explain the choices made, do not suggest where to look. You
have not read this diff either — that is comfortable, keep it that way.

Keep the **raw** reports: they, and they alone, feed Step 6.4's admissibility
check and then Step 6.4.5 — which relays them as-is at dosage `light` (nothing to
merge), or has them aggregated by the aggregator at dosage `deep` (§ Step 6.4.5).
What Steps 6.5 and 6.6 receive is therefore no longer systematically the raw
report itself: it is `<RAW_FINDINGS>`, defined at Step 6.4.5.

### The two reviewer call prompts — its manual is a FILE

The reviewer's complete manual — location assertion, prohibitions, **the 4 axes**
and the output format — lives in `prompts/reviewer.md`, which the reviewer
**reads itself**. The axes have stopped being an injection: they are now
invariants of the file, and no reviewer can ever receive three out of four
because a transcription got tired.

⚠️ Here, `<ABSOLUTE_SPEC_PATH>` is the `<spec_path>` **resolved inside
`<WORKTREE_IMPL>`**, not in your own checkout: step 1 of SDD allows the spec to
have been updated in the reviewed commit, and the reviewer judges the code
**against the delivered contract**. Handing it your copy would make it review a
stale spec — or a nonexistent path if your worktree does not yet have the ticket.

<!-- CALL:reviewer-light -->
````
You are a code reviewer. You produce a report, nothing else. Here are your variables:

Ticket: <TICKET-ID>
Reference spec (contract): <ABSOLUTE_SPEC_PATH>
Working directory: <WORKTREE_IMPL>
Reviewed commit: <SHA_IMPL>

Your manual — location assertion, prohibitions, review axes, output format — is a
FILE, outside this worktree. Resolve its path, then read it IN FULL with the Read
tool BEFORE any other action:

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','reviewer.md'))"
```

⛔ If you cannot read that file, STOP and report it. Do not improvise what comes
next and do not review anything from memory: everything you have to do is written
there.
````

**Substitutions for this block — CLOSED list**: `<TICKET-ID>` ·
`<ABSOLUTE_SPEC_PATH>` (resolved inside the reviewed worktree, see above) ·
`<WORKTREE_IMPL>` and `<SHA_IMPL>` (Step 6.1, taken **verbatim** from the JSON,
never retyped). **No `<REPORT_PATH>` in `light`**: no aggregator spawns for a
single report (§ Step 6.4.5), the file would have no reader. No lens is assigned:
the single reviewer sweeps the four axes on an equal footing.

<!-- CALL:reviewer-deep -->
````
You are a code reviewer. You produce a report, nothing else. Here are your variables:

Ticket: <TICKET-ID>
Reference spec (contract): <ABSOLUTE_SPEC_PATH>
Working directory: <WORKTREE_IMPL>
Reviewed commit: <SHA_IMPL>
Priority lens: <PRIORITY_AXIS>
Report deposit path: <REPORT_PATH>

Your manual — location assertion, prohibitions, review axes, output format — is a
FILE, outside this worktree. Resolve its path, then read it IN FULL with the Read
tool BEFORE any other action:

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','reviewer.md'))"
```

⛔ If you cannot read that file, STOP and report it. Do not improvise what comes
next and do not review anything from memory: everything you have to do is written
there.
````

**Substitutions for this block — CLOSED list**: the four of the previous block,
plus `<PRIORITY_AXIS>` (axis 1 for reviewer A, axis 2 for B, axis 3 for C — one
different lens per reviewer, never a subset of the axes) and `<REPORT_PATH>` (the
per-reviewer path computed above, distinct for each of the three).


---

## Step 6.4 — Integrity check (YOU constate it)

As soon as the reviewers have returned their reports:

```bash
git -C "<WORKTREE_IMPL>" status --porcelain
git -C "<WORKTREE_IMPL>" rev-parse HEAD
```

The reviewer is supposed to be read-only but **technically keeps** Write/Edit:
its instruction is declarative, these two commands are the only real
guarantee. **Both are necessary**: `status` alone is empty after a
`git commit`, hence blind to a reviewer that committed or amended by reflex.
If anything moved since Step 6.2, or if HEAD is no longer `<SHA_IMPL>`:
**STOP** — launch no corrector (Step 6.5), do not integrate, report "a reviewer
wrote" with the raw output of these commands.

**Admissibility of reports** (as important as their content): an admissible
report ends with its `TOTAL: <n> finding(s)` line. A report that says
`MISMATCH`, that stops without `TOTAL:`, or that explains it could not read
anything, **is not a "0 findings"**: it is a review that did not happen. Fix
the cause (truncated SHA, wrong spec path) and **respawn that reviewer** — it
is not a second round of review, it is the first one that did not happen.
Never count such a report in `R`.

---

## Step 6.4.5 — Aggregating the findings (dosage `deep` only)

**Pointer — conditional read.** **At dosage `light`, skip this entire step**: a
single report, nothing to merge — `R = U`, go directly to Step 6.5 with that
report as `<RAW_FINDINGS>`. ⛔ That path does not read the file below: there is
nothing there for it.

**At dosage `deep`**, the body of this step is in `steps/review-deep.md`. Resolve
its path, then read it IN FULL with the `Read` tool:

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','steps','review-deep.md'))"
```

⛔ If you cannot read that file, **STOP and report it** — do not guess what it
contains, and do not skip the step silently. ⚠️ The `<!-- CALL:aggregator -->`
block below, however, **stays here**: the body is read over there, the block is
copied from here — the round-trip is intended, and this sentence is what
announces it.

<!-- CALL:aggregator -->
````
Ticket: <TICKET-ID>
Report 1: <REPORT_PATH_1>
Report 2: <REPORT_PATH_2>
Report 3: <REPORT_PATH_3>

Your system prompt points you at `prompts/reviewer.md`: that pointer DOES NOT
APPLY to this launch. Your conduct is entirely in `prompts/aggregator.md`, outside
this worktree. Resolve its path, then read it IN FULL with the Read tool BEFORE
any other action:

```bash
node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','aggregator.md'))"
```

⛔ If you cannot read that file, STOP and report it. Do not improvise what comes
next and do not work from memory: everything you have to do is written there.
````

**Substitutions for this block — CLOSED list**: `<TICKET-ID>` ·
`<REPORT_PATH_1>`, `<REPORT_PATH_2>`, `<REPORT_PATH_3>` — the three paths
computed at Step 6.3, in the order the reviewers were spawned.

---

## Step 6.5 — Fresh corrector on the raw findings

**Launch a FRESH corrector** on the implementer's worktree. That is the nominal
mode, and the only one: there is no fallback path, because a path never taken
degrades without a witness — the same argument that forbids copying a manual into
a call prompt (§ Step 6). The context of the Step 6 agent is not what a fresh
corrector lacks: it re-reads its manual IN FULL, and the rationale behind the
conservative choices is in the commit messages, which it re-reads with `git log`.

Same parameters as Step 6 — `subagent_type` = `sdd-impl-<effort>`, the ticket's
`model` — **without the `isolation` line, in BOTH modes**:

```
Agent({
  subagent_type: "<subagent_type>",
  model: "<model>",
  run_in_background: true,
  description: "SDD <TICKET-ID> (correction)",
  prompt: <PROMPT_TEMPLATE>
})
```

⛔ **No `isolation` here, even in "same repo" mode**: the worktree already exists
and holds the reviewed commit. An `isolation` would create a second, blank one —
the corrector would "fix" a tree without the commit to fix, and would announce
SHAs unfindable in `<WORKTREE_IMPL>`.

⚠️ **The `(correction)` suffix of the `description` is a literal, and it is not
decorative: it MARKS this launch for the Step 6.8 measurement.** Without it, the
Step 6 implementer and this corrector carry the same `description`; the
measurement, which keeps the ticket's **last** launch, switches to the corrector,
and `spawnIndex`, `prompt` and `tokensAtSpawn` then designate the correction
instead of the cycle — a plausible and false record. It breaks nothing:
`TICKET_ID_FROM_DESCRIPTION_RE` stops at the **first blank**, so
`SDD <TICKET-ID> (correction)` yields exactly the same ticket identifier as
`SDD <TICKET-ID>`. ⛔ **Apart from that suffix, the `description` stays word for
word the one from Step 6.**

The prompt carries the findings:

```
Resumption on <TICKET-ID>. Your diff has been reviewed. Here are the findings, verbatim:

<RAW_FINDINGS>

Apply the "If you are resumed with findings" section of your manual. Your manual
is a FILE: re-read it IN FULL rather than trusting your memory — that is
precisely the section memory loses. Its path:

node -e "console.log(require('path').join(require('os').homedir(),'.claude','prompts','<manual>'))"

Triage (E1/E2/E3), fix, re-run tests + typecheck, commit. Then return your
disposition table — one line per number above — and STOP.
⛔ Invoke neither /send nor /deploy.
```

⚠️ **The resolution command is given again here, and that is not redundancy**: a
fresh corrector has no call prompt behind it at all, and even a resumed agent
carries its initial prompt at the head of its context, where compaction summarizes
first. Without that path the corrector would handle the findings from memory,
without E1/E2/E3 and without the disposition format. That is the failure mode this
mechanism exists to close; do not remove those two lines.

**Substitutions of this message**: `<RAW_FINDINGS>` → the `U` unique findings,
numbered, composed under the following rules — the **aggregated list** of Step
6.4.5 at dosage `deep`, the single report at dosage `light`; `<manual>` → the
file name sent at Step 6 (`impl-same.md` in "same repo" mode, `impl-cross.md` in
cross-repo) — **the same one**, never the other (the `<TICKET-ID>` is the
skill's):

- **Verbatim.** Each finding's text is copied as-is. You do not summarize it,
  do not rephrase it, do not rank it, discard none — you have not read the
  diff, you are in no position to judge, and a finding discarded here is a
  silent dismissal nobody would see a trace of.
- **No attribution, no counts.** No mention of the reviewer that raised it, of
  the number of reviewers, of the dosage, nor of the number of empty reports.
  That information is your evidence, not theirs: giving it to the corrector
  would hand back exactly the material it must no longer be able to attest to.
- If `U` is **0**, launch no corrector: there is nothing to fix.
  Move to Step 6.6 with an empty register.

⏳ **Wait for its disposition table before Step 6.6**, exactly as you waited
for its completion notification at Step 6. It works in the background:
chaining without waiting would make you publish a register with empty
dispositions, and Step 6.7 would `/send` a tree it is in the middle of
editing.

⛔ **One round only.** Once the implementer has returned its dispositions, you
spawn no second wave of reviewers, even if its fixes are substantial.

---

## Step 6.6 — Review register (written by YOU)

You now have both columns: the **incoming** findings (your reports) and the
outgoing **dispositions** (the corrector's table). Cross them and publish
the register — it is a **constatation**, not a transcribed declaration:

```
Review: <n> reviewer(s) · R raised findings · U unique after merge
| # | Finding (short title) | Reviewer | Disposition |
|---|---|---|---|
| 1 | …                     | A        | fixed (<sha>) |
| 2 | …                     | A, C     | escalated — E1: <justification> |
| 3 | …                     | B        | ticket created — E2: <id> |
Check: U unique = U disposed ✓
Spec escalation (first pass): none | <summary — outside the equation, Step 6.6.5>
Orchestrator observation: none | <summary — outside the equation, Step 6.6.5>
git status during the review: clean | WROTE — <what moved>
Correction regime: fresh corrector | none — U = 0 | none — stopped at Step 6.4
```

- **Two distinct counters, not one.** `R` = the **raw raised findings** (the
  sum of findings across all reports, before duplicate merge — a count of
  findings, not of reports). `U` = the **unique** findings after merge. Three
  reviewers raising the same finding give `R=3, U=1`. Replace `R` and `U` with
  the real numbers.
- A finding raised by several reviewers is **one line**, with all its
  reviewers in the "Reviewer" column — it is that column, with `R`, that
  measures redundancy across dosages. You alone know that attribution: you
  placed the calls.
- The **Check** line is mandatory and bears **only on `U`**: as many unique
  findings as disposed lines. Never put `R` in that equation — `R > U` is the
  **nominal** case in `deep`, not an anomaly, and the equation would not
  balance. A **missing disposition** is mechanically visible here, since you
  hold the input list: if the two numbers differ, do not publish a false
  total — write it explicitly, say which numbers lack a disposition, and **do
  not integrate** before obtaining them (one more resumption is allowed for
  that: it is claiming a missing answer, not a second round of review).
- The **`git status` during the review** line reports your constatation from
  Steps 6.2 and 6.4 — `clean`, or the detail of what moved, in which case you
  stopped at Step 6.4 and there are neither fixes nor integration.
- **Verify the `fixed (<sha>)` entries before transcribing them.** It is the
  only column still declared by the implementer: list the commits actually
  added since the review and confront them with the announced SHAs —

  ```bash
  git -C "<WORKTREE_IMPL>" log --oneline "<SHA_IMPL>..HEAD"
  ```

  An announced SHA that does not appear (or three findings "fixed" by the same
  one-line commit) is not a fix: claim the real disposition before
  integrating. Without this check, the register loops on false dispositions —
  the `U` check only detects a **missing** line, never a **lying** one. Note
  that after a `git commit --amend`, `<SHA_IMPL>` is no longer reachable: in
  that case the command errors out and the amended commit is to be confronted
  with `git -C "<WORKTREE_IMPL>" show --stat HEAD`.
- Each line has exactly one disposition, never empty: `fixed (<sha>)`,
  `escalated — E1: <justification>` (or E3), or `ticket created — E2: <id>`.
  The escalations are what the user must arbitrate — the register exposes
  them, it does not bury them in prose.
- `0 findings` is a perfectly valid outcome: empty register,
  `Check: 0 unique = 0 disposed ✓`.

---

## Step 6.6.5 — E1/E3 escalations (written, not merely published)

⛔ **This runs only if the Step 6.6 register carries at least one
`escalated — E1` or `escalated — E3` disposition, or if the implementer declared
a spec escalation in its first-pass report** (§ "Spec escalation (first pass)" of
its manual, the "contradictory spec" case of its "If you find yourself stuck"
section), **or if YOU yourself formed a Step 6.6 observation — the third source,
bounded by the three conditions of the ⛔ paragraph below.** No escalation → no
section, no commit: an empty section would say an arbitration was requested when
none was — the same defect as a register fabricated at dosage `none` (§ Step 7).
E2 is not concerned: the ticket it created is already its durable trace.

⛔ **The third source — the observation YOU form yourself at Step 6.6, crossing
the register's material with a clause of the spec — is bounded by THREE
cumulative conditions, and a missing condition closes it: it does not soften
it.** (1) **Anchoring** — the observation is born of an element the register
**already** carries (a finding and its disposition, or a `fixed (<sha>)` you have
just verified), crossed with a **named** clause of the spec (file, section,
quotation); without that anchoring it is not an observation but a **re-read**:
you are not a reviewer, and Step 6.6 is not a second gate. (2) **Lack of
authority** — fixing the clause at issue would be **deciding**: it is outside the
ticket's Scope section, or fixing it would amount to rewriting the contract by
implementing it. This is not a lack of **capability**: you can perfectly well
write in that spec, it is even what this step makes you do — the boundary is
between **writing the escalation**, hence making arbitration possible, and
**settling it**, hence taking it in the user's place. (3) **Perishability** —
unwritten, the information dies with the session: it has no finding, no
disposition, no ticket carrying it. A defect the corrector **could** have fixed is
a finding the gate missed: it is not an escalation, and manufacturing one to house
it is the exact inverse of this mechanism.

- **Where**: the ticket's spec (`<ABSOLUTE_SPEC_PATH>`), resolved inside
  `<WORKTREE_IMPL>` — never in a live checkout. **Appended into the body**, under
  an `## Escalations` heading (a single section for the whole file; if one
  already exists from a previous cycle, add an entry inside it rather than
  creating a second), never in the frontmatter: the frontmatter stays mutated
  exclusively by the tool (the skill's Strict rules). **Each escalation is a
  level-3 heading under that container** — never `##` (already taken by the
  container), never `####`: the `backlog escalations` verb requires that exact
  depth.
- **An escalation may bear on the spec itself, and that is the nominal case, not
  an exception**: E1 means "the *what* has to change", so its most frequent
  object is a defect **in the spec**. Do not soften it into "the spec should
  perhaps be reviewed" — name the defect observed and cite what proves it. The
  prohibition that bounds E1 ("you do not touch the spec") applies to the
  **implementer**; you, the orchestrator, are precisely the one who writes here.
- **How**: a separate commit, scoped to the spec alone —
  `docs(<TICKET-ID>): escalation E1` (or `E3`, or `E1/E3`) — never folded into
  the commit of the ticket that went through the gate: what is not reviewed code
  must stay visible as such. That commit precedes the rebase of the `/send` that
  follows; its SHA will be rewritten, without consequence — the trace is the
  content.

  ```bash
  git -C "<WORKTREE_IMPL>" add "<ABSOLUTE_SPEC_PATH>"
  git -C "<WORKTREE_IMPL>" commit -q --only -m "docs(<TICKET-ID>): escalation E1" -- "<ABSOLUTE_SPEC_PATH>"
  ```

  As for every command in this range of steps (Step 1.2), the repo is named **in
  the command itself** (`-C "<WORKTREE_IMPL>"`), never by an earlier `cd`: a bare
  `git` command would commit into your session's repo, not into the reviewed
  worktree.
- **Required content, no literal template** to copy word for word (a locked
  formula prevents its own correction if its logic turns out to be wrong) — **the
  elements depend on WHICH SOURCE** triggered this step (§ above); in both cases,
  you do not arbitrate, you make arbitration possible:
  - **"Register" source** (an `escalated — E1`/`E3` disposition) — four elements:
    the **finding's number** in the Step 6.6 register and its type (E1 or E3);
    **what the gate found**, with what makes it true (file, line, quote); **why
    the implementer could not fix it**; **the possible ways out, not decided**.
  - **"First pass" source** (the initial report's declaration, outside the
    register) — three elements, NOT the four above: this source has neither a
    finding number (Step 6.6 explicitly excludes it from `U`) nor a "what the
    gate found" (the gate had not yet happened when it was declared) — do not
    invent them. Instead: **the contradiction itself**, citing the two clauses
    that exclude each other (file, line); **the choice the implementer made**,
    and why it is the most conservative; **the possible ways out, not decided**.
- **One single formal constraint, on the `###` title** — this disavowal of
  templates covers the two content lists above, and there is no literal template
  for this point either, but there is a locked prefix: the `###` title starts
  with its tag — `E1`, `E3` or `E1/E3`, optionally suffixed (`E1-a`, `E1.b`,
  `E1 (finding 2)`) — followed by the rest of the title. An escalation from the
  "first pass" source is **always** tagged `E1` (it always contests the *what*,
  never a test); its suffix then names the declaration rather than an absent
  finding, e.g. `E1 (first-pass declaration)`. A mechanical reader
  (`backlog escalations`) recognizes an escalation by that prefix; what this repo
  *produces* must guarantee it, not leave it to inference.

  ```
  ### E1 (finding 2) — the position of the tag in the title
  ```

The register (6.6) and Step 7 keep publishing the escalations in conversation:
this step adds to them, it does not replace them.

---

## Step 6.7 — Integration

The implementer never invokes `/send`: you integrate, once the register is
closed. Verify its worktree is clean — **every** command carries its own `cd`:
the shell's current directory is not assumed to persist from one command to the
next:

```bash
cd "<WORKTREE_IMPL>" && git status --porcelain
cd "<WORKTREE_IMPL>" && git rev-parse --abbrev-ref HEAD
```

- **Non-empty** `status` output: **stop** — uncommitted work remains, and it
  is not yours to commit.
- The branch must be the implementer's (`worktree-agent-*`), never `main`.

Then execute `/send` (rebase + fast-forward, and backlog hooks `merge`/`ship`).

⚠️ **`/send` is not an isolated subprocess: you are the one executing, one by
one, the commands it prescribes** (`send.md`) — in the same shell regime as those
in the block above, hence with the same cwd that never persists from one command
to the next. `/send` is out of scope here: its text still shows its bare `git`
commands (it assumes a stateful `cd` written once in its Prerequisite). That
changes nothing about the rule you apply to them here: **every `git` command you
execute on its behalf** — prerequisite, rebase, hooks — carries the same
`cd "<WORKTREE_IMPL>" && ` as the commands above, even when `send.md` shows it
bare. There is **no single point** where "verify before invoking" would do: an
isolated `cd "<WORKTREE_IMPL>"` run just before would protect none of the
commands that follow — the guarantee is line by line, down to `/send`'s last
command.

- In cross-repo, the `main` into which `/send` fast-forwards is the target
  repo's — hence, when the target is `claude-config`, **the live checkout**.
  That is intended: it is where the deliverable must land. Nothing else is
  touched there.
- **No `cd` "stays" anywhere**: since the cwd never persists from one command to
  the next, there is nothing to restore after `/send` — the next command,
  wherever it is written (a second ticket, a verification, another `/send`),
  starts from the session's root as always. Do not reintroduce a stateful `cd`
  to "come back": that would be falling back onto the very premise this corrects.

- ⛔ **NEVER run `/deploy`**: if `/send`'s message displays "→ Run /deploy",
  it is a suggestion for the user. Deploying to prod is a human decision.
- **Conflict on `specs/backlog.md` / `backlog.json` during the rebase**:
  nobody is supposed to have touched those files. **Do not resolve it by
  hand**: take `main`'s version (`git checkout --ours` is ambiguous during a
  rebase → use `git show main:<file> > <file>`), `git add` the file, then
  `git rebase --continue`. Those artifacts are **regenerated** from the
  frontmatter — never edited. If it happens again, **stop and report**.

### The `<final_sha>` is taken AFTER `/send`'s rebase, never before

⚠️ **Do NOT take `<final_sha>` before executing `/send`.** Its own Step 3 (the
rebase onto main) **rewrites every commit on the branch** — a SHA taken just
before it is therefore dead by the time it would be displayed or recorded
(observed while integrating a real ticket: `7c55bab` before `/send` had become
`891f064` after the rebase). `/send`'s Step 4 fast-forward, on the other hand,
rewrites nothing: it is indeed that rebase that matters.

So, **immediately after executing `/send`'s Step 3** (before continuing to its
own Step 3.5), take:

```bash
cd "<WORKTREE_IMPL>" && git rev-parse HEAD
```

⚠️ This reading assumes `/send`'s Step 3 **succeeded**. If `/send` stops before
reaching it (its Step 0 guards failing) or during it (unresolved rebase
conflicts), you have **no** `<final_sha>` to take — and nothing to invent:
`/send` already prescribes an immediate stop in both cases (§ Strict rules:
"Non-zero exit code at any step → stop, explain, do not continue"). So you stop
there, **before** this reading, before Step 6.8 and before a nominal Step 7.

It is **that** SHA — and only it — that you will display at Step 7 and pass to
the writer of Step 6.8. It differs from `<SHA_IMPL>` in **two** cases, not one:

1. the implementer fixed something (a `fix(…)` commit added, or a commit
   amended);
2. Step 6.6.5 added its `docs(<TICKET-ID>): escalation` commit — **without any
   fix having taken place**. `<SHA_IMPL>` is only the review's anchor; after an
   amend, a rebase, or that escalation commit, it no longer designates anything.
   Neither case is an anomaly: it is the expected behavior of Step 6.6.5 and of
   `/send`'s rebase.

---

## Step 6.8 — Measurement (written, not published)

The Step 6.6 register is **published in conversation, then dies with the
session**. This step writes its durable part: **one JSON file per ticket cycle**
in a data repository, produced by a dedicated writer tool. You compose nothing —
you pass it what **you** computed (the `R`/`U` counts, the per-lens attribution,
each finding's disposition); the token counts and the launch's rank, for their
part, are **read** from the transcript, never declared.

⚠️ **YOU run this command, from your own shell tool.** Run by a sub-agent, it
would measure the **sub-agent's** transcript — a different quantity, silently.

```bash
WRITER="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','review-log','write.mjs'))")"
node "$WRITER" \
  --ticket "<TICKET-ID>" --project "<project>" --repo "<target_root>" --mode "<mode>" \
  --sha "<final_sha>" --date "<date>" \
  --model "<model>" --effort "<effort>" --review "<review>" \
  --dosage "<dosage>" --reviewers "<n_reviewers>" --r "<R>" --u "<U>" \
  --finding '<finding>'
```

`--finding` is **repeatable**: one occurrence per unique finding of the Step 6.6
register, fields separated by a vertical bar, **the title last** so that a title
containing a bar shifts nothing —
`<i>|<reviewers>|<disposition>|<ref>|<short title>`, for example
`2|A,C|fixed|9f2c1ab|the announced SHA does not exist`. The number is the
register's (**integer ≥ 1**, never empty); `disposition` is a closed enum
(`fixed` · `E1` · `E2` · `E3`); `ref` is the SHA (for `fixed`) or the ticket id
(for `E2`), empty otherwise. **Zero unique findings → no `--finding` at all**,
which is a perfectly valid observation.

⚠️ **A finding's `ref` is taken BEFORE `/send`'s rebase.** It comes from the Step
6.6 register, hence from before the integration of Step 6.7 — unlike
`<final_sha>`, always taken AFTER. It may therefore no longer designate the
commit actually delivered (rewritten by the rebase, or borrowed from another
branch): the writer constates that itself, by checking the SHA's reachability
from the branch.

⚠️ **SINGLE quotes around `--finding`, never double.** The short title is free
text copied from a reviewer's report, and those reports quote code between
backquotes: on the titles this mechanism actually produces, **close to half
contain at least one**, a few a double quote or a `$`. Inside double quotes, the
shell would substitute the backquote and the dollar-parenthesis: the title would
arrive **truncated** — silently, exit code 0, file written — and, with a title
quoting a command, it is that command that would run in your shell. Inside single
quotes, nothing is interpreted. **The one exception to handle**: a straight
apostrophe cannot appear inside a single-quoted string — replace it, in the title
only, with the typographic apostrophe `’`, and touch nothing else.

At dosage `none`, the last four flags have no object — nobody looked, and `0`
would be invented evidence. The command then drops `--dosage`, `--reviewers`,
`--r` and `--u`, and carries no `--finding`.

---

## Step 7 — Confirmation

Once the cycle is finished, display:

```
✓ TICKET-ID delivered.
  Model      : <model>
  Effort     : <effort>
  Review     : <review> (<n> fresh reviewer(s), spawned by the orchestrator)
  Repo       : <target_root>
  Commit     : <final sha, Step 6.7>
  /send      : ✓ integrated into main | <error>
  Measurement: <path of the file written, Step 6.8> | <reason for not writing>
```

The **Measurement** line carries the absolute path returned by the writer, or —
when nothing was written — the **reason** it printed on stderr (data repository
absent, for instance). ⛔ Never leave it empty and never omit the reason: a
silent no-op is indistinguishable from a forgotten measurement.

Followed by the **Step 6.6 register** and any escalations (E1/E3), which are what
the user must arbitrate — cf. Step 6.6.5 for their durable writing.

In `none` dosage, Steps 6.3 to 6.6 did not happen: write the line
`Review: none — no gate, no reviewer spawned` and **publish no register**.
⛔ Above all do not fabricate an empty one: `Check: 0 unique = 0 disposed ✓`
means "reviewers looked and found nothing", and would here be invented
evidence — the very defect this device fights. Step 6.6.5 may have run
nonetheless (its second source, § Step 6.2): if so, mention it here in one line,
without counting it in a register that does not exist.

⚠️ **Verify, do not believe**: a sub-agent can return "completed" having
stopped midway (tests half-written, no commit). Confirm that the
`feat/fix(<TICKET-ID>):` commit is **actually on main** before believing a
report — and that the ticket's status did move to `merged`/`shipped`:

```bash
git -C "<target_root>" log main --oneline -5
```

⚠️ This final check is the last place where "everything works, but in the
wrong tree" can still be caught — provided you look at the **target** repo's
`main`. Without `-C "<target_root>"`, you would observe the commit's absence
in the session's main and conclude failure, or worse, watch five unrelated
commits go by and declare yourself satisfied.

Finally, in cross-repo, the Step 5.7 worktree belongs to you: it is **not**
cleaned by the harness. Once the ticket is delivered, report its path to the
user (`git -C "<target_root>" worktree remove "<worktree_path>"` when they no
longer need it) — do not delete it yourself, the E1/E3 escalations may still
need the tree.

---

## Strict rules

- **Never** hand-edit `specs/backlog.md` / `backlog.json` / a ticket's
  frontmatter — neither you nor the sub-agent. The status is set by the hooks
  (`hook start` here, `hook merge`/`ship` at `/send`). Any manual mutation
  goes through the global tool (`backlog set|mature|new`).
- **Never** reintroduce a project-specific fact into this skill (stack, ORM,
  host, file name). The project's `CLAUDE.md` is authoritative.
- **Never** launch several agents on the **same ticket** (the `wip` status at
  Step 1.5 is your signal).
- **Never** ignore an undelivered dependency without the user's explicit
  confirmation (Step 4).
- **Review gate — YOU run it**; the implementer only knows the findings
  triage:
  - The reviewer is spawned **without `isolation`** and **never** writes. Its
    read-only instruction is **declarative** — it technically keeps
    Write/Edit — so the real guarantee is the `git status --porcelain`
    before/after, **which you constate yourself** (Steps 6.2 and 6.4).
    Difference → STOP.
  - The reviewer prompt is **frozen**. Never let a summary, a justification or
    a comment about the reviewed work leak into it: that would inject bias
    into a blank context, and it is the only real contamination vector.
  - The SHA and worktree handed to the reviewer are **read
    programmatically** (Step 6.1), never transcribed from a report: a
    39-character transcription instead of 40 makes the location assertion
    fail, and it happened.
  - No finding is **silently dismissed**, neither by you when composing
    `<RAW_FINDINGS>`, nor by the implementer when triaging: fixed, or
    escalated with justification. Nobody judges severity — you classify
    (E1/E2/E3) or you fix.
  - **One round** of review. No polishing loop.
  - `review` **absent = `light`**. Never write a default value into the
    frontmatter: the default lives here, in the consumer.
- The `/send` is done by **you**, from the implementer's worktree (Step 6.7),
  never by the sub-agent.
- **Target repo — the session's repo is only a default.** The ticket belongs
  to the repo where its deliverable lives (`specs/skill-01.md`), not to the
  one the command is typed from. In cross-repo mode:
  - **never** `isolation: "worktree"` (it would fork the session's repo);
  - **never** a `git` command without `-C`: `git worktree list`, `cat-file`,
    `log main` all answer, without flinching, about the session's repo;
  - the worktree mounts **outside** the target repo's tree, and the "not under
    the target root" assertion (Step 4.5) is verified before the recap, hence
    before creation;
  - the sub-agent locks its shell by **branch assertion**, not by the
    `.agent_worktree_probe_<TICKET-ID>` probe — that one only serves to
    discover a harness-assigned worktree, which does not happen here.
- **Never write into a live checkout.** When the target repo's `main` is the
  user's active configuration, only two writes are permitted there, by
  **you** and never by an agent: the scoped backlog commit of Step 5.5 and
  `/send`'s fast-forward. No `checkout`, `reset`, `stash`, `clean`, no file
  edit, no `npm install`. The sub-agent, for its part, writes nothing there at
  all — its manual (`prompts/impl-cross.md`) explicitly forbids it.
- If a step fails (resolution, validation, Agent launch): **stop**, explain
  what went wrong, do not continue.

---

## Typical use case

```
[user]    /sdd-run-ticket ANALYTICS-02S
[skill]   Launching ANALYTICS-02S in SDD:
          Model     : sonnet
          Effort    : high
          Review    : light (1 fresh reviewer)
          Repo      : /c/dev/myproject   ← same repo as the session
          Spec      : specs/analytics-02s-batch-compute-if-null.md (relative to the repo above)
          Isolation : worktree
          Mode      : background
          Proceed? (yes / no)
[user]    yes
[skill]   ✓ SDD agent launched on ANALYTICS-02S.
          ...
[notif]   Agent "SDD ANALYTICS-02S" completed. Commit d1f1ef7, 8 tests green.
[skill]   → worktree + SHA re-read programmatically, git status clean
          → 1 reviewer spawned (light), 2 findings raised
          → fresh corrector launched on the 2 findings, dispositions returned
[skill]   ✓ ANALYTICS-02S delivered.
          Review: 1 reviewer · 2 raised findings · 2 unique after merge
          | # | Finding                    | Reviewer | Disposition |
          |---|----------------------------|----------|-------------|
          | 1 | empty batch unhandled      | A        | escalated — E1: the spec does not say what to do |
          | 2 | counter not reset          | A        | fixed (a3c9b21) |
          Check: 2 unique = 2 disposed ✓
          git status during the review: clean
          /send: ✓ integrated into main
```

### Cross-repo variant (ticket of another repo)

The worked example of a cross-repo cycle lives with the rest of that mode's body,
in `steps/cross-repo.md` (Steps 4.5 and 5.7) — read there, not duplicated here.

---

## Note on parallel agents

You can invoke this skill several times in a row with different `TICKET-ID`s.
Each implementer lives in its own isolated worktree → no conflict on the main
repo's files. Since no agent touches the backlog (the status comes from the
hooks, scoped by the `feat/fix(<ID>)` commit), parallel launches no longer
stomp on each other over `backlog.md`. Beware however of tickets that **share
data files** (e.g. translations, fixtures) subject to a coherence test: launch
them **in waves** (the 2nd after the 1st's merge).

In **cross-repo**, each ticket has its own mounted worktree (Step 5.7) and its
own suffix: two tickets of the same target repo do not stomp on each other. But
your successive `cd`s do — Step 6.7 leaves your shell in the worktree it just
integrated. Put it back systematically before picking up the neighboring
ticket, and never rely on the implicit: `git -C` everywhere.

⚠️ In parallel, you hold **one three-beat loop per ticket** (Steps 6 →
6.1-6.4 → 6.5), not a launch you forget. Attach each notification to the right
ticket before acting: Steps 6.1 to 6.7 execute **entirely** with the
`<WORKTREE_IMPL>` and `<SHA_IMPL>` of the ticket concerned, never the
neighbor's.
