// zero-pi — the /zero-models command.
//
// A real pi command — a code handler, not an LLM prompt — for reading and
// changing the per-phase SDD models in `~/.pi/zero.json`. It is deterministic:
// no model is involved, so it does exactly what you pick, every time.
//
//   /zero-models                        interactive — pick a phase, pick a model
//   /zero-models build=claude-opus-4-7   set one phase directly
//
// The SDD orchestrator reads `~/.pi/zero.json` at the start of every `/forge`
// run, so a change takes effect on the next run.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readAutotuneMode, type AutotuneMode } from "./autotune.ts";
import type { AutotunePending } from "./autotune-extension.ts";

/** The SDD phases, in pipeline order. */
export const PHASES = ["explore", "plan", "build", "veredicto"] as const;
export type Phase = (typeof PHASES)[number];

/** The per-phase model map. */
export type PhaseModels = Record<Phase, string>;

/** Fallback models when `~/.pi/zero.json` has none — cheap to explore, strong
 *  to plan and review. */
const DEFAULT_MODELS: PhaseModels = {
  explore: "claude-haiku-4-5",
  plan: "claude-opus-4-7",
  build: "claude-sonnet-4-6",
  veredicto: "claude-opus-4-7",
};

/** Models offered in the interactive picker — the Claude lineup pi-claude-cli
 *  exposes. Any other model can still be typed via the custom option. */
const MODEL_CHOICES = [
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

/** Parse a `<phase>=<model>` (or `<phase> <model>`) assignment. */
export function parseAssignment(arg: string): { phase: Phase; model: string } | null {
  const match = arg.trim().match(/^(\w+)\s*[=\s]\s*(.+)$/);
  if (!match) return null;
  const phase = match[1].toLowerCase();
  const model = match[2].trim();
  if (!isPhase(phase) || model === "") return null;
  return { phase, model };
}

/** Render the per-phase model map as an aligned block. */
export function formatModels(models: PhaseModels): string {
  return PHASES.map((phase) => `  ${phase.padEnd(10)} ${models[phase]}`).join("\n");
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

/** Write the models back into `~/.pi/zero.json`, preserving every other key. */
function writeModels(data: Record<string, unknown>, models: PhaseModels): void {
  writeFileSync(zeroJsonPath(), `${JSON.stringify({ ...data, models }, null, 2)}\n`, "utf8");
}

/**
 * Write an updated `~/.pi/zero.json` object, preserving every other key via the
 * same `{ ...data }` spread, 2-space indent and trailing newline `writeModels`
 * uses. The caller passes the keys it wants to add/override.
 */
function writeZeroJson(data: Record<string, unknown>, patch: Record<string, unknown>): void {
  writeFileSync(zeroJsonPath(), `${JSON.stringify({ ...data, ...patch }, null, 2)}\n`, "utf8");
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

/** The slice of pi's extension API this command uses. */
interface PiUI {
  select(prompt: string, options: string[]): Promise<string | undefined>;
  input(prompt: string, placeholder?: string): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}
interface PiCommandContext {
  ui: PiUI;
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

const SAVE_AND_EXIT = "— guardar y salir —";
const CUSTOM_MODEL = "— otro modelo (escribir) —";

/**
 * The pi extension entry point — registers the `/zero-models` command.
 */
export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;

  pi.registerCommand("zero-models", {
    description: "Show or set the per-phase SDD models — /zero-models [<phase>=<model>]",
    handler: async (args: string, ctx: PiCommandContext): Promise<void> => {
      try {
        const data = readZeroJson();
        const models = readModels(data);

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
            writeZeroJson(data, { autotune: mode });
            ctx.ui.notify(`zero autotune: ${formatAutotune(mode)}`, "info");
            return;
          }

          const assignment = parseAssignment(arg);
          if (!assignment) {
            ctx.ui.notify(
              "uso: /zero-models  —o—  /zero-models <fase>=<modelo> " +
                "(fase: explore | plan | build | veredicto)  —o—  " +
                "/zero-models autotune=<modo>",
              "warning",
            );
            return;
          }
          models[assignment.phase] = assignment.model;
          writeModels(data, models);
          ctx.ui.notify(`zero models: ${assignment.phase} → ${assignment.model}`, "info");
          return;
        }

        // Interactive form: pick a phase, pick a model, repeat until saved.
        let changed = false;
        let autotuneMode = readAutotuneMode(data);
        let autotuneChanged = false;
        let pending = readAutotunePending(data);
        let pendingApplied = false;
        for (;;) {
          const applyEntry =
            pending.length > 0
              ? `★ aplicar sugerencia: ${pending
                  .map((p) => `${p.phase} → ${p.to}`)
                  .join(", ")}`
              : null;
          const autotuneEntry = `autotune   →   ${autotuneMode}`;

          const phasePick = await ctx.ui.select("zero · modelos SDD — elegí una fase", [
            ...(applyEntry ? [applyEntry] : []),
            ...PHASES.map((p) => `${p}   →   ${models[p]}`),
            autotuneEntry,
            SAVE_AND_EXIT,
          ]);
          if (!phasePick || phasePick === SAVE_AND_EXIT) break;

          // Apply the pending autotune suggestion.
          if (applyEntry && phasePick === applyEntry) {
            for (const adj of pending) models[adj.phase] = adj.to;
            changed = true;
            pendingApplied = true;
            pending = [];
            continue;
          }

          // Change the autotune mode.
          if (phasePick === autotuneEntry) {
            const modePick = await ctx.ui.select(
              "Modo de autotune",
              AUTOTUNE_MODES.map((m) => formatAutotune(m)),
            );
            if (!modePick) continue;
            const picked = parseAutotuneArg(modePick.split(/\s/)[0]);
            if (picked && picked !== autotuneMode) {
              autotuneMode = picked;
              autotuneChanged = true;
            }
            continue;
          }

          const phase = phasePick.split(/\s/)[0];
          if (!isPhase(phase)) break;

          const modelPick = await ctx.ui.select(`Modelo para «${phase}»`, [
            ...MODEL_CHOICES,
            CUSTOM_MODEL,
          ]);
          if (!modelPick) continue;

          let model = modelPick;
          if (modelPick === CUSTOM_MODEL) {
            const typed = await ctx.ui.input(`Modelo para «${phase}»`, models[phase]);
            if (!typed || typed.trim() === "") continue;
            model = typed.trim();
          }
          models[phase] = model;
          changed = true;
        }

        if (changed || autotuneChanged) {
          // Build the patch, preserving every other key via the spread. When
          // the pending suggestion was applied, clear the `autotunePending` key.
          const patch: Record<string, unknown> = { models };
          if (autotuneChanged) patch.autotune = autotuneMode;
          if (pendingApplied) patch.autotunePending = undefined;

          const merged = { ...data, ...patch };
          if (pendingApplied) delete merged.autotunePending;
          writeFileSync(zeroJsonPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");

          const summary = [`zero · modelos SDD guardados:\n${formatModels(models)}`];
          summary.push(`  autotune   ${autotuneMode}`);
          if (pendingApplied) summary.push("sugerencia aplicada");
          ctx.ui.notify(summary.join("\n"), "info");
        } else {
          ctx.ui.notify(
            `zero · modelos SDD (sin cambios):\n${formatModels(models)}\n` +
              `  autotune   ${autotuneMode}`,
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
