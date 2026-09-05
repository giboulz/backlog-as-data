# claude-config (verbatim)

This folder mirrors `~/.claude` — the Claude Code configuration directory the
whole system lives in, published as it runs.

**It is in French.** These are prompts read by a model, not documentation for
you: the skills, the sub-agents' manuals and the maturation method are the files
the harness loads, and the tests in [`__tests__/`](__tests__/) assert their
French text. English translations of part of it are in
[`../reading/`](../reading/), labelled as the reading copies they are, and the
[root README](../README.md) explains every concept in English.

To install it, follow [Route C](../README.md#route-c--the-whole-pipeline). Do not
copy the whole folder blindly — step 6 in particular asks you to read
[`CLAUDE.md`](CLAUDE.md) and cut what belongs to someone else's projects.

## What is where, and who reads it

| Path | Reader | What |
|---|---|---|
| [`commands/`](commands/) | the harness, as slash commands | The twelve skills. `sdd-run-ticket` orchestrates a ticket end to end; `mature` writes specs and doses the triplet; `send` integrates; `deploy` ships; `backlog` maps conversational intent to CLI verbs; `reflect` mines the friction log; `improve-skill` runs in a young skill; `worktree-clean`, `sync`, `sync-all` keep the worktrees honest |
| [`prompts/`](prompts/) | the **sub-agents themselves** | Their manuals, read at the start of their own run — implementer (same-repo, cross-repo), reviewer, aggregator. Not injected by the caller: the spawn prompt carries variables and a pointer, and the sub-agent resolves and reads the file itself |
| [`steps/`](steps/) | the orchestrator | Sections of `sdd-run-ticket` read **conditionally**: the cross-repo branch, the aggregation body at dosage `deep` |
| [`rules/`](rules/) | the orchestrator, by path scope | The maturation method — loaded when a spec file is opened, not on every session |
| [`agents/`](agents/) | the harness, when spawning | The six agent definitions. Five implementer tiers and the pinned reviewer. **Generated**, and asserted against their generator by a test |
| [`CLAUDE.md`](CLAUDE.md) | every session, always | The doctrine. Loaded on every session of every project and injected into every sub-agent — which is why it has its own size ceiling |
| [`tools/`](tools/) | scripts, invoked by the skills | `sdd/preflight.mjs` resolves every guard deterministically; `agent-defs/generate.mjs` writes the definitions above; `review-log/`, `sdd-telemetry/` and `sdd-push/` are the measurement chain |
| [`memory/`](memory/) | the harness, at session start | The durable-memory index and the candidate tier's README — the capture half of the retro loop |
| [`__tests__/`](__tests__/) | you | 35 coherence tests, 3 helpers, 48 fixtures. Every "asserted by a test" claim in the root README points here |
| [`.gitattributes`](.gitattributes) | git | Worth reading on its own: every entry is a dated CRLF incident with its cause |

## Running the tests

```bash
npm ci
npm test
```

Against this repository as published you get **1,491 passing and 22 failing in
12 files**, for two reasons only, both consequences of what is deliberately not
published: twenty-one assertions read the system's own `specs/*.md` (five
representative tickets are in [`../examples/`](../examples/) instead), and
`backlog-bundle-coherence.test.js` compares against the unpublished bundle. A
green run is not the target; the 23 fully-passing files are.
