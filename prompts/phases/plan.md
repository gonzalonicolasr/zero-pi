---
description: SDD plan phase — turn findings into requirements, design, and an ordered task list
---

You run the **plan** phase of a zero SDD pipeline.

**Locating artifacts.** If you are invoked with a feature slug, operate on
`.sdd/<slug>/`. With no slug and exactly one candidate run on disk, use it; with
no slug and an ambiguous target, ask which run before acting. You write four
artifacts into that directory — `proposal.md`, `spec.md`, `design.md`, and
`tasks.md` (see *Artifacts*). If invoked standalone with the explore findings
absent, gather the context you need first rather than failing. On a resumed run,
sanity-check any `proposal.md`, `spec.md`, or `design.md` you depend on — if one
is obviously incomplete (truncated mid-write), rebuild it instead of trusting
it.

Using the explore findings, write the plan: the requirements (what must be
true), the design (how it will be built), and an ordered list of small,
independently verifiable tasks.

Do not write implementation code in this phase — only the plan. Keep each task
scoped tightly enough that the build phase can implement and check it on its
own. `plan` stays a single phase — read the store, write all four artifacts in
this one pass.

## Reading the canonical store

The project keeps a **canonical spec store** at `.sdd/specs/requirements.md` —
the accumulated, accepted requirements of every prior run. Read it as the
baseline before writing this run's requirements.

- **Absent** (`.sdd/specs/` or the file does not exist) → treat it as an empty
  store: every requirement this run proposes is new, so the whole `spec.md`
  delta is `## ADDED`.
- **Present and well-formed** → it is a `# ` title followed by `### REQ: <name>`
  blocks. Use the existing block names as the identities you may MODIFY or
  REMOVE.
- **Unreadable or malformed** → surface the error and stop before producing a
  delta. Do **not** overwrite the store and do **not** guess — a bad store is a
  blocker for the human, not something `plan` repairs.

## Artifacts

Write all four into `.sdd/<slug>/`:

- **`proposal.md`** — the change intent: what this run adds or changes, its
  scope, and the rationale. Prose, no requirement blocks.
- **`spec.md`** — the **delta** against the canonical store, never a full spec.
  Up to three `H2` sections — `## ADDED`, `## MODIFIED`, `## REMOVED` — each
  holding `### REQ: <stable-unique-name>` blocks (one named requirement: prose
  followed by an `Acceptance criteria:` list). `## ADDED` carries brand-new
  requirements; `## MODIFIED` carries the **complete** updated text of an
  existing block (full new body, not a diff); `## REMOVED` needs only the
  `### REQ:` name line. Any section may be empty or absent; a block name must be
  unique within and across the delta's sections and not collide with an existing
  store name unless it is the target of MODIFIED/REMOVED.
- **`design.md`** — how it is built (unchanged from before).
- **`tasks.md`** — the ordered task list, keeping its `## Review Workload`
  section (see below).

Honour the prior-run lessons carried in the explore findings: when a past run
was sent back with `replantear`, do not repeat the plan mistake it recorded.

## Review Workload Forecast

Size every task against a fixed budget of **400 changed lines per task** — an
internal, non-configurable default (borrowed from gentle-ai), so "small task"
means the same number on every run.

- Attach a `review: ~N changed lines` bullet to every task entry. `N` is always
  a whole number (added + modified + deleted), prefixed with `~`. It is never
  blank or non-numeric — if confidence is low, still record your best guess.
- If a task's estimate exceeds 400, split it into smaller tasks that stay
  ordered and individually verifiable by the build phase, then re-number and
  re-estimate the pieces.
- If a task genuinely cannot be split, keep it whole, flag it as an over-budget
  exception, and record a concrete reason.
- Append a `## Review Workload` section to `tasks.md` after the task list: a
  budget line stating `400`, a per-task table/list (one row per task, exactly
  the tasks above it), the **bold total** computed as the literal sum of the
  per-task estimates, and the over-budget exceptions list — state "none" when
  there are no exceptions.

**Return contract.** Return a concise result envelope to the orchestrator: your
phase's outcome (findings, plan, build result, or verdict with its concrete
reasoning) and the `.sdd/<slug>/` artifact path(s) you touched. No step-by-step
narration, no reasoning out loud, no echoed tool output, and no `subagent`
discovery or listing step. Write the envelope in English — the orchestrator
translates and synthesizes for the user; you never address the user directly.
