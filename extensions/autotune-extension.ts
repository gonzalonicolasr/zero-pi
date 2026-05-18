// zero-pi — adaptive model profiles, pi wiring.
//
// A thin pi extension that wires the pure decision logic in `autotune.ts` to
// the `session_start` hook. On every session start it reads the local outcome
// log (`~/.pi/zero-runs.jsonl`), aggregates it, decides per-phase model
// adjustments, and — depending on the `autotune` mode stored in
// `~/.pi/zero.json` — either applies them (`auto`), records them as a pending
// suggestion (`ask`), or does nothing (`off`).
//
// `session_start` is the chosen trigger: it runs deterministic code and
// applies the freshly-learned profile *before* the next `/forge` run reads
// `zero.json`. A run's own record only influences the *next* session — the
// one-run lag the requirements explicitly model ("a change takes effect on the
// next run").
//
// All decisions live in `autotune.ts`; this file only reads files, calls those
// functions, and applies/notifies. The whole handler is wrapped in a swallowing
// `try/catch` — exactly like `startup-banner.ts`, a failure must never break a
// pi session. The package stays dependency-free: `node:fs`/`node:os`/`node:path`
// only, plus minimal local interfaces for the pi API.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  aggregate,
  decideAdjustments,
  readAutotuneMode,
  readRunRecords,
  type Adjustment,
} from "./autotune.ts";

/** The SDD phases, in pipeline order. Mirrors `zero-models.ts`. */
const PHASES = ["explore", "plan", "build", "veredicto"] as const;
type Phase = (typeof PHASES)[number];

/**
 * One pending adjustment recorded under the `autotunePending` key of
 * `~/.pi/zero.json` in `ask` mode. It mirrors `autotune.ts`'s `Adjustment`
 * exactly — a flat `{ phase, from, to, reason }` record — so `/zero-models`
 * (Task 6) can read the key, surface the suggestion, apply it, and clear it.
 *
 * `autotunePending` is the JSON shape `Adjustment[]`: an array of these
 * records. It is never read by the orchestrator.
 */
export interface AutotunePending {
  /** SDD phase the suggested change applies to. */
  phase: Phase;
  /** Model the phase currently runs on. */
  from: string;
  /** Model the phase is suggested to move to (always one tier above `from`). */
  to: string;
  /** Human-readable justification, used verbatim when surfacing the suggestion. */
  reason: string;
}

/** Absolute path of pi's `zero.json` marker. Mirrors `zero-models.ts`. */
function zeroJsonPath(): string {
  return join(homedir(), ".pi", "zero.json");
}

/** Absolute path of the append-only run metrics log. */
function zeroRunsPath(): string {
  return join(homedir(), ".pi", "zero-runs.jsonl");
}

/** Whether a value is a non-null, non-array object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read `~/.pi/zero.json`.
 *
 * Returns `null` — distinct from an empty object — when the file is absent or
 * unparseable. The autotune flow treats `null` as "no profile to safely tune":
 * it must not synthesize a `models` map (AC 6.4). A present-but-`{}` file is a
 * valid object and is returned as such.
 */
function readZeroJson(): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(zeroJsonPath(), "utf8"));
  } catch {
    return null;
  }
  return isObject(parsed) ? parsed : null;
}

/**
 * Extract the per-phase models actually present in a `zero.json` object. Only
 * string entries for known phases are kept; missing or non-string entries are
 * omitted (no defaults are synthesized — `decideAdjustments` skips a phase with
 * no current model).
 */
function readCurrentModels(data: Record<string, unknown>): Partial<Record<Phase, string>> {
  const raw = isObject(data.models) ? data.models : {};
  const models: Partial<Record<Phase, string>> = {};
  for (const phase of PHASES) {
    const value = raw[phase];
    if (typeof value === "string" && value !== "") models[phase] = value;
  }
  return models;
}

/**
 * Derive `knownModels` — the distinct, non-empty model ids the autotune logic
 * may step toward. Per the design this is the union of every model seen in the
 * run log plus the current per-phase models, so `stepUp` prefers a model the
 * user already uses anywhere.
 */
function deriveKnownModels(
  currentModels: Partial<Record<Phase, string>>,
  loggedModels: Iterable<string>,
): string[] {
  const known = new Set<string>();
  for (const phase of PHASES) {
    const model = currentModels[phase];
    if (typeof model === "string" && model !== "") known.add(model);
  }
  for (const model of loggedModels) {
    if (typeof model === "string" && model !== "") known.add(model);
  }
  return [...known];
}

