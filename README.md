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

Needs Node ≥ 20.6. Restart pi after an upgrade.

## 🛠 `/forge` — the SDD pipeline

The core of zero-pi. Run **`/forge <feature>`** and the orchestrator drives the
work through four phases, each delegated to its own sub-agent:

| Phase | Does |
| ----- | ---- |
| **explore** | Investigate the codebase read-only; produce findings. |
| **plan** | Write requirements, design, and an ordered task list. |
| **build** | Implement the plan. |
| **veredicto** | Review it adversarially and record a verdict. |

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
| **`/zero-models`** | Pick the model + provider + thinking level for each SDD phase — a boxed-window picker, or set one directly. |
| **Autotune** | Learns which model fits each phase from your run history and re-tunes itself. |
| **`/zero-sync` / `/zero-archive`** | Folds each run's spec delta into a canonical, project-wide spec store and archives approved runs. |
| **Git / PR / Issues** | `/zero-branch`, `/zero-git-validate`, `/zero-pr`, and `/zero-issue` keep branches and GitHub links audit-ready. |
| **Run memory** | Every run recalls and saves traces to Cortex, so runs learn from each other. |
| **Provider guard** | Warns when the `anthropic` provider runs on a metered API key instead of your subscription. |
| **Startup banner** | The violet ANSI-Shadow `ZERO` wordmark, drawn once at pi startup — `ZERO_HEADER=off` to disable. |
| **Working-phrase ticker** | Swaps pi's `Working...` for a context-aware Spanish phrase + spinner. |
| **Conversation resume** | Writes `.pi/zero-resume.md` on exit — the restore command + a conversation tail. |
| **Windows tree-kill** | Aborting a turn kills the whole process tree — no orphaned `claude`. |
| **Skill auto-learning** | Distills reusable skills from substantial tasks and surfaces them later. |
| **`zero-sdd` theme** | A dark, high-contrast pi theme tuned for SDD work. |

## ⌨️ Commands

| Command | Does |
| ------- | ---- |
| `/forge <feature>` | Run the SDD pipeline — `--continue [slug]` resumes. |
| `/zero-models [<phase>=[<provider>/]<model> [thinking=<level>]]` | Show or set per-phase models, providers, and thinking — `thinking=<level>` (`off\|minimal\|low\|medium\|high\|xhigh`); `autotune=auto\|ask\|off`. |
| `/zero-sync <slug>` | Fold a run's spec delta into the canonical spec store; a first all-`## ADDED` delta creates the store lazily. |
| `/zero-archive <slug>` | Merge an approved run into `.sdd/specs/`, move it to `.sdd/archive/YYYY-MM-DD-<slug>/`, and persist `archivePath`. |
| `/zero-validate <slug>` | Validate proposal/spec/design/tasks artifacts, including task schema and per-domain specs. |
| `/zero-status` | Show each `.sdd/` run's artifact, sync, latest-verdict, and GitHub-link status. |
| `/zero-branch <slug>` | Create/reuse the configured SDD Git branch and persist `branch`/`baseBranch`. |
| `/zero-git-validate <slug>` | Check worktree, branch, remote, `gh auth`, and verdict gating before PR/archive. |
| `/zero-pr <slug>` | Create an audit-ready GitHub PR from a run that already has verdict `pasa`. |
| `/zero-issue <slug>` | Create or reuse a GitHub issue for a run and persist the link. |
| `/zero-diff <slug>` | Preview the logical spec-store merge without writing files. |
| `/zero-resume` | Write the session handoff note now. |

### Git / PR / Issues

Recommended flow: `/zero-branch <slug>` → `/zero-issue <slug>` → `/forge <slug>` → `/zero-git-validate <slug> --for=pr` → `/zero-pr <slug>` → `/zero-archive <slug>`.

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

`~/.pi/zero.json` stores three parallel per-phase maps plus the autotune mode:

```json
{
  "models":    { "explore": "claude-haiku-4-5", "build": "claude-sonnet-4-6" },
  "providers": { "explore": "anthropic",        "build": "anthropic" },
  "thinking":  { "explore": "low",              "build": "high" },
  "autotune": "ask"
}
```

The `thinking` map sets each phase's pi effort level — one of `off`, `minimal`,
`low`, `medium`, `high`, `xhigh`. A phase with no entry gets no `thinking:` line
in its generated sub-agent (no aggressive default). Set it from the picker's
after-model thinking screen, or directly:

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

## Continuous integration

The `.github/workflows/zero-pi-ci.yml` workflow runs on every push to `main` and
on every pull request that touches `packages/zero-pi/**`. It enforces `npm test`
and `npm run pack-check` for the package.

## 🔗 Relationship to `zero`

zero-pi is the pi layer of the **zero** integrator. The `zero` CLI installs it
onto pi and writes the per-phase model config; you can also install zero-pi on
its own with the command above.

## Development

Dependency-free, no build step — pi loads the TypeScript extensions directly.
Run the test suite with `npm test`.

## License

MIT © Gonzalo Rocca · [github.com/gonzalonicolasr/zero-pi](https://github.com/gonzalonicolasr/zero-pi)
