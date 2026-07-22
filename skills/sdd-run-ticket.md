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
spawn the reviewers, you constate the worktree state, you send the findings back
to the implementer (resumption), you write the register and you integrate.

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
lives in `claude-config`, even when launched from a session opened elsewhere. In
that case `isolation: "worktree"` is **unusable**: it forks the session's repo,
not the ticket's. The skill then switches to **cross-repo mode** (Step 1.2):
worktree mounted by hand on the target repo, agent spawned **without**
`isolation`. Everything else in the skill — guards, hooks, review, `/send` —
must then target the **target repo**, never the session's. This is the central
failure mode: everything works, but in the wrong tree.

**Portability**: this skill is **generic**. It knows neither the stack nor the
guardrails of any given project — the project's `CLAUDE.md` is authoritative,
and the sub-agent is instructed to read it. Never reintroduce a
project-specific fact here (stack, ORM, host, particular files).

**Specs**: this file is an artifact of `claude-config` — any modification goes
through a `SKILL-NN` ticket in its `specs/`  (ownership rule:
`specs/skill-01.md`). The design of the **review gate** (reviewer template
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
fields; it recomputes nothing by hand. The tilde trap, the double backslashes
swallowed by git-bash and the positional `awk` disappeared **along with** the
prose that carried them — in code, they no longer exist.

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

The ticket does not necessarily belong to the session's repo: a deliverable
that is a global skill lives in `claude-config` (= `$HOME/.claude`), even when
launched from elsewhere. **The Step 1 tool knows this.** Without `--repo`, it
scans **two roots** by default: the session's root, then `$HOME/.claude`, the
root of the `claude-config` repo, **derived from the machine** (never declared,
nothing to keep up to date, nothing to go stale). It is **the only** known
alternative root — no repo registry.

- Ticket found in `$HOME/.claude` → the JSON's `targetRoot` points there and
  `mode` is `cross-repo`: the skill switches automatically (Step 1.2). You do
  **not** have to re-ask for `--repo` — but the Step 5 recap displays the target
  repo in plain sight and expects an explicit confirmation, so no repo switch
  ever happens silently.
- Ticket nowhere → the tool exits non-zero with a message naming **the two
  roots actually scanned** (session · `$HOME/.claude`) and recalling the
  `--repo` flag for a hypothetical **third** repo. Relay that message and stop.

⚠️ `--repo <path>` remains a cheap **escape hatch** for that rare case, not a
contract of N-repo generality: the entire class of tickets that motivated this
mode (deliverable = global skill) **always** points at `$HOME/.claude`, which
the tool can compute. When provided, `--repo` disables any other search (the
tool scans only that root) and an absence there is **final** (no harness
fallback).

---

## Step 1.2 — Decide the mode: read from the `mode` field

The mode is **no longer computed in prose**: it is the `mode` field of the
Step 1 JSON (`same-repo` \| `cross-repo`), already decided by the tool — root
comparison, Windows normalization (separators, drive-letter case) included.

| `mode` | Consequences |
|---|---|
| `same-repo` (nominal) | the skill behaves as before SKILL-09: `isolation: "worktree"`, worktree probe, Steps 4.5 and 5.7 skipped, Step 6 copies Template A directly |
| `cross-repo` | worktree mounted by you (Step 5.7), agent spawned **without** `isolation`, and **every** `git` command in the skill prefixed `git -C "<target_root>"` or `git -C "<worktree_path>"` |

**This is where the deferred verdict of Step 0 lands**: in `same-repo` mode, a
current branch of `main` **stops now**, with the Step 0 message. In cross-repo,
it is ignored.

Note: the `git -C "<target_root>"` blocks in later steps are written to hold
**in both modes** — in "same repo" mode, `<target_root>` is the session's root,
so the `-C` is a no-op. There is nothing to remove.

⚠️ In cross-repo, the rule is mechanical: **a `git` command targets its repo
explicitly**, never by accident. A bare `git` command inherits your shell's
current directory — hence the session's repo — and will calmly answer about the
**wrong tree**: `git worktree list` will list the wrong repo's worktrees,
`git cat-file -e main:…` will look for the spec in the wrong `main`, and
nothing will flag it. That is exactly the defect this mode exists to prevent.

Two ways to target explicitly, and **only one of the two per step**:

| Way | Where | What makes it safe |
|---|---|---|
| `git -C "<target_root>"` / `git -C "<worktree_path>"` | Steps 1 to 6.6 | the repo is named in the command, your `cd` has no influence |
| `cd "<worktree_path>"` then bare `git` | Step 6.7 **only** | `/send` takes no repo argument: it reads the current directory. The `cd` **is** the targeting, and Step 6.7 verifies it with a `git rev-parse --show-toplevel` before invoking anything |

⛔ Do not "fix" the bare `git` commands of Step 6.7 by adding `-C` to them: they
are correct **by construction** (they constate the directory `/send` will run
in). Adding `-C` there would mask precisely what they verify.

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
- `effort` ∈ {`none`, `think`, `think-hard`, `ultrathink`} — informative (the
  `Agent` tool takes no effort parameter): it is **injected into the prompt** as
  a reasoning-depth instruction.
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
which, in cross-repo, does not exist, or worse: exists and is not the right one.

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

⚠️ The `-C targetRoot` **inside the tool** is not decorative (D3, SKILL-09): it
is the `main` of the repo **that owns the ticket** that must contain the spec,
since that is what the worktree will be forked from. Compared against the
session's `main`, this guard would always fail in cross-repo (spec absent) and
block a legitimate launch — or, worse, pass green on a same-path homonym.

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

⛔ **`same-repo` mode: skip this step** — the harness assigns the worktree, and
the JSON's `worktreePath`/`branch` are `null`.

This step **creates** nothing: it **reads** a path already derived and checked
by the Step 1 tool, so that the Step 5 recap can display it **before** any side
effect. Creation comes later (Step 5.7).

The path is **derived**, not configured (decision D2, SKILL-09). The tool
places the worktree **OUTSIDE** the target repo's tree, without exception: a
worktree nested under the target would be scanned, backed up and cleaned by
tools that have no business there — and, when the target is `claude-config`,
purely and simply **loaded by the harness** (a second set of skills and
settings live at once). The worktree root is the one the target repo **already**
uses (read from its own out-of-tree worktrees); failing that, the
`$HOME/claude-config-wt/` convention. The suffix is the lowercased ID.

**Substitutions resolved at this step**: `<worktree_path>` — the JSON's
`worktreePath` field (absolute path), used as-is until the end of the cycle;
`<target_branch>` — the JSON's `branch` field (`claude/` + lowercased ID).

**Assertions read from the guards** — the derived path is not taken on faith:

- `guards.worktreeUnderTarget` is `true` → **REFUSE**: the derivation falls
  under the target repo. **Stop** and report, before even the recap.
- `guards.worktreePathFree` is `false` → **REFUSE**: the path is already
  occupied — probably the worktree of a neighboring session on the same ticket
  (Step 1.5 should have seen it as `wip`). **Stop**; do not "find" another path
  yourself.

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
  8. Resume it with the raw findings; it triages, fixes, re-runs the tests
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

⛔ **In "same repo" mode, skip this step entirely**: `isolation: "worktree"`
does the job, and mounting a duplicate worktree would only end up abandoning
one.

Procedure — the one applied by hand six times on 2026-07-21, without incident.
The path itself was already derived and checked at Step 4.5: only the
**creation** remains here.

Creation, then **branch assertion**:

```bash
git -C "<target_root>" worktree add "<worktree_path>" -b "<target_branch>" main
git -C "<worktree_path>" rev-parse --abbrev-ref HEAD
git -C "<worktree_path>" log --oneline -1
```

- The final `main` of `worktree add` is **mandatory**: without it, the worktree
  forks from the target checkout's current `HEAD`, which can be anything. It is
  also what fulfills point 2 of the procedure (synchronization on `main`) — a
  worktree created from `main` **is** up to date, there is nothing to rebase
  afterwards.
- The displayed branch must be `<target_branch>`, never `main`: otherwise
  **stop**, and remove the worktree
  (`git -C "<target_root>" worktree remove "<worktree_path>"`) before yielding.
- The "path free" check of Step 4.5 predates the user's confirmation: a
  neighboring session may have taken the path in between. No need to redo it —
  `worktree add` fails by itself on an occupied path. **Do not force** that
  refusal and do not derive a fallback path: stop and report.

---

## Step 6 — Phase 1: spawn the implementer

Invoke the `Agent` tool with these parameters — **"same repo" mode**:

```
Agent({
  subagent_type: "general-purpose",
  model: "<model>",
  isolation: "worktree",
  run_in_background: true,
  description: "SDD <TICKET-ID>",
  prompt: <PROMPT_TEMPLATE>
})
```

**Cross-repo mode**: the same parameters **without the `isolation` line**, and
with the prompt from **Template B** below (instead of Template A).

```
Agent({
  subagent_type: "general-purpose",
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

⚠️ **Keep the agent's identifier**: you will **resume** it at Step 6.5 with
`SendMessage`, and it is that resumption — context intact — that replaces
reloading a fresh fixer from scratch.

Then **wait for its completion notification** before moving to Step 6.1. Spawn
no reviewer until the implementer has returned its report: they would have no
commit to review.

### Two complete implementer prompt templates, chosen by mode

⚠️ **These two blocks are fenced with FOUR backticks**, because they themselves
contain three-backtick excerpts. A three-backtick closing would end the
template at the first excerpt — and everything after (substitutions, steps)
would be swallowed into a code block. If you add an excerpt here, keep it at
three.

**"Same repo" mode** → copy **Template A** below, verbatim, placeholders
substituted. **"Cross-repo" mode** → copy **Template B** below, verbatim,
placeholders substituted. Each template is complete and self-contained — **no
more surgery**: the old Step 6' ("four replacements" to perform from memory on
the template) is gone; its result is frozen once and for all in Template B.

<!-- TEMPLATE:same-repo -->
````
You will implement ticket <TICKET-ID> end to end following the project's SDD.

**Spec path (absolute)**: <ABSOLUTE_SPEC_PATH>
**Expected effort**: <effort> — calibrate your reasoning depth on it
(`none` = straight ahead; `think`/`think-hard`/`ultrathink` = think before coding).

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

## SDD discipline (non-negotiable)

1. **Spec**: read the spec linked above in full. It is the source of truth.
   If it **points to a design spec** (e.g. `See [parse.md](parse.md)`), read
   that spec too — the ticket file may be a mere pointer.
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
Ticket: <TICKET-ID>
Branch: <name>
Commit: <SHA>
```

Followed by:
- Short summary (≤ 5 lines) of what was implemented
- Tests added and their count
- Difficulties encountered (if any)

**Important**: the first line `Model used: ...` is non-negotiable — it lets the
user verify that the model decided during maturation was actually used. You
know your execution model (it is in your system context). State it precisely.

## If you find yourself stuck

- Spec ambiguous on a point → pick the most conservative interpretation,
  document the choice in the commit.
- Existing tests broken by your change → fix the tests if the spec requires
  it, otherwise **stop** and report.
- Undelivered dependency detected during implementation → **stop**, report.
- **A command that hangs / exceeds ~3-5 min or awaits input → ABORT it** (use a
  bounded timeout) and report. **Never** stay blocked indefinitely, do not
  relaunch a command that already hung. A hanging command = almost always a
  connection to a service (DB) or an interactive prompt: change approach or
  stop and report.

You have carte blanche inside the worktree. Work in strict SDD.
````

<!-- TEMPLATE:cross-repo -->
````
You will implement ticket <TICKET-ID> end to end following the project's SDD.

**Spec path (absolute)**: <ABSOLUTE_SPEC_PATH>
**Expected effort**: <effort> — calibrate your reasoning depth on it
(`none` = straight ahead; `think`/`think-hard`/`ultrathink` = think before coding).

You work in a dedicated git worktree — your Step 0 below tells you which one and
how to lock your shell onto it. You write nowhere else.

⚠️ **Read `CLAUDE.md` at the root BEFORE coding.** It is what describes the
stack, the verification commands, the conventions and the guardrails **of this
project** (ORM, migrations, deployment, red lines…). This prompt is generic: it
presumes no stack. On conflict, `CLAUDE.md` (project, then global) wins.

## Step 0 — Lock your shell (CRITICAL — BEFORE ANY OTHER COMMAND)

Your worktree was mounted for you in a DIFFERENT repo than the session
launching you. The harness will not assign it to you: you go there, and you
verify.

```bash
cd "<worktree_path>"
test "$(git rev-parse --abbrev-ref HEAD)" = "<target_branch>" || { echo "MISMATCH"; exit 1; }
git rev-parse --show-toplevel
```

MISMATCH → **STOP**, report it, commit nothing, write NO file. This is an
assertion, not a search: do not go fishing for another directory.

⚠️ Verify your path at EVERY write: the same files exist in this repo's main
checkout. An absolute path that does not start with `<worktree_path>` is an
error, never a shortcut.

⚠️ **This `cd` only applies to your Bash shell, and only while it persists.**
No sandbox brings you back here: if a command seems to start elsewhere, if a
`git status` shows you a tree you do not recognize, or at the slightest doubt,
prefix the command with `cd "<worktree_path>" && `. Do it without hesitation
for commands that write — installation, tests, `git add`, `git commit`: a
single one of them executed elsewhere is enough to land your work on the wrong
tree, and nothing will tell you.

## Step 0.1 — Synchronization

Nothing to do: your worktree was just created from this repo's live `main`. Do
not rebase, do not merge, pull nothing.

## Step 0.5 — Environment (node_modules)

Your worktree is OUTSIDE the repo's tree: dependency resolution walks up to
nothing, and the dependency directory may be gitignored here. Installation in
YOUR worktree is therefore an **explicit prerequisite**, not a no-op — run the
project's install command (`CLAUDE.md`, failing that whatever the lockfile at
the root betrays) before any verification. Node example:

