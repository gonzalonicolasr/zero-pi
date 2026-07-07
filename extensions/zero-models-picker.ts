// zero-pi — the /zero-models interactive picker, pure-state module.
//
// The no-arg path of /zero-models is a single boxed-window TUI. This file holds
// every *decision* of that picker — menu-entry construction, highlighted-index
// movement, screen transitions, and the staged-edit accumulator — as pure,
// dependency-free TypeScript so it is unit-testable with `node --test`. The
// pi-TUI render+input shell lives in `zero-models.ts` and owns no navigation
// logic; it holds one `PickerState`, forwards keystrokes here, and re-renders.
//
// This file has NO `node:fs` and NO pi imports. It takes injected data
// (registry groups, current models/providers, pending suggestions) and returns
// new state. Type-only imports are `import type` so `--experimental-strip-types`
// erases them with no runtime resolution. Mirrors the `autotune.ts` precedent.

import type { Phase, PhaseModels, PhaseProviders, PhaseThinking, ThinkingLevel } from "./zero-models.ts";
import type { AutotuneMode } from "./autotune.ts";
import type { AutotunePending } from "./autotune-extension.ts";

/** The SDD phases, in pipeline order — re-stated locally so the pure module
 *  carries no value import. Must stay in lockstep with `PHASES` in
 *  `zero-models.ts` (the `clarify` gate leads, `analyze` sits after `plan`). */
const PHASES = ["clarify", "explore", "plan", "analyze", "build", "veredicto"] as const;

/** The three autotune modes offered on the autotune screen. */
const AUTOTUNE_MODES = ["auto", "ask", "off"] as const;

/** The six real pi effort levels, in ascending order — re-stated locally so
 *  the pure module carries no value import. Must stay in lockstep with
 *  `THINKING_LEVELS` in `zero-models.ts`. No `max`/`ultracode` aliases. */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

// ---------------------------------------------------------------------------
// Screen model
// ---------------------------------------------------------------------------

/** Which sub-screen the picker is currently showing. */
export type Screen = "main" | "provider" | "model" | "thinking" | "autotune";

/** One selectable row in the current screen. */
export interface MenuEntry {
  /** Stable kind discriminator for the transition functions. */
  kind:
    | "apply-pending" // ★ aplicar sugerencia      (main, conditional)
    | "phase" // explore/plan/build/veredicto (main)
    | "autotune" // autotune → <mode>          (main)
    | "save" // — guardar y salir —        (main)
    | "provider" // a concrete provider id     (provider screen)
    | "custom-provider" // — otro provider (escribir) —
    | "model" // a concrete model id        (model screen)
    | "custom-model" // — otro modelo (escribir) —
    | "thinking-level" // off | minimal | … | xhigh   (thinking screen)
    | "autotune-mode"; // auto | ask | off           (autotune screen)
  /** The text shown for the row (Spanish, voseo). */
  label: string;
  /** Payload: phase name, provider id, model id, or autotune mode. */
  value: string;
}

// ---------------------------------------------------------------------------
// Staged edits (the accumulator)
// ---------------------------------------------------------------------------

/** Edits staged in memory; only written to zero.json on save. */
export interface StagedEdits {
  /** From `readModels` — a mutated copy, never the caller's object. */
  models: PhaseModels;
  /** From `readProviders` — a mutated copy, parallel to {@link models}. */
  providers: PhaseProviders;
  /** From `readThinking` — a mutated copy, parallel to {@link models}. A
   *  partial map: an absent phase means no thinking level configured. */
  thinking: PhaseThinking;
  /** The autotune mode, possibly changed from disk. */
  autotuneMode: AutotuneMode;
  /** Any phase model/provider changed. */
  changed: boolean;
  /** `autotuneMode` differs from disk. */
  autotuneChanged: boolean;
  /** A pending suggestion was applied. */
  pendingApplied: boolean;
}

// ---------------------------------------------------------------------------
// Picker state (the single value the component holds)
// ---------------------------------------------------------------------------

/** The full picker state — one mutable value the component holds for its
 *  lifetime; the transition functions mutate-and-return it. */