/** The slice of pi's UI surface the autotune extension uses. */
interface PiUI {
  notify(message: string, type?: "info" | "warning" | "error"): void;
}
interface PiSessionContext {
  ui: PiUI;
}
/** The slice of pi's extension API the autotune extension uses. */
interface PiExtensionAPI {
  on(event: string, handler: (ctx: PiSessionContext) => void): void;
}

/**
 * The `session_start` evaluate-and-tune handler.
 *
 * Runs entirely inside `register`'s swallowing `try/catch`, but is also written
 * to never throw on the expected paths: a missing log, an absent `zero.json`,
 * and an `off` mode all return cleanly.
 */
function evaluateAndTune(ctx: PiSessionContext): void {
  const notify = (message: string, type?: "info" | "warning" | "error"): void => {
    try {
      ctx.ui.notify(message, type);
    } catch {
      // A notification failure must not break the session either.
    }
  };

  const data = readZeroJson();
  if (data === null) {
    // Absent or unparseable `zero.json` — no profile to safely tune. Skip with
    // a single non-blocking warning; never synthesize a `models` map (AC 6.4).
    notify("zero autotune: ~/.pi/zero.json missing or unreadable — skipping", "warning");
    return;
  }

  const mode = readAutotuneMode(data);
  if (mode === "off") return; // metrics still captured by the orchestrator; nothing changes here.

  const currentModels = readCurrentModels(data);

  const records = readRunRecords(zeroRunsPath());
  const loggedModels: string[] = [];
  for (const record of records) {
    for (const phase of PHASES) {
      const model = record.phases[phase]?.model;
      if (typeof model === "string" && model !== "") loggedModels.push(model);
    }
  }
  const knownModels = deriveKnownModels(currentModels, loggedModels);

  const stats = aggregate(records);
  const adjustments: Adjustment[] = decideAdjustments(stats, currentModels, knownModels);
  if (adjustments.length === 0) return; // nothing to do — return silently.

  if (mode === "auto") {
    // Apply every adjustment, write `zero.json` ONCE preserving all other keys,
    // then emit one notification per change (AC 5.4, 6.1 — never silent).
    const models: Record<string, unknown> = isObject(data.models) ? { ...data.models } : {};
    for (const adj of adjustments) {
      models[adj.phase] = adj.to;
    }
    writeFileSync(
      zeroJsonPath(),
      `${JSON.stringify({ ...data, models }, null, 2)}\n`,
      "utf8",
    );
    for (const adj of adjustments) {
      notify(`zero autotune: ${adj.phase} ${adj.from} → ${adj.to} (${adj.reason})`, "info");
    }
    return;
  }

  // mode === "ask" — record the recommendations under `autotunePending` without
  // touching `models`, and tell the user to run /zero-models to apply.
  const pending: AutotunePending[] = adjustments.map((adj) => ({
    phase: adj.phase,
    from: adj.from,
    to: adj.to,
    reason: adj.reason,
  }));
  writeFileSync(
    zeroJsonPath(),
    `${JSON.stringify({ ...data, autotunePending: pending }, null, 2)}\n`,
    "utf8",
  );
  for (const adj of pending) {
    notify(
      `zero autotune suggests: ${adj.phase} → ${adj.to} — run /zero-models to apply`,
      "info",
    );
  }
}

/**
 * The pi extension entry point.
 *
 * pi calls this once when the extension loads. It wires the evaluate-and-tune
 * handler to the `session_start` event. The whole body is wrapped in a
 * swallowing `try/catch`, and the handler itself is wrapped again, so neither
 * registration nor a later failure can ever break a pi session. Called with no
 * or an invalid `pi`, it no-ops cleanly.
 */
export default function register(pi?: unknown): void {
  try {
    if (
      !pi ||
      typeof (pi as PiExtensionAPI).on !== "function"
    ) {
      return;
    }
    (pi as PiExtensionAPI).on("session_start", (ctx: PiSessionContext): void => {
      try {
        if (!ctx || !ctx.ui || typeof ctx.ui.notify !== "function") return;
        evaluateAndTune(ctx);
      } catch {
        // An evaluate-and-tune failure must never break a pi session.
      }
    });
  } catch {
    // Registration itself must never break a pi session.
  }
}
