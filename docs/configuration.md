# Configuration

## Files

| File | Scope | What it holds |
| ---- | ----- | ------------- |
| `~/.pi/zero.json` | user | Per-phase `models`, `providers`, `thinking`, `autotune` mode, `autotuneBudget`, `profiles`, `activeProfile`. |
| `~/.pi/zero-runs.jsonl` | user | Run-metrics log that autotune reads. |
| `.sdd/config.json` | project | Git and TDD settings (below). |
| `.sdd/<slug>/` | project | One run's artifacts. |

## `~/.pi/zero.json`

It stores three parallel per-phase maps plus the autotune mode. The
configurable phases are `clarify`, `explore`, `plan`, `analyze`, `build`, and
`veredicto`; a pre-gates file that lists only the original four stays valid and
the missing `clarify`/`analyze` fall back to defaults (cheap/fast clarify,
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

You rarely edit it by hand: use `/zero-models`. Defaults, thinking levels,
profiles and autotune are in [models-and-profiles.md](./models-and-profiles.md).

## `.sdd/config.json`

Per-project settings. Every key is optional; these are the defaults:

```json
{
  "git": { "branchPrefix": "sdd/", "numbering": false, "autoCommit": false, "commitStyle": "conventional", "baseBranch": "main" },
  "tdd": { "mode": "strict", "testCommand": "" },
  "rounds": { "cap": 3 }
}
```

- `git.*` — used by `/zero-branch` (see [git-pr-issues.md](./git-pr-issues.md)).
  `commitStyle` accepts `conventional` (default) or `plain`.
- `tdd.mode` defaults to `"strict"` (the build phase runs test-first; veredicto
  audits the TDD evidence) and accepts `"off"` to disable the discipline.
- `tdd.testCommand` overrides the auto-detected test runner the TDD cycle
  invokes; leave it empty to let the build/veredicto phases detect it from the
  project.
- `rounds.cap` is the build/veredicto iteration cap (default 3).

## Environment variables

| Variable | Effect |
| -------- | ------ |
| `ZERO_HUD_PRESET` | Startup preset of the footer HUD: `compact` (default), `minimal`, `full`, `ascii`, `off`. |
| `ZERO_HEADER=off` | Disable the startup banner. |
| `ZERO_RESUME=off` | Disable the conversation-resume note (`.pi/zero-resume.md`). `0` also works. |

## After changing things

- After an install or upgrade, or after switching profiles, **restart pi**: the
  `zero-*` phase agents are regenerated when pi loads.
- After `pi install npm:@gonrocca/zero-pi@<version>`, `/reload` refreshes the
  visual extensions; if a visual patch was already loaded in the current
  process, restarting pi is the safest way to reinitialize all of them.