export interface PickerState {
  /** The sub-screen currently shown. */
  screen: Screen;
  /** Highlighted row index, always within `[0, entries.length)`. */
  cursor: number;
  /** Menu rows for the current screen — derived, never hand-mutated. */
  entries: MenuEntry[];
  /** Staged, unsaved edits. */
  edits: StagedEdits;
  /** Pending autotune suggestions still un-applied (drives the apply entry). */
  pending: AutotunePending[];
  /** Provider→models registry groups, captured once at open. */
  groups: Map<string, string[]>;
  /** Fallback model list when the registry is empty. */
  fallbackModels: readonly string[];
  /** Drill-down context: the phase being edited (provider/model screens). */
  drillPhase: Phase | null;
  /** Drill-down context: provider chosen so far (model screen). */
  drillProvider: string | null;
  /** Drill-down context: the model chosen, awaiting a thinking level
   *  (thinking screen). Held out of `edits` until a level commits it. */
  drillModel: string | null;
  /** When non-null, the component shows an inline text input for this. */
  textPrompt: { for: "provider" | "model"; label: string } | null;
}

// ---------------------------------------------------------------------------
// Transition results
// ---------------------------------------------------------------------------

/** Discriminated outcome of `enter()`/`back()` — lets the component act. */
export type EnterResult =
  | { type: "state"; state: PickerState } // stay open, re-render
  | { type: "save"; state: PickerState } // close, persist edits
  | { type: "quit" }; // close, write nothing

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/** The escape-row label for typing a custom provider id. */
const CUSTOM_PROVIDER_LABEL = "— otro provider (escribir) —";
/** The escape-row label for typing a custom model id. */
const CUSTOM_MODEL_LABEL = "— otro modelo (escribir) —";
/** The save-and-exit row label. */
const SAVE_LABEL = "— guardar y salir —";

/** Render a phase's current `provider/model` (provider omitted when empty),
 *  with ` · thinking <level>` appended when a level is staged — mirroring
 *  `formatPhases` in `zero-models.ts`. No artifact when no level is set. */
function phaseLabel(
  phase: Phase,
  models: PhaseModels,
  providers: PhaseProviders,
  thinking: PhaseThinking,
): string {
  const provider = providers[phase];
  const model = provider ? `${provider}/${models[phase]}` : models[phase];
  const level = thinking[phase];
  return `${phase}   →   ${model}${level ? ` · thinking ${level}` : ""}`;
}

/** Render the `★ aplicar sugerencia` label from the pending adjustments. */
function applyLabel(pending: readonly AutotunePending[]): string {
  return `★ aplicar sugerencia: ${pending
    .map((p) => `${p.phase} → ${p.to}`)
    .join(", ")}`;
}

/**
 * Build the initial main-screen picker state from disk-read inputs.
 *
 * The `models`/`providers` maps are copied so staged edits never mutate the
 * caller's objects. `edits.autotuneMode` snapshots the disk value; the three
 * change flags start `false`. The result is on `screen: "main"` with `cursor`
 * at `0` and `entries` already built via `rebuildEntries`.
 */
export function createPickerState(input: {
  models: PhaseModels;
  providers: PhaseProviders;
  thinking: PhaseThinking;
  autotuneMode: AutotuneMode;
  pending: AutotunePending[];
  groups: Map<string, string[]>;
  fallbackModels: readonly string[];
}): PickerState {
  const state: PickerState = {
    screen: "main",
    cursor: 0,
    entries: [],
    edits: {
      models: { ...input.models },
      providers: { ...input.providers },
      thinking: { ...input.thinking },
      autotuneMode: input.autotuneMode,
      changed: false,
      autotuneChanged: false,
      pendingApplied: false,
    },
    pending: [...input.pending],
    groups: input.groups,
    fallbackModels: input.fallbackModels,
    drillPhase: null,
    drillProvider: null,
    drillModel: null,
    textPrompt: null,
  };
  return rebuildEntries(state);
}

// ---------------------------------------------------------------------------
// rebuildEntries
// ---------------------------------------------------------------------------

