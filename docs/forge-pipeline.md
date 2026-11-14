# The `/forge` pipeline in detail

The short version is in the [README](../README.md#phases). This page keeps the
details: artifacts, gates, verdicts, iteration caps, strict TDD, and how a
phase is launched.

## Phases

Run **`/forge <feature>`** and the orchestrator drives the work through six
phases — **clarify → explore → plan → analyze → build → veredicto** — each
delegated to its own sub-agent (`zero-clarify`, `zero-explore`, `zero-plan`,
`zero-analyze`, `zero-build`, `zero-veredicto`).

| Phase | Does |
| ----- | ---- |
| **clarify** | Record de-risking assumptions before exploration; stop only on blocking ambiguity. |
| **explore** | Investigate the codebase read-only; produce findings. |
| **plan** | Write requirements, design, and an ordered task list. |
| **analyze** | Review plan readiness after `/zero-validate`; decide continue or replan. |
| **build** | Implement the plan. |
| **veredicto** | Review it adversarially and record a verdict. |

Each run keeps its paper trail under `.sdd/<slug>/`: `clarifications.md`,
`findings.md`, `proposal.md`, `spec.md`, `design.md`, `tasks.md`,
`checklist.md`, and (when Strict TDD engages) `tdd-evidence.md`.

## Automatic gates: clarify and analyze

The **clarify** and **analyze** gates are automatic inside `/forge` — no extra
slash command in the normal flow. `clarify` writes `.sdd/<slug>/clarifications.md`
and asks only when proceeding would risk the wrong product; `analyze` writes
`.sdd/<slug>/checklist.md` after the structural `/zero-validate` gate and returns
`continue` (build) or `replan` (re-run plan with concrete defects). Neither gate
counts as a build/veredicto round. Readiness has a separate durable cap: the
**second analyze `replan` decision stops blocked/not verified**. Resume retains
that count and execution identity; missing/corrupt legacy accounting fails
closed rather than buying a new allowance. Analyze is never bypassed.

## Verdicts and the iteration cap

The verdict is `pasa` (done), `corregir` (re-run build), or `replantear`
(re-run plan). A hard iteration cap bounds the build↔veredicto loop — reached
without a `pasa`, the run stops and is reported as **not verified**. The cap
defaults to 3 (`rounds.cap` in `.sdd/config.json`); `/zero-rounds` shows and
records the durable round count in `.sdd/<slug>/rounds.json`.

`/forge --continue [slug]` resumes an interrupted run.

After `corregir`, the next build batch reopens and fixes the failing tasks
(it does not jump straight to `done`).

## Build runs test-first

By default the build phase follows a strict TDD cycle — RED → GREEN →
TRIANGULATE → REFACTOR — and records a **TDD Cycle Evidence** table; veredicto
audits that evidence (tests exist, are really green, assertions verify real
behavior) and returns `corregir` if the discipline slipped. It engages only
when a test runner exists and the change touches code, so docs/config-only work
degrades gracefully. Opt a project out with `tdd.mode: "off"` in
`.sdd/config.json` (see [configuration.md](./configuration.md)).

## Language and output

The run speaks **Spanish**, in a bounded, low-noise format — one short summary
per phase, naming the model that phase runs on, no raw tool output. Or just
describe the work and say "hacelo con sdd": the `sdd-routing` skill routes it
into `/forge` for you.

## How a phase is launched

Since the next release (see the `[Unreleased]` entries in the
[CHANGELOG](../CHANGELOG.md)):

- `/forge` receives the orchestrator rules (`prompts/orchestrator.md`)
  attached to its prompt by the `zero_execution` extension before the first
  turn. If they do not arrive, `forge.md` tells the model to stop.
- `zero_execution` `attempt` takes a `brief` (and `outputMode: "inline"` for
  explore), writes the phase script to `.sdd/<slug>/workflows/<attemptId>.js`
  (a single `runs.run` with `context: "fresh"`, fixed by code), and returns the
  exact `subagent` arguments. The orchestrator never writes scripts.
- The phase is launched with `subagent({ workflow: <path>, ... })`.
  `workflowScript` is no longer used: pi-subagents 0.79.1 rejects it.
- `attach` and `bg_wait` go in the same turn; no decision is taken before
  `bg_wait` reports done. `status` runs only after clarify and plan, because
  `findings`, `analyze`, `round`, `batch-close` and `wave-close` already verify
  the delivery.
- `findings` accepts both `## Code roots` and `### Code roots`.
- `batch-close` and `wave-close` reject a child that is still running before
  writing anything.

## Parallel tasks and shared contract

Parallel tasks (`[P]`), waves, how a task is marked done, request size and the
NODD handoff are part of the contract shared with the Claude Code forge mod:
see [forge-contract.md](./forge-contract.md).
