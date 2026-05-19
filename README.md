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

[![npm](https://img.shields.io/npm/v/@gonrocca/zero-pi?color=af8aff&label=npm)](https://www.npmjs.com/package/@gonrocca/zero-pi) [![repo](https://img.shields.io/badge/repo-github-7497ff?logo=github&logoColor=white)](https://github.com/gonzalonicolasr/zero-pi) [![license](https://img.shields.io/npm/l/@gonrocca/zero-pi?color=eebe5c)](./LICENSE) [![node](https://img.shields.io/node/v/@gonrocca/zero-pi?color=4fddab&label=node)](https://nodejs.org)

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

The run speaks **Spanish**, in a bounded, low-noise format — one short summary
per phase, naming the model that phase runs on, no raw tool output. Or just
describe the work and say "hacelo con sdd": the `sdd-routing` skill routes it
into `/forge` for you.

## ✨ What else it adds

| Feature | What it does |
| ------- | ------------ |
| **`/zero-models`** | Pick the model + provider for each SDD phase — interactive or direct. |
| **Autotune** | Learns which model fits each phase from your run history and re-tunes itself. |
| **`/zero-sync`** | Folds each run's spec delta into a canonical, project-wide spec store. |
| **Run memory** | Every run recalls and saves traces to Cortex, so runs learn from each other. |
| **Provider guard** | Warns when the `anthropic` provider runs on a metered API key instead of your subscription. |
| **Working-phrase ticker** | Swaps pi's `Working...` for a context-aware Spanish phrase + spinner. |
| **Conversation resume** | Writes `.pi/zero-resume.md` on exit — the restore command + a conversation tail. |
| **Windows tree-kill** | Aborting a turn kills the whole process tree — no orphaned `claude`. |
| **Skill auto-learning** | Distills reusable skills from substantial tasks and surfaces them later. |
| **`zero-sdd` theme** | A dark, high-contrast pi theme tuned for SDD work. |

## ⌨️ Commands

| Command | Does |
| ------- | ---- |
| `/forge <feature>` | Run the SDD pipeline — `--continue [slug]` resumes. |
| `/zero-models [<phase>=[<provider>/]<model>]` | Show or set per-phase models — `autotune=auto\|ask\|off`. |
| `/zero-sync <slug>` | Fold a run's delta into the canonical spec store. |
| `/zero-resume` | Write the session handoff note now. |

## 🔧 Configuration

zero-pi keeps its state in `~/.pi/zero.json` (per-phase models + autotune mode)
and `~/.pi/zero-runs.jsonl` (the run-metrics log); per-project artifacts live
under `.sdd/`. Set `ZERO_RESUME=off` to disable the conversation-resume note.

## 🔗 Relationship to `zero`

zero-pi is the pi layer of the **zero** integrator. The `zero` CLI installs it
onto pi and writes the per-phase model config; you can also install zero-pi on
its own with the command above.

## Development

Dependency-free, no build step — pi loads the TypeScript extensions directly.
Run the test suite with `npm test`.

## License

MIT © Gonzalo Rocca · [github.com/gonzalonicolasr/zero-pi](https://github.com/gonzalonicolasr/zero-pi)