/** Build the rows for the `main` screen. */
function mainEntries(state: PickerState): MenuEntry[] {
  const entries: MenuEntry[] = [];

  // Conditional apply-pending row, prepended when a suggestion is staged.
  if (state.pending.length > 0) {
    entries.push({
      kind: "apply-pending",
      label: applyLabel(state.pending),
      value: "apply",
    });
  }

  // One row per SDD phase, in pipeline order.
  for (const phase of PHASES) {
    entries.push({
      kind: "phase",
      label: phaseLabel(
        phase,
        state.edits.models,
        state.edits.providers,
        state.edits.thinking,
      ),
      value: phase,
    });
  }

  // The autotune row, then the save row.
  entries.push({
    kind: "autotune",
    label: `autotune   →   ${state.edits.autotuneMode}`,
    value: "autotune",
  });
  entries.push({ kind: "save", label: SAVE_LABEL, value: "save" });

  return entries;
}

/** Build the rows for the `provider` screen — sorted provider ids + escape. */
function providerEntries(state: PickerState): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const provider of [...state.groups.keys()].sort()) {
    entries.push({ kind: "provider", label: provider, value: provider });
  }
  entries.push({
    kind: "custom-provider",
    label: CUSTOM_PROVIDER_LABEL,
    value: "",
  });
  return entries;
}

/** Build the rows for the `model` screen — models for the drilled provider
 *  (or `fallbackModels` when the registry is empty) + custom-model escape. */
function modelEntries(state: PickerState): MenuEntry[] {
  const models =
    state.drillProvider !== null
      ? (state.groups.get(state.drillProvider) ?? state.fallbackModels)
      : state.fallbackModels;
  const entries: MenuEntry[] = [];
  for (const model of models) {
    entries.push({ kind: "model", label: model, value: model });
  }
  entries.push({ kind: "custom-model", label: CUSTOM_MODEL_LABEL, value: "" });
  return entries;
}

/** Build the rows for the `thinking` screen — the six real pi effort levels. */
function thinkingEntries(): MenuEntry[] {
  return THINKING_LEVELS.map((level) => ({
    kind: "thinking-level" as const,
    label: level,
    value: level,
  }));
}

/** Build the rows for the `autotune` screen — the three modes. */
function autotuneEntries(): MenuEntry[] {
  return AUTOTUNE_MODES.map((mode) => ({
    kind: "autotune-mode" as const,
    label: mode,
    value: mode,
  }));
}

/**
 * Recompute `state.entries` for the current screen + drill context.
 *
 * Idempotent: calling it twice in a row produces the same rows. After
 * rebuilding, `cursor` is clamped into `[0, entries.length)` so a transition
 * that shrinks the row list never leaves the highlight out of bounds. Mutates
 * and returns the same `PickerState`.
 */
export function rebuildEntries(state: PickerState): PickerState {
  switch (state.screen) {
    case "main":
      state.entries = mainEntries(state);
      break;
    case "provider":
      state.entries = providerEntries(state);
      break;
    case "model":
      state.entries = modelEntries(state);
      break;
    case "thinking":
      state.entries = thinkingEntries();
      break;
    case "autotune":
      state.entries = autotuneEntries();
      break;
  }

  // Clamp the cursor — a shrunk list must never leave it past the last row.
  const n = state.entries.length;
  if (n === 0) {
    state.cursor = 0;
  } else if (state.cursor < 0) {
    state.cursor = 0;
  } else if (state.cursor >= n) {
    state.cursor = n - 1;
  }

  return state;
}

// ---------------------------------------------------------------------------
// navigate
// ---------------------------------------------------------------------------

/**
 * Move the highlighted-row index by `dir` (`-1` up, `+1` down), wrapping
 * cyclically at both ends: Up at index 0 lands on the last row, Down at the
 * last row lands on row 0 (resolves Open Question 1). A single-entry list is
 * a fixed point — any move stays on row 0. An empty list keeps `cursor` at 0.
 *
 * Mutates and returns the same `PickerState`; the filesystem is never touched.
 */
export function navigate(state: PickerState, dir: -1 | 1): PickerState {
  const n = state.entries.length;
  if (n === 0) {
    state.cursor = 0;
  } else {
    state.cursor = (state.cursor + dir + n) % n;
  }
  return state;
}

// ---------------------------------------------------------------------------
// decodeKey — keystroke decoding
// ---------------------------------------------------------------------------

/** The picker's five meaningful keys, as decoded from a raw stdin sequence. */
export type PickerKey = "up" | "down" | "enter" | "esc" | "backspace";

