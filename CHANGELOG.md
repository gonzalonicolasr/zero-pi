# Changelog

All notable changes to `@gonrocca/zero-pi` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/); the package
uses [semantic versioning](https://semver.org/).

## [Unreleased]

### autotune v2 — phase attribution (in progress)

Spec-driven work under `.sdd/autotune-phase-attribution/`. The SDD verdict
already names the culprit — a `corregir` blames `build`, a `replantear` blames
`plan` — so autotune will upgrade only the phase actually at fault instead of
every phase with tier headroom (v1's blunt behaviour). Requirements written;
design pending.

## [0.1.5] - 2026-05-17

### Added — adaptive model profiles (autotune)

zero learns which model fits each SDD phase from past run outcomes and tunes
the per-phase profile in `~/.pi/zero.json`.

- Every completed SDD run appends a record to `~/.pi/zero-runs.jsonl` — the
  model each phase used, the final verdict, and the build/veredicto round count.
- On pi `session_start`, the new `autotune-extension` aggregates that log and,
  once a phase has enough samples, adjusts its model one tier.
- An `autotune` mode in `~/.pi/zero.json`: `auto` (apply the change and notify,
  the default), `ask` (record a recommendation, apply it from `/zero-models`),
  `off` (track only — never change or recommend).
- `/zero-models` gained an autotune menu entry, the `/zero-models autotune=<mode>`
  direct form, and a `★ aplicar sugerencia` entry for pending `ask` suggestions.

New files: `extensions/autotune.ts` (pure logic), `extensions/autotune-extension.ts`
(`session_start` wiring).

## [0.1.4] - 2026-05-17

### Changed — `/zero-models` is now a real command

The model configurator moved from an LLM-driven prompt (`/forge models`, which
relied on the model choosing to execute it and frequently did not) to
`/zero-models` — a real pi command with a code handler. Deterministic, with an
interactive picker and a direct `/zero-models <phase>=<model>` form. `/forge` is
pipeline-only again.

New file: `extensions/zero-models.ts`.

## [0.1.3] - 2026-05-17

### Added — run-memory loop

The SDD orchestrator now reads from and writes to Cortex (the memory MCP
server): it recalls prior `zero-run/*` traces before the explore phase and
saves a run-trace after the final verdict, so each run starts from what the
runs before it learned. Degrades silently when Cortex is unavailable.

### Added

- An ANSI-art wordmark at the top of the README files.
- `/forge models` — a first, prompt-based attempt at in-session model
  configuration. Superseded by `/zero-models` in 0.1.4.

## [0.1.2] - 2026-05-17

Intermediate run-memory release; superseded by 0.1.3.

## [0.1.1] - 2026-05-17

### Fixed

- `skills/skill-loop.md` lacked the `description` frontmatter pi requires for a
  skill, which surfaced as a "description is required" error. Added it (and to
  `prompts/orchestrator.md` for consistency).

## [0.1.0] - 2026-05-17

### Added — initial release

The first release of `@gonrocca/zero-pi` — an installable layer for pi, in the
gentle-pi style: pi itself stays untouched; zero-pi is a package pi loads.

- The zero SDD workflow as prompts — the orchestrator plus `/forge` and the
  four phase prompts (explore, plan, build, veredicto).
- Skill auto-learning (`skills/skill-loop.md`).
- An animated `ZERO` startup banner (`extensions/startup-banner.ts`): ANSI
  Shadow figlet with a purple → amber shimmer, controlled by the `ZERO_BANNER`
  environment variable.

The package was briefly named `zero-pi`; npm rejected that name as too similar
to an existing package, so it ships scoped as `@gonrocca/zero-pi`.
