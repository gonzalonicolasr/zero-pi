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
import { isValidProfileName, type Profile } from "./zero-models-profiles.ts";

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
export type Screen =
  | "main"
  | "provider"
  | "model"
  | "thinking"
  | "autotune"
  | "phases" // las seis fases del perfil abierto
  | "profile-actions"; // qué hacer con un perfil elegido

/** One selectable row in the current screen. */
export interface MenuEntry {
  /** Stable kind discriminator for the transition functions. */
  kind:
    | "apply-pending" // ★ aplicar sugerencia      (main, conditional)
    | "phase" // explore/plan/build/veredicto (main)
    | "autotune" // autotune → <mode>          (main)
    | "profile" // un perfil concreto          (main)
    | "new-profile" // — nuevo perfil —         (main)
    | "edit-loose" // configurar sin perfiles   (main, sólo sin ninguno)
    | "profile-edit" // editar modelos          (profile-actions)
    | "profile-use" // activar                  (profile-actions)
    | "profile-active-noop" // ya está activo   (profile-actions)
    | "profile-duplicate" // duplicar           (profile-actions)
    | "profile-delete" // borrar                (profile-actions)
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
  /** Perfiles guardados, copia staged de `profiles` en zero.json. */
  profiles: Record<string, Profile>;
  /** Nombre del perfil activo staged, o `null` si no hay ninguno. */
  activeProfile: string | null;
  /** El perfil que los mapas de arriba están editando ahora mismo. `null`
   *  significa "la config viva" — que es el perfil activo cuando hay uno.
   *  Distinto de `activeProfile`: podés editar un perfil sin activarlo. */
  editingProfile: string | null;
  /** Se creó, borró, duplicó o activó un perfil. */
  profilesChanged: boolean;
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
  /** Drill-down context: el perfil elegido en la lista (profile-actions). */
  drillProfile: string | null;
  /** ¿Se editó alguna fase desde que se cargaron estos mapas? Decide si volcar
   *  al perfil destino. `edits.changed` no sirve: es pegajoso para todo el
   *  picker, así que después de editar un perfil quedaría en `true` y abrir un
   *  tercero volcaría encima de él lo que no se tocó. */
  dirtySinceLoad: boolean;
  /** When non-null, the component shows an inline text input for this. */
  textPrompt: {
    for: "provider" | "model" | "new-profile" | "duplicate-profile";
    label: string;
  } | null;
  /** Aviso de una línea bajo el título (nombre inválido, perfil repetido…).
   *  Se limpia solo en la próxima transición. */
  notice: string | null;
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
/** The new-profile escape-row label. */
const NEW_PROFILE_LABEL = "— nuevo perfil —";
/** La fila para editar la config suelta cuando no hay ningún perfil. */
const LOOSE_LABEL = "— configurar modelos sin perfil —";

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
  /** Perfiles leídos de zero.json. Opcional: sin perfiles el picker se
   *  comporta exactamente como antes de que existieran. */
  profiles?: Record<string, Profile>;
  /** Perfil activo leído de zero.json, si hay. */
  activeProfile?: string | null;
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
      profiles: cloneProfiles(input.profiles ?? {}),
      activeProfile: input.activeProfile ?? null,
      // Se arranca editando la config viva, que es el perfil activo cuando
      // hay uno: así abrir el picker y tocar una fase edita ese perfil.
      editingProfile: null,
      profilesChanged: false,
    },
    pending: [...input.pending],
    groups: input.groups,
    fallbackModels: input.fallbackModels,
    drillPhase: null,
    drillProvider: null,
    drillModel: null,
    drillProfile: null,
    dirtySinceLoad: false,
    textPrompt: null,
    notice: null,
  };
  return rebuildEntries(state);
}

/** Copia profunda del mapa de perfiles — los edits staged nunca deben mutar
 *  los objetos que leyó el llamador. */
