# Token efficiency

How `/forge` accounts for and limits token use. The historical audit behind
these changes (fixtures, provenance and limitations) is in
[TOKEN-EFFICIENCY.md](../TOKEN-EFFICIENCY.md).

> Update (0.1.93): the phase script is now written by code. `zero_execution`
> `attempt` takes a `brief` and writes the script with a single `runs.run` and
> `context: "fresh"` fixed in code, so the orchestrator no longer writes
> scripts (see the [CHANGELOG](../CHANGELOG.md)). Where the text below says the
> fresh-context request is prompt-enforced, read it with that in mind; the
> routing/tool invocation itself is still prompt-enforced.

**Implemented first slice (Unreleased; audit baseline was 0.1.78):**

- Forge invokes the `zero_execution` tool to persist the complete verbatim
  request, create a project/canonical-cwd + UUID identity, register each
  phase/batch/retry attempt and attach its actual async workflow receipt.
  `.sdd/<slug>/execution.json` points at `.sdd/.executions/<runId>.json`.
  `--continue` accumulates new fresh children under that same ID; fresh
  same-slug runs get new IDs and retain the previous accounting ledger.
- `/zero-cost` reads only these ledgers and exact attached runtime identities.
  It snapshots normalized child usage, includes failed attempts with metadata,
  deduplicates child IDs, shows both cache classes, and reports missing/legacy
  coverage honestly. Reported `$0.00` is not proof of free tokens/subscription
  quota; missing USD is `unknown`. Duration is summed child duration, not wall
  time. **Parent calls/compactions are not captured**, nor are unregistered
  children: this is not a whole-Forge benchmark. Provider/thinking are not
  independently verified beyond the model string reported by child metadata.
- Every async phase/batch brief explicitly requests `context: "fresh"` at the
  workflow and child levels; generated agents add `defaultContext: fresh` as
  defense. Receipt reconciliation checks resolved context. Global fork wins
  over an agent default when an explicit launch context is omitted, so the
  launch instruction matters. This is **prompt-enforced orchestration**, not
  a JS rewriter, automatic scheduler, or sandbox. Existing inheritance/skills
  exclusions and project-local rules/steering handoffs are preserved.
- Explore retains `read,bash` and its read-only **prompt** boundary. Because
  the runtime treats bash as mutation-capable, Forge uses `output: false` for
  explore (no conflicting write instruction) with debug artifacts enabled.
  Runtime saves its full final report; the parent `findings` operation copies
  the confirmed output to `findings.md`, then the parent checks completeness.
  Missing/disabled debug output blocks plan. Other phase outputs use file-only
  pointers; authored requirements/design/tasks and artifact gates remain.
- Build keeps cumulative per-task TDD evidence on disk, returns paths/status/
  exceptions rather than another table, and veredicto independently reruns
  tests. The support modules follow the same contract.
- Readiness outcomes are idempotent per analyze attempt, capped at two replans
  per execution, stop on the second, and never reset on resume. Delivery
  retries are neither replans nor build rounds. Malformed ledgers fail closed;
  interrupted lock recovery requires a human to verify no writer is active.
  Routing/tool invocation remains prompt-enforced; the ledger enforces only
  operations actually called. Veredicto never writes `zero-runs.jsonl`:
  terminal outcome persistence belongs to the orchestrator.

Existing 20/40 exploration guidance, four-task / 800-estimated-line batching,
quality gates, TDD, model/thinking assignments and user configuration remain.
No measured token savings or A/B quality equivalence is claimed. Deferred:
parent/compaction accounting, automatic async event capture, temp/custom
metadata recovery, Cortex metrics transport, and controlled profile/batch
experiments.