/**
 * Kitty-keyboard-protocol matcher for one functional key: `CSI <code>` +
 * optional `;1` (no modifiers) + optional `:1` (press) / `:2` (repeat) +
 * `<final>`. A `:3` (release) or any real modifier does NOT match — releases
 * must be ignored and modified keys are not picker keys.
 */
function kittyPressOrRepeat(code: string, final: string): RegExp {
  return new RegExp(`^\\x1b\\[${code}(?:;1(?::[12])?)?${final}$`);
}

const KITTY_UP = kittyPressOrRepeat("1", "A");
const KITTY_DOWN = kittyPressOrRepeat("1", "B");
const KITTY_ENTER = kittyPressOrRepeat("13", "u");
const KITTY_ESC = kittyPressOrRepeat("27", "u");
const KITTY_BACKSPACE = kittyPressOrRepeat("127", "u");

/**
 * Decode one raw stdin sequence into a picker key, or `null` when it is not
 * one (printable characters, releases, modified keys, unknown sequences).
 *
 * pi-tui negotiates kitty keyboard protocol flags 7 with the terminal, and a
 * granting terminal (Ghostty, kitty, …) then encodes arrows as
 * `CSI 1;1:1 A/B` and Esc as `CSI 27 u` — never the legacy `\x1b[A` / bare
 * `\x1b` forms. A non-granting terminal keeps the legacy (or SS3
 * application-cursor-mode) forms. Both worlds are accepted here; kitty
 * repeats (`:2`) navigate too so holding an arrow scrolls the list.
 */
export function decodeKey(data: string): PickerKey | null {
  if (data === "\x1b[A" || data === "\x1bOA" || KITTY_UP.test(data)) return "up";
  if (data === "\x1b[B" || data === "\x1bOB" || KITTY_DOWN.test(data)) return "down";
  if (data === "\r" || data === "\n" || data === "\r\n" || KITTY_ENTER.test(data)) return "enter";
  if (data === "\x1b" || KITTY_ESC.test(data)) return "esc";
  if (data === "\x7f" || data === "\x08" || KITTY_BACKSPACE.test(data)) return "backspace";
  return null;
}

// ---------------------------------------------------------------------------
// enter / back — Enter/Esc dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch Enter on the highlighted entry. Returns an {@link EnterResult}:
 *
 * - `phase` → drills into provider selection (`screen: "provider"`), or
 *   straight to `model` with `fallbackModels` when the registry is empty.
 * - `provider` → records `drillProvider`, drills into model selection.
 * - `custom-provider` / `custom-model` → opens `textPrompt`, stays on screen.
 * - `model` → commits the model/provider into `edits` for `drillPhase`,
 *   marks `edits.changed`, returns to `main`.
 * - `autotune` → drills into the autotune-mode screen.
 * - `autotune-mode` → records the mode, marks `autotuneChanged` when it
 *   differs from the staged value, returns to `main`.
 * - `apply-pending` → applies every pending `to` into `edits.models`,
 *   marks `changed` + `pendingApplied`, clears `state.pending`.
 * - `save` → `{ type: "save" }`.
 *
 * Every staying-open path rebuilds `entries`. Filesystem is never touched.
 */
