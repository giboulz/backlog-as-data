# /deploy — Safe push to production

Deployment workflow toward `main` (auto-deploy host, e.g. Vercel).
Execute in exact order, skipping no step.

---

## Step 0 — Configuration detection

Read `.claude/deploy.md` if it exists in the current project to get the E2E
command.

Recognized format in `.claude/deploy.md`:
```markdown
## Tests E2E
npm run test:e2e     ← command to run
```
or
```markdown
## Tests E2E
none                 ← explicitly disables E2E tests
```

If `.claude/deploy.md` is absent or has no `## Tests E2E` section:
→ auto-detect via `package.json`:
```bash
node -e "const p=require('./package.json'); process.exit(p.scripts?.['test:e2e'] ? 0 : 1)"
```
- If the `test:e2e` script exists: E2E command = `npm run test:e2e`
- Otherwise: no E2E tests

---

## Step 0.1 — The project's deployment mode

Not every project has a prod behind `main`. Each declares its mode **as
data**, in the `## Deploy` section of its `.claude/deploy.md` — we never fork
this command per project, we extend the config it reads.

| `## Deploy` | Meaning | Effect on `/deploy` |
|---|---|---|
| *(section absent)* | Prod behind `main` (historical default, e.g. Vercel) | Full pipeline — continue at 0.4 |
| `none` | No deployment target (local app, tool, lib) | No-op, delivery is done by `/send` |
| `push` | No prod; the remote is a **backup**, delivery **is** the push | Skip 0.4 → 3, go directly to step 4 |

Both spellings are accepted, on the title line or below it:

```markdown
## Deploy: push          ## Deploy
                         push
```

Reading the value (prints the lowercased value, empty string if absent):

```bash
node -e "const fs=require('fs');let v='';try{const t=fs.readFileSync('.claude/deploy.md','utf8').split(/\r?\n/);let i=false;for(const l of t){const m=/^##\s*Deploy\b\s*:?\s*(.*)/i.exec(l);if(m){if(m[1].trim()){v=m[1].trim();break}i=true;continue}if(i){if(/^##\s/.test(l))break;if(l.trim()){v=l.trim();break}}}}catch{}console.log(v.toLowerCase())"
```

Do not "simplify" this parser: `split(/\r?\n/)` handles CRLF files (Windows),
`\b` avoids matching `## Deployment notes`, and the inline capture avoids
reading empty on `## Deploy: push` — an empty read would be interpreted as
"full pipeline", hence a **silent** error.

Depending on the value:

- **`none`** → display
  `⚠ Project without deployment (## Deploy: none) — delivery happens via /send. /deploy is a no-op here.`
  then **stop**. On these projects, moving the backlog cycle to `shipped` is
  done by `/send` (see /send Step 4.6).
- **`push`** → display
  `⚠ Project in push mode (## Deploy: push) — no verification pipeline, the push is the delivery.`
  then **skip steps 0.4 to 3** (no preflight, no `tsc`, no migrations check,
  no unit tests, no E2E) and go directly to **step 4**. These projects accept
  the absence of guards here: their checks are those of `/send` (coherence
  tests) and of `/fastship` (unit tests) when the user runs them. Do not add a
  "just in case" verification — `push` mode is an explicit choice, not an
  oversight.
- **empty value (section absent) or any other value** → normal deployment,
  continue at 0.4. A project without `.claude/deploy.md` is thus unchanged.

---

## Step 0.4 — Environment preflight (self-repair)

Two recurring environment corruptions when several sessions/dev servers run in
the same directory. This preflight neutralizes them deterministically
**before** the TypeScript check. Both commands are idempotent and have no
effect if the problem does not exist.

```bash
# 1. node_modules: typescript can "disappear" if another process ran
#    npm install in parallel (dependency tree in a transient state).
node -e "require.resolve('typescript')" 2>/dev/null || npm install

# 2. .next/dev/types/routes.d.ts (Turbopack dev types) is continuously
#    rewritten by `next dev` and can be read mid-write (corrupted) → tsc
#    parse error. next-env.d.ts forces its import, so tsconfig
#    include/exclude cannot help. Deleting it is safe: absent, tsc passes
#    clean (`bundler` resolution); next dev regenerates it at next launch.
rm -rf .next/dev/types
```

- If `npm install` fails (non-zero exit): **stop**, display the npm error.
- These commands only apply to Node/Next projects; on another project type
  they are no-ops (folder/dep absent).

---

## Step 0.5 — TypeScript check

```bash
npx tsc --noEmit
```

- If the exit code is non-zero: **stop immediately**.
- Display the TypeScript errors.
- Do not continue to step 1.

---

## Step 0.6 — Migrations coherence (if applicable)

