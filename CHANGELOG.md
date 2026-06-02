# Changelog

All notable changes to `@gonrocca/zero-pi` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/); the package
uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Added — Strict TDD in the SDD pipeline (ported from gentle-ai)

- Two new support modules drive a real test-first discipline through the
  build/veredicto phases:
  - `prompts/support/strict-tdd.md` — the **build** contract: RED → GREEN →
    TRIANGULATE → REFACTOR, a Safety Net for modified files, test-layer
    selection, pure-function preference, approval testing for refactors, the
    banned-assertion catalogue (tautologies, ghost loops, smoke-only tests,
    impl-detail/CSS assertions, mock-heavy tests), and a mandatory **TDD Cycle
    Evidence** table written to `.sdd/<slug>/tdd-evidence.md`.
  - `prompts/support/strict-tdd-verify.md` — the **veredicto** audit: verify the
    evidence table, cross-reference reported test files, re-run the tests, audit
    assertion quality, and map a failed audit to a `corregir` verdict.
- `extensions/sdd-config.ts`: new `tdd` block in `.sdd/config.json` —
  `{ mode: "strict" | "off", testCommand: string }`, defaulting to
  `strict` with auto-detected runner. Strict is **runtime-gated**: it only
  engages when a test runner exists and the change touches code, so docs/config
  changes and runner-less projects degrade gracefully.
- `extensions/sdd-agents.ts`: at load it now stages the two support modules to
  `~/.pi/agent/agents/zero/support/` (`SUPPORT_MODULES`, `supportModulesDir()`)
  so the `inheritSkills: false` `zero-build` / `zero-veredicto` sub-agents can
  `read` them at runtime. Best-effort: a copy failure falls back to the prompt's
  inline TDD contract.
- Phase prompts wired with a Strict TDD gate: `build.md` (resolve mode + runner
  + code-touch, then follow the module), `veredicto.md` (TDD audit → verdict),
  `plan.md` (TDD-shaped tasks pair a test file with each production file),
  `orchestrator.md` (`## Strict TDD forwarding`), and `forge.md`.
- 11 new tests (`sdd-config.test.ts` tdd defaults/overrides, `sdd-agents.test.ts`
  support-module exports).

## [0.1.49] - 2026-05-24

### Added — scan-guard: block filesystem-wide scans

