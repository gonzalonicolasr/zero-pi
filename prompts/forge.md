---
description: Run an automatic spec-driven development pipeline for a feature request
---

Run the zero SDD pipeline for the feature request in the arguments.

**Parse the arguments first.** If the arguments start with `--continue`, this is
a **resume** run, not a fresh one:

- `--continue` with no slug → resume mode: hand control to the orchestrator's
  `## Resuming a run` section, which scans `.sdd/*/` for an unfinished run.
- `--continue <slug>` → resume mode targeting `.sdd/<slug>/` directly. If that
  directory does not exist, report "no such run: <slug>" and stop — do **not**
  start a fresh run under that slug.
- Anything else (a feature request, or no arguments) → a fresh run, exactly
  today's behaviour: the arguments are the feature request.

Follow the zero SDD orchestrator instructions: drive the run through the
explore → plan → build → veredicto phases, honour the build/veredicto iteration
cap, and use the execution mode (interactive or automatic) the user chose.

Delegate each phase to its dedicated sub-agent so the phase runs on the model
it is configured for: `zero-explore`, `zero-plan`, `zero-build`, and
`zero-veredicto`. You stay the orchestrator — you decide phase order and count
the rounds; the sub-agents only execute their phase.

In interactive mode, pause after each phase with a summary and ask before
continuing. Never report success unless the veredicto phase returned a `pasa`
verdict; if the cap is reached first, report that the result is not verified.

To change the per-phase models, the user runs the `/zero-models` command — do
not handle model configuration here.

Feature request: $ARGUMENTS