Auto-detection: if the ORM's migration config exists at the project root
(e.g. `drizzle.config.ts`), run the migrations coherence command:

```bash
npx drizzle-kit check
```

Otherwise (no such ORM in the project): **step skipped silently**.

- If the exit code is non-zero: **stop immediately**.
- Display the error (missing snapshots, incoherent journal, etc.).
- Do not continue to step 1.

**Why this step?** A `.sql` migration created manually without its
corresponding journal entry is silently ignored by the migration runner → the
schema change is never applied to the prod DB → delayed regression when a
query hits the missing column. Documented anti-pattern: a hand-written
migration without a journal entry broke a prod API route for several hours,
detected only by the E2E tests.

---

## Step 1 — Unit tests

```bash
npm test
```

- If the exit code is non-zero: **stop immediately**.
- Display which tests failed.
- Do not continue to step 2.

## Step 2 — E2E tests

If no E2E command is configured (detected at step 0):
→ Display `⚠ No E2E tests configured — step skipped.` and go to step 3.

Otherwise, run the configured E2E command.

- If the exit code is non-zero: **stop immediately**.
- Display the summary of failed tests (spec files, Playwright errors).
- Do not continue to step 3.

## Step 3 — Test summary

Display:
```
✓ Unit tests : N/N passed
✓ E2E tests  : M/M passed     ← omit this line if E2E not configured
```

## Step 4 — Push

### Step 4.0 — Backlog-as-data: `ship` status (BEFORE the push)

Set the `shipped` status **before** the push so it leaves in that same push.
Set via the **global backlog tool**; guarded by its presence → total no-op if
absent, and the bundle no-ops itself in a project without a backlog. `/deploy`
already runs on the `main` checkout, so cwd = `.`:

The bulk `ship` (`every merged → shipped`) is **correct here**: the push sends
all of main to prod, so every `merged` ticket arrives there. But the
**commit** must stay scoped: the main checkout is shared (10-15
worktrees/sessions in parallel), and committing all of `specs/` would sweep up
the `specs/*.md` **in progress in another session** — happened on 2026-07-17.
We commit only the actually transitioned tickets + the artifacts:

```bash
TOOL="$(node -e "console.log(require('path').join(require('os').homedir(),'.claude','tools','backlog','backlog.mjs'))")"
if [ -f "$TOOL" ]; then
  OUT="$(node "$TOOL" hook ship)"
  printf '%s\n' "$OUT"
  # Ids ACTUALLY transitioned. Uppercase-anchored grammar → the service line
  # "[backlog:hook] ship: nothing to do" does not match (event is lowercase).
  PATHS=""
  for id in $(printf '%s\n' "$OUT" | sed -n 's/^\[backlog:hook\] \([A-Z][A-Z0-9]*\(-[A-Za-z0-9]\{1,\}\)\{1,\}\) : .*/\1/p'); do
    PATHS="$PATHS specs/$(printf '%s' "$id" | tr '[:upper:]' '[:lower:]').md"
  done
  if [ -n "$PATHS" ]; then
    PATHS="backlog.json $PATHS"
    [ -f specs/backlog.md ] && PATHS="$PATHS specs/backlog.md"
    git add -- $PATHS
    # `--only`: a bare `git commit` commits the WHOLE index — hence whatever a
    # neighboring session may have staged. `--only` restricts to the named paths.
    git diff --cached --quiet -- $PATHS \
      || git commit -q --only -m "chore(backlog): ship" -- $PATHS
  fi
fi
```

The hook always exits 0 and only emits `warn`s (lifecycle-hook tolerance): it
must **never** block the deploy. No commit if no `merged` ticket is concerned
(`PATHS` empty).

### Step 4.1 — Push

```bash
git pull --rebase origin main
git push origin HEAD:main
```

⚠️ `HEAD:main`, **never** `git push origin main`: from a worktree, the latter
form pushes the parent repo's **local** `main` branch, not the current HEAD —
the commits just made (including step 4.0's `chore(backlog): ship`) do not
leave, silently: the push succeeds, it just pushes something else. Incident
2026-06-22: two commits excluded from the push, CI red on the coherence test.
From `main`, `HEAD:main` is strictly equivalent — hence the single form, with
no condition on the branch. (The `pull --rebase`, for its part, does apply to
the current HEAD: it stays correct as-is.)

After the push, display:
```
✓ Pushed to main. Deploy triggered.
```

---

## Strict rules

- Non-zero exit code at any step → stop, explain, do not continue.
- Never modify the changelog file.
- Never replace `git push origin HEAD:main` with `git push origin main`, even
  if the latter's permission is already granted: see the Step 4.1 warning.
- The `Bash(git push origin HEAD:main)` permission should be granted in the
  project's `.claude/settings.json` (otherwise a simple permission prompt, not
  a failure).