function cloneProfiles(profiles: Record<string, Profile>): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  for (const [name, profile] of Object.entries(profiles)) {
    out[name] = {
      models: { ...profile.models },
      providers: { ...profile.providers },
      thinking: { ...profile.thinking },
    };
  }
  return out;
}

/** Snapshot de los mapas por fase que se están editando, como perfil. */
function snapshotEdits(edits: StagedEdits): Profile {
  return {
    models: { ...edits.models },
    providers: { ...edits.providers },
    thinking: { ...edits.thinking },
  };
}

/**
 * Volcar los mapas en edición al perfil al que pertenecen.
 *
 * El destino es el perfil que se está editando, o el activo cuando se está
 * editando la config viva. Sin ninguno de los dos no hay dónde volcar y los
 * mapas quedan como la config plana, igual que antes de los perfiles.
 *
 * Sólo vuelca si el usuario efectivamente editó una fase desde que estos mapas
 * se cargaron. Sin ese guard, con los mapas planos desviados del perfil activo
 * — que es exactamente lo que deja autotune — el solo hecho de abrir otro
 * perfil pisaría el activo con el desvío, sin que nadie lo haya pedido.
 */
function flushEdits(state: PickerState): void {
  if (!state.dirtySinceLoad) return;
  const target = state.edits.editingProfile ?? state.edits.activeProfile;
  if (target === null) return;
  state.edits.profiles[target] = snapshotEdits(state.edits);
  state.dirtySinceLoad = false;
}

/** Cargar un perfil en los mapas en edición, volcando antes el anterior para
 *  no perder lo tocado. */
function loadProfileIntoEdits(state: PickerState, name: string): void {
  const profile = state.edits.profiles[name];
  if (profile === undefined) return;
  flushEdits(state);
  state.edits.models = { ...profile.models } as PhaseModels;
  state.edits.providers = { ...profile.providers } as PhaseProviders;
  state.edits.thinking = { ...profile.thinking };
  state.edits.editingProfile = name;
  state.dirtySinceLoad = false;
}

/**
 * El título del recuadro para el estado actual.
 *
 * Deja siempre claro qué se está tocando: la config viva, un perfil concreto,
 * o la lista de perfiles. El componente lo usa en vez de un título fijo.
 */
export function pickerTitle(state: PickerState): string {
  if (state.screen === "main") return "zero · perfiles de modelos SDD";
  if (state.screen === "profile-actions") {
    return `zero · perfil «${state.drillProfile ?? ""}»`;
  }
  // Pantallas de edición: siempre decir de quién son las fases que se tocan.
  const editing = state.edits.editingProfile;
  if (editing === null) return "zero · modelos sin perfil";
  const suffix = editing === state.edits.activeProfile ? " · activo" : " · no activo";
  return `zero · perfil «${editing}»${suffix}`;
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

  // Un perfil por fila: es lo que /forge va a usar, así que es lo primero que
  // hay que ver. Las fases se editan entrando a un perfil, no acá: sin perfil
  // activo `models` es un cuarto estado invisible que compite con ellos.
  for (const name of Object.keys(state.edits.profiles).sort()) {
    entries.push({
      kind: "profile",
      label: profileRowLabel(state, name),
      value: name,
    });
  }

  entries.push({ kind: "new-profile", label: NEW_PROFILE_LABEL, value: "" });

  // La config suelta sólo se ofrece mientras no haya ningún perfil — es el
  // estado de quien todavía no migró, y la fila desaparece al crear el primero.
  if (Object.keys(state.edits.profiles).length === 0) {
    entries.push({
      kind: "edit-loose",
      label: LOOSE_LABEL,
      value: "loose",
    });
  }

  entries.push({
    kind: "autotune",
    label: `autotune   →   ${state.edits.autotuneMode}`,
    value: "autotune",
  });
  entries.push({ kind: "save", label: SAVE_LABEL, value: "save" });

  return entries;
}

