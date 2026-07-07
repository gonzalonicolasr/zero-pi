// zero-pi — the /zero-models command.
//
// A real pi command — a code handler, not an LLM prompt — for reading and
// changing the per-phase SDD models in `~/.pi/zero.json`. It is deterministic:
// no model is involved, so it does exactly what you pick, every time.
//
//   /zero-models                              interactive — phase, provider, model
//   /zero-models build=claude-opus-4-7         set one phase directly
//   /zero-models build=codex/gpt-5-codex       set phase with an explicit provider
//
// The interactive picker reads pi's model registry, so every provider you have
// configured — anthropic, codex, opencode, … — and its models are offered, not
// just a hardcoded Claude list.
//
// The SDD orchestrator reads `~/.pi/zero.json` at the start of every `/forge`
// run, so a change takes effect on the next run.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// This module has NO `@earendil-works/pi-tui` import at all — not a value
// import, not an `import type`. The no-arg picker is a `ctx.ui.custom()`
// component, and `ctx.ui.custom`'s factory only needs an object that exposes
// `render(width): string[]` (plus optional `handleInput`/`invalidate`) — pi's
// own docs example returns exactly such a plain object literal. So the picker
// builds its framed layout by hand with Unicode box-drawing characters and
// satisfies the contract via the small local `Component` interface below. Not
// importing the ambient `@earendil-works/pi-tui` specifier at all means even a
// stray static reference can never crash `node --test` with
// `ERR_MODULE_NOT_FOUND` when `zero-models.test.ts` imports the deterministic
// helpers.

/** The shape `ctx.ui.custom()`'s factory must return — a renderable component.
 *  Declared locally so this module pulls in no ambient TUI specifier. */
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
}

import { readAutotuneMode, type AutotuneMode } from "./autotune.ts";
import type { AutotunePending } from "./autotune-extension.ts";
import {
  back,
  createPickerState,
  decodeKey,
  enter,
  navigate,
  submitText,
  type EnterResult,
  type PickerState,
} from "./zero-models-picker.ts";

/** The SDD phases, in pipeline order. `clarify` is the pre-explore assumption
 *  gate and `analyze` is the post-plan readiness gate; both are configurable
 *  here like any other phase. */
export const PHASES = ["clarify", "explore", "plan", "analyze", "build", "veredicto"] as const;
export type Phase = (typeof PHASES)[number];

/** The per-phase model map. */
export type PhaseModels = Record<Phase, string>;
/** The per-phase provider map — parallel to {@link PhaseModels}. */
export type PhaseProviders = Record<Phase, string>;

/** The six real pi effort levels, in ascending order. The single source of
 *  truth for thinking-level validity — no `max`/`ultracode` aliases exist. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
/** One of the six real pi effort levels. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
/** The per-phase thinking map — partial on purpose: an absent phase means
 *  "no thinking configured", which renders to no `thinking:` frontmatter. */
export type PhaseThinking = Partial<Record<Phase, ThinkingLevel>>;

/** Whether a value is one of the six real pi effort levels. */
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

/** Fallback models when `~/.pi/zero.json` has none — cheap to clarify/explore,
 *  strong to plan, analyze and review. A pre-gates zero.json missing `clarify`/
 *  `analyze` keeps its four phases and gets these gate defaults in memory. */
const DEFAULT_MODELS: PhaseModels = {
  clarify: "claude-haiku-4-5",
  explore: "claude-haiku-4-5",
  plan: "claude-opus-4-8",
  analyze: "claude-opus-4-8",
  build: "claude-sonnet-4-6",
  veredicto: "claude-opus-4-8",
};

/** Package default thinking level per phase, used to fill any gap in the
 *  user's `zero.json` when the agent files are generated — so no phase ever
 *  inherits the session-wide `defaultThinkingLevel` from the user's settings.
 *  An explicit valid `zero.json` entry always wins. The gates get a level
 *  proportional to their job (clarify records assumptions, analyze reviews
 *  artifacts); veredicto keeps `xhigh` as the pipeline's adversarial guard. */
