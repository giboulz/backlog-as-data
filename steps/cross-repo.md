## Step 4.5 — Target worktree path: read from the JSON (CROSS-REPO only)

⛔ **`same-repo` mode: skip this step** — the harness assigns the worktree, and
the JSON's `worktreePath`/`branch` are `null`.

This step **creates** nothing: it **reads** a path already derived and checked
by the Step 1 tool, so that the Step 5 recap can display it **before** any side
effect. Creation comes later (Step 5.7).

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

> ⛔ **You read both steps at once; you do not play them at once.** The section
> below (Step 5.7) **creates** the worktree — the one above just said it creates
> nothing itself. It only runs in its turn: after the Step 5 recap, the user's
> answer, and Step 5.5's `start` hook. Running its `git worktree add` while
> reading Step 4.5 would mount a branch for a cycle the user can still refuse,
> and the next attempt would hit a path that has become occupied.

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
          ✓ agent launched without isolation, CALL:impl-cross prompt (points at
            prompts/impl-cross.md — nothing is amended, nothing is copied)
          ...
[skill]   ✓ SKILL-09 delivered. Repo: /c/Users/me/.claude
          (worktree kept — remove it when you no longer need it)
```


## Substitutions already resolved on entering this file

One value used by the commands above without being resolved here: it is resolved
earlier in the cycle and arrives here as-is, never re-derived. Declared here so
that this file reads on its own.

**Substitutions**: `<target_root>` — the root of the repo **that owns the
ticket**, the `targetRoot` field of the Step 1 JSON (absolute path). Every `git`
command in this file targets it, never the session's repo.