/** La fila de un perfil en el menú: nombre, estado y un resumen de modelos. */
function profileRowLabel(state: PickerState, name: string): string {
  const active = name === state.edits.activeProfile;
  const mark = active ? "●" : "○";
  const profile = state.edits.profiles[name];
  const summary = profileSummary(profile);
  const state_ = active ? "activo" : "";
  const bits = [state_, summary].filter((s) => s !== "").join(" · ");
  return `${mark} ${name}${bits ? `   (${bits})` : ""}`;
}

/** Resumen corto de un perfil: los providers distintos que usa. */
function profileSummary(profile: Profile): string {
  const providers = new Set<string>();
  for (const phase of PHASES) {
    const p = profile.providers[phase];
    if (p) providers.add(p);
  }
  if (providers.size === 0) return "";
  return [...providers].sort().join(", ");
}

/** Filas de la pantalla `profile-actions` — qué hacer con el perfil elegido. */
function profileActionEntries(state: PickerState): MenuEntry[] {
  const name = state.drillProfile ?? "";
  const isActive = name === state.edits.activeProfile;
  const entries: MenuEntry[] = [];
  // Activar primero: es la acción más frecuente y la que decide qué corre
  // /forge. En el que ya está activo no se ofrece, se dice que lo está.
  if (isActive) {
    entries.push({
      kind: "profile-active-noop",
      label: "● ya es el perfil activo",
      value: name,
    });
  } else {
    entries.push({
      kind: "profile-use",
      label: "activar — /forge va a usar este",
      value: name,
    });
  }
  entries.push({ kind: "profile-edit", label: "editar modelos por fase…", value: name });
  entries.push({
    kind: "profile-duplicate",
    label: "duplicar en un perfil nuevo…",
    value: name,
  });
  entries.push({
    kind: "profile-delete",
    label: isActive ? "borrar (queda sin perfil activo)" : "borrar",
    value: name,
  });
  return entries;
}

