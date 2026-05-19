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

## [0.1.24] - 2026-05-19

### Fixed — repository metadata

`repository`, `homepage`, and `bugs` now point at the standalone
`github.com/gonzalonicolasr/zero-pi` repo; the previous URLs referenced a
repository that does not exist, so the links on npm were broken. The README's
`zero` reference no longer links to a non-existent repo.

## [0.1.23] - 2026-05-19

### Documentation

Full README rewrite — accurate, complete, and organized. Centered header with
npm/license/node badges, a table of contents, and the sections grouped into
**The SDD workflow** and **Quality-of-life extensions**. The previously
undocumented `sdd-agents` and `win-tree-kill` extensions are now covered, along
with the Spanish Language Boundary / Output Contract, the banner sparkle pass,
and the `ZERO_RESUME` variable. Added Commands, Environment-variable, and Files
reference tables; fixed the `ZERO_BANNER` table that was under the wrong
section.

## [0.1.22] - 2026-05-19

### Added — banner sparkle pass

After the ZERO wordmark assembles and settles, a short sparkle pass runs in
shimmer mode: a few cells glint bright each frame for ~0.8s, then a clean
final settle. Controlled by the new `sparkleFrames` / `sparkleMs` render
options; `ZERO_BANNER=static` or `off` skip it as before.

### Changed — no fenced code blocks in chat output

pi's chat renders a triple-backtick fenced code block with the backticks
showing literally. The Output Contract now tells the orchestrator to avoid
fenced blocks entirely — commands and snippets go as two-space-indented plain
lines or single-backtick inline code, which pi renders cleanly.

## [0.1.21] - 2026-05-19

### Changed — Spanish, low-noise SDD output

Builds on 0.1.20's quieting. The `/forge` orchestrator prompt gains two
sections, modelled on `gentle-pi`:

- **Language Boundary** — every user-facing message of a zero SDD run is in
  Spanish (Rioplatense voseo); sub-agent briefs stay English; identifiers
  (`pasa`/`corregir`/…, slugs, paths, model ids, commands) are kept verbatim.
- **Output Contract** — the per-phase summary is a bounded envelope
  (`Estado`/`Resumen`/`Artefactos`/`Siguiente`) instead of free-form prose;
  no raw tool output, file dumps, or `subagent` listings reach the chat; the
  approval question is Spanish-only (`¿Continuamos?`); the run ends stating
  `verificado` / `no verificado`. The phase-start line now names the model and
  provider the phase runs on plus a brief gloss of what the phase does, so a
  slow phase reads as working rather than frozen.

The four phase sub-agents now carry a concise return contract (a result
envelope to the orchestrator, no chat narration). User-facing chat strings in
the `conversation-resume`, `autotune`, `zero-models`, and `spec-merge`
extensions are translated to Spanish.

## [0.1.20] - 2026-05-19

### Changed — quieter SDD runs

The `/forge` orchestrator and the four phase sub-agents are now instructed to
work quietly: one short status line per phase, no step-by-step narration, no
reasoning out loud, and no echoing tool output or `subagent` listings back into
the chat. A run shows progress and the final verdict — not a log. The terse
directive is also baked into the generated `zero-<phase>` agent files.

## [0.1.19] - 2026-05-19

### Fixed — `/zero-models` offered model names pi could not resolve

0.1.15 sourced the `/zero-models` picker from OpenCode's model catalog. That
catalog names providers and models differently from pi's own registry — e.g.
OpenCode's `openai` / `gpt-5.5-pro` versus pi's `openai-codex` / `gpt-5.5`. So a
model picked through `/zero-models` could be written to `~/.pi/zero.json` under
a name pi cannot resolve, and the SDD sub-agent for that phase failed at run
time with "No API key found for <provider>".

`/zero-models` now reads **pi's own model registry** (`ctx.modelRegistry`)
again — it lists every model from every provider the user is authenticated for,
with the exact ids pi resolves at run time. The `opencode-models` discovery
module is removed.

## [0.1.18] - 2026-05-18

### Changed — `/forge` prompt trimmed so it stops flooding the chat

`/forge` expanded to a ~40-line orchestrator block that pi echoes into the
conversation, burying the user's own command. `forge.md` is rewritten to a
compact ~13-line form that keeps the orchestrator essentials — phase order,
sub-agent delegation, the verdict-driven iteration cap, the interactive/
automatic modes — so a `/forge` invocation no longer drowns the chat.

## [0.1.17] - 2026-05-18

### Fixed — `/forge` had no sub-agents to delegate to

`/forge`'s orchestrator delegates each phase to a dedicated sub-agent
(`zero-explore`, `zero-plan`, `zero-build`, `zero-veredicto`), but pi-subagents
discovers agents from `~/.pi/agent/agents/**/*.md` and a `pi install` of zero-pi
shipped only the phase *prompts*, never the agent definitions — so `/forge`
stalled with nothing to delegate to.

- New `sdd-agents` extension generates the four `zero-<phase>` agent files
  under `~/.pi/agent/agents/zero/` at load, built from the package's own
  `prompts/phases/*.md` and the per-phase models in `~/.pi/zero.json`. They are
  regenerated every load, so they track the prompts and `/zero-models`.

New file: `extensions/sdd-agents.ts`.

## [0.1.16] - 2026-05-18

### Fixed — win-tree-kill froze pi on every turn (regression from 0.1.14)