```bash
npm install
```

- Installation failure → **stop and report**. Do not run the tests behind it:
  they would fail for an environment reason that you would mistake for a
  defect in your code.

⚠️ NEVER use a junction / symlink to a neighboring `node_modules`:
`git worktree remove` descends into it and empties the target's real
`node_modules`.

## File tools (IMPORTANT — do not lose 2 hours on this)

- ⚠️ **No sandbox protects you here**: your worktree is not a harness-assigned
  isolated worktree. The Step 0 `cd` moves your Bash shell, **nothing else** —
  `Write`, `Edit`, `Read`, `Grep` and `Glob` resolve relative paths against the
  directory you were launched from, which is NOT your worktree.
- **Therefore work with ABSOLUTE paths**, all prefixed with `<worktree_path>`.
  A relative path (`specs/…`, `lib/…`) will not be refused: it will write
  elsewhere, silently, potentially into this repo's live checkout. That is the
  most expensive failure mode of this launch mode.
- **Use the `Write` and `Edit` tools** to create/modify files.
  **NEVER write files via `bash`/`echo`/heredoc/`python`/`.mjs`/PowerShell**:
  it is slow and breaks on backticks and apostrophes (TSX template literals,
  JSON) → failure loop. `Write`/`Edit` handle any character without escaping.