/** Filas de la pantalla `phases` — las seis fases del perfil abierto. */
function phaseEntries(state: PickerState): MenuEntry[] {
  return PHASES.map((phase) => ({
    kind: "phase" as const,
    label: phaseLabel(
      phase,
      state.edits.models,
      state.edits.providers,
      state.edits.thinking,
    ),
    value: phase,
  }));
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
    case "phases":
      state.entries = phaseEntries(state);
      break;
    case "profile-actions":
      state.entries = profileActionEntries(state);
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

  // Cualquier tecla que avanza limpia el aviso de la transición anterior.
  state.notice = null;

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
        state.dirtySinceLoad = true;
      }
      state.screen = "phases";
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
      state.dirtySinceLoad = true;
      state.pending = [];
      return { type: "state", state: rebuildEntries(state) };
    }

    case "profile": {
      state.drillProfile = entry.value;
      state.screen = "profile-actions";
      state.cursor = 0;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "profile-active-noop":
      // Fila informativa: no hay nada que activar.
      return { type: "state", state };

    case "edit-loose": {
      // La config suelta, para quien todavía no tiene ningún perfil.
      state.edits.editingProfile = null;
      state.screen = "phases";
      state.cursor = 0;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "new-profile": {
      state.textPrompt = { for: "new-profile", label: "nombre del perfil nuevo:" };
      return { type: "state", state: rebuildEntries(state) };
    }

    case "profile-edit": {
      // Cargar ese perfil en los mapas en edición y mostrar sus seis fases.
      // No lo activa: se puede editar uno inactivo.
      loadProfileIntoEdits(state, entry.value);
      state.screen = "phases";
      state.cursor = 0;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "profile-use": {
      // Activar = ese perfil pasa a ser la config viva. Se vuelca lo editado
      // antes de mover el puntero, para no perder cambios sin guardar.
      loadProfileIntoEdits(state, entry.value);
      state.edits.activeProfile = entry.value;
      state.edits.profilesChanged = true;
      state.edits.changed = true;
      state.screen = "main";
      state.drillProfile = null;
      state.cursor = 0;
      state.notice = `perfil «${entry.value}» activo — guardá y reiniciá pi para que /forge lo tome`;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "profile-duplicate": {
      state.textPrompt = {
        for: "duplicate-profile",
        label: `nombre del duplicado de «${entry.value}»:`,
      };
      return { type: "state", state: rebuildEntries(state) };
    }

    case "profile-delete": {
      const name = entry.value;
      delete state.edits.profiles[name];
      state.edits.profilesChanged = true;
      // Borrar no cambia los modelos en uso: sólo deja de haber perfil al que
      // volcar los cambios.
      if (state.edits.activeProfile === name) state.edits.activeProfile = null;
      if (state.edits.editingProfile === name) state.edits.editingProfile = null;
      state.screen = "main";
      state.drillProfile = null;
      state.cursor = 0;
      state.notice = `perfil «${name}» borrado`;
      return { type: "state", state: rebuildEntries(state) };
    }

    case "save":
      // Volcar lo editado a su perfil antes de cerrar, si no lo tocado en la
      // pantalla de fases no llegaría al perfil.
      flushEdits(state);
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
  state.notice = null;

  if (state.screen === "main") {
    return { type: "quit" };
  }
  // Esc desde una fase vuelve a la lista de fases del perfil, no al menú.
  if (
    state.screen === "provider" ||
    state.screen === "model" ||
    state.screen === "thinking"
  ) {
    state.screen = "phases";
    state.drillPhase = null;
    state.drillProvider = null;
    state.drillModel = null;
    state.textPrompt = null;
    state.cursor = 0;
    return { type: "state", state: rebuildEntries(state) };
  }
  // Salir de las fases vuelca lo editado a su perfil antes de volver.
  if (state.screen === "phases") {
    flushEdits(state);
  }
  state.screen = "main";
  state.drillPhase = null;
  state.drillProvider = null;
  state.drillProfile = null;
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
  state.notice = null;

  // Empty / whitespace input, or no prompt open: a no-op. Drop the prompt and
  // re-show the current list screen unchanged — no edit is committed.
  if (prompt === null || value === "") {
    state.textPrompt = null;
    return rebuildEntries(state);
  }

  if (prompt.for === "new-profile" || prompt.for === "duplicate-profile") {
    const name = value.toLowerCase();
    state.textPrompt = null;

    // Un nombre inválido o repetido avisa y no crea nada — pisar un perfil
    // por tipear su nombre sería destructivo y silencioso.
    if (!isValidProfileName(name)) {
      state.notice = `nombre inválido: «${value}» (minúsculas, números, - y _)`;
      return rebuildEntries(state);
    }
    if (name in state.edits.profiles) {
      state.notice = `ya existe un perfil «${name}»`;
      return rebuildEntries(state);
    }

    // El duplicado clona el perfil elegido; el nuevo parte de lo que se esté
    // editando, que es lo que el usuario tiene a la vista.
    const source =
      prompt.for === "duplicate-profile" && state.drillProfile !== null
        ? state.edits.profiles[state.drillProfile]
        : snapshotEdits(state.edits);
    state.edits.profiles[name] = {
      models: { ...source.models },
      providers: { ...source.providers },
      thinking: { ...source.thinking },
    };
    state.edits.profilesChanged = true;

    if (prompt.for === "new-profile") {
      // Crear entra a editarlo: es lo que se viene a hacer después de nombrarlo.
      loadProfileIntoEdits(state, name);
      // El primer perfil se activa solo. Si no, quedaría guardado pero /forge
      // seguiría corriendo la config suelta — un perfil que no hace nada.
      if (state.edits.activeProfile === null) {
        state.edits.activeProfile = name;
        state.edits.editingProfile = null;
        state.notice = `perfil «${name}» creado y activo — elegí los modelos`;
      } else {
        state.notice = `perfil «${name}» creado — elegí los modelos (activar es aparte)`;
      }
      state.screen = "phases";
      state.cursor = 0;
    } else {
      state.screen = "main";
      state.drillProfile = null;
      state.cursor = 0;
      state.notice = `perfil «${name}» duplicado`;
    }
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
