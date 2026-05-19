```
███████╗ ███████╗ ██████╗   ██████╗           ██████╗  ██╗
╚══███╔╝ ██╔════╝ ██╔══██╗ ██╔═══██╗          ██╔══██╗ ██║
  ███╔╝  █████╗   ██████╔╝ ██║   ██║  █████╗  ██████╔╝ ██║
 ███╔╝   ██╔══╝   ██╔══██╗ ██║   ██║  ╚════╝  ██╔═══╝  ██║
███████╗ ███████╗ ██║  ██║ ╚██████╔╝          ██║      ██║
╚══════╝ ╚══════╝ ╚═╝  ╚═╝  ╚═════╝           ╚═╝      ╚═╝
```

<div align="center">

# @gonrocca/zero-pi

**The zero spec-driven development workflow, packaged for [pi](https://pi.dev).**

[![npm](https://img.shields.io/npm/v/@gonrocca/zero-pi?color=af8aff&label=npm)](https://www.npmjs.com/package/@gonrocca/zero-pi)
[![license](https://img.shields.io/npm/l/@gonrocca/zero-pi?color=eebe5c)](./LICENSE)
[![node](https://img.shields.io/node/v/@gonrocca/zero-pi?color=4fddab&label=node)](https://nodejs.org)

</div>

---

zero-pi adds the **`/forge`** SDD pipeline, skill auto-learning, adaptive
per-phase models, a metered-billing guard, and an animated `ZERO` banner —
**without modifying pi itself**. Same idea as `gentle-pi`: pi stays untouched;
zero-pi is a package pi loads. Every prompt, skill, extension and theme below
ships inside this one package.

## Contents

- [Install](#-install)
- [The SDD workflow](#-the-sdd-workflow)
- [Quality-of-life extensions](#-quality-of-life-extensions)
- [Commands](#-commands)
- [Environment variables](#-environment-variables)
- [Files it reads & writes](#-files-it-reads--writes)
- [Relationship to `zero`](#-relationship-to-zero)
- [Development](#-development)

---

## 📦 Install

```
pi install npm:@gonrocca/zero-pi
```

That registers zero-pi in `~/.pi/agent/settings.json` and makes its prompts,
skills, theme, and extensions available in every pi session.

| Requirement | Detail |
| ----------- | ------ |
| `pi-subagents` | **Required** — the SDD pipeline delegates each phase to a sub-agent. Install with `pi install npm:pi-subagents`. |
| Node | ≥ 20.6 — pi loads the TypeScript extensions directly. |
| After upgrade | Restart pi for the new version to take effect. |

Remove it with `pi remove npm:@gonrocca/zero-pi`.

---

## 🛠 The SDD workflow

### `/forge` — the four-phase pipeline

A spec-driven development run, driven through four phases in order:

| Phase | Does |
| ----- | ---- |
| **explore** | Investigate the codebase read-only; produce findings. |
| **plan** | Write requirements, design, and an ordered task list. |
| **build** | Implement the plan. |
| **veredicto** | Review the build adversarially and record a verdict. |

Start it with `/forge <feature>`. The orchestrator drives phase order and
enforces a hard build/veredicto iteration cap — a `corregir` verdict re-runs
`build`, a `replantear` re-runs `plan`, and when the cap is reached without a
`pasa` the run stops and reports the result as **not verified**.
`/forge --continue [slug]` resumes an interrupted run from its `.sdd/<slug>/`
artifacts.

A run can also start from natural language: describe the work and signal SDD
intent — "hacelo con sdd", "usá el pipeline" — and the `sdd-routing` skill
routes it into `/forge`. It triggers only on a clear signal phrase; `/forge`
stays the primary, explicit entry point.

### Language & output

A `/forge` run reads as a short, calm progress stream, in Spanish:

- **Language Boundary** — every user-facing message is in Spanish (Rioplatense
  voseo); sub-agent briefs stay in English for token efficiency; identifiers
  (verdicts, slugs, paths, model ids, commands) are kept verbatim.
- **Output Contract** — each phase reports a bounded summary
  (`Estado` / `Resumen` / `Artefactos` / `Siguiente`), never free-form prose.
  No raw tool output, file dumps, sub-agent listings, or triple-backtick code
  fences reach the chat. The phase-start line names the model and provider the
  phase runs on plus a brief gloss of what it does — so a slow phase reads as
  working, not frozen. The run ends stating `verificado` or `no verificado`.

### Review Workload Forecast

The `plan` phase keeps tasks reviewable. Every planned task carries a
`review: ~N changed lines` estimate, and `tasks.md` gains a `## Review Workload`
section with a bold run total. Tasks are sized against a fixed budget of
**400 changed lines per task** (borrowed from gentle-ai). A task over budget is
split; one that genuinely cannot be split stays whole and is recorded as an
over-budget exception with a reason.

### SDD sub-agents — `sdd-agents.ts`

`pi-subagents` discovers agents from `~/.pi/agent/agents/**/*.md`, but a
`pi install` ships only the phase *prompts*. This extension closes the gap: on
every load it generates the four `zero-<phase>` agent files under
`~/.pi/agent/agents/zero/` from the package's phase prompts and the per-phase
models in `~/.pi/zero.json`, so they stay in sync with the prompts and with
`/zero-models`.

### Per-phase models — `/zero-models`

A real pi command — a code handler, not an LLM prompt — for the SDD models. Run
it with no argument for the **provider-aware** interactive picker
(**phase → provider → model**, sourced from pi's model registry), or set one
directly:

```
/zero-models                          interactive picker
/zero-models build=claude-opus-4-7     set one phase
/zero-models build=codex/gpt-5-codex   set one phase with an explicit provider
```

It reads and writes `~/.pi/zero.json` — a `models` map and a parallel
`providers` map. The orchestrator picks the change up on the next `/forge` run.

### Run memory — Cortex

Every run reads from and writes to Cortex, the persistent-memory MCP server.
Before exploring, the orchestrator recalls prior `zero-run/*` traces; when the
run ends it saves a run-trace — verdict, correction rounds, gotchas — under
`topic_key: zero-run/<slug>`. The next run starts from what the last one
learned. With `--no-mcp`, or when Cortex is unreachable, the loop degrades
silently and never blocks a run.

### Canonical specs & `/zero-sync`

zero keeps a **canonical, project-wide spec store** that accumulates accepted
requirements across runs, so each `/forge` run builds on the last.

- **The store** — `.sdd/specs/requirements.md`: a `# ` title followed by
  `### REQ: <name>` blocks. The `plan` phase reads it as the baseline.
- **The plan artifacts** — every run's `plan` phase writes `proposal.md`,
  `spec.md` (the **delta**: `## ADDED` / `## MODIFIED` / `## REMOVED`),
  `design.md`, and `tasks.md` into `.sdd/<slug>/`.
- **`/zero-sync <slug>`** — a deterministic, unit-tested merge that folds the
  delta into the store atomically. Guardrails reject a bad delta before
  anything is written. The orchestrator invokes it automatically after a `pasa`
  verdict — never on `corregir`, `replantear`, or a cap-reached run.
- **The archive** — `.sdd/archive/<YYYY-MM-DD>-<slug>/`: an append-only audit
  trail of every sync.

### Adaptive model profiles — autotune

zero learns which model fits each SDD phase from your own run history.

- **The metrics log** — `~/.pi/zero-runs.jsonl`: every completed run appends one
  JSON line (slug, per-phase models, verdict, round count, per-round verdict
  sequence). Append-only.
- **Phase attribution** — a `corregir` round blames `build`, a `replantear`
  blames `plan`. Autotune upgrades **only the phase at fault**, one tier at a
  time. `explore` and `veredicto` are never tuned.
- **Cross-machine sync** — each run pushes its metrics to Cortex; `/forge`
  pulls the shared log back, so autotune sees runs from other machines too.

The `autotune` mode in `~/.pi/zero.json` controls what happens:

| Mode | Behaviour |
| ---- | --------- |
| `auto` _(default)_ | Applies the adjustment to `~/.pi/zero.json` and notifies you what changed. |
| `ask` | Records the recommendation; you apply it from `/zero-models`. |
| `off` | Records run metrics, but never changes or recommends anything. |

Set it with `/zero-models autotune=<auto\|ask\|off>`. In `ask` mode a waiting
recommendation shows as a leading `★ aplicar sugerencia` entry in `/zero-models`.

### Skill auto-learning — `skill-loop`

Gives the agent a closed learning loop — distill a reusable skill from a
substantial task, store it, surface relevant skills on a new task, refine an
existing skill instead of duplicating it — so solutions are reused, not
re-derived.

---

## ✨ Quality-of-life extensions

### Provider guard — `provider-guard.ts`

The `anthropic` provider runs two ways: a Claude Pro/Max **subscription** login
(OAuth, via `/login` — `pi-claude-oauth-adapter` smooths this path) or an **API
key**, which bills per token from your metered extra-usage pool. Same provider
id, different billing. The guard watches model switches and reads pi's auth mode
(`modelRegistry.isUsingOAuth`): when a model runs on `anthropic` with an API key
it emits a single non-blocking warning suggesting `/login`. On OAuth, or on any
other provider, it stays silent.

### Startup banner — `startup-banner.ts`

Renders the `ZERO` wordmark as ASCII-safe Tetris cells in pure ANSI 24-bit
colour, no runtime dependencies. The cells assemble from the bottom up, settle,
then run a short **sparkle pass** — a few cells glint bright for about a second.
The render runs synchronously before pi draws its UI.

| `ZERO_BANNER` | Effect |
| ------------- | ------ |
| _(unset)_ / `shimmer` | Animated assembly + sparkle, then settle (default) |
| `static` | Completed banner only, no animation |
| `off` | Render nothing |

Colour is skipped automatically when `NO_COLOR` is set or output is not a TTY.

### Working-phrase ticker — `working-phrases.ts`

Replaces pi's static `Working...` line with a context-aware, rotating Spanish
phrase — tool-specific while a tool runs (`Leyendo archivos…`), the SDD phase
while a sub-agent runs (`Planeando la solución…`), playful verbs while the model
thinks (`Maquinando…`) — plus a theme-tinted braille spinner.

### Conversation resume — `conversation-resume.ts`

When pi exits normally, writes a local handoff note at `.pi/zero-resume.md` —
the exact restore command for the persisted session plus a concise conversation
tail. Generate it any time with `/zero-resume`. zero-pi creates `.pi/.gitignore`
so conversation context is never committed. Set `ZERO_RESUME=off` to disable the
automatic write.

### Windows process-tree kill — `win-tree-kill.ts`

On Windows, `kill()` terminates only the target process — so aborting a turn can
leave an orphaned `claude` process streaming (Esc appears to do nothing). This
extension patches `child_process.spawn` so every later subprocess tree-kills via
`taskkill /T /F`. No-op on non-Windows. **Keep it enabled on Windows.**

### ZERO terminal theme — `themes/zero-sdd.json`

A dark, high-contrast pi theme with cyan, amber, mint, rose, and violet accents
tuned for SDD work. Select it from `/settings`, or set `"theme": "zero-sdd"`.

---

## ⌨️ Commands

| Command | What it does |
| ------- | ------------ |
| `/forge <feature>` | Run the four-phase SDD pipeline for a feature. |
| `/forge --continue [slug]` | Resume an interrupted SDD run. |
| `/zero-models [<phase>=[<provider>/]<model>]` | Show or set the per-phase SDD models. |
| `/zero-models autotune=<auto\|ask\|off>` | Set the autotune mode. |
| `/zero-sync <slug>` | Fold a run's delta `spec.md` into the canonical store. |
| `/zero-resume` | Write `.pi/zero-resume.md` now. |

## 🔧 Environment variables

| Variable | Effect |
| -------- | ------ |
| `ZERO_BANNER` | `shimmer` (default) · `static` · `off` — startup-banner mode. |
| `ZERO_RESUME` | `off` / `0` disables the automatic conversation-resume write. |
| `NO_COLOR` | Standard — disables banner colour. |

## 📂 Files it reads & writes

| Path | Role |
| ---- | ---- |
| `~/.pi/zero.json` | Per-phase `models` / `providers` and the `autotune` mode. |
| `~/.pi/zero-runs.jsonl` | Append-only run-metrics log autotune learns from. |
| `~/.pi/agent/agents/zero/` | Generated `zero-<phase>` sub-agent files. |
| `.sdd/<slug>/` | Per-run plan artifacts. |
| `.sdd/specs/requirements.md` | The canonical, project-wide spec store. |
| `.sdd/archive/` | Append-only audit trail of every `/zero-sync`. |
| `.pi/zero-resume.md` | Local session handoff note. |

## 🔗 Relationship to `zero`

`zero-pi` is the pi-specific layer of the **zero** integrator. The `zero` CLI
installs this layer onto pi (bootstrapping pi.dev itself when missing) and
writes the per-phase model configuration. You can also install `zero-pi`
directly with `pi install npm:@gonrocca/zero-pi` if you only want the pi layer.

## 🧪 Development

Dependency-free, no build step — pi loads the TypeScript extensions directly.
Run the test suite with:

```
npm test
```

---

<div align="center">

MIT © Gonzalo Rocca

</div>