- Before your first write, re-read the path you are about to pass to `Write`:
  if it does not start with `<worktree_path>`, it is a bug, not a shortcut.
- ⛔ **This repo's main checkout may be LIVE** (the user's active
  configuration, loaded by the harness while you work). You NEVER write into
  it, under any pretext: no Edit, no Write, no `git` that modifies its tree.
  The same files exist on both sides — that is exactly why the mistake is easy
  and silent. Your only terrain is your worktree.

## SDD discipline (non-negotiable)

1. **Spec**: read the spec linked above in full. It is the source of truth.
   If it **points to a design spec** (e.g. `See [parse.md](parse.md)`), read
   that spec too — the ticket file may be a mere pointer.
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
Ticket: <TICKET-ID>
Branch: <name>
Commit: <SHA>
```

Followed by:
- Short summary (≤ 5 lines) of what was implemented
- Tests added and their count
- Difficulties encountered (if any)

**Important**: the first line `Model used: ...` is non-negotiable — it lets the
user verify that the model decided during maturation was actually used. You
know your execution model (it is in your system context). State it precisely.

## If you find yourself stuck

- Spec ambiguous on a point → pick the most conservative interpretation,
  document the choice in the commit.
- Existing tests broken by your change → fix the tests if the spec requires
  it, otherwise **stop** and report.
- Undelivered dependency detected during implementation → **stop**, report.
- **A command that hangs / exceeds ~3-5 min or awaits input → ABORT it** (use a
  bounded timeout) and report. **Never** stay blocked indefinitely, do not
  relaunch a command that already hung. A hanging command = almost always a
  connection to a service (DB) or an interactive prompt: change approach or
  stop and report.

You have carte blanche inside the worktree. Work in strict SDD.
````

**Substitutions to make before sending the chosen prompt (A or B)**:
- `<TICKET-ID>` → the skill's argument
- `<ABSOLUTE_SPEC_PATH>` → absolute path to the spec, i.e. `<target_root>` +
  `/` + the `file` from Step 1. **Never** a relative path nor a path built on
  the session's repo: in cross-repo, the agent could not open it — or would
  open a homonym.
- `<effort>` → the frontmatter's effort (Step 2)
- **Template B only**: `<worktree_path>` and `<target_branch>` → already
  resolved at Step 4.5, copy them as-is, do not re-derive them.

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

If the dosage is `none` → **skip the rest of this step and Steps 6.3 to 6.6**,
go directly to Step 6.7 (integration).

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

With the `Agent` tool:

- `subagent_type: "general-purpose"`, `run_in_background: false`
- ⚠️ **WITHOUT the `isolation` parameter** — the reviewer must land in the
  implementer's worktree. Giving it an isolated worktree would make it review
  another tree.
- `prompt: <REVIEWER_PROMPT>` — the **frozen template** below.
  **Substitutions of this parameter**: `<REVIEWER_PROMPT>` → the frozen
  template copied in full, its own placeholders already filled in by you.
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

Keep the **raw** reports: they, and they alone, will feed Steps 6.5 and 6.6.

### FROZEN reviewer prompt template

**Authorized substitutions, and they alone**: `<TICKET-ID>`,
`<ABSOLUTE_SPEC_PATH>`, `<WORKTREE_IMPL>` and `<SHA_IMPL>` (Step 6.1),
`<AXES>` (next section). **All** are filled in by you, the orchestrator — the
implementer never sees this template.

⚠️ Here, `<ABSOLUTE_SPEC_PATH>` is the `<spec_path>` **resolved inside
`<WORKTREE_IMPL>`**, not in your own checkout: step 1 of SDD allows the spec to
have been updated in the reviewed commit, and the reviewer judges the code
**against the delivered contract**. Handing it your copy would make it review a
stale spec — or a nonexistent path if your worktree does not yet have the
ticket.

````
You are a code reviewer. You produce a report, nothing else.

**Scope**: ticket <TICKET-ID>.
**Reference spec (contract)**: <ABSOLUTE_SPEC_PATH>
**Working directory**: <WORKTREE_IMPL>

## Step 0 — Location assertion (BEFORE anything else)

```bash
cd "<WORKTREE_IMPL>"
test "$(git rev-parse HEAD)" = "<SHA_IMPL>" || { echo "MISMATCH"; exit 1; }
git rev-parse --show-toplevel
```

If MISMATCH → **STOP**, report it, review nothing. Do not try to find the
right directory yourself: this is an assertion, not a search.

⚠️ **This `cd` only moves your shell.** Your reading tools (Read/Grep/Glob)
resolve relative paths against the directory you were launched from, which is
NOT this one. So open every file by its **absolute path under
`<WORKTREE_IMPL>`**. A file read relatively would be another tree's version,
and nothing would flag it.

## Step 1 — Read the rules BEFORE the code

In this order:
1. `CLAUDE.md` at the project root
2. The global `CLAUDE.md` (user instructions, already in your context)
3. The reference spec above — it is the **contract**. The code must do what it
   says, no more, no less.

## Step 2 — Read the diff

```bash
git diff --stat main...HEAD
git diff main...HEAD
```

Open the touched files in full when the diff alone is not enough to judge.

## ⛔ Absolute prohibitions

- **Write, modify or create NO file.** No Write, no Edit, no shell write
  command, no `git add`/`commit`/`checkout`/`stash`/`rebase`.
- Run no command touching a live service (DB, dev server): this worktree has
  no secrets, those commands hang.
- **Fix nothing.** You report. Someone else will fix.

## Review axes — you receive them ALL, none is taken from you

<AXES>

## IMPOSED output format

For each finding:

### <short title>
- **Where**: <file>:<line>
- **What breaks**: <the failure, in one sentence>
- **Scenario**: <concrete inputs / action sequence → wrong result>
- **Axis**: <number>

⚠️ **A finding without a concrete scenario is not a finding — omit it.**
A style preference not anchored in any `CLAUDE.md` does not pass this format.

⚠️ **The scenario may be one of USAGE, not only execution.** The victim may be
a reader or an operator, not only a runtime. "The doc says to run X, but X has
failed since this change" **is** a valid and complete scenario — do not
self-censor because there is no crash to describe. Same for an error message,
an example, a README or a comment made false.

⚠️ **Nothing off-format.** If you have something to say, it goes through the
format above or it does not go. ⛔ **No "in passing" remarks in prose**: that
is the worst of both worlds — visible enough to show you saw it, not structured
enough for anyone to be bound to fix it. If it is worth mentioning, it is worth
a finding.

⛔ **Do not say what is fine either.** No conformity recap, no "the rest of the
contract holds", no list of validated decisions, no "point by point"
verification. Your report contains only findings and the `TOTAL:` line. An
exhaustive confirmation is not a proof — it once accompanied a report that
declared conformant the very decisions on which it was missing a defect. That
prose manufactures false confidence: it is more dangerous than silence,
because it looks like verification.

⚠️ **Do not invent findings to pad the count.** "Nothing to report" is a valid
and expected answer. An empty report beats an inflated one — but an empty
report **accompanied by prose remarks** is a contradiction: decide.

End with one line: `TOTAL: <n> finding(s)`.
````

### The 4 axes (to inject as `<AXES>`)

The skill is **generic**: these axes presume no stack. The specifics arrive
via the `CLAUDE.md` the reviewer reads at its Step 1 (axis 4).

⚠️ **The axes are not a partition.** No reviewer receives a subset: `<AXES>`
always contains **all four**, whatever the dosage. Observed on a real `deep`
run: the same finding was labeled "axis 1" by one reviewer and "axis 2" by
another, none stayed in its lane, and the reviewer most disciplined about its
axis is the one that found the **least**. Splitting the axes therefore splits
nothing — it only authorizes a reviewer to ignore three axes out of four.

1. **Spec conformity** — does the code do what the spec says, no more, no
   less? Spec cases not covered? Behavior added that it does not ask for?
2. **Contracts & data** — boundaries (inputs, persistence, serialization, API,
   errors). Breakable invariants. Round-trip. Compatibility with existing
   data.
3. **Simplification & reuse** — duplication, wrong altitude, dead code.
4. **Conformity to the `CLAUDE.md` rules** (project then global) — notably the
   non-negotiable test rules.

In **all** dosages, `<AXES>` = the 4 axes above, copied in full.

- In `light`: nothing more — the single reviewer sweeps them all.
- In `deep`: the 4 axes **plus** one **priority lens** line, different per
  reviewer, at the head of the injection:
  - reviewer A → `Priority lens: start with axis 1, then sweep the other three.`
  - reviewer B → same line with axis 2 · reviewer C → with axis 3.

⛔ Never remove an axis from a reviewer to "leave it its own": the lens
**orders** its sweep, it does not restrict its scope.

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
**STOP** — do not resume the implementer, do not integrate, report "a reviewer
wrote" with the raw output of these commands.

**Admissibility of reports** (as important as their content): an admissible
report ends with its `TOTAL: <n> finding(s)` line. A report that says
`MISMATCH`, that stops without `TOTAL:`, or that explains it could not read
anything, **is not a "0 findings"**: it is a review that did not happen. Fix
the cause (truncated SHA, wrong spec path) and **respawn that reviewer** — it
is not a second round of review, it is the first one that did not happen.
Never count such a report in `R`.

---

## Step 6.5 — Resume the implementer with the raw findings

Merge the duplicates across reports (`R` raised findings → `U` unique findings),
number the unique ones from 1 to `U`, and **resume the implementer**
(`SendMessage` to the Step 6 agent — its context is intact, it reloads
nothing) with this message:

```
Resumption on <TICKET-ID>. Your diff has been reviewed. Here are the findings, verbatim:

