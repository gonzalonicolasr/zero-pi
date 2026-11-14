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

</div>

---

zero-pi is a package for **[pi](https://pi.dev)** that adds `/forge`: one command
that takes a feature through a spec-driven pipeline, one sub-agent per phase,
with a model and thinking level you choose for each phase. pi stays untouched.

```
clarify ─► explore ─► plan ─► analyze ─► build ─► veredicto ─► pasa (done)
                       ▲         │          ▲          │
                       └─ replan ┘          └─corregir─┤
                       ▲                               │
                       └───────── replantear ──────────┘
```

```
pi install npm:@gonrocca/zero-pi
pi install npm:pi-subagents        # required: every phase runs as a sub-agent
# restart pi, then inside pi:
/forge add a dark-mode toggle to the settings page
```

## Install

Needs Node ≥ 20.6 and pi. Install both packages as above and **restart pi** so
it regenerates the `zero-*` phase agents (do it again after every upgrade).

Then run `/zero-doctor`. It checks `pi-subagents`, generated agents, model
config and `gh` auth before you spend tokens.

## Quick use

1. `/forge <feature>`. It asks for interactive or automatic mode, then runs the
   phases. The run is in Spanish and prints one short summary per phase.
2. In interactive mode it pauses after each phase for your approval.
3. At the end it prints a cost table and, if the verdict is `pasa`, asks you to
   run `/zero-archive <slug>`.
4. `/forge --continue [slug]` resumes an interrupted run.

You can also write "hacelo con sdd" in a normal message: the `sdd-routing`
skill sends it to `/forge`.

## Phases

| Phase | Does |
| ----- | ---- |
| **clarify** | Records assumptions; stops only on blocking ambiguity. |
| **explore** | Reads the codebase (read-only) and writes findings. |
| **plan** | Writes requirements, design and an ordered task list. |
| **analyze** | Checks the plan after `/zero-validate`: `continue` or `replan`. |
| **build** | Implements the plan, test-first (strict TDD when a test runner exists). |
| **veredicto** | Reviews adversarially: `pasa`, `corregir` (back to build) or `replantear` (back to plan). |

Clarify and analyze run on their own. A run that reaches the round cap (3 by
default) without a `pasa` is reported as **not verified**. Everything lands in
`.sdd/<slug>/` (`clarifications.md`, `findings.md`, `spec.md`, `design.md`,
`tasks.md`, `checklist.md`, ...). Details: [docs/forge-pipeline.md](./docs/forge-pipeline.md).

## Models and profiles

Each phase has its own model, provider and thinking level. Without config, the
defaults are: Haiku 4.5 for clarify/explore, Opus 4.8 for plan/analyze/veredicto,
Sonnet 4.6 for build. A **profile** is a named setup you can switch.

```
/zero-models                                       # picker (the main screen is the profile list)
/zero-models build=anthropic/claude-sonnet-4-6 thinking=high
/zero-models profile new barato                    # snapshot current setup and activate it
/zero-models profile use premium                   # switch, then restart pi
```

| Profile command | Does |
| --------------- | ---- |
| `profile list` | List profiles (`*` marks the active one). |
| `profile new <name> [from <other>]` | Create and activate (from the current setup, or a clone). |
| `profile use <name>` | Activate. Restart pi afterwards. |
| `profile save [<name>]` | Save the current setup under `<name>` (create or update) and activate it. No name: update the active profile, e.g. to keep autotune changes. |
| `profile delete <name>` | Delete. |

zero-pi ships no ready-made profiles; you create them. More:
[docs/models-and-profiles.md](./docs/models-and-profiles.md).

## Commands

| Command | Does |
| ------- | ---- |
| `/forge <feature>` | Run the pipeline. `--continue [slug]` resumes. |
| `/zero-models ...` | Show or set models, thinking and profiles. |
| `/zero-doctor` | Preflight checks. |
| `/zero-status` | State of every run in `.sdd/`. |
| `/zero-validate <slug>` | Validate a run's plan artifacts. |
| `/zero-cost [<runId>\|<slug>]` | Token and USD usage of a run's sub-agents. |
| `/zero-checkpoint [<slug>]` | Patch checkpoint before risky build batches. |
| `/zero-rounds [status\|record\|reset]` | Build/veredicto round ledger. |
| `/zero-branch`, `/zero-issue`, `/zero-pr`, `/zero-git-validate` `<slug>` | Git branch, GitHub issue and PR for a run. |
| `/zero-sync`, `/zero-diff`, `/zero-archive` `<slug>` | Merge a run's spec into `.sdd/specs/` and archive it. |
| `/zero-hud`, `/zero-theme` | Footer preset and theme. |
| `/zero-resume` | Write the session handoff note now. |

All flags and arguments: [docs/commands.md](./docs/commands.md).

## Configuration

| Where | What |
| ----- | ---- |
| `~/.pi/zero.json` | Per-phase models, providers, thinking, autotune, profiles. |
| `.sdd/config.json` | Per project: `git`, `tdd.mode` (`strict` or `off`), `rounds.cap`. |
| `ZERO_HUD_PRESET`, `ZERO_HEADER=off`, `ZERO_RESUME=off` | HUD preset, startup banner, resume note. |

Example `.sdd/config.json` to turn TDD off:

```json
{ "tdd": { "mode": "off" } }
```

Full reference: [docs/configuration.md](./docs/configuration.md).

## Common problems

| Problem | Fix |
| ------- | --- |
| `/forge` does nothing useful or phases fail to launch | Run `/zero-doctor`. The usual cause is a missing `pi-subagents`. |
| Model or profile change has no effect | Restart pi: the `zero-*` agents are regenerated when pi loads. |
| `/zero-models build=...` is rejected | The provider/model is unknown or ambiguous in pi's registry. Use `provider/model`. |
| `/zero-archive` or `/zero-branch` says the worktree is dirty | Commit first, or pass `--allow-dirty`. |
| `/zero-pr`, `/zero-issue` fail | Install `gh` and run `gh auth login`. |
| `/zero-pr` refuses to run | The run's latest verdict is not `pasa`. |
| Visuals look stale after an upgrade | `/reload`, or restart pi. |
| Run stopped as "not verified" | The round cap or the second analyze `replan` was hit. Read `.sdd/<slug>/` and re-run `/forge`. |

## More docs

- [docs/forge-pipeline.md](./docs/forge-pipeline.md): gates, verdicts, caps, TDD, how phases launch.
- [docs/models-and-profiles.md](./docs/models-and-profiles.md): defaults, thinking, profiles, autotune.
- [docs/configuration.md](./docs/configuration.md): config files and environment variables.
- [docs/commands.md](./docs/commands.md): every command with its flags.
- [docs/git-pr-issues.md](./docs/git-pr-issues.md): branch, issue, PR, archive, spec deltas.
- [docs/features.md](./docs/features.md): everything else it adds, HUD, activity panel, themes.
- [docs/token-efficiency.md](./docs/token-efficiency.md): cost accounting and token limits.
- [docs/forge-contract.md](./docs/forge-contract.md): `.sdd/<slug>/` contract shared with the Claude Code forge mod.
- [docs/related-projects.md](./docs/related-projects.md): zero or NODD, the `zero` CLI.
- [docs/development.md](./docs/development.md): tests and release checks.
- [CHANGELOG.md](./CHANGELOG.md) and [TOKEN-EFFICIENCY.md](./TOKEN-EFFICIENCY.md) (historical audit).

## License

MIT © Gonzalo Rocca · [github.com/gonzalonicolasr/zero-pi](https://github.com/gonzalonicolasr/zero-pi)