- New extension `scan-guard` (`scan-guard.ts` pure logic + `scan-guard-extension.ts`
  wiring) hooks the `tool_call` event and **blocks** any shell command whose
  `find` / `grep -r` / `rg` is rooted at a filesystem root (`/`, a bare drive
  mount like `/c` or `C:\`, or `~`/`$HOME`), returning a reason that points the
  agent at the plan's code root. Scoped searches (`find /e/zero/.sdd …`, `rg foo
  src/`) are always allowed.
- Motivation: a `zero-veredicto` subagent ran `find / -maxdepth 12 …` to
  rediscover the code and wedged the whole pipeline for 6+ hours — on Windows
  that traversal hangs forever forcing OneDrive to hydrate cloud placeholders.
  The phase prompt already discouraged full-tree scans, but a prompt is not
  enforcement; this guard is. Degrades to "allow" on any internal error so it
  can never block a tool by accident or break a session.
- 23 new tests (`scan-guard.test.ts`, `scan-guard-extension.test.ts`).

### Changed — phase prompts hardened against full-tree scans

- `veredicto.md`: the "Locating the code" guidance is now a hard rule that
  forbids root-rooted `find`/`grep`/`rg`, explains the Windows/OneDrive hang,
  and adds a fallback for delta/forge runs with no `design.md` — read the code
  root from the `Code root:` line in `tasks.md` or the task input.
- `explore.md`: adds an explicit "scope every search to the project, never the
  filesystem root" rule.
- Same edits mirrored in the zero integrator assets (`src/payload/assets/sdd/phases/`).

## [0.1.48] - 2026-05-22

### Added — CI pipeline for zero-pi

- New GitHub Actions workflow `.github/workflows/zero-pi-ci.yml`: runs on push
  to `main` and PRs touching `packages/zero-pi/**`, matrix Node 20.x / 22.x,
  executes `npm test` and `npm run pack-check`.
- New `pack-check` script in `package.json` (`npm pack --dry-run`) used as the
  packaging gate before publish.
- README documents the CI gate under a new *Continuous integration* section.

SDD artifacts: `.sdd/zero-pi-improvements/`.

### autotune v2 — phase attribution (in progress)

Spec-driven work under `.sdd/autotune-phase-attribution/`. The SDD verdict
already names the culprit — a `corregir` blames `build`, a `replantear` blames
`plan` — so autotune will upgrade only the phase actually at fault instead of
every phase with tier headroom (v1's blunt behaviour). Requirements written;
design pending.

## [0.1.41] - 2026-05-19

### Changed — brand (www.ceroclawd.com) is violet

The `www.ceroclawd.com` brand in the statusline was amber; set to violet to
match the user's reference statusline. (Diff parsing unchanged — `+`/`-` from
`git diff --shortstat`, tracked-modified lines only.)

## [0.1.40] - 2026-05-19

### Fixed — statusline tokens were stuck at 0

`zero-statusline.ts` accumulated tokens from `message_update` events using
`usage.inputTokens` / `usage.outputTokens` — but pi names those fields
`usage.input` / `usage.output`, so the accumulator never added anything.
Replaced with `computeSessionTokens(sessionManager)` that sums assistant
input/output across `sessionManager.getEntries()` on every render — exactly
how pi's own footer computes the same numbers, and immune to streamed
`message_update` repeats double-counting. `readGit` also gained a
`process.cwd()` fallback so the branch shows even when `ctx.cwd` is absent.
New unit test covers the session-token sum (assistant-only, malformed
entries ignored, missing sessionManager → zeros).

## [0.1.39] - 2026-05-19

### Added — colored statusline footer (`zero-statusline.ts`)

New pi-managed footer status that shows, with the theme's colors:

  `claude-opus-4-7 · tok ↑12.3K ↓4.1K · diff +50/-12 · ctx 45% · master · www.ceroclawd.com`

Model in violet, tokens cyan/blue (cumulative for the session), git diff
mint/rose, context % mint→amber→rose by load, branch steel,
`www.ceroclawd.com` brand in amber. No timer — refreshes on `session_start`,
`model_select`, `message_update` (token usage), and `tool_execution_end`
(re-reads `git diff --shortstat`). Pure formatters (`formatTokenCount`,
`ctxColor`, `shortModel`, `composeStatusline`) exported and unit-tested.

## [0.1.38] - 2026-05-19

### Reverted — banner is a one-shot stdout write again

0.1.33–0.1.37 installed the banner as a pi-managed widget via
`ctx.ui.setWidget` so it would survive terminal resize. But pi positions
widgets **above the editor**, not at the top of the viewport — with a short
chat the banner ended up centered in the empty space between the chat and
the editor, not at the top. Reverted to a one-shot `process.stdout.write`
at extension load, so the banner sits at the top of the terminal scrollback
where a CLI startup banner belongs. Tradeoff: a terminal resize can scroll
it out of view (normal CLI behavior). pi has no `setHeader` / top-anchored
widget API, so this is the only way to put it at the top.

## [0.1.37] - 2026-05-19

### Changed — accent color is now violet

The `zero-sdd` theme's `accent` token was `cyan`. Set to `violet` (`#af8aff`)
so cursor, picker frame, highlighted rows and every other accent-tinted UI
element matches the banner — the "active typing zone" reads as violet without
having to recolor default text. `mdLink` / `toolTitle` / `syntaxFunction` etc.
still point at `cyan` directly so they keep their cyan tint.

## [0.1.36] - 2026-05-19

### Changed — your input messages are violet

The `zero-sdd` theme's `userMessageText` was `""` (default terminal white).
Set to `"violet"` (`#af8aff`) — the same brand color the banner uses — so
your typed messages stand out from the assistant's responses with a
consistent visual identity. Hot-reload picks it up automatically on a running
pi session; otherwise restart pi.

## [0.1.35] - 2026-05-19

### Note — accidental release without the theme change

Published by mistake during the 0.1.36 release flow: the version + this
changelog entry made it out, but the actual `themes/zero-sdd.json` edit did
not. Superseded by 0.1.36 — install that instead.

## [0.1.34] - 2026-05-19

### Fixed — banner widget no longer truncated

0.1.33's banner is 12 lines but pi's `setWidget` caps managed widgets at
`MAX_WIDGET_LINES = 10` — so the bottom ornament + the tagline were replaced
with `... (widget truncated)`. The wide layout is now exactly 10 lines (top
ornament + 7 logo rows + tag + bottom ornament) by dropping the two internal
blank-line paddings. Everything visible inside the cap.

## [0.1.33] - 2026-05-19

### Changed — banner survives resize (managed widget)

The ZERO banner used to be a one-shot `stdout.write` at extension load — it
sat in scrollback, so when the terminal resized (maximize/minimize) it
disappeared. It is now installed as a pi-managed widget above the editor via
`ctx.ui.setWidget`, hooked on `session_start` (fires on startup, reload, new,
resume, fork). pi owns the lines and redraws them on every resize, so the
banner stays put. Stays static (no animation timer), so the historical
re-render loop crash on pi 0.75.x cannot recur. Tradeoff: the banner is now
pinned above the editor for the whole session — it occupies ~12 rows
permanently instead of scrolling away. `ZERO_HEADER=off` still disables it.

## [0.1.32] - 2026-05-19

### Changed — the `/zero-models` picker draws a real bordered box

0.1.30's boxed picker used pi-tui's `Box`, which only pads (background +
padding) — no visible frame, so the panel rendered borderless. The picker now
draws a true 4-sided Unicode box (`┌─┐ │ └─┘`) around the panel, themed. As a
side effect `@earendil-works/pi-tui` is no longer imported at all — the
component renders its own lines — which removes the lazy dynamic-`import()`
workaround `zero-models.ts` carried for it.

## [0.1.31] - 2026-05-19

### Fixed — 0.1.30 shipped without `zero-models-picker.ts`

0.1.30 added `zero-models-picker.ts` (the picker's pure module, imported by
`zero-models.ts`) but the `package.json` `files` allowlist — which enumerates
extension files one by one — was not updated, so the file was omitted from the
published tarball. pi failed to load the `zero-models` extension with
`Cannot find module './zero-models-picker.ts'`. The file is now in `files`.

## [0.1.30] - 2026-05-19

### Changed — `/zero-models` interactive picker is now a boxed-window TUI

The no-arg `/zero-models` interactive flow was a chain of pi's flat
`ui.select`/`ui.input` prompts. It is now a single bordered panel rendered via
pi's `ctx.ui.custom()` + `@earendil-works/pi-tui` (`Box`/`Text`): a
"zero · modelos SDD" window with the four phases, the autotune entry, and
save/exit, navigated with the arrow keys, drilling phase → provider → model.
The picker's menu/navigation logic is a new pure, fully unit-tested module
(`zero-models-picker.ts`). The direct command forms
(`/zero-models <phase>=[<provider>/]<model>`, `/zero-models autotune=<mode>`)
are unchanged. Built via the SDD loop — spec/design/tasks under
`.sdd/zero-models-boxed-tui/`.

## [0.1.29] - 2026-05-19

### Added — the ZERO startup banner ships with zero-pi

The violet "ZERO SDD" ANSI-Shadow banner (`zero-banner.ts`) is now a zero-pi
package extension, so `pi install npm:@gonrocca/zero-pi` brings it — it was
previously a hand-placed standalone global extension. Static by design: drawn
once at load, no animation timer (an animated header spammed/crashed pi
0.75.x). Disable with `ZERO_HEADER=off`.

## [0.1.28] - 2026-05-19

### Removed — the startup banner

zero-pi no longer ships the `startup-banner.ts` extension (the Tetris-cell
`ZERO` banner). It collided with the standalone `zero-banner.ts` global pi
extension (`~/.pi/agent/extensions/`), rendering two banners at pi startup.
zero-pi now ships no banner of its own — `zero-banner.ts` is the single
banner — so the double banner cannot recur. The `ZERO_BANNER` environment
variable is removed with it.

## [0.1.27] - 2026-05-19

### Documentation

Condensed the README — `/forge` and the four-phase pipeline are now the clear
headline; the per-feature reference paragraphs collapse into a single
scannable table. Roughly a third of the previous length.

## [0.1.26] - 2026-05-19

### Documentation

Added a GitHub badge and a repository link to the README header, pointing at
the standalone `github.com/gonzalonicolasr/zero-pi` repo.

## [0.1.25] - 2026-05-19

### Changed — provider guard reworked for Anthropic OAuth

The provider guard no longer redirects `anthropic` → `pi-claude-cli` (that
provider is no longer used). It now keys off pi's **auth mode** rather than the
provider name: it reads `modelRegistry.isUsingOAuth` and warns only when the
`anthropic` provider runs on an **API key** (metered extra usage) instead of a
Claude Pro/Max subscription OAuth login. The redirect, the confirmation dialog,
and the `METERED_TO_SUBSCRIPTION` map are removed — the guard is now warn-only.
An unknown auth mode (older pi without `isUsingOAuth`) never warns.

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