<RAW_FINDINGS>

Apply the "If you are resumed with findings" section of your initial prompt:
triage (E1/E2/E3), fix, re-run tests + typecheck, commit. Then return your
disposition table — one line per number above — and STOP.
⛔ Invoke neither /send nor /deploy.
```

**Substitutions of this message**: `<RAW_FINDINGS>` → the `U` unique findings,
numbered, composed under the following rules (the `<TICKET-ID>` is the
skill's):

- **Verbatim.** Each finding's text is copied as-is. You do not summarize it,
  do not rephrase it, do not rank it, discard none — you have not read the
  diff, you are in no position to judge, and a finding discarded here is a
  silent dismissal nobody would see a trace of.
- **No attribution, no counts.** No mention of the reviewer that raised it, of
  the number of reviewers, of the dosage, nor of the number of empty reports.
  That information is your evidence, not theirs: giving it to the implementer
  would hand back exactly the material it must no longer be able to attest to.
- If `U` is **0**, do not resume the implementer: there is nothing to fix.
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
outgoing **dispositions** (the implementer's table). Cross them and publish
the register — it is a **constatation**, not a transcribed declaration:

```
Review: <n> reviewer(s) · R raised findings · U unique after merge
| # | Finding (short title) | Reviewer | Disposition |
|---|---|---|---|
| 1 | …                     | A        | fixed (<sha>) |
| 2 | …                     | A, C     | escalated — E1: <justification> |
| 3 | …                     | B        | ticket created — E2: <id> |
Check: U unique = U disposed ✓
git status during the review: clean | WROTE — <what moved>
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

