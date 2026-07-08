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

[![npm](https://img.shields.io/npm/v/@gonrocca/zero-pi?color=af8aff&label=npm)](https://www.npmjs.com/package/@gonrocca/zero-pi) [![repo](https://img.shields.io/badge/repo-github-7497ff?logo=github&logoColor=white)](https://github.com/gonzalonicolasr/zero-pi) [![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/aNFCZBZVT3) [![license](https://img.shields.io/npm/l/@gonrocca/zero-pi?color=eebe5c)](./LICENSE) [![node](https://img.shields.io/node/v/@gonrocca/zero-pi?color=4fddab&label=node)](https://nodejs.org)

### 💬 Join the community

Questions, ideas, or want to debate workflow design? Come hang out:

[![Join the Discord](https://img.shields.io/badge/Discord-join%20the%20chat-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/aNFCZBZVT3)

</div>

---

zero-pi is an installable **[pi](https://pi.dev)** package that adds a
disciplined spec-driven development pipeline — plus a handful of quality-of-life
extensions — **without modifying pi**. Same idea as `gentle-pi`: pi stays
untouched; zero-pi is a package it loads.

## 📦 Install

```
pi install npm:@gonrocca/zero-pi
pi install npm:pi-subagents      # required — the pipeline delegates to sub-agents
```

Needs Node ≥ 20.6. Restart pi after an install or upgrade so pi regenerates
the `zero-*` phase agents.

### Quick start

1. Run `/zero-doctor` to catch missing `pi-subagents`, stale generated agents,
   invalid model config, or GitHub CLI auth before spending tokens.
2. Run `/zero-models` (or set direct assignments) when you want a different
   model/thinking profile per phase; otherwise the package defaults are used.
3. Run `/forge <feature>` and let the automatic gates drive the flow.
4. Read the final cost table: `/forge` invokes `/zero-cost <slug>` automatically
   at the end. Re-run `/zero-cost [slug]` manually only when you want to inspect
   an older run or debug missing metadata.

## 🛠 `/forge` — the SDD pipeline

The core of zero-pi. Run **`/forge <feature>`** and the orchestrator drives the
work through six phases — the automatic
**clarify → explore → plan → analyze → build → veredicto** flow — each delegated
to its own sub-agent:

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

The **clarify** and **analyze** gates are automatic inside `/forge` — no extra
slash command in the normal flow. `clarify` writes `.sdd/<slug>/clarifications.md`
and asks only when proceeding would risk the wrong product; `analyze` writes
`.sdd/<slug>/checklist.md` after the structural `/zero-validate` gate and returns
`continue` (build) or `replan` (re-run plan with concrete defects). Neither gate
counts as a build/veredicto round.

The verdict is `pasa` (done), `corregir` (re-run build), or `replantear`
(re-run plan). A hard iteration cap bounds the build↔veredicto loop — reached
without a `pasa`, the run stops and is reported as **not verified**.
`/forge --continue [slug]` resumes an interrupted run.

**Build runs test-first.** By default the build phase follows a strict TDD
cycle — RED → GREEN → TRIANGULATE → REFACTOR — and records a **TDD Cycle
Evidence** table; veredicto audits that evidence (tests exist, are really green,
assertions verify real behavior) and returns `corregir` if the discipline
slipped. It engages only when a test runner exists and the change touches code,
so docs/config-only work degrades gracefully. Opt a project out with
`tdd.mode: "off"` in `.sdd/config.json` (see *Configuration*).

The run speaks **Spanish**, in a bounded, low-noise format — one short summary
per phase, naming the model that phase runs on, no raw tool output. Or just
describe the work and say "hacelo con sdd": the `sdd-routing` skill routes it
into `/forge` for you.

## ✨ What else it adds

| Feature | What it does |
| ------- | ------------ |
| **Strict TDD** | The build phase drives RED → GREEN → TRIANGULATE → REFACTOR with a TDD Cycle Evidence table; veredicto audits it. On by default, runtime-gated on a test runner; `tdd.mode: "off"` disables it. |
| **`/zero-models`** | Pick the model + provider + thinking level for each of the six SDD phases — a boxed-window picker, or set one directly. Direct assignments are validated against pi's model registry when available. |
| **Phase tool gating** | Generated `zero-*` sub-agents get phase-specific tool allowlists: explore/veredicto are read-only, clarify/analyze/plan write only `.sdd` artifacts, build edits code. |
| **Dependency-aware tasks** | `tasks.md` is validated as a task graph with mandatory `depends:` edges, topological ordering, and review workload totals. |
| **Autotune** | Learns which model fits each phase from your run history and re-tunes itself; optional `autotuneBudget.maxPhaseCostUsd` suppresses costly step-ups. |
| **`/zero-doctor`** | Preflight diagnostics for zero-pi: package install, Node version, pi-subagents, generated phase agents, model config, `.sdd/config`, run history, git, and `gh` auth. |
| **`/zero-cost`** | Aggregates a run's sub-agent `meta.json` files into a per-phase token/cost/duration report — `/forge` invokes it automatically at the end; manual re-run stays available for older runs/debug. |
| **`/zero-checkpoint`** | Writes patch-based worktree checkpoints under `.sdd/<slug>/checkpoints/` before risky build batches. |
| **`/zero-sync` / `/zero-archive`** | Folds each run's spec delta into a canonical, project-wide spec store and archives approved runs. |
| **Git / PR / Issues** | `/zero-branch`, `/zero-git-validate`, `/zero-pr`, and `/zero-issue` keep branches and GitHub links audit-ready. |
| **Run memory** | Every run recalls and saves traces to Cortex, so runs learn from each other. |
| **Provider guard** | Warns when the `anthropic` provider runs on a metered API key instead of your subscription. |
| **Startup banner** | The sunset ANSI-Shadow `ZERO` wordmark, drawn once at pi startup — `ZERO_HEADER=off` to disable. |
| **ZERO HUD** | OMP-inspired segmented footer for SDD work: phase, model, tokens, cache, cost, diff, context %, and branch. Switch presets with `/zero-hud compact\|minimal\|full\|ascii\|off` or `ZERO_HUD_PRESET`. |
| **Pretty input box** | OMP-style prompt chrome with rounded corners, side borders, ZERO chips, and compact keyboard hints. |
| **Pretty code fences** | Markdown code blocks render as bordered panels with language badges instead of raw ```txt / ```json fence lines. |
| **Live activity panel** | Shows `/forge` phase progress and recent tool cards above the prompt while work is running. |
| **Working-phrase ticker** | Swaps pi's static `Working...` / `Procesando...` for a large pool of context-aware Spanish/ZERO/SDD phrases + spinner. |
| **Conversation resume** | Writes `.pi/zero-resume.md` on exit — the restore command + a conversation tail. |
| **Windows tree-kill** | Aborting a turn kills the whole process tree — no orphaned `claude`. |
| **SDD routing skill** | Natural-language requests that say "hacelo con sdd" route into `/forge` without remembering the slash command. |
| **`zero-sdd` theme** | A dark, high-contrast pi theme tuned for SDD work. |
| **`zero-sunset` theme** | A warm sunset variant — gold/coral/magenta accents over warm-dark panels, with one cool tone kept for syntax legibility. Activate with `/theme zero-sunset`. |

## ⌨️ Commands

| Command | Does |
| ------- | ---- |
| `/forge <feature>` | Run the SDD pipeline — `--continue [slug]` resumes. |
| `/zero-models [<phase>=[<provider>/]<model> [thinking=<level>]]` | Show or set per-phase models, providers, and thinking — `thinking=<level>` (`off\|minimal\|low\|medium\|high\|xhigh`); `autotune=auto\|ask\|off`. Direct assignments fail fast when pi's registry says the provider/model is unknown or ambiguous. |
| `/zero-doctor` | Run zero-pi preflight diagnostics: package, Node, pi-subagents, generated agents/support modules, model config, `.sdd/config`, run history, git, and `gh`. |
| `/zero-sync <slug>` | Fold a run's spec delta into the canonical spec store; a first all-`## ADDED` delta creates the store lazily. |
| `/zero-archive <slug>` | Merge an approved run into `.sdd/specs/`, move it to `.sdd/archive/YYYY-MM-DD-<slug>/`, and persist `archivePath`. |
| `/zero-validate <slug>` | Validate proposal/spec/design/tasks artifacts, including task schema and per-domain specs. |
| `/zero-status` | Show each `.sdd/` run's artifact, sync, latest-verdict, and GitHub-link status. |
| `/zero-hud [compact\|minimal\|full\|ascii\|off\|on\|preview]` | Preview or switch the segmented ZERO footer for this pi session. Default preset: `compact`. |
| `/zero-cost [<slug>]` | Report tokens (in/out/cache), USD cost, duration, and tool-count per SDD phase for a run — reads native pi session metas and project-local `.pi-subagents/artifacts`; `<slug>` for a specific run, no argument for the most recent. |
| `/zero-checkpoint [<slug>] [--json]` | Save `diff.patch`, `status.txt`, `head.txt`, `meta.json`, and a review-before-running `restore.sh` under `.sdd/<slug>/checkpoints/<id>/`. |
| `/zero-branch <slug>` | Create/reuse the configured SDD Git branch and persist `branch`/`baseBranch`. |
| `/zero-git-validate <slug>` | Check worktree, branch, remote, `gh auth`, and verdict gating before PR/archive. |
| `/zero-pr <slug>` | Create an audit-ready GitHub PR from a run that already has verdict `pasa`. |
| `/zero-issue <slug>` | Create or reuse a GitHub issue for a run and persist the link. |
| `/zero-diff <slug>` | Preview the logical spec-store merge without writing files. |
| `/zero-resume` | Write the session handoff note now. |

### Git / PR / Issues

Recommended flow: `/zero-branch <slug>` → `/zero-issue <slug>` → `/forge <slug>` (the orchestrator validates plan artifacts and can create `/zero-checkpoint` before build) → `/zero-git-validate <slug> --for=pr` → `/zero-pr <slug>` → `/zero-archive <slug>`.

`links.json` is forward-compatible and may contain:

```json
{
  "issueNumber": 12,
  "issueUrl": "https://github.com/org/repo/issues/12",
  "branch": "sdd/my-feature",
  "baseBranch": "main",
  "prNumber": 34,
  "prUrl": "https://github.com/org/repo/pull/34",
  "archivePath": ".sdd/archive/2026-05-24-my-feature"
}
```

`/zero-branch <slug>` uses `.sdd/config.json` when present:

```json
{ "git": { "branchPrefix": "sdd/", "numbering": false, "autoCommit": false, "commitStyle": "conventional", "baseBranch": "main" } }
```


`/zero-pr <slug>` builds a PR title/body from `.sdd/<slug>/proposal.md`,
`spec.md`, `design.md`, and `tasks.md`, then saves the returned `prNumber` and
`prUrl` into `.sdd/<slug>/links.json`. It only runs after the run's latest
recorded verdict is `pasa`; if an issue was already linked, the PR body includes
`Closes #N`.

`/zero-issue <slug>` searches open GitHub issues for the exact normalized title
before creating a new one, then saves `issueNumber` and `issueUrl` in the same
`links.json`. Both commands require the `gh` CLI to be installed and
authenticated (`gh auth login`). `--type=<label>` is optional: when the label
exists in the repository it is passed to `gh`, and when it does not exist the
command continues without it.

The implementation shells out through `gh` rather than GitHub-specific Node
SDKs, keeping zero-pi dependency-free and portable across Windows, macOS, and
Linux as long as GitHub CLI is on `PATH`.

### Spec deltas

`/zero-sync` and `/zero-diff` understand four delta sections: `## ADDED`, `## MODIFIED`, `## REMOVED`, and `## RENAMED`. `RENAMED` keeps the requirement's store position while changing its stable name:

```md
## RENAMED

### REQ: new-name

from: old-name

Updated requirement body.

Acceptance criteria:
- ...
```

## 🔧 Configuration

zero-pi keeps its state in `~/.pi/zero.json` (per-phase `models`, `providers`,
`thinking`, and autotune mode) and `~/.pi/zero-runs.jsonl` (the run-metrics log);
per-project artifacts live under `.sdd/`. Set `ZERO_RESUME=off` to disable the
conversation-resume note.

`~/.pi/zero.json` stores three parallel per-phase maps plus the autotune mode.
The configurable phases are `clarify`, `explore`, `plan`, `analyze`, `build`,
and `veredicto`; a pre-gates file that lists only the original four stays valid
and the missing `clarify`/`analyze` fall back to defaults (cheap/fast clarify,
strong analyze):

```json
{
  "models":    { "clarify": "claude-haiku-4-5", "analyze": "claude-opus-4-8", "build": "claude-sonnet-4-6" },
  "providers": { "clarify": "anthropic",         "analyze": "anthropic",       "build": "anthropic" },
  "thinking":  { "analyze": "high",              "build": "high" },
  "autotune": "ask",
  "autotuneBudget": { "maxPhaseCostUsd": 4, "minSamples": 3 }
}
```

The `thinking` map sets each phase's pi effort level — one of `off`, `minimal`,
`low`, `medium`, `high`, `xhigh`. An explicit entry always wins; a phase with no
entry (or an invalid level) falls back to the package default — `clarify:
medium`, `explore: high`, `plan: high`, `analyze: high`, `build: high`,
`veredicto: xhigh` — so no phase inherits your session-wide
`defaultThinkingLevel`. `autotuneBudget` is optional:
when `maxPhaseCostUsd` is set, autotune will not step a blamed phase up to a more
expensive tier if that phase/model is already at or above the average USD
ceiling with enough cost samples (`minSamples`, default 3). Set thinking from
the picker's after-model thinking screen, or directly:

```
/zero-models build=anthropic/claude-sonnet-4-6 thinking=high
/zero-models build=anthropic/claude-sonnet-4-6 high      # trailing shorthand
```

`.sdd/config.json` carries the per-project git and TDD settings:

```json
{
  "git": { "branchPrefix": "sdd/", "numbering": false, "autoCommit": false, "commitStyle": "conventional", "baseBranch": "main" },
  "tdd": { "mode": "strict", "testCommand": "" }
}
```

`tdd.mode` defaults to `"strict"` (the build phase runs test-first; veredicto
audits the TDD evidence) and accepts `"off"` to disable the discipline.
`tdd.testCommand` overrides the auto-detected test runner the TDD cycle invokes;
leave it empty to let the build/veredicto phases detect it from the project.

### Token efficiency

The phase sub-agents run **without** your global project context
(`inheritProjectContext: false`): a global `AGENTS.md` is heavy and may carry
personal data or credentials no phase needs — project conventions still reach
the phases, because explore/build skim the repo's own `AGENTS.md`/`CLAUDE.md`.
Every phase runs at an explicit `thinking:` level (your `zero.json` entry wins;
gaps take the package defaults above), and explore works under a numeric
tool-call budget with a mid-budget stop check. The heavy lifting happens inside
the sub-agents on their own models — leave the session that runs `/forge` on
your cheap default model.

## Release checks

Before publishing, run `npm test` and `npm run pack-check` from
`packages/zero-pi`. `prepublishOnly` also runs the test suite, but `pack-check`
confirms the npm tarball still contains the prompts, skills, themes, assets, and
extension support modules pi needs.

## 🔗 Relationship to `zero`

zero-pi is the pi layer of the **zero** integrator. The `zero` CLI installs it
onto pi and writes the per-phase model config; you can also install zero-pi on
its own with the command above.

## Development

Dependency-free, no build step — pi loads the TypeScript extensions directly.
Run the test suite with `npm test`.

## License

MIT © Gonzalo Rocca · [github.com/gonzalonicolasr/zero-pi](https://github.com/gonzalonicolasr/zero-pi)
