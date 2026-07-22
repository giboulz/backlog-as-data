# /send — Send the worktree's work to main

Integrates the current branch into `main` via **rebase + fast-forward**: ticket
commits (`feat(XX-01): ...`) land directly on main, without a parasitic merge
commit.

Execute in exact order, skipping no step.

---

## Prerequisite

Verify the current branch is not `main`:

```bash
git rev-parse --abbrev-ref HEAD
```

- If the branch is `main`: **stop immediately**, display an error.

---

## Step 0 — Structural guards

Coherence tests of typed sources (`*-coherence.test.{js,ts}`: generated views ↔
their sources, migration `.sql` files ↔ `_journal.json`, etc.). Fast (< 5 s),
no DB nor dev server. Justified exception to the "no tests in /send" rule:
these tests verify source integrity, not behavior.

### Environment preflight (self-repair)

A fresh worktree or an emptied main `node_modules` → `vitest` unresolvable,
Step 0 crashes for a non-coherence reason. Normally resolution walks up to
main's `node_modules` (worktrees are nested under it); this net only serves
when main is broken. Idempotent self-repair (no-op if vitest already
resolves):

```bash
node -e "require.resolve('vitest/package.json')" 2>/dev/null || npm install
```

- If `npm install` fails (non-zero exit): **stop**, display the npm error.

### Running the coherence tests

Auto-detection: if at least one file matching
`__tests__/**/*-coherence.test.{js,ts}` (the **detection** — a file glob)
exists in the project:

```bash
npm test -- coherence
```

(the **execution** — a distinct vitest filter, by name: it targets every file
containing `coherence` in its name, whatever the extension → automatically
extensible to any future structural guard).

- If the exit code is non-zero: **stop immediately**, display the failed
  tests, do not continue.

Otherwise (no `*-coherence.test.{js,ts}` file): step skipped silently.

---

## Step 1 — Commit

Display the result of `git status`.

- If the working tree is **clean** (nothing to commit): go directly to step 2.
- Otherwise:
  - If `$ARGUMENTS` is provided → use it directly as the commit message.
  - Otherwise → ask the user for the commit message and **wait for their
    answer**.

  Then run:
  ```bash
  git add -A
  git commit -m "<message>"
  ```

  - If the exit code is non-zero: **stop immediately**, display the error.

---

## Step 2 — Find the main worktree

**Substitutions used in this skill**: `<main_path>` (resolved below),
`<current_branch>` (the branch `/send` is launched from), `<message>` (the
commit message — `$ARGUMENTS` or asked of the user, Step 1).

```bash
git worktree list
```

Identify the path of the worktree whose branch is `main` (usually the first
entry). Store that path in an internal variable `<main_path>` **without
displaying it in the conversation**.

⚠️ `<main_path>` serves **only** for the `git -C` commands of the following
steps. Never use it to read or write files (`Read`, `Edit`, `Write`).

---

## Step 3 — Rebase onto main

From the current worktree, replay the branch's commits on top of main:

```bash
git rebase main
```

- If the exit code is non-zero (conflicts): **stop immediately**. Display the
  error and tell the user to resolve the conflicts then relaunch.

---

## Step 3.5 — Replay the guards AFTER the rebase

⚠️ The Step 3 rebase can **introduce** an incoherence that Step 0 (played
before the rebase) could not see. Real case: a branch forked from a stale main
adds a ticket as done; the rebase brings the same entry back, still **active**,
from main → **active + done duplicate** → coherence violation, never detected
because coherence had only run before the rebase.

So, if at least one `__tests__/**/*-coherence.test.{js,ts}` file exists **and**
the rebase touched `specs/backlog.md` or a typed source (`*.data.ts`,
`_journal.json`, migrations) — when in doubt, replay it systematically
(cost < 5 s):

```bash
npm test -- coherence
```

- If the exit code is non-zero: **stop immediately**, display the failed
  tests. The rebase produced an incoherent state — the user must fix the
  backlog then relaunch. **Do not fast-forward into main.**

---

## Step 4 — Fast-forward into main

From the main directory:

```bash
git -C <main_path> merge <current_branch> --ff-only
```