## Step 6.7 — Integration

The implementer never invokes `/send`: you integrate, once the register is
closed. Put your shell in its worktree and verify it is clean:

```bash
cd "<WORKTREE_IMPL>"
git status --porcelain
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

- **Non-empty** `status` output: **stop** — uncommitted work remains, and it
  is not yours to commit.
- The branch must be the implementer's (`worktree-agent-*`), never `main`.
- That last `git rev-parse HEAD` is the **final SHA**, the one you will
  display at Step 7. It differs from `<SHA_IMPL>` as soon as the implementer
  fixed anything (`fix(…)` commit added, or commit amended): `<SHA_IMPL>` is
  only the review's anchor, and after an amend it no longer designates
  anything.

Then invoke the `/send` skill **from that directory** (rebase + fast-forward,
and backlog hooks `merge`/`ship`).

⚠️ **`/send` is worktree-scoped, hence repo-scoped — but only through your
`cd`** (D3, SKILL-09). It takes no repo argument: it reads
`git worktree list`, `git rebase main` and the hooks **from the current
directory**. The `cd "<WORKTREE_IMPL>"` above is therefore the only thing
making it work on the right repository, and there is no guard behind it.
Verify before invoking:

```bash
git rev-parse --show-toplevel
```

- That output must be `<worktree_path>` in cross-repo (the Step 5.7 worktree),
  not the session's root. Otherwise **stop**: launched in the wrong place,
  `/send` would rebase and fast-forward the **wrong repo**, while displaying a
  perfectly credible success.
- In cross-repo, the `main` into which `/send` fast-forwards is the target
  repo's — hence, when the target is `claude-config`, **the live checkout**.
  That is intended: it is where the deliverable must land. Nothing else is
  touched there.
- **After `/send`, put your shell back** in the session's repo (`cd` to its
  root). A shell left in another repository silently derails everything you
  chain next — a second ticket, a verification command, another `/send`.

- ⛔ **NEVER run `/deploy`**: if `/send`'s message displays "→ Run /deploy",
  it is a suggestion for the user. Deploying to prod is a human decision.
- **Conflict on `specs/backlog.md` / `backlog.json` during the rebase**:
  nobody is supposed to have touched those files. **Do not resolve it by
  hand**: take `main`'s version (`git checkout --ours` is ambiguous during a
  rebase → use `git show main:<file> > <file>`), `git add` the file, then
  `git rebase --continue`. Those artifacts are **regenerated** from the
  frontmatter — never edited. If it happens again, **stop and report**.

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
```

