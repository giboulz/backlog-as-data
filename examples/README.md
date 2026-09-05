# Examples

Two kinds of file live here, and the difference matters when you read them.

## `specs/` — real tickets, verbatim

Five tickets taken unedited from the system's own backlog (`claude-config`, the
repository that holds the skills). They are in French, like everything the system
actually runs on, and they are the best answer to "what does a matured spec look
like" — better than any example written to be exemplary.

| File | Why it is here |
|---|---|
| `skill-59.md` | The light end of the dosing scale: `sonnet` / `low` / `light`, on a ticket whose whole job is to close a stale note. Three kilobytes, start to finish. |
| `skill-38.md` | `status: wont`, and **no `exec` block at all** — the schema forbids one outside `todo`/`wip`/`merged`/`shipped`. Shows the commitment axis as a separate thing from the lifecycle: this ticket was understood, judged, and declined. |
| `skill-13.md` | Carries `effort: ultrathink` — a value the tool **refuses to write** today. It is the migration described in the README: tolerant on read, strict on write. The ticket was never rewritten, and the projection normalises it. |
| `skill-110.md` | Born of an escalation (it exists to treat `SKILL-106`'s E1 finding 7) and **carries two open ones of its own**. An escalation that outlives its session, in its natural habitat. |
| `skill-112.md` | The heavy end: `opus` / `high` / `deep`, with a **closed** escalation — its E1 finding 1 was treated by `SKILL-114`, and the closure marker is in the body. |

Read them together and the two orthogonal axes stop being a diagram: `skill-38`
is a decision not to act, `skill-13` is a shipped ticket carrying obsolete
vocabulary, `skill-110` and `skill-112` are the same mechanism seen open and
closed.

## `parse-07.md` and `backlog.generated.md` — synthetic

A single invented ticket and the readable projection it would produce. They are
the worked example the README walks through, kept small on purpose so the data
model is visible without 111 real tickets around it. Nothing here was ever run.

## What is not here

The real `backlog.json` and the real generated `specs/backlog.md` of the system's
own backlog. They are projections — regenerating them from the specs above is the
point of the CLI, not something to read a snapshot of.

To see the escalation register the README describes, the verb is:

```bash
node "$HOME/.claude/tools/backlog/backlog.mjs" escalations --all
```
