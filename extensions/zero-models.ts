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

import { readAutotuneMode, type AutotuneMode } from "./autotune.ts";
import type { AutotunePending } from "./autotune-extension.ts";

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

/** The slice of pi's extension API this command uses. */
interface PiUI {
  select(prompt: string, options: string[]): Promise<string | undefined>;
  input(prompt: string, placeholder?: string): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
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

const SAVE_AND_EXIT = "— guardar y salir —";
const CUSTOM_MODEL = "— otro modelo (escribir) —";
const CUSTOM_PROVIDER = "— otro provider (escribir) —";

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

        // Interactive form: pick a phase, a provider, a model — until saved.
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
            ...PHASES.map(
              (p) => `${p}   →   ${providers[p] ? `${providers[p]}/` : ""}${models[p]}`,
            ),
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

          // Pick a provider — from the registry, or typed when unknown.
          let provider = providers[phase];
          let modelChoices = FALLBACK_MODELS;
          if (groups.size > 0) {
            const providerPick = await ctx.ui.select(`Provider para «${phase}»`, [
              ...[...groups.keys()].sort(),
              CUSTOM_PROVIDER,
            ]);
            if (!providerPick) continue;
            if (providerPick === CUSTOM_PROVIDER) {
              const typed = await ctx.ui.input(
                `Provider para «${phase}»`,
                providers[phase] || "",
              );
              if (!typed || typed.trim() === "") continue;
              provider = typed.trim();
              modelChoices = groups.get(provider) ?? [];
            } else {
              provider = providerPick;
              modelChoices = groups.get(providerPick) ?? [];
            }
          }

          // Pick a model within that provider — or type one.
          const label = provider ? `Modelo para «${phase}» (${provider})` : `Modelo para «${phase}»`;
          const modelPick = await ctx.ui.select(label, [...modelChoices, CUSTOM_MODEL]);
          if (!modelPick) continue;

          let model = modelPick;
          if (modelPick === CUSTOM_MODEL) {
            const typed = await ctx.ui.input(label, models[phase]);
            if (!typed || typed.trim() === "") continue;
            model = typed.trim();
          }
          models[phase] = model;
          providers[phase] = provider || resolveProvider(ctx.modelRegistry, model) || "";
          changed = true;
        }

        if (changed || autotuneChanged) {
          // Build the patch, preserving every other key via the spread. When
          // the pending suggestion was applied, clear the `autotunePending` key.
          const patch: Record<string, unknown> = { models, providers };
          if (autotuneChanged) patch.autotune = autotuneMode;

          const merged = { ...data, ...patch };
          if (pendingApplied) delete merged.autotunePending;
          writeFileSync(zeroJsonPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");

          const summary = [`zero · modelos SDD guardados:\n${formatPhases(models, providers)}`];
          summary.push(`  autotune   ${autotuneMode}`);
          if (pendingApplied) summary.push("sugerencia aplicada");
          ctx.ui.notify(summary.join("\n"), "info");
        } else {
          ctx.ui.notify(
            `zero · modelos SDD (sin cambios):\n${formatPhases(models, providers)}\n` +
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