export const DEFAULT_THINKING: Record<Phase, ThinkingLevel> = {
  clarify: "medium",
  explore: "high",
  plan: "high",
  analyze: "high",
  build: "high",
  veredicto: "xhigh",
};

/** Model list used only when pi's model registry is unavailable. */
const FALLBACK_MODELS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

/** Absolute path of pi's `zero.json` marker. */
function zeroJsonPath(): string {
  return join(homedir(), ".pi", "zero.json");
}

/** Whether a string names an SDD phase. */
export function isPhase(value: string): value is Phase {
  return (PHASES as readonly string[]).includes(value);
}

/** Read `~/.pi/zero.json`, returning an empty object when absent or invalid. */
function readZeroJson(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(zeroJsonPath(), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Extract the per-phase models from a zero.json object, filling any gap with
 * the default so the picker always has a value to show.
 */
export function readModels(data: Record<string, unknown>): PhaseModels {
  const raw = (data.models ?? {}) as Record<string, unknown>;
  const models: PhaseModels = { ...DEFAULT_MODELS };
  for (const phase of PHASES) {
    if (typeof raw[phase] === "string") models[phase] = stripThinkingSuffix(raw[phase] as string);
  }
  return models;
}

/**
 * Strip a single whitespace-separated trailing token from a stored model string
 * only when that token is a valid thinking level (legacy `"<model> <level>"`
 * form). A non-level trailing token is left intact — dropping it would silently
 * lose data — and a plain model id is returned unchanged.
 */
function stripThinkingSuffix(model: string): string {
  const trimmed = model.trim();
  const idx = trimmed.lastIndexOf(" ");
  if (idx < 0) return model;
  const tail = trimmed.slice(idx + 1);
  return isThinkingLevel(tail) ? trimmed.slice(0, idx).trim() : model;
}

/**
 * Extract the per-phase providers from a zero.json object. A missing provider
 * is an empty string — the consumer resolves or ignores it.
 */
export function readProviders(data: Record<string, unknown>): PhaseProviders {
  const raw = (data.providers ?? {}) as Record<string, unknown>;
  const providers: PhaseProviders = {
    clarify: "",
    explore: "",
    plan: "",
    analyze: "",
    build: "",
    veredicto: "",
  };
  for (const phase of PHASES) {
    if (typeof raw[phase] === "string") providers[phase] = raw[phase] as string;
  }
  return providers;
}

/**
 * Extract the per-phase thinking levels from a zero.json object.
 *
 * For each phase the explicit `thinking[phase]` value wins when it is a valid
 * level. Otherwise a legacy model string of the form `"<model> <level>"` is
 * mined: its trailing whitespace-separated token supplies the level, but only
 * when that token is one of the six real levels. The result is a partial map —
 * a phase with no valid or recoverable level is simply absent, never defaulted.
 */
export function readThinking(data: Record<string, unknown>): PhaseThinking {
  const out: PhaseThinking = {};
  const raw = (data.thinking ?? {}) as Record<string, unknown>;
  const models = data.models as Record<string, unknown> | undefined;
  for (const phase of PHASES) {
    if (isThinkingLevel(raw[phase])) {
      out[phase] = raw[phase];
      continue;
    }
    // Legacy recovery: "<model> <level>" with a valid trailing level.
    const model = models?.[phase];
    if (typeof model === "string") {
      const trimmed = model.trim();
      const tail = trimmed.split(/\s+/).slice(-1)[0];
      if (trimmed.includes(" ") && isThinkingLevel(tail)) out[phase] = tail;
    }
  }
  return out;
}

/** A provider-qualified model assignment from the direct command form. */
export interface Assignment {
  phase: Phase;
  model: string;
  provider?: string;
  thinking?: ThinkingLevel;
}

/** The result of mining a thinking token out of an assignment value:
 *  the cleaned value plus the level, or the `"invalid"` sentinel when an
 *  explicit `thinking=` token names an unknown level. */
export type ThinkingTokenResult = { value: string; thinking?: ThinkingLevel } | "invalid";

/**
 * Mine a thinking level out of an assignment value.
 *
 * Precedence:
 *   1. An explicit `thinking=<level>` token anywhere in the value. When the
 *      level is valid it is removed from the value and returned; when it is
 *      unknown the whole parse is `"invalid"` so the handler shows usage help.
 *   2. Otherwise a trailing bare `<level>` token — recognized only when it is
 *      one of the six real levels; a non-level trailing token stays in the value.
 *   3. Otherwise the value is returned unchanged with no thinking.
 */
export function parseThinkingToken(value: string): ThinkingTokenResult {
  const tokens = value.trim().split(/\s+/);
  // 1. explicit thinking=<level> anywhere in the value.
  const idx = tokens.findIndex((t) => /^thinking=/i.test(t));
  if (idx >= 0) {
    const level = tokens[idx].slice("thinking=".length);
    if (!isThinkingLevel(level)) return "invalid";
    const rest = tokens.slice(0, idx).concat(tokens.slice(idx + 1));
    return { value: rest.join(" "), thinking: level };
  }
  // 2. trailing bare <level> shorthand.
  if (tokens.length > 1 && isThinkingLevel(tokens[tokens.length - 1])) {
    return { value: tokens.slice(0, -1).join(" "), thinking: tokens[tokens.length - 1] };
  }
  // 3. no thinking token.
  return { value: value.trim() };
}

/**
 * Parse a direct `<phase>=<model>` assignment. The value may carry an explicit
 * provider as `<provider>/<model>` — the first `/` splits them — and an optional
 * thinking level via `thinking=<level>` or a trailing bare `<level>` shorthand.
 * An invalid explicit thinking level makes the whole parse `null` so the handler
 * writes nothing and shows usage help.
 */
export function parseAssignment(arg: string): Assignment | null {
  const match = arg.trim().match(/^(\w+)\s*[=\s]\s*(.+)$/);
  if (!match) return null;
  const phase = match[1].toLowerCase();
  if (!isPhase(phase)) return null;
  let value = match[2].trim();
  if (value === "") return null;

  const parsed = parseThinkingToken(value);
  if (parsed === "invalid") return null;
  value = parsed.value.trim();
  if (value === "") return null;
  const thinking = parsed.thinking;

  const slash = value.indexOf("/");
  if (slash > 0 && slash < value.length - 1) {
    const out: Assignment = {
      phase,
      provider: value.slice(0, slash).trim(),
      model: value.slice(slash + 1).trim(),
    };
    if (thinking) out.thinking = thinking;
    return out;
  }
  const out: Assignment = { phase, model: value };
  if (thinking) out.thinking = thinking;
  return out;
}

/**
 * Render the per-phase model map as an aligned `provider/model` block, with the
 * thinking level appended as ` · thinking <level>` for any phase that has one.
 */
export function formatPhases(
  models: PhaseModels,
  providers: PhaseProviders,
  thinking: PhaseThinking,
): string {
  return PHASES.map((phase) => {
    const provider = providers[phase];
    let label = provider ? `${provider}/${models[phase]}` : models[phase];
    if (thinking[phase]) label += ` · thinking ${thinking[phase]}`;
    return `  ${phase.padEnd(10)} ${label}`;
  }).join("\n");
}

/** The valid `autotune` modes a user can set. */
const AUTOTUNE_MODES = ["auto", "ask", "off"] as const;

/**
 * Parse the value of a `/zero-models autotune=<mode>` argument.
 *
 * Accepts only `auto`, `ask`, or `off` — case-insensitive and trimmed.
 * Returns `null` for any other value so the caller can emit a usage warning
 * and write nothing.
 */
export function parseAutotuneArg(arg: string): AutotuneMode | null {
  const value = arg.trim().toLowerCase();
  return (AUTOTUNE_MODES as readonly string[]).includes(value)
    ? (value as AutotuneMode)
    : null;
}

/** A short human label for an autotune mode, used in menus and notifications. */
export function formatAutotune(mode: AutotuneMode): string {
  switch (mode) {
    case "auto":
      return "auto — aplica cambios automáticamente";
    case "ask":
      return "ask — sugiere y espera confirmación";
    case "off":
      return "off — no ajusta nada";
  }
}

/** A pi model entry — only the fields the picker needs. */
export interface PiModel {
  provider: string;
  id: string;
  name?: string;
}

/**
 * Group model ids by provider, each list sorted and de-duplicated. Malformed
 * entries are skipped so a registry quirk never crashes the picker.
 */
export function groupByProvider(models: readonly PiModel[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const m of models) {
    if (!m || typeof m.provider !== "string" || typeof m.id !== "string") continue;
    if (m.provider === "" || m.id === "") continue;
    const list = map.get(m.provider) ?? [];
    if (!list.includes(m.id)) list.push(m.id);
    map.set(m.provider, list);
  }
  for (const list of map.values()) list.sort();
  return map;
}

/** Result of validating a direct `/zero-models <phase>=...` assignment
 *  against pi's model registry. */
export type AssignmentValidation =
  | { ok: true; provider?: string }
  | { ok: false; message: string };

function containsModel(list: readonly string[] | undefined, model: string): boolean {
  return Boolean(list?.includes(model));
}

function modelProviders(groups: Map<string, string[]>, model: string): string[] {
  const providers: string[] = [];
  for (const [provider, models] of groups) if (models.includes(model)) providers.push(provider);
  return providers.sort();
}

function suggestModels(groups: Map<string, string[]>, model: string): string[] {
  const needle = model.toLowerCase();
  const scored: string[] = [];
  for (const [provider, models] of groups) {
    for (const id of models) {
      const hay = id.toLowerCase();
      if (hay.includes(needle) || needle.includes(hay)) scored.push(`${provider}/${id}`);
    }
  }
  return scored.slice(0, 5);
}

/**
 * Validate a direct assignment against pi's model registry.
 *
 * Empty registry = permissive fallback (old behaviour), because tests and some
 * headless contexts may not expose `ctx.modelRegistry`. When the registry is
 * present, the command writes only provider/model pairs pi can actually
 * resolve. Bare ambiguous model ids are rejected with a provider-qualified hint.
 */
export function validateAssignment(
  assignment: Assignment,
  groups: Map<string, string[]>,
): AssignmentValidation {
  if (groups.size === 0) return { ok: true, provider: assignment.provider };

  if (assignment.provider) {
    const providerModels = groups.get(assignment.provider);
    if (!providerModels) {
      return {
        ok: false,
        message: `provider desconocido: ${assignment.provider}. Usá uno de: ${[...groups.keys()].sort().join(", ")}`,
      };
    }
    if (!containsModel(providerModels, assignment.model)) {
      const suggestions = suggestModels(groups, assignment.model);
      return {
        ok: false,
        message:
          `modelo desconocido para ${assignment.provider}: ${assignment.model}` +
          (suggestions.length > 0 ? `. Quizás: ${suggestions.join(", ")}` : ""),
      };
    }
    return { ok: true, provider: assignment.provider };
  }

  const providers = modelProviders(groups, assignment.model);
  if (providers.length === 1) return { ok: true, provider: providers[0] };
  if (providers.length > 1) {
    return {
      ok: false,
      message: `modelo ambiguo: ${assignment.model}. Usá provider/model: ${providers.map((p) => `${p}/${assignment.model}`).join(", ")}`,
    };
  }
  const suggestions = suggestModels(groups, assignment.model);
  return {
    ok: false,
    message:
      `modelo desconocido: ${assignment.model}` +
      (suggestions.length > 0 ? `. Quizás: ${suggestions.join(", ")}` : ""),
  };
}

/** The pi-TUI host handed to a `ctx.ui.custom()` factory — only the one
 *  method the picker shell uses. */
interface PiTui {
  requestRender(): void;
}
/** A pi theme — only the foreground-color helper the picker uses. */
interface PiTheme {
  fg(color: string, text: string): string;
}
/** The factory `ctx.ui.custom()` invokes to build the boxed component. */
type PiCustomFactory<T> = (
  tui: PiTui,
  theme: PiTheme,
  keybindings: unknown,
  done: (result: T) => void,
) => Component;

/** The slice of pi's extension API this command uses. */
interface PiUI {
  select(prompt: string, options: string[]): Promise<string | undefined>;
  input(prompt: string, placeholder?: string): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  custom<T>(factory: PiCustomFactory<T>): Promise<T>;
}
/** pi's model registry — the source of every provider's model list. */
interface PiModelRegistry {
  getAll(): PiModel[];
  getAvailable?(): PiModel[];
}
interface PiCommandContext {
  ui: PiUI;
  modelRegistry?: PiModelRegistry;
}
interface PiExtensionAPI {
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: PiCommandContext) => Promise<void> | void;
    },
  ): void;
}

