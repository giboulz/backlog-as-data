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

Translated from the state of **2026-08-31**. The system has moved since; the
table says by how much, so you can tell what you are reading.

| File | Original | Drift since translation |
|---|---|---|
| `skills/sdd-run-ticket.md` | `claude-config/commands/sdd-run-ticket.md` | 11 commits — the review gate's resume step, the correction spawn, the third escalation source |
| `skills/send.md` | `claude-config/commands/send.md` | none |
| `skills/deploy.md` | `claude-config/commands/deploy.md` | none |
| `skills/backlog.md` | `claude-config/commands/backlog.md` | 2 commits, one line |
| `prompts/aggregator.md` | `claude-config/prompts/aggregator.md` | none |
| `prompts/impl-same.md` | `claude-config/prompts/impl-same.md` | 5 commits |
| `prompts/impl-cross.md` | `claude-config/prompts/impl-cross.md` | 5 commits |
| `prompts/reviewer.md` | `claude-config/prompts/reviewer.md` | 3 commits |
| `steps/cross-repo.md` | `claude-config/steps/cross-repo.md` | 2 commits |
| `steps/review-deep.md` | `claude-config/steps/review-deep.md` | 1 commit |

## What is not translated

The eight skills published for the first time in this refresh —
`mature`, `reflect`, `improve-skill`, `worktree-clean`, `sync`, `sync-all`,
`deploywithchangelog`, `fastship` — plus `rules/maturation.md`, the global
`CLAUDE.md`, the agent definitions and the memory files. They exist only in
`claude-config/`, in French.

The root [`README.md`](../README.md) explains all of them in English. That is the
deliberate division: the README carries the concepts, this folder carries a
convenience, and `claude-config/` carries the truth.