followed by the **Step 6.6 register** and any escalations (E1/E3), which are
what the user must arbitrate.

In `none` dosage, Steps 6.3 to 6.6 did not happen: write the line
`Review: none — no gate, no reviewer spawned` and **publish no register**.
⛔ Above all do not fabricate an empty one: `Check: 0 unique = 0 disposed ✓`
means "reviewers looked and found nothing", and would here be invented
evidence — the very defect this device fights.

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
  all — its prompt (Template B) explicitly forbids it.
- If a step fails (resolution, validation, Agent launch): **stop**, explain
  what went wrong, do not continue.

---

## Typical use case

```
[user]    /sdd-run-ticket ANALYTICS-02S
[skill]   Launching ANALYTICS-02S in SDD:
          Model     : sonnet
          Effort    : think-hard
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
          → implementer resumed with the 2 findings, dispositions returned
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

```
[user]    /sdd-run-ticket SKILL-09
[skill]   → not found in the session's repo (Step 1)
          → found in $HOME/.claude (Step 1.1) — switching to cross-repo
          Launching SKILL-09 in SDD:
          Repo      : /c/Users/me/.claude   ⚠️ CROSS-REPO
          Spec      : specs/skill-09.md (relative to the repo above)
          Isolation : cross-repo — worktree mounted by me at
                      /c/Users/me/claude-config-wt/skill-09, agent WITHOUT isolation
          Proceed? (yes / no)
[user]    yes
[skill]   ✓ worktree mounted on branch claude/skill-09 (from the target repo's main)
          ✓ hook start set on the TARGET repo's main checkout
          ✓ agent launched without isolation, amended prompt (Steps 0 / 0.1 / 0.5 + live-checkout prohibition)
          ...
[skill]   ✓ SKILL-09 delivered. Repo: /c/Users/me/.claude
          (worktree kept — remove it when you no longer need it)
```

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