/**
 * Group models by provider for the picker.
 *
 * The source is pi's own model registry — `getAll()` returns every model from
 * every provider the user is authenticated for (`anthropic`, `openai-codex`,
 * `opencode-go`, …), each with the exact provider id and model id pi resolves
 * at runtime. Using pi's registry — rather than a foreign catalog like
 * OpenCode's — guarantees the names written to `~/.pi/zero.json` are names pi
 * actually understands, so a configured phase model never fails to resolve.
 */
function providerGroups(registry: PiModelRegistry | undefined): Map<string, string[]> {
  if (registry && typeof registry.getAll === "function") {
    try {
      const all = registry.getAll();
      if (all && all.length > 0) return groupByProvider(all);
    } catch {
      /* fall through to an empty map */
    }
  }
  return new Map();
}

/** Find the provider that owns a model id, per pi's own model registry. */
function resolveProvider(
  registry: PiModelRegistry | undefined,
  modelId: string,
): string | undefined {
  if (registry && typeof registry.getAll === "function") {
    try {
      for (const m of registry.getAll()) {
        if (m && m.id === modelId && typeof m.provider === "string") return m.provider;
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** The boxed-panel title row. */
const PICKER_TITLE = "zero · modelos SDD";
/** The dim help line shown at the foot of the boxed panel. */
const PICKER_HELP = "↑↓ navegar · enter elegir · esc volver";


/**
 * Clamp a rendered line to `width` columns so it never overflows the box
 * frame (tui.md "Line Width" is a hard rule). A plain slice is enough here —
 * the picker emits no ANSI inside its row strings except whole-line theming,
 * and `theme.fg` is applied *after* truncation by the caller where it matters.
 */
function clampLine(line: string, width: number): string {
  if (width <= 0) return "";
  return line.length > width ? line.slice(0, width) : line;
}

/** Unicode box-drawing characters for the picker's 4-sided frame. */
const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
} as const;
/** The theme color used for the picker's box frame. */
const FRAME_COLOR = "accent";
/** Below this `width` a real frame cannot be drawn — render unframed instead. */
const MIN_BOX_WIDTH = 10;

/**
 * One content row of the boxed panel, given as *plain* text plus an optional
 * theme color. {@link frameBox} measures the plain `text`, then sizes and
 * colorizes it — so an ANSI escape is never fed to `clampLine`/`padEnd`.
 */
interface BoxRow {
  text: string;
  color?: string;
}

/**
 * Wrap content rows in a true 4-sided Unicode box.
 *
 * `width` is the full outer box width. Each row's *plain* text is truncated
 * and space-padded to the inner width (`width - 4`: two `│` columns plus one
 * space of padding on each side) — measured *before* `theme.fg` runs, so an
 * ANSI escape is never measured. The frame chars and the row content are
 * themed separately. When `width` is too small to frame, the plain rows are
 * returned unframed (defensive — never produce garbage).
 */
function frameBox(rows: readonly BoxRow[], width: number, theme: PiTheme): string[] {
  if (width < MIN_BOX_WIDTH) {
    return rows.map((row) => clampLine(row.text, Math.max(0, width)));
  }
  const inner = width - 4;
  const frame = (s: string): string => theme.fg(FRAME_COLOR, s);
  const horizontal = BOX.horizontal.repeat(width - 2);
  const top = frame(`${BOX.topLeft}${horizontal}${BOX.topRight}`);
  const bottom = frame(`${BOX.bottomLeft}${horizontal}${BOX.bottomRight}`);
  const side = frame(BOX.vertical);

  const body = rows.map((row) => {
    // Size on plain text, then colorize — never measure an ANSI string.
    const sized = clampLine(row.text, inner).padEnd(inner, " ");
    const content = row.color ? theme.fg(row.color, sized) : sized;
    return `${side} ${content} ${side}`;
  });
  return [top, ...body, bottom];
}

/**
 * Build the inline pi-TUI component for the no-arg picker.
 *
 * The component owns no navigation logic — it holds one mutable `PickerState`,
 * forwards keystrokes to the pure transition functions of
 * `zero-models-picker.ts`, and re-renders. A `save`/`quit` `EnterResult` ends
 * the component via `done(result)`.
 *
 * Custom typed provider/model values use an inline character buffer handled
 * directly in `handleInput` (the design's documented fallback for the embedded
 * `Input`): pi-tui's `Input` is not shipped with type definitions in this pi
 * build and an embedded-input + `Focusable` wiring is the design's named
 * highest-risk path — the inline buffer is self-contained, needs no ambient
 * TUI class at all, and keeps the pure module's `submitText` contract
 * untouched.
 *
 * The whole `handleInput` body is wrapped in a `try/catch` that closes the
 * component cleanly via `done({ type: "quit" })` on any error (Req 9).
 *
 * `render(width)` builds the framed layout by hand with Unicode box-drawing
 * characters ({@link frameBox}) — no pi-tui components are involved — so the
 * picker draws as a real closed rectangle.
 */
function createPickerComponent(
  initial: PickerState,
  theme: PiTheme,
  tui: PiTui,
  done: (result: EnterResult) => void,
): Component {
  // The single mutable state reference; reassigned from the pure functions.
  let state = initial;
  // Inline text buffer — non-null only while `state.textPrompt` is open.
  let buffer: string | null = null;

  /**
   * Render the boxed panel for the current state.
   *
   * Builds plain-text content rows with an optional theme color each, then
   * hands them to {@link frameBox} which sizes (on plain text) and colorizes
   * last. Defensive — it must never throw: rows carry plain text, theming is
   * deferred to `frameBox`, and `frameBox` degrades gracefully on a tiny
   * `width`.
   */
  function render(width: number): string[] {
    const rows: BoxRow[] = [];

    rows.push({ text: PICKER_TITLE });
    rows.push({ text: "" });

    if (state.textPrompt) {
      // Inline text-entry mode: show the prompt label and the typed buffer.
      rows.push({ text: state.textPrompt.label });
      rows.push({ text: `> ${buffer ?? ""}`, color: "accent" });
      rows.push({ text: "" });
      rows.push({ text: "enter confirmar · esc volver", color: "dim" });
      return frameBox(rows, width, theme);
    }

    state.entries.forEach((entry, index) => {
      if (index === state.cursor) {
        rows.push({ text: `> ${entry.label}`, color: "accent" });
      } else {
        rows.push({ text: `  ${entry.label}`, color: "dim" });
      }
    });

    rows.push({ text: "" });
    rows.push({ text: PICKER_HELP, color: "dim" });
    return frameBox(rows, width, theme);
  }

  /** Apply an `EnterResult` — re-render on `state`, close on `save`/`quit`. */
  function applyResult(result: EnterResult): void {
    if (result.type === "state") {
      state = result.state;
      tui.requestRender();
    } else {
      done(result);
    }
  }

  /** Route a keystroke while the inline text buffer is open. */
  function handleTextInput(data: string): void {
    const key = decodeKey(data);
    if (key === "esc") {
      // Esc abandons the typed value and returns to the current list screen
      // unchanged. `submitText` with an empty string is exactly that no-op:
      // it clears `textPrompt` and rebuilds the list without committing.
      state = submitText(state, "");
      buffer = null;
      tui.requestRender();
      return;
    }
    if (key === "enter") {
      state = submitText(state, buffer ?? "");
      buffer = null;
      tui.requestRender();
      return;
    }
    if (key === "backspace") {
      buffer = (buffer ?? "").slice(0, -1);
      tui.requestRender();
      return;
    }
    // Append printable characters only (skip control sequences).
    if (data.length >= 1 && data.charCodeAt(0) >= 32 && !data.startsWith("\x1b")) {
      buffer = (buffer ?? "") + data;
      tui.requestRender();
    }
  }

  /** Receive a keystroke; never throws out — a failure closes the picker. */
  function handleInput(data: string): void {
    try {
      // Inline text-entry mode takes input until it submits or escapes.
      if (state.textPrompt) {
        handleTextInput(data);
        return;
      }

      const key = decodeKey(data);
      if (key === "up") {
        state = navigate(state, -1);
        tui.requestRender();
        return;
      }
      if (key === "down") {
        state = navigate(state, 1);
        tui.requestRender();
        return;
      }
      if (key === "enter") {
        const result = enter(state);
        // `enter` on a custom-* row opens `textPrompt`; arm the buffer.
        if (result.type === "state" && result.state.textPrompt) buffer = "";
        applyResult(result);
        return;
      }
      if (key === "esc") {
        applyResult(back(state));
        return;
      }
    } catch {
      // A render/transition bug must never wedge the pi session — close.
      done({ type: "quit" });
    }
  }

  return {
    render,
    invalidate(): void {
      /* stateless render — nothing cached to clear */
    },
    handleInput,
  };
}

/**
 * The pi extension entry point — registers the `/zero-models` command.
 */
export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;

  pi.registerCommand("zero-models", {
    description:
      "Muestra o cambia los modelos SDD por fase — /zero-models [<fase>=[<provider>/]<modelo>]",
    handler: async (args: string, ctx: PiCommandContext): Promise<void> => {
      try {
        const data = readZeroJson();
        const models = readModels(data);
        const providers = readProviders(data);
        const thinking = readThinking(data);
        const groups = providerGroups(ctx.modelRegistry);

        // Direct form: /zero-models build=claude-opus-4-7
        const arg = args.trim();
        if (arg) {
          // Direct form: /zero-models autotune=<mode>
          const autotuneMatch = arg.match(/^autotune\s*[=\s]\s*(.+)$/i);
          if (autotuneMatch) {
            const mode = parseAutotuneArg(autotuneMatch[1]);
            if (!mode) {
              ctx.ui.notify(
                "uso: /zero-models autotune=<modo>  (modo: auto | ask | off)",
                "warning",
              );
              return;
            }
            writeFileSync(
              zeroJsonPath(),
              `${JSON.stringify({ ...data, autotune: mode }, null, 2)}\n`,
              "utf8",
            );
            ctx.ui.notify(`zero autotune: ${formatAutotune(mode)}`, "info");
            return;
          }

          // A malformed explicit `thinking=<level>` gets a targeted usage help
          // and writes nothing — distinct from the generic assignment help.
          const thinkingToken = arg.match(/(?:^|\s)thinking=(\S+)/i);
          if (thinkingToken && !isThinkingLevel(thinkingToken[1])) {
            ctx.ui.notify(
              "uso: thinking=<nivel>  (nivel: off | minimal | low | medium | high | xhigh)",
              "warning",
            );
            return;
          }

          const assignment = parseAssignment(arg);
          if (!assignment) {
            ctx.ui.notify(
              "uso: /zero-models  —o—  /zero-models <fase>=[<provider>/]<modelo> [thinking=<nivel>] " +
                "(fase: clarify | explore | plan | analyze | build | veredicto · " +
                "nivel: off | minimal | low | medium | high | xhigh)  —o—  " +
                "/zero-models autotune=<modo>",
              "warning",
            );
            return;
          }
          const validation = validateAssignment(assignment, groups);
          if (!validation.ok) {
            ctx.ui.notify(`zero-models: ${validation.message}`, "warning");
            return;
          }

          models[assignment.phase] = assignment.model;
          providers[assignment.phase] =
            validation.provider ??
            assignment.provider ??
            resolveProvider(ctx.modelRegistry, assignment.model) ??
            providers[assignment.phase];
          // Resolve the thinking map: start from the recovered/persisted levels
          // (legacy suffixes already mined by `readThinking`), apply the new
          // level when given, preserve the prior level when absent. `models` was
          // read via `readModels`, which already stripped any valid legacy
          // suffix — so the written store is normalized (model token only).
          const nextThinking = { ...thinking };
          if (assignment.thinking) nextThinking[assignment.phase] = assignment.thinking;
          const merged: Record<string, unknown> = { ...data, models, providers };
          if (Object.keys(nextThinking).length > 0) merged.thinking = nextThinking;
          else delete merged.thinking;
          writeFileSync(zeroJsonPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
          const shown = providers[assignment.phase]
            ? `${providers[assignment.phase]}/${assignment.model}`
            : assignment.model;
          const level = nextThinking[assignment.phase];
          ctx.ui.notify(
            `zero models: ${assignment.phase} → ${shown}${level ? ` · thinking ${level}` : ""}`,
            "info",
          );
          return;
        }

        // Interactive form: open the boxed picker, then persist on save.
        const autotuneMode = readAutotuneMode(data);
        const pending = readAutotunePending(data);

        const initialState = createPickerState({
          models,
          providers,
          thinking,
          autotuneMode,
          pending,
          groups,
          fallbackModels: FALLBACK_MODELS,
        });

        // The picker is a self-contained `ctx.ui.custom()` component — it
        // renders its own framed layout with box-drawing characters, so no
        // pi-tui module is loaded here.
        const result = await ctx.ui.custom<EnterResult>((tui, theme, _kb, done) =>
          createPickerComponent(initialState, theme, tui, done),
        );

        if (result.type !== "save") {
          // Esc / quit (or a contained UI failure): write nothing, leaving
          // `zero.json` byte-for-byte unchanged, and report the leave-as-is
          // state — the existing "sin cambios" notification text.
          ctx.ui.notify(
            `zero · modelos SDD (sin cambios):\n${formatPhases(models, providers, thinking)}\n` +
              `  autotune   ${autotuneMode}`,
            "info",
          );
          return;
        }

        // Save: pull the accumulated edits off the final picker state.
        const edits = result.state.edits;
        if (edits.changed || edits.autotuneChanged) {
          // Build the patch, preserving every other key via the spread. When
          // the pending suggestion was applied, clear the `autotunePending` key.
          const patch: Record<string, unknown> = {
            models: edits.models,
            providers: edits.providers,
          };
          // Persist the staged per-phase thinking map alongside models/
          // providers; omit the key entirely when no phase has a level so the
          // store stays byte-minimal and backward-compatible.
          if (Object.keys(edits.thinking).length > 0) patch.thinking = edits.thinking;
          if (edits.autotuneChanged) patch.autotune = edits.autotuneMode;

          const merged = { ...data, ...patch };
          if (Object.keys(edits.thinking).length === 0) delete merged.thinking;
          if (edits.pendingApplied) delete merged.autotunePending;
          writeFileSync(zeroJsonPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");

          const summary = [
            `zero · modelos SDD guardados:\n${formatPhases(edits.models, edits.providers, edits.thinking)}`,
          ];
          summary.push(`  autotune   ${edits.autotuneMode}`);
          if (edits.pendingApplied) summary.push("sugerencia aplicada");
          ctx.ui.notify(summary.join("\n"), "info");
        } else {
          ctx.ui.notify(
            `zero · modelos SDD (sin cambios):\n${formatPhases(edits.models, edits.providers, edits.thinking)}\n` +
              `  autotune   ${edits.autotuneMode}`,
            "info",
          );
        }
      } catch (err) {
        ctx.ui.notify(
          `zero-models: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
}

/** Whether a value is a non-null, non-array object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extract the `autotunePending` adjustments from a zero.json object.
 *
 * Returns only well-formed records — an array entry with string `phase`/`from`/
 * `to`/`reason` and a recognized phase — so a malformed key never crashes the
 * picker. A missing or off-shape key yields `[]`.
 */
function readAutotunePending(data: Record<string, unknown>): AutotunePending[] {
  const raw = data.autotunePending;
  if (!Array.isArray(raw)) return [];
  const pending: AutotunePending[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const { phase, from, to, reason } = entry;
    if (
      typeof phase === "string" &&
      isPhase(phase) &&
      typeof from === "string" &&
      typeof to === "string" &&
      typeof reason === "string"
    ) {
      pending.push({ phase, from, to, reason });
    }
  }
  return pending;
}
