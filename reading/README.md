# Reading copies (English) — not the system

Everything in this folder is an **English translation, made for reading**. The
system runs on the French originals in [`../claude-config/`](../claude-config/),
and so do its tests: `claude-config/__tests__/` asserts strings like
`Escalades (D10)` and `un numéro (1 à 7)` against those files. A translation
cannot satisfy them, which is exactly why the originals are what gets published
as the artefact and these are labelled as a copy.

**When the two disagree, the French original is right.** Not as a courtesy to the
source language — because it is the file the harness loads, the sub-agents read,
and the guards measure.

## What is translated, and how current it is

**Brought level with the originals on 2026-09-05**, by porting the six weeks of
French diff rather than re-translating blind. Ten files, all current as of this
snapshot:

| File | Original |
|---|---|
| `skills/sdd-run-ticket.md` | `claude-config/commands/sdd-run-ticket.md` |
| `skills/send.md` | `claude-config/commands/send.md` |
| `skills/deploy.md` | `claude-config/commands/deploy.md` |
| `skills/backlog.md` | `claude-config/commands/backlog.md` |
| `prompts/aggregator.md` | `claude-config/prompts/aggregator.md` |
| `prompts/impl-same.md` | `claude-config/prompts/impl-same.md` |
| `prompts/impl-cross.md` | `claude-config/prompts/impl-cross.md` |
| `prompts/reviewer.md` | `claude-config/prompts/reviewer.md` |
| `steps/cross-repo.md` | `claude-config/steps/cross-repo.md` |
| `steps/review-deep.md` | `claude-config/steps/review-deep.md` |

Expect that to stop being true: the originals move and these do not follow
automatically. **Check the git log of the file in `claude-config/` before relying
on a detail here.** The substantive change ported in this pass was the review
gate no longer resuming the implementer but launching a fresh corrector — worth
knowing, because it is the kind of change that makes a stale translation say the
opposite of what the system does.

## What is not translated

The eight skills published for the first time in this refresh —
`mature`, `reflect`, `improve-skill`, `worktree-clean`, `sync`, `sync-all`,
`deploywithchangelog`, `fastship` — plus `rules/maturation.md`, the global
`CLAUDE.md`, the agent definitions and the memory files. They exist only in
`claude-config/`, in French.

The root [`README.md`](../README.md) explains all of them in English. That is the
deliberate division: the README carries the concepts, this folder carries a
convenience, and `claude-config/` carries the truth.