export function enter(state: PickerState): EnterResult {
  const entry = state.entries[state.cursor];
  if (!entry) return { type: "state", state };

  switch (entry.kind) {
    case "phase": {
      state.drillPhase = entry.value as Phase;
      state.drillProvider = null;
      // Skip the provider screen entirely when the registry is empty —
      // jump straight to model selection over `fallbackModels`.
      state.screen = state.groups.size === 0 ? "model" : "provider";
      state.cursor = 0;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "provider": {
      state.drillProvider = entry.value;
      state.screen = "model";
      state.cursor = 0;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "custom-provider": {
      state.textPrompt = { for: "provider", label: entry.label };
      return { type: "state", state: rebuildEntries(state) };
    }

    case "custom-model": {
      state.textPrompt = { for: "model", label: entry.label };
      return { type: "state", state: rebuildEntries(state) };
    }

    case "model": {
      // Selecting a model no longer commits — it stages the model in
      // `drillModel` and advances to the thinking screen, so model + provider
      // + thinking are written together (atomically) only when a level is
      // chosen. An Esc before that leaves `edits` untouched.
      state.drillModel = entry.value;
      state.screen = "thinking";
      state.cursor = 0;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "thinking-level": {
      // The single commit point: write model + provider + thinking together
      // for the drilled phase, then clear all drill context and return to main.
      const level = entry.value as ThinkingLevel;
      if (state.drillPhase !== null && state.drillModel !== null) {
        const phase = state.drillPhase;
        state.edits.models[phase] = state.drillModel;
        // `drillProvider` is the provider picked/typed on the provider screen,
        // or `null` when the empty-registry skip jumped straight to the model
        // screen — in which case there is no provider, so `""`.
        state.edits.providers[phase] = state.drillProvider ?? "";
        state.edits.thinking[phase] = level;
        state.edits.changed = true;
      }
      state.screen = "main";
      state.drillPhase = null;
      state.drillProvider = null;
      state.drillModel = null;
      state.cursor = 0;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "autotune": {
      state.screen = "autotune";
      state.cursor = 0;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "autotune-mode": {
      const mode = entry.value as AutotuneMode;
      if (mode !== state.edits.autotuneMode) {
        state.edits.autotuneMode = mode;
        state.edits.autotuneChanged = true;
      }
      state.screen = "main";
      state.cursor = 0;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "apply-pending": {
      for (const adj of state.pending) {
        state.edits.models[adj.phase] = adj.to;
      }
      state.edits.changed = true;
      state.edits.pendingApplied = true;
      state.pending = [];
      return { type: "state", state: rebuildEntries(state) };
    }

    case "save":
      return { type: "save", state };
  }
}

/**
 * Dispatch Esc. From a drill screen (`provider`/`model`/`autotune`) it
 * returns to `main` with the drill context cleared and **no** edit
 * committed. From `main` it returns `{ type: "quit" }` so the handler
 * closes the picker without writing `zero.json`.
 */
export function back(state: PickerState): EnterResult {
  if (state.screen === "main") {
    return { type: "quit" };
  }
  state.screen = "main";
  state.drillPhase = null;
  state.drillProvider = null;
  // Clearing `drillModel` here is what makes the model+provider+thinking write
  // atomic: Esc from the thinking screen drops the staged model so no partial
  // edit is ever committed.
  state.drillModel = null;
  state.textPrompt = null;
  state.cursor = 0;
  return { type: "state", state: rebuildEntries(state) };
}

// ---------------------------------------------------------------------------
// submitText — commit a typed custom value
// ---------------------------------------------------------------------------

/**
 * Commit a typed custom value from the inline text input opened by a
 * `custom-provider` / `custom-model` escape row.
 *
 * - `textPrompt.for === "provider"` → records the trimmed `typed` string as
 *   `drillProvider` and advances to the `model` screen so a model can be
 *   picked under the just-typed provider.
 * - `textPrompt.for === "model"` → commits the trimmed `typed` string as the
 *   drilled phase's model into `edits.models`, records the provider
 *   (`drillProvider ?? ""`, matching the model-commit semantics of `enter`)
 *   into `edits.providers`, sets `edits.changed`, and returns to `main`.
 * - empty / whitespace `typed` → a no-op: nothing is committed, the screen is
 *   left unchanged, only `textPrompt` is cleared so the list shows again.
 *
 * `textPrompt` is cleared on every path and `rebuildEntries` is always called.
 * Mutates and returns the same `PickerState`; the filesystem is never touched.
 */
export function submitText(state: PickerState, typed: string): PickerState {
  const prompt = state.textPrompt;
  const value = typed.trim();

  // Empty / whitespace input, or no prompt open: a no-op. Drop the prompt and
  // re-show the current list screen unchanged — no edit is committed.
  if (prompt === null || value === "") {
    state.textPrompt = null;
    return rebuildEntries(state);
  }

  if (prompt.for === "provider") {
    state.drillProvider = value;
    state.screen = "model";
    state.cursor = 0;
  } else {
    // prompt.for === "model": stage the typed model in `drillModel` and advance
    // to the thinking screen — the commit happens atomically when a level is
    // chosen, never here. Mirrors the `model`-row `enter` path.
    state.drillModel = value;
    state.screen = "thinking";
    state.cursor = 0;
  }

  state.textPrompt = null;
  return rebuildEntries(state);
}
