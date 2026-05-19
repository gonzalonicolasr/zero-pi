---
description: Run the zero spec-driven development pipeline for a feature request
---

Run the zero SDD pipeline for the feature request below — you are the
orchestrator. Drive it through four phases in order: **explore → plan → build →
veredicto**, delegating each to its sub-agent (`zero-explore`, `zero-plan`,
`zero-build`, `zero-veredicto`). A `corregir` verdict re-runs `build`; a
`replantear` verdict re-runs `plan`; after a few rounds with no `pasa`, stop and
report the result as not verified. Ask the user for interactive or automatic
mode up front; in interactive mode pause after each phase for approval. Never
claim success unless veredicto returned `pasa`.

If the request begins with `--continue [slug]`, resume that unfinished run from
its `.sdd/<slug>/` artifacts instead of starting fresh.

**Output and language.** Follow the orchestrator's `## Language Boundary` and
`## Output Contract`: user-facing chat in Spanish (natural Rioplatense voseo),
the bounded per-phase summary, no raw tool output, no agent listings, no
step-by-step narration — progress and the final verdict, never a log. The four
`zero-*` sub-agents already exist; delegate to them directly without running a
`subagent` listing.

Feature request: $ARGUMENTS