- `--ff-only` guarantees no merge commit is created.
- If the exit code is non-zero: **stop immediately**, display the error.

### Step 4.5 — Backlog-as-data: `merge` status

Set the `merged` status for every `wip` ticket now on main, and commit the
mutation **on the main checkout** (the push will come at `/deploy`). Set via
the **global backlog tool**; guarded by its presence → total no-op if absent,
and the bundle no-ops itself in a project without a backlog. The hook must run
**with cwd = `<main_path>`** (`process.cwd()` determines which `specs/` is
scanned — `git -C` is not enough):

⚠️ **Never commit all of `specs/` on main.** The main checkout is shared:
10-15 worktrees/sessions run in parallel. The hook is surgical (it only
transitions named tickets), so the commit must be too — otherwise it sweeps up
the `specs/*.md` **in progress in another session**. Happened on 2026-07-17: a
`/send` embarked a neighboring session's `wip` ticket in its
`chore(backlog): merge`. So we commit **only** the actually transitioned
tickets (read from the hook's output) + the 2 generated artifacts:

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
if [ -f "$TOOL" ]; then
  OUT="$( cd "<main_path>" && node "$TOOL" hook merge )"
  printf '%s\n' "$OUT"
  # Ids ACTUALLY transitioned. Uppercase-anchored grammar → the service line
  # "[backlog:hook] merge: nothing to do" does not match (event is lowercase).
  PATHS=""
  for id in $(printf '%s\n' "$OUT" | sed -n 's/^\[backlog:hook\] \([A-Z][A-Z0-9]*\(-[A-Za-z0-9]\{1,\}\)\{1,\}\) : .*/\1/p'); do
    PATHS="$PATHS specs/$(printf '%s' "$id" | tr '[:upper:]' '[:lower:]').md"
  done
  if [ -n "$PATHS" ]; then
    PATHS="backlog.json $PATHS"
    [ -f "<main_path>/specs/backlog.md" ] && PATHS="$PATHS specs/backlog.md"
    git -C "<main_path>" add -- $PATHS
    # `--only`: a bare `git commit` commits the WHOLE index — hence whatever a
    # neighboring session may have staged. `--only` restricts to the named paths.
    git -C "<main_path>" diff --cached --quiet -- $PATHS \
      || git -C "<main_path>" commit -q --only -m "chore(backlog): merge" -- $PATHS
  fi
fi
```

The hook always exits 0 (lifecycle-hook tolerance): it must **never** block
`/send`. No commit if no `wip` ticket is concerned (`PATHS` empty).

---

### Step 4.6 — Deployment mode: `ship`, and push in `push` mode

On projects where **no `/deploy` will ever set `shipped`**, `/send` **is** the
final delivery: it must set `shipped` itself — and, in `push` mode, push. The
mode is declared as data in the `## Deploy` section of the main checkout's
`.claude/deploy.md` (same values as `/deploy` Step 0.1):

| `## Deploy` | Step 4.6 |
|---|---|
| *(section absent)* | **Skipped** — `shipped` will be set by `/deploy` |
| `none` | `hook ship` alone (no target: nothing to push) |
| `push` | `hook ship` **then** push — `/send` is the complete delivery |

Read the value (empty string if absent; parser identical to `/deploy`
Step 0.1 — accepts `## Deploy: push` as well as `## Deploy` + value below):

```bash
MODE="$(cd "<main_path>" && node -e "const fs=require('fs');let v='';try{const t=fs.readFileSync('.claude/deploy.md','utf8').split(/\r?\n/);let i=false;for(const l of t){const m=/^##\s*Deploy\b\s*:?\s*(.*)/i.exec(l);if(m){if(m[1].trim()){v=m[1].trim();break}i=true;continue}if(i){if(/^##\s/.test(l))break;if(l.trim()){v=l.trim();break}}}}catch{}console.log(v.toLowerCase())")"
```

If `MODE` is `none` **or** `push`, set `shipped`. As in step 4.5, the hook
must run with cwd = `<main_path>` (`process.cwd()` determines which `specs/`
is scanned — `git -C` is not enough):

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
if [ -f "$TOOL" ] && { [ "$MODE" = "none" ] || [ "$MODE" = "push" ]; }; then
  OUT="$( cd "<main_path>" && node "$TOOL" hook ship )"
  printf '%s\n' "$OUT"
  # Scoped commit, same reason as step 4.5 (shared main checkout).
  PATHS=""
  for id in $(printf '%s\n' "$OUT" | sed -n 's/^\[backlog:hook\] \([A-Z][A-Z0-9]*\(-[A-Za-z0-9]\{1,\}\)\{1,\}\) : .*/\1/p'); do
    PATHS="$PATHS specs/$(printf '%s' "$id" | tr '[:upper:]' '[:lower:]').md"
  done
  if [ -n "$PATHS" ]; then
    PATHS="backlog.json $PATHS"
    [ -f "<main_path>/specs/backlog.md" ] && PATHS="$PATHS specs/backlog.md"
    git -C "<main_path>" add -- $PATHS
    git -C "<main_path>" diff --cached --quiet -- $PATHS \
      || git -C "<main_path>" commit -q --only -m "chore(backlog): ship" -- $PATHS
  fi
fi
```

⚠️ **`hook ship` is bulk by design** (`every merged → shipped`: a `/deploy`
pushes all of main). Here that is **legitimate** — the step only runs in
`MODE` `none`/`push`, where `/send` IS the delivery. **Never** run `hook ship`
by hand on a project with `## Deploy` absent: you would mark as `shipped`
(= in prod) the `merged` tickets of other sessions still waiting for their
`/deploy`. Happened on 2026-07-17 on the main project.

Then, **only if `MODE` is `push`**, push — after the `ship` commit, so it
leaves in the same push:

```bash
if [ "$MODE" = "push" ]; then
  git -C "<main_path>" push origin HEAD:main
fi
```

`git -C <main_path>` puts HEAD on `main` (the main checkout), so `HEAD:main`
does push main. We keep the `HEAD:main` form anyway — never `origin main` —
for consistency with `/deploy` and `/fastship`.

- If the push fails (non-zero exit — typically the remote diverged): **do not
  panic**. The step 4 fast-forward is already done and remains valid; display
  the error and tell the user to `git pull --rebase origin main` from main
  then push again.
- The `ship` hook always exits 0 (lifecycle-hook tolerance): it must **never**
  block `/send`. No commit if no `merged` ticket is concerned.

---

## Step 5 — Confirmation

The closing message depends on the `MODE` read at step 4.6: **never**
hard-refer to `/deploy` — on a `none` or `push` project, that command does not
apply and the user goes in circles.

- `MODE` empty (section absent) — prod behind main:
  ```
  ✓ <branch> integrated into main (fast-forward).
  → Run /deploy from main to push to production.
  ```
- `MODE` = `none` — no deployment target:
  ```
  ✓ <branch> integrated into main (fast-forward). Tickets moved to shipped.
  → Project without deployment: nothing else to do.
  ```
- `MODE` = `push` — the remote is the backup:
  ```
  ✓ <branch> integrated into main (fast-forward), tickets shipped, pushed to origin/main.
  → Nothing else to do: on this project, the push is the delivery.
  ```

And display main's last 5 commits to confirm the tickets are visible:

```bash
git -C <main_path> log --oneline -5
```

---

## Strict rules

- **Never** run `git push`, **except** the single Step 4.6 case: the project
  declared `## Deploy: push` in its `.claude/deploy.md`. The exception lives in
  the **project's data**, never in the agent's judgment: if a CLAUDE.md, a
  README or the user says "here we push after every commit" while the
  `## Deploy` section says nothing, **do not push** — offer to add
  `## Deploy: push` to `.claude/deploy.md`, and let the user decide.
  (Incident 2026-07-15: lacking a way to declare this mode, a session pushed
  on its own initiative in violation of this rule. The hole was in the config,
  not in the agent — but the answer is to fill the config, not to improvise.)
- **Never** run tests **other than** the structural guards
  (`*-coherence.test.{js,ts}`) of steps 0 **and 3.5** — they are not
  behavioral but verify the integrity of typed sources (before AND after the
  rebase).
- **Never** touch the changelog file.
- Non-zero exit code at any step → stop, explain, do not continue.
