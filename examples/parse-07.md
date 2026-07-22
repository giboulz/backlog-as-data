---
id: PARSE-07
title: Tolerate CRLF in decklist import
type: ticket
status: todo
priority: should
epic: import
exec:
  model: sonnet
  effort: think
  review: light
  matured: 2026-07-22
---

# PARSE-07 — Tolerate CRLF in decklist import

> Synthetic example of a ticket file. The frontmatter above is the **data**
> (owned by the CLI, mutated only through it); everything below is the
> **spec** (owned by whoever writes specs). Same file, so they cannot drift.

## Context

Decklists pasted from Windows clients arrive with `\r\n` line endings. The
current parser splits on `\n` only, leaving a trailing `\r` on every card name,
which then fails the exact-name lookup.

## Design

- `splitLines()` in `lib/import/parse.ts` switches to `split(/\r?\n/)`.
- No behavior change for `\n` input (regression tests cover it).

## Tests

- `parse.test.ts`: CRLF input yields identical card list as LF input.
- `parse.test.ts`: lone `\r` in the middle of a name is NOT stripped
  (only line-ending `\r`).
- Existing LF fixtures stay green.

## Out of scope

- Old Mac `\r`-only line endings (no observed traffic).
