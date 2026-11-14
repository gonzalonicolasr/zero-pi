# Models, thinking and profiles

Each of the six SDD phases (`clarify`, `explore`, `plan`, `analyze`, `build`,
`veredicto`) runs on its own model, provider and thinking level. `/zero-models`
sets them; profiles save whole setups under a name.

## Set a model directly

```
/zero-models                                        # open the picker
/zero-models build=anthropic/claude-sonnet-4-6      # model (provider optional)
/zero-models build=anthropic/claude-sonnet-4-6 thinking=high
/zero-models build=anthropic/claude-sonnet-4-6 high # trailing shorthand
/zero-models autotune=ask                           # auto | ask | off
```

Thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`. Direct
assignments are validated against pi's model registry when available and fail
fast when the provider/model is unknown or ambiguous.

Defaults when `~/.pi/zero.json` has no entry (`extensions/zero-models.ts`):

| Phase | Model | Thinking |
| ----- | ----- | -------- |
| clarify | `claude-haiku-4-5` | medium |
| explore | `claude-haiku-4-5` | high |
| plan | `claude-opus-4-8` | high |
| analyze | `claude-opus-4-8` | high |
| build | `claude-sonnet-4-6` | high |
| veredicto | `claude-opus-4-8` | xhigh |

An explicit entry always wins; a phase with no entry (or an invalid level)
falls back to the package default, so no phase inherits your session-wide
`defaultThinkingLevel`.

## Profiles

A profile is a named bundle of the three per-phase maps (`models`,
`providers`, `thinking`). Profiles live in `~/.pi/zero.json` under `profiles`,
and `activeProfile` points at the one in use. zero-pi ships no built-in
profiles: you create them.

From the TUI — run `/zero-models` with no arguments. The main screen **is** the
profile list: one row per profile (`●` marks the active one), plus
`— nuevo perfil —`. Opening a profile offers **activate**, **edit models per
phase**, **duplicate** and **delete**; editing drops you on the familiar
six-phase screen. Phases are no longer on the main screen — they belong to a
profile, and `/forge` runs whichever profile is active.

Editing a profile does **not** activate it, and nothing is written until
`— guardar y salir —`. The first profile you create is activated automatically;
otherwise it would sit there saved while `/forge` kept running the loose
config. Until a profile exists, `— configurar modelos sin perfil —` still edits
the bare `models`/`providers`/`thinking` keys the way it always did.

Or from the command line:

```
/zero-models profile new barato            # snapshot the current setup, activate it
/zero-models profile new qa from barato    # clone another profile instead
/zero-models build=anthropic/claude-sonnet-4-6   # edits land in the active profile
/zero-models profile use premium           # switch
/zero-models profile list                  # `*` marks the active one
/zero-models profile save                  # fold autotune drift back into the active profile
/zero-models profile delete qa
```

Activating a profile copies its maps onto the flat `models`/`providers`/
`thinking` keys, which is what the generated `zero-<phase>.md` agents and
autotune read — so nothing else in the package needs to know profiles exist.
Because those agent files are regenerated when pi loads, **restart pi after
switching profiles**.

Autotune writes the flat keys directly. When that drifts from the active
profile, the profile shows as `premium*`; `/zero-models profile save` (no name)
folds the drift back into it.

## Autotune

Autotune proposes model step-ups for build/plan from sufficiently sampled,
valid outcome records (`~/.pi/zero-runs.jsonl`); it does not automatically
downgrade models to save tokens. Mode: `/zero-models autotune=auto|ask|off`.

Optional budget in `~/.pi/zero.json`:

```json
{ "autotuneBudget": { "maxPhaseCostUsd": 4, "minSamples": 3 } }
```

When `maxPhaseCostUsd` is set, autotune will not step a blamed phase up to a
more expensive tier if that phase/model is already at or above the average USD
ceiling with enough cost samples (`minSamples`, default 3).
