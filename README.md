```
███████╗ ███████╗ ██████╗   ██████╗           ██████╗  ██╗
╚══███╔╝ ██╔════╝ ██╔══██╗ ██╔═══██╗          ██╔══██╗ ██║
  ███╔╝  █████╗   ██████╔╝ ██║   ██║  █████╗  ██████╔╝ ██║
 ███╔╝   ██╔══╝   ██╔══██╗ ██║   ██║  ╚════╝  ██╔═══╝  ██║
███████╗ ███████╗ ██║  ██║ ╚██████╔╝          ██║      ██║
╚══════╝ ╚══════╝ ╚═╝  ╚═╝  ╚═════╝           ╚═╝      ╚═╝
```

# @gonrocca/zero-pi

An installable layer for **[pi](https://pi.dev)** — it adds the zero
spec-driven development workflow, skill auto-learning, and an animated `ZERO`
startup banner **without modifying pi itself**.

Same idea as `gentle-pi`: pi stays untouched; zero-pi is a package pi loads.

## Install

```bash
pi install npm:@gonrocca/zero-pi
```

That registers zero-pi in `~/.pi/agent/settings.json` and makes its prompts,
skills, and the startup-banner extension available in every pi session.

To remove it:

```bash
pi remove npm:@gonrocca/zero-pi
```

## What it adds

### SDD workflow (`prompts/`)

A spec-driven development pipeline driven through four phases, in order:

1. **explore** — investigate the codebase read-only; produce findings.
2. **plan** — write requirements, design, and an ordered task list.
3. **build** — implement the plan.
4. **veredicto** — review the build adversarially and record a verdict
   (`pasa`, `corregir`, or `replantear`).

Run it with the `/forge <feature>` prompt. The orchestrator drives phase order
and enforces a hard build/veredicto iteration cap. Each phase has its own prompt
under `prompts/phases/` so it can be delegated to a dedicated sub-agent.

Besides the explicit `/forge` command, an SDD run can also be started from
natural language: describe the work and signal SDD intent — e.g. "hacelo con
sdd" or "usá el pipeline" — and the `sdd-routing` skill routes the request into
`/forge` for you. It triggers only on a clear signal phrase and stays out of the
way for ordinary requests; `/forge` remains the primary, explicit entry point.

**Review Workload Forecast** — the plan phase keeps tasks reviewable. Every
planned task carries a `review: ~N changed lines` estimate, and `tasks.md` gains
a `## Review Workload` section with the per-task estimates and a bold run total.
Tasks are sized against a fixed budget of **400 changed lines per task** — an
internal, non-configurable default (borrowed from gentle-ai), so "small task"
means the same number on every run. A task whose estimate exceeds the budget is
split into smaller, individually verifiable tasks; one that genuinely cannot be
split stays whole and is recorded as an over-budget exception with a reason. The
orchestrator's plan-phase summary reports the run total and any exceptions.

### Per-phase models (`/zero-models`)

`/zero-models` is a real pi command — a code handler, not an LLM prompt — for
the SDD models. Run it with no argument to pick a phase and a model
interactively, or set one directly:

```
/zero-models                        # interactive picker
/zero-models build=claude-opus-4-7  # set one phase
```

It reads and writes `~/.pi/zero.json`; the orchestrator picks the change up on
the next `/forge` run.

Per-phase model assignments are read from `~/.pi/zero.json`, which the `zero`
CLI writes when it installs this layer.

**Run memory** — every SDD run reads from and writes to Cortex (the memory MCP
server). Before exploring, the orchestrator recalls prior `zero-run/*` traces
for the feature; when the run ends it saves a run-trace — the final verdict, the
correction rounds, and the gotchas — under `topic_key: zero-run/<slug>`. The
next run on related work starts from what the last one learned. With `--no-mcp`
the loop degrades silently.

### Canonical specs & `/zero-sync`

zero keeps a **canonical, project-wide spec store** that accumulates accepted
requirements across runs, so each `/forge` run builds on the last instead of
starting from a blank spec.

**The canonical store — `.sdd/specs/requirements.md`.** A single flat markdown
file: a `# ` title followed by `### REQ: <stable-unique-name>` requirement
blocks. It is the project's source of truth. The `plan` phase reads it as the
baseline; a fresh project has no store yet, and that absence simply means an
empty store.

**The granular plan artifacts.** Every run's `plan` phase writes four files
into `.sdd/<slug>/`:

- `proposal.md` — the change intent: scope and rationale, in prose.
- `spec.md` — the **delta** against the canonical store, never a full spec. Up
  to three `H2` sections — `## ADDED`, `## MODIFIED`, `## REMOVED` — each
  holding `### REQ:` blocks. `## MODIFIED` carries the complete updated text of
  an existing block (not a diff); `## REMOVED` needs only the name line.
- `design.md` — how it is built.
- `tasks.md` — the ordered task list with its `## Review Workload` section.

**`/zero-sync` — folding the delta into the store.** `/zero-sync <slug>` is a
real pi command — a deterministic, unit-tested merge, not an LLM prompt — that
reads the store and the run's delta `spec.md`, applies the ADDED/MODIFIED/REMOVED
changes, and writes the store atomically. Guardrails reject a bad delta before
anything is written: a duplicate name, an ADDED collision with an existing
block, a MODIFIED or REMOVED of a missing block, or malformed input. On a
guardrail failure it writes nothing and reports the offending requirement; the
store is never left half-merged. After a `pasa` verdict the SDD orchestrator
invokes `/zero-sync <slug>` automatically — a `corregir`, `replantear`, or
cap-reached run never syncs.

**The archive — `.sdd/archive/`.** Each successful sync appends a dated,
slug-named entry `.sdd/archive/<YYYY-MM-DD>-<slug>/` containing a copy of the
run's `proposal.md` and `spec.md` plus a `sync.md` report listing every added,
modified, and removed requirement. The archive is append-only — a new entry
never rewrites a prior one — so it is a full audit trail of how the canonical
store evolved.

### Adaptive model profiles

zero learns which model fits each SDD phase from your own run history and can
re-tune `~/.pi/zero.json` for you.

**The metrics log — `~/.pi/zero-runs.jsonl`.** Every completed SDD run appends
one JSON line to this file: the feature slug, the per-phase models the run used,
the final verdict, the build/veredicto round count, and the ordered per-round
verdict sequence. It is append-only and never rewritten. This local log is the
only thing zero learns from — a run abandoned before it reaches a verdict adds
no line.

**Phase attribution (v2).** The per-round verdict sequence makes blame precise:
a `corregir` round re-runs — and so blames — the `build` phase, and a
`replantear` round blames the `plan` phase. Autotune aggregates that sequence
per phase and upgrades **only the phase at fault**, one tier at a time — a
`build` problem no longer drags `plan` up with it. The `explore` and `veredicto`
phases are never tuned.

**Autotune modes.** At each pi session start zero aggregates the log and, once a
phase has accumulated enough run data to cross a confidence threshold, decides
whether that phase's model should change. Until a phase has accumulated enough
v2 runs of its own, autotune deliberately stays quiet — a one-time, silent
cold-start after upgrading, not a regression. The `autotune` mode in
`~/.pi/zero.json` controls what happens next:

| Mode | Behaviour |
| ---- | --------- |
| `auto` _(default)_ | zero applies the adjustment to `~/.pi/zero.json` and notifies you exactly what changed. |
| `ask` | zero records the recommendation but changes nothing — you apply it from `/zero-models`. |
| `off` | zero still records run metrics, but never changes or recommends anything. |

A change always takes effect on the *next* `/forge` run, and every applied
change is announced — autotune is never silent.

**Setting the mode.** Set it directly, or pick it from the interactive
`/zero-models` menu (which shows the current mode as its own entry):

```
/zero-models autotune=ask   # auto | ask | off
```

**Applying a pending suggestion.** In `ask` mode, when a recommendation is
waiting, running `/zero-models` shows a leading `★ aplicar sugerencia` entry;
selecting it applies the change and clears the pending suggestion. Note that a
pending suggestion is *refreshed* — an unactioned suggestion is overwritten by
the next `ask`-mode session with fresher data, so `/zero-models` always reflects
the most recent recommendation.

### Skill auto-learning (`skills/`)

`skill-loop.md` gives the agent a closed learning loop so solutions are reused
instead of re-derived.

### ZERO terminal theme (`themes/zero-sdd.json`)

`zero-pi` ships a Pi theme named `zero-sdd`: a dark, high-contrast terminal
palette with cyan, amber, mint, rose, and violet accents tuned for SDD work.
Select it from `/settings`, or set `"theme": "zero-sdd"` in Pi settings.

### Startup banner (`extensions/startup-banner.ts`)

Renders the `ZERO` wordmark as ASCII-safe Tetris cells. In the default animated
mode, the cells assemble from the bottom up when a pi session starts, then
settle into the completed ZERO banner. Pure ANSI 24-bit colour, no runtime
dependencies.

The render runs synchronously before pi draws its UI, so the animation never
fights pi's renderer.

### Working-phrase ticker (`extensions/working-phrases.ts`)

Pi shows a single static `Working...` line while the agent is busy. This
extension replaces it with a context-aware, rotating phrase:

- **While a tool runs** — a tool-specific line: `Leyendo archivos…`,
  `Ejecutando comandos…`, `Buscando en el código…`. MCP tools are named by
  server (`Consultando un MCP…`).
- **While a zero sub-agent runs** — the SDD phase it owns:
  `Explorando el código…`, `Planeando la solución…`,
  `Construyendo la implementación…`, `Revisando el veredicto…`.
- **While the model thinks** — a rotation of playful verbs (`Maquinando…`,
  `Rumiando…`, `Cocinando…`). Once a `/forge` run is detected the rotation
  biases toward SDD vocabulary.

It also installs a theme-tinted braille spinner that gently breathes through
the palette's `dim`/`muted`/`accent` colours. The extension uses only pi's
public extension API, and every handler is defensive — the indicator can never
break a session.

Control it with the `ZERO_BANNER` environment variable:

| `ZERO_BANNER` | Effect |
| ------------- | ------ |
| _(unset)_ / `shimmer` | Animated Tetris assembly, then settle (default) |
| `static` | Completed Tetris banner only, no animation |
| `off` | Render nothing |

Colour is skipped automatically when `NO_COLOR` is set or the output is not a
TTY.

### Provider guard (`extensions/provider-guard.ts`)

zero-pi watches model switches and steps in when you move to a metered
provider. When you switch to a model on the `anthropic` provider — which bills
per token and draws down your metered extra-usage pool — the guard offers to
redirect you to the equivalent model on `pi-claude-cli`, the provider backed by
your subscription's limits.

The redirect is offered through a confirmation dialog, and that dialog is your
escape hatch: say "yes" and the guard switches you to the subscription-backed
equivalent; say "no" (or cancel) and you stay on the metered `anthropic`
provider with no further nagging. When there is no equivalent model on
`pi-claude-cli`, and when a model is restored on session start rather than
switched deliberately, the guard skips the modal and just shows a one-line
warning. Switching to a subscription provider is a complete no-op — no dialog,
no notification, no noise.

## Relationship to `zero`

`zero-pi` is the pi-specific layer of the **[zero](https://github.com/gonzalonicolasr/zero)**
integrator. The `zero` CLI installs this layer onto pi (bootstrapping pi.dev
itself when it is missing) and writes the per-phase model configuration. You
can also install `zero-pi` directly with `pi install npm:@gonrocca/zero-pi` if
you only want the pi layer.

## License

MIT © Gonzalo Rocca
