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

// `@earendil-works/pi-tui` is provided by the pi runtime as an ambient bare
// specifier — it is NOT a `package.json` dependency. It is loaded lazily, via
// a dynamic `import()` inside the no-arg handler branch, NOT a top-level value
// import: a static `import { Box } from "@earendil-works/pi-tui"` would be
// evaluated whenever any consumer imports this module — including
// `zero-models.test.ts`, which imports the deterministic helpers — and would
// crash `node --test` with `ERR_MODULE_NOT_FOUND`. `import type` below is
// fully erased by `--experimental-strip-types`, so it never triggers
// resolution. The runtime classes are reached only from inside pi.
import type { Component } from "@earendil-works/pi-tui";

import { readAutotuneMode, type AutotuneMode } from "./autotune.ts";
import type { AutotunePending } from "./autotune-extension.ts";
import {
  back,
  createPickerState,
  enter,
  navigate,
  submitText,
  type EnterResult,
  type PickerState,
} from "./zero-models-picker.ts";

/** The SDD phases, in pipeline order. */
export const PHASES = ["explore", "plan", "build", "veredicto"] as const;
export type Phase = (typeof PHASES)[number];

/** The per-phase model map. */
export type PhaseModels = Record<Phase, string>;
/** The per-phase provider map — parallel to {@link PhaseModels}. */
export type PhaseProviders = Record<Phase, string>;

/** Fallback models when `~/.pi/zero.json` has none — cheap to explore, strong
 *  to plan and review. */
const DEFAULT_MODELS: PhaseModels = {
  explore: "claude-haiku-4-5",
  plan: "claude-opus-4-7",
  build: "claude-sonnet-4-6",
  veredicto: "claude-opus-4-7",
};

/** Model list used only when pi's model registry is unavailable. */
const FALLBACK_MODELS = [
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
    if (typeof raw[phase] === "string") models[phase] = raw[phase] as string;
  }
  return models;
}

/**
 * Extract the per-phase providers from a zero.json object. A missing provider
 * is an empty string — the consumer resolves or ignores it.
 */
export function readProviders(data: Record<string, unknown>): PhaseProviders {
  const raw = (data.providers ?? {}) as Record<string, unknown>;
  const providers: PhaseProviders = { explore: "", plan: "", build: "", veredicto: "" };
  for (const phase of PHASES) {
    if (typeof raw[phase] === "string") providers[phase] = raw[phase] as string;
  }
  return providers;
}

/** A provider-qualified model assignment from the direct command form. */
export interface Assignment {
  phase: Phase;
  model: string;
  provider?: string;
}

/**
 * Parse a direct `<phase>=<model>` assignment. The value may carry an explicit
 * provider as `<provider>/<model>` — the first `/` splits them.
 */
export function parseAssignment(arg: string): Assignment | null {
  const match = arg.trim().match(/^(\w+)\s*[=\s]\s*(.+)$/);
  if (!match) return null;
  const phase = match[1].toLowerCase();
  if (!isPhase(phase)) return null;
  let value = match[2].trim();
  if (value === "") return null;

  const slash = value.indexOf("/");
  if (slash > 0 && slash < value.length - 1) {
    return { phase, provider: value.slice(0, slash).trim(), model: value.slice(slash + 1).trim() };
  }
  return { phase, model: value };
}