0.1.14's `win-tree-kill` ran `taskkill` through a **synchronous** `execSync`
inside the patched `kill()`. pi kills a subprocess on most turns (pi-claude-cli
kills its `claude` child on break-early), and a synchronous `taskkill` blocks
Node's event loop for hundreds of milliseconds — or indefinitely if it stalls —
so pi appeared to hang on every message. The tree-kill is now fired
asynchronously (`child_process.exec`, fire-and-forget) and can never block the
event loop.

### Fixed — working-phrases double-load guard

`register()` now no-ops on a second call, so a double-load can never stack
event handlers or a second spinner timer.

## [0.1.15] - 2026-05-18

### Changed — `/zero-models` discovers providers from OpenCode's catalog

`/zero-models` now surfaces the same providers as the `zero` installer's model
picker. It reads OpenCode's model catalog (`~/.cache/opencode/models.json`)
cross-referenced with the user's OpenCode auth file, so every provider the user
authenticated there — `opencode-go`, `openai` (codex/gpt), `anthropic`, … — is
offered, with only tool-call-capable models. It falls back to pi's own model
registry, then to a built-in Claude list, when OpenCode is not present.

New file: `extensions/opencode-models.ts` (pure catalog discovery).

## [0.1.14] - 2026-05-18

### Fixed — Esc/abort orphaning a `claude` process on Windows

On Windows `ChildProcess.kill()` terminates only the target process, not its
descendants. The `pi-claude-cli` provider spawns `claude` (which resolves to
`claude.cmd`) through a `cmd.exe` batch wrapper, so when pi aborts a turn the
wrapper is killed but the real `claude` process is orphaned and keeps
streaming — pressing **Esc did nothing**.

- New `win-tree-kill` extension patches `child_process.spawn` once, at load,
  so every subprocess spawned afterwards gets a `kill()` that terminates the
  whole process tree via `taskkill /T /F`. It reaches `pi-claude-cli` (and the
  `cross-spawn` it depends on) without modifying them — the fix survives
  `pi update`. No-op on non-Windows platforms.

## [0.1.13] - 2026-05-18

### Fixed — skill packaging collision

The package's two skills were loose `.md` files directly in `skills/`, which pi
collapsed into a single skill named `skills` and reported as a resource
collision. Each skill is now its own `skills/<name>/SKILL.md` directory — the
structure pi expects (and that `pi-subagents` uses) — so `sdd-routing` and
`skill-loop` load as two distinct skills with no conflict.

### Changed — `/zero-models` is provider-aware

- The interactive picker no longer offers a hardcoded Claude list. It reads
  pi's model registry, so the flow is **phase → provider → model** and every
  provider you have configured (anthropic, codex, opencode, …) and its models
  are offered. An `— otro provider —` / `— otro modelo —` entry still lets you
  type anything by hand, and the picker degrades to the old flow when no
  registry is available.
- The direct form accepts an explicit provider:
  `/zero-models build=codex/gpt-5-codex`.
- `~/.pi/zero.json` now stores a parallel `providers` map alongside `models`;
  the SDD orchestrator delegates each phase to its provider + model. The new
  key is additive — older `models`-only files keep working.

## [0.1.12] - 2026-05-18

### Added - conversation resume on quit

- Added a `conversation-resume` extension that writes `.pi/zero-resume.md` when
  pi exits normally.
- The resume includes the exact restore command (`pi --session <path>`), the
  direct session-id form when available, the `pi --resume` picker command, and a
  concise conversation tail.
- Added `/zero-resume` to write the same handoff note manually.
- The extension creates `.pi/.gitignore` so local conversation context is not
  accidentally committed.

### Added - ZERO SDD terminal theme and Tetris banner

- Added the `zero-sdd` Pi theme as a package theme resource.
- Reworked the startup banner from an ANSI Shadow shimmer into an ASCII-safe
  Tetris-style ZERO assembler while preserving the `ZERO_BANNER` controls.

## [0.1.11] - 2026-05-18

### Added — provider guard (pi-provider-guard)

A new extension watches model switches and steps in when you move to a metered
provider.

- Detects switches to the metered `anthropic` provider and offers the
  equivalent model on `pi-claude-cli` — the provider backed by your
  subscription — through a confirmation dialog. Say "no" to stay on the metered
  provider.
- Skips the modal and shows a one-line warning instead on session `restore`
  and when no equivalent model exists on `pi-claude-cli`.
- Stays silent for subscription providers — no dialog, no notification.

New files: `extensions/provider-guard.ts` (pure classification logic),
`extensions/provider-guard-extension.ts` (`model_select` wiring).

### Added — hybrid working-phrase ticker and themed spinner

- New `working-phrases` extension replaces pi's static `Working...` line with a
  context-aware, rotating phrase: a tool-specific line while a tool runs
  (`Leyendo archivos…`), an SDD-phase line while a zero sub-agent runs
  (`Construyendo la implementación…`), and a rotation of playful verbs while the
  model thinks (`Maquinando…`). The thinking pool biases toward SDD vocabulary
  once a `/forge` run is detected.
- Installs a theme-tinted braille spinner that gently breathes through the
  palette's `dim`/`muted`/`accent` colours.
- Built only on pi's public extension API; every handler is defensive so the
  indicator can never break a session.

New file: `extensions/working-phrases.ts`.

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
