---
description: Run the zero spec-driven development pipeline for a feature request
---

Run the zero SDD pipeline for the feature request below — you are the
orchestrator. Drive it through the phases in order:
**clarify → explore → plan → analyze → build → veredicto**, delegating each to
its sub-agent (`zero-clarify`, `zero-explore`, `zero-plan`, `zero-analyze`,
`zero-build`, `zero-veredicto`). The `clarify` and `analyze` gates run
**automatically** inside `/forge` — there is no slash command a user must run
by hand for the normal flow. `clarify` records assumptions in
`.sdd/<slug>/clarifications.md` and stops only on genuinely blocking ambiguity;
`analyze` writes `.sdd/<slug>/checklist.md` after `plan`/`/zero-validate` and
returns `continue` (proceed to build) or `replan` (re-run plan with its
defects). A `corregir` verdict re-runs `build`; a `replantear` verdict re-runs
`plan`; after a few rounds with no `pasa`, stop and report the result as not
verified. Ask the user for interactive or automatic mode up front; in
interactive mode pause after each phase for approval. At terminal run end,
invoke `/zero-cost <slug>` automatically and include the best-effort cost table
in the final summary; the user should not have to run a second command. Never
claim success unless veredicto returned `pasa`.

**Parse the arguments first.** If the request begins with `--continue`, this is
a **resume** run, not a fresh one:

- `--continue` with no slug → resume mode: hand control to the orchestrator's
  `## Resuming a run` section, which scans `.sdd/*/` for an unfinished run.
- `--continue <slug>` → resume mode targeting `.sdd/<slug>/` directly. If that
  directory does not exist, report "no such run: <slug>" and stop — do **not**
  start a fresh run under that slug.
- Anything else (a feature request, or no arguments) → a fresh run: the
  arguments are the feature request below.

**Strict TDD by default.** Follow the orchestrator's `## Strict TDD forwarding`:
build runs test-first (RED → GREEN → TRIANGULATE → REFACTOR) and emits a TDD
Cycle Evidence table whenever a test runner exists and the work touches code;
veredicto audits that evidence and returns `corregir` if it fails. Set
`tdd.mode: "off"` in `.sdd/config.json` to opt a project out.

**Output and language.** Follow the orchestrator's `## Language Boundary` and
`## Output Contract`: user-facing chat in Spanish (natural Rioplatense voseo),
the bounded per-phase summary, no raw tool output, no agent listings, no
step-by-step narration — progress and the final verdict, never a log. The six
`zero-*` sub-agents already exist; delegate to them directly without running a
`subagent` listing.

Feature request: $ARGUMENTS