/** Render the per-phase model map as an aligned `provider/model` block. */
export function formatPhases(models: PhaseModels, providers: PhaseProviders): string {
  return PHASES.map((phase) => {
    const provider = providers[phase];
    const label = provider ? `${provider}/${models[phase]}` : models[phase];
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

/** The pi-TUI host handed to a `ctx.ui.custom()` factory — only the one
 *  method the picker shell uses. */
interface PiTui {
  requestRender(): void;
}
/** A pi-TUI component that groups children vertically and renders a frame. */
interface PiBox extends Component {
  addChild(child: Component): void;
}
/** The slice of `@earendil-works/pi-tui` the boxed picker constructs at
 *  runtime — `Box`/`Text`/`Spacer` constructors, captured from the lazy
 *  dynamic `import()` so this module never statically resolves the specifier. */
interface PiTuiModule {
  Box: new (paddingX?: number, paddingY?: number) => PiBox;
  Text: new (content: string, paddingX?: number, paddingY?: number) => Component;
  Spacer: new (lines: number) => Component;
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

/** ANSI arrow-key escape sequences. */
const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_ESC = "\x1b";
/** Enter — CR or LF, depending on the terminal. */
const KEY_ENTER = new Set(["\r", "\n", "\r\n"]);
/** Backspace — DEL or BS. */
const KEY_BACKSPACE = new Set(["\x7f", "\x08"]);

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
 * class beyond `Box`/`Text`/`Spacer`, and keeps the pure module's `submitText`
 * contract untouched.
 *
 * The whole `handleInput` body is wrapped in a `try/catch` that closes the
 * component cleanly via `done({ type: "quit" })` on any error (Req 9).
 */
function createPickerComponent(
  initial: PickerState,
  pitui: PiTuiModule,
  theme: PiTheme,
  tui: PiTui,
  done: (result: EnterResult) => void,
): Component {
  const { Box, Text, Spacer } = pitui;
  // The single mutable state reference; reassigned from the pure functions.
  let state = initial;
  // Inline text buffer — non-null only while `state.textPrompt` is open.
  let buffer: string | null = null;

  /** Render the boxed panel for the current state. */
  function render(width: number): string[] {
    const box = new Box(1, 1);
    const inner = Math.max(1, width - 4); // account for the box's paddingX

    box.addChild(new Text(clampLine(PICKER_TITLE, inner), 0, 0));
    box.addChild(new Spacer(1));

    if (state.textPrompt) {
      // Inline text-entry mode: show the prompt label and the typed buffer.
      box.addChild(
        new Text(clampLine(state.textPrompt.label, inner), 0, 0),
      );
      const typed = `> ${buffer ?? ""}`;
      box.addChild(
        new Text(theme.fg("accent", clampLine(typed, inner)), 0, 0),
      );
      box.addChild(new Spacer(1));
      box.addChild(
        new Text(
          theme.fg("dim", clampLine("enter confirmar · esc volver", inner)),
          0,
          0,
        ),
      );
      return box.render(width);
    }

    state.entries.forEach((entry, index) => {
      if (index === state.cursor) {
        const row = clampLine(`> ${entry.label}`, inner);
        box.addChild(new Text(theme.fg("accent", row), 0, 0));
      } else {
        const row = clampLine(`  ${entry.label}`, inner);
        box.addChild(new Text(theme.fg("dim", row), 0, 0));
      }
    });

    box.addChild(new Spacer(1));
    box.addChild(
      new Text(theme.fg("dim", clampLine(PICKER_HELP, inner)), 0, 0),
    );
    return box.render(width);
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
    if (data === KEY_ESC) {
      // Esc abandons the typed value and returns to the current list screen
      // unchanged. `submitText` with an empty string is exactly that no-op:
      // it clears `textPrompt` and rebuilds the list without committing.
      state = submitText(state, "");
      buffer = null;
      tui.requestRender();
      return;
    }
    if (KEY_ENTER.has(data)) {
      state = submitText(state, buffer ?? "");
      buffer = null;
      tui.requestRender();
      return;
    }
    if (KEY_BACKSPACE.has(data)) {
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

      if (data === KEY_UP) {
        state = navigate(state, -1);
        tui.requestRender();
        return;
      }
      if (data === KEY_DOWN) {
        state = navigate(state, 1);
        tui.requestRender();
        return;
      }
      if (KEY_ENTER.has(data)) {
        const result = enter(state);
        // `enter` on a custom-* row opens `textPrompt`; arm the buffer.
        if (result.type === "state" && result.state.textPrompt) buffer = "";
        applyResult(result);
        return;
      }
      if (data === KEY_ESC) {
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

          const assignment = parseAssignment(arg);
          if (!assignment) {
            ctx.ui.notify(
              "uso: /zero-models  —o—  /zero-models <fase>=[<provider>/]<modelo> " +
                "(fase: explore | plan | build | veredicto)  —o—  " +
                "/zero-models autotune=<modo>",
              "warning",
            );
            return;
          }
          models[assignment.phase] = assignment.model;
          providers[assignment.phase] =
            assignment.provider ??
            resolveProvider(ctx.modelRegistry, assignment.model) ??
            providers[assignment.phase];
          writeFileSync(
            zeroJsonPath(),
            `${JSON.stringify({ ...data, models, providers }, null, 2)}\n`,
            "utf8",
          );
          const shown = providers[assignment.phase]
            ? `${providers[assignment.phase]}/${assignment.model}`
            : assignment.model;
          ctx.ui.notify(`zero models: ${assignment.phase} → ${shown}`, "info");
          return;
        }

        // Interactive form: open the boxed picker, then persist on save.
        const autotuneMode = readAutotuneMode(data);
        const pending = readAutotunePending(data);

        const initialState = createPickerState({
          models,
          providers,
          autotuneMode,
          pending,
          groups,
          fallbackModels: FALLBACK_MODELS,
        });

        // Load pi-tui lazily — the bare specifier resolves only inside pi.
        // This `import()` lives in the handler (already inside the swallowing
        // `try/catch`), so a resolution failure becomes an error notification
        // and never escapes (Req 9).
        const pitui = (await import(
          "@earendil-works/pi-tui"
        )) as unknown as PiTuiModule;

        const result = await ctx.ui.custom<EnterResult>((tui, theme, _kb, done) =>
          createPickerComponent(initialState, pitui, theme, tui, done),
        );

        if (result.type !== "save") {
          // Esc / quit (or a contained UI failure): write nothing, leaving
          // `zero.json` byte-for-byte unchanged, and report the leave-as-is
          // state — the existing "sin cambios" notification text.
          ctx.ui.notify(
            `zero · modelos SDD (sin cambios):\n${formatPhases(models, providers)}\n` +
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
          if (edits.autotuneChanged) patch.autotune = edits.autotuneMode;

          const merged = { ...data, ...patch };
          if (edits.pendingApplied) delete merged.autotunePending;
          writeFileSync(zeroJsonPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");

          const summary = [
            `zero · modelos SDD guardados:\n${formatPhases(edits.models, edits.providers)}`,
          ];
          summary.push(`  autotune   ${edits.autotuneMode}`);
          if (edits.pendingApplied) summary.push("sugerencia aplicada");
          ctx.ui.notify(summary.join("\n"), "info");
        } else {
          ctx.ui.notify(
            `zero · modelos SDD (sin cambios):\n${formatPhases(edits.models, edits.providers)}\n` +
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
