# Features and visual chrome

Everything zero-pi adds besides the `/forge` pipeline itself.

## Feature catalog

| Feature | What it does |
| ------- | ------------ |
| **Strict TDD** | The build phase drives RED → GREEN → TRIANGULATE → REFACTOR with a TDD Cycle Evidence table; veredicto audits it. On by default, runtime-gated on a test runner; `tdd.mode: "off"` disables it. |
| **`/zero-models`** | Pick the model + provider + thinking level for each of the six SDD phases — a boxed-window picker, or set one directly. Direct assignments are validated against pi's model registry when available. |
| **Model profiles** | Save whole per-phase setups as named profiles and switch between them — from the picker's `perfiles` row (create, edit, activate, duplicate, delete) or via `/zero-models profile …`. Editing a profile does not activate it. |
| **Phase tool gating** | Generated `zero-*` sub-agents get phase-specific tool allowlists: explore/veredicto are read-only, clarify/analyze/plan write only `.sdd` artifacts, build edits code. |
| **Dependency-aware tasks** | `tasks.md` is validated as a task graph with mandatory `depends:` edges, topological ordering, and review workload totals. |
| **Autotune** | Proposes model step-ups for build/plan from sufficiently sampled, valid outcome records; it does not automatically downgrade models to save tokens. Optional `autotuneBudget.maxPhaseCostUsd` suppresses costly step-ups when cost samples are available. |
| **`/zero-doctor`** | Preflight diagnostics for zero-pi: package install, Node version, pi-subagents, generated phase agents, model config, `.sdd/config`, run history, git, and `gh` auth. |
| **`/zero-cost`** | Reports registered child usage from project/execution identity and attached async receipts; explicit UUID selects one run, legacy/missing data stays unattributed/partial. Not a parent/whole-Forge meter. |
| **`/zero-checkpoint`** | Writes patch-based worktree checkpoints under `.sdd/<slug>/checkpoints/` before risky build batches. |
| **`/zero-rounds`** | Durable build/veredicto round ledger in `.sdd/<slug>/rounds.json` — a resumed run recovers the rounds it already spent instead of restarting the iteration cap. |
| **`/zero-sync` / `/zero-archive`** | Folds each run's spec delta into a canonical, project-wide spec store and archives approved runs. |
| **Git / PR / Issues** | `/zero-branch`, `/zero-git-validate`, `/zero-pr`, and `/zero-issue` keep branches and GitHub links audit-ready. See [git-pr-issues.md](./git-pr-issues.md). |
| **Run memory** | Every run recalls and saves traces to Cortex, so runs learn from each other. |
| **Provider guard** | Warns when the `anthropic` provider runs on a metered API key instead of your subscription. |
| **Startup banner** | The sunset ANSI-Shadow `ZERO` wordmark, drawn once at pi startup — `ZERO_HEADER=off` to disable. |
| **ZERO HUD** | OMP-inspired segmented footer for SDD work: phase, model, tokens, cache, cost, diff, context %, and branch. Switch presets with `/zero-hud compact\|minimal\|full\|ascii\|off` or `ZERO_HUD_PRESET`. |
| **Pretty input box** | OMP-style prompt chrome with rounded corners, side borders, ZERO chips, and compact keyboard hints. |
| **Pretty code fences** | Markdown code blocks render as bordered panels with language badges instead of raw ```` ```txt ```` / ```` ```json ```` fence lines. |
| **Live activity panel** | Shows `/forge` phase progress and recent tool cards above the prompt while work is running. |
| **Working-phrase ticker** | Swaps pi's static `Working...` / `Procesando...` for a large pool of context-aware Spanish/ZERO/SDD phrases + spinner. |
| **Conversation resume** | Writes `.pi/zero-resume.md` on exit — the restore command + a conversation tail. `/zero-resume` writes it now. |
| **Windows tree-kill** | Aborting a turn kills the whole process tree — no orphaned `claude`. |
| **SDD routing skill** | Natural-language requests that say "hacelo con sdd" route into `/forge` without remembering the slash command. |
| **Themes** | See [Themes](#themes). |

## Visual chrome: HUD, activity panel, prompt box

zero-pi ships several visual extensions. They are related, but each one owns a
different part of pi's TUI:

| Surface | File | Where it appears | Purpose |
| ------- | ---- | ---------------- | ------- |
| **ZERO HUD** | `extensions/zero-hud.ts` | Footer/status line at the bottom | Persistent model/tokens/cost/diff/context/branch telemetry. |
| **Activity panel** | `extensions/zero-activity-panel.ts` | Widget above the prompt while work is running | Live `/forge` phase progress plus recent tool cards. |
| **Tool cards** | `extensions/zero-pretty-tool-cards.ts` | Each tool execution/result in chat | ZERO-styled bordered cards with status glyphs, title metadata, and padded content. |
| **Prompt box** | `extensions/zero-pretty-input-box.ts` | The input/editor box | OMP-like rounded box with ZERO chips and key hints. |
| **Code fences** | `extensions/zero-pretty-code-fences.ts` | Markdown code blocks in chat | Bordered panels with language badges instead of raw fence lines. |
| **Working phrases** | `extensions/working-phrases.ts` | Tiny loading row (`Procesando… (esc)`) | Rotating ZERO/SDD/Star Wars/DBZ phrases and themed spinner. |

### ZERO HUD presets

The HUD is the **bottom footer**. It is not the activity panel. Control it with:

```txt
/zero-hud preview
/zero-hud compact
/zero-hud minimal
/zero-hud full
/zero-hud ascii
/zero-hud off
/zero-hud on
```

Example compact HUD:

```txt
ZERO ▸ gpt-5.5 ▸ tok ↑1.1M ↓42K ▸ cost $16.22 ▸ diff +0/-0 ▸ ctx 11%
```

Startup preset can be set with:

```bash
ZERO_HUD_PRESET=full pi
```

Supported presets: `compact` (default), `minimal`, `full`, `ascii`, `off`.

### Activity panel vs HUD

During `/forge`, the activity panel appears **above the prompt** and summarizes
the live run:

```txt
╭─ ZERO activity ───────────────────────────────────────────────────────╮
│ SDD   ✓ clarify › ✓ explore › ⠋ plan › · analyze › · build › · veredicto
│ Tools ⠋ subagent · ✓ read zero-hud.ts · ✓ bash npm test
╰────────────────────────────────────────────────────────────────────────╯
```

The activity panel is transient: it clears after the agent finishes. The HUD
stays in the footer across normal work.

### Applying visual changes after install

After `pi install npm:@gonrocca/zero-pi@<version>`, reload the active session:

```txt
/reload
```

If a visual monkeypatch was already loaded in the current process, restarting
pi is the safest way to force all visual extensions to reinitialize.

## Themes

Activate a theme with pi's `/theme <name>`, or with `/zero-theme <alias>`.

| Theme | `/zero-theme` alias | Look |
| ----- | ------------------- | ---- |
| `zero-sdd` | `sdd` | Dark, high-contrast, tuned for SDD work. |
| `zero-sunset` | `sunset` | Warm sunset variant — gold/coral/magenta accents over warm-dark panels, with one cool tone kept for syntax legibility. |
| `zero-omp-neon` | `neon` (also `omp`) | High-contrast OMP-inspired neon: cyan links/paths, gold titles, mint code/success, violet borders, navy tool cards. |
| `zero-sith` | `sith` | Extra variant. |
| `zero-saiyan` | `saiyan` | Extra variant. |
| `zero-matrix` | `matrix` | Extra variant. |
| `zero-cyberpunk` | `cyberpunk` | Extra variant. |
