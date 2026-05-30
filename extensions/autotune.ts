// zero-pi — adaptive model profiles, pure-logic module.
//
// zero learns which Claude model fits each SDD phase by accumulating a local,
// append-only outcome log (`~/.pi/zero-runs.jsonl`) and tuning `~/.pi/zero.json`
// from aggregated statistics. Every *decision* — parsing, aggregation, tier
// math, adjustment — lives here in plain, dependency-free TypeScript so it is
// testable and reproducible. The pi wiring lives in `autotune-extension.ts`.
//
// This file has no pi imports and no side-effecting top-level code; it only
// touches the filesystem through the explicit `readRunRecords` reader.

import { readFileSync } from "node:fs";

/** Schema version of one `~/.pi/zero-runs.jsonl` record. A record carrying any
 *  other `v` is dropped by `parseRunLine` rather than mis-aggregated. v2 adds
 *  the per-round `verdicts` sequence; `parseRunLine` still accepts v1 records. */
export const RUN_SCHEMA_VERSION = 2;

/** The SDD phases a run record carries a model for, in pipeline order. */
const RECORD_PHASES = ["explore", "plan", "build", "veredicto"] as const;

/** Terminal states a run can be recorded with. `pasa` = success;
 *  `cap-reached` = the round cap was hit without a `pasa`. */
const VERDICTS = ["pasa", "cap-reached"] as const;

/** A run's terminal verdict. */
export type RunVerdict = (typeof VERDICTS)[number];

/** Per-round verdicts the `veredicto` phase can return. `corregir` re-runs
 *  build, `replantear` re-runs plan, `pasa` ends the run. `cap-reached` is a
 *  run-level terminal state and is deliberately *not* a round verdict. */
const ROUND_VERDICTS = ["corregir", "replantear", "pasa"] as const;

/** A single round's verdict from the `veredicto` phase. */
export type RunRoundVerdict = (typeof ROUND_VERDICTS)[number];

/** The model a single phase ran on for a given run. An object (not a bare
 *  string) so the schema can grow additive fields without a version bump. */
export interface PhaseRun {
  model: string;
}

/**
 * One line of `~/.pi/zero-runs.jsonl` — a single completed SDD run. The
 * orchestrator prompt emits exactly this shape at run end.
 */
export interface RunRecord {
  /** Schema version — always `RUN_SCHEMA_VERSION`. */
  v: number;
  /** ISO 8601 run-end timestamp. */
  ts: string;
  /** SDD feature slug. */
  feature: string;
  /** The model each phase ran on for this run. */
  phases: Record<(typeof RECORD_PHASES)[number], PhaseRun>;
  /** The run's terminal verdict. */
  verdict: RunVerdict;
  /** Count of build/veredicto rounds — `1` for a clean first-pass run. */
  rounds: number;
  /** The chronological per-round verdict sequence. Present on `v:2` records
   *  (`verdicts.length === rounds`); `undefined` on `v:1` records, which carry
   *  only the run-level verdict and so cannot be phase-attributed. Its
   *  presence is the single discriminator `aggregate` uses for v2 attribution. */
  verdicts?: RunRoundVerdict[];
}

/** How aggressively zero applies a learned profile — stored in `zero.json`.
 *  `auto` applies and notifies; `ask` records a pending suggestion; `off`
 *  changes nothing. */
export type AutotuneMode = "auto" | "ask" | "off";

/** Whether a value is a non-null object (and not an array). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed `verdicts` value against the v2 invariants.
 *
 * Returns the typed array when the value is a non-empty `RunRoundVerdict[]`
 * with `length === rounds` and a sequence consistent with the run-level
 * `verdict`: a `pasa` run ends with exactly one `pasa` (last entry), a
 * `cap-reached` run contains no `pasa`. Returns `null` for any violation —
 * the caller drops the whole record rather than mis-attribute.
 */
function validateVerdicts(
  value: unknown,
  verdict: RunVerdict,
  rounds: number,
): RunRoundVerdict[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < 1) return null;
  if (value.length !== rounds) return null;

  const verdicts: RunRoundVerdict[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    if (!(ROUND_VERDICTS as readonly string[]).includes(entry)) return null;
    verdicts.push(entry as RunRoundVerdict);
  }

  const passCount = verdicts.filter((e) => e === "pasa").length;
  if (verdict === "pasa") {
    // Exactly one `pasa`, and it is the final entry.
    if (passCount !== 1) return null;
    if (verdicts[verdicts.length - 1] !== "pasa") return null;
  } else {
    // `cap-reached`: the run never passed.
    if (passCount !== 0) return null;
  }

  return verdicts;
}

/**
 * Parse one JSONL line into a `RunRecord`, validating the shape.
 *
 * Accepts both `v:1` records (no `verdicts`) and `v:2` records (a fully
 * validated per-round `verdicts` sequence). Returns `null` — never throws —
 * for anything off-shape: invalid JSON, a non-object, a `v` outside
 * `{1, 2}`, a missing/non-string `feature` or `ts`, a non-integer `rounds`, a
 * `verdict` outside the enum, a `phases` map missing any of the four phases
 * or carrying a non-string model, or — for `v:2` — a missing/non-array/
 * inconsistent `verdicts`. This is the deliberate defense against malformed
 * LLM-emitted records: a bad emission degrades to "one missing sample",
 * never a crash.
 */
export function parseRunLine(line: string): RunRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!isObject(parsed)) return null;

  if (parsed.v !== 1 && parsed.v !== 2) return null;
  if (typeof parsed.ts !== "string" || parsed.ts === "") return null;
  if (typeof parsed.feature !== "string" || parsed.feature === "") return null;
  if (typeof parsed.rounds !== "number" || !Number.isInteger(parsed.rounds)) return null;
  if (typeof parsed.verdict !== "string") return null;
  if (!(VERDICTS as readonly string[]).includes(parsed.verdict)) return null;
  const verdict = parsed.verdict as RunVerdict;

  if (!isObject(parsed.phases)) return null;
  const phases = {} as RunRecord["phases"];
  for (const phase of RECORD_PHASES) {
    const phaseRun = parsed.phases[phase];
    if (!isObject(phaseRun)) return null;
    if (typeof phaseRun.model !== "string" || phaseRun.model === "") return null;
    phases[phase] = { model: phaseRun.model };
  }

  // v2 records must carry a fully consistent `verdicts` sequence; v1 records
  // legitimately lack the field (the discriminator is `v`, not its presence).
  let verdicts: RunRoundVerdict[] | undefined;
  if (parsed.v === 2) {
    const validated = validateVerdicts(parsed.verdicts, verdict, parsed.rounds);
    if (validated === null) return null;
    verdicts = validated;
  }

  return {
    v: parsed.v,
    ts: parsed.ts,
    feature: parsed.feature,
    phases,
    verdict,
    rounds: parsed.rounds,
    ...(verdicts !== undefined ? { verdicts } : {}),
  };
}

/**
 * Drop duplicate run records by their `(feature, ts)` identity, keeping the
 * FIRST occurrence in input order.
 *
 * The `~/.pi/zero-runs.jsonl` log is a local cache of a shared run log: a
 * careless Cortex PULL can re-append a record already present (even a machine
 * re-pulling its own push), so the same `(feature, ts)` may appear more than
 * once. This pass collapses each identity to a single sample so `aggregate`
 * never counts a run twice.
 *
 * The identity key is `` `${feature}\0${ts}` `` — a NUL separator, which can
 * appear neither in a feature slug nor an ISO 8601 timestamp, so the two
 * fields can never collide ambiguously (`feature:"a-b", ts:"c"` vs
 * `feature:"a", ts:"b-c"` stay distinct). Identity is `(feature, ts)` alone,
 * independent of `v`/`verdicts` — v1 and v2 records dedupe identically.
 *
 * Keeping the FIRST occurrence is deterministic and stable under append: the
 * local PUSH writes a run's line before any later PULL can re-fetch it, so the
 * first copy is the one closest to the origin; and appending more duplicates
 * never changes which record survives. The kept set depends only on the
 * identities present, not on the count or order of duplicates. Pure and never
 * throws.
 */
export function dedupeRunRecords(records: RunRecord[]): RunRecord[] {
  const seen = new Set<string>();
  const out: RunRecord[] = [];
  for (const record of records) {
    const key = `${record.feature}\0${record.ts}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

/**
 * Read `~/.pi/zero-runs.jsonl` (or any path) into a list of valid `RunRecord`s.
 *
 * A missing or unreadable file yields `[]`. The file is split on `\n`; empty
 * lines are skipped, and any line `parseRunLine` rejects (a malformed or
 * half-written record) is dropped. The parsed records are then passed through
 * `dedupeRunRecords`, so the returned array is already de-duplicated by
 * `(feature, ts)` — the aggregation call site never sees a duplicate sample.
 * Never throws.
 */
export function readRunRecords(path: string): RunRecord[] {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return [];
  }

  const records: RunRecord[] = [];
  for (const line of contents.split("\n")) {
    if (line.trim() === "") continue;
    const record = parseRunLine(line);
    if (record !== null) records.push(record);
  }
  return dedupeRunRecords(records);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregated outcome statistics for one `(phase, model)` pair.
 */
export interface PhaseModelStat {
  /** SDD phase this stat is for. */
  phase: (typeof RECORD_PHASES)[number];
  /** Model id this stat is for. */
  model: string;
  /** Total runs recorded for the pair. */
  samples: number;
  /** Fraction of runs that reached `pasa` — `0` when `samples` is `0`. */
  passRate: number;
  /** Mean `rounds` averaged ONLY over runs that reached `pasa`; `null` when no
   *  `pasa` run exists for the pair. */
  avgRounds: number | null;
  // --- v2 phase attribution ---
  /** Count of `v:2` records contributing to this pair — the dormancy-gate
   *  denominator. v1 records do not increment this. */
  v2Samples: number;
  /** Mean count of `corregir` verdicts per v2 run for this pair — only
   *  meaningful for `phase === "build"`. `null` when `v2Samples === 0`. */
  avgCorregir: number | null;
  /** Mean count of `replantear` verdicts per v2 run for this pair — only
   *  meaningful for `phase === "plan"`. `null` when `v2Samples === 0`. */
  avgReplantear: number | null;
}

/** Map key for a `(phase, model)` bucket. */
function statKey(phase: string, model: string): string {
  return `${phase} ${model}`;
}

/**
 * Aggregate run records into per-`(phase, model)` statistics.
 *
 * For every record (v1 and v2 alike), each of the four phases contributes one
 * sample to the bucket of the model that phase ran on (a phase whose model is
 * missing or non-string is skipped). `avgRounds` is averaged exclusively over
 * runs that reached `pasa`; non-positive `rounds` values (which `parseRunLine`
 * does not reject) are ignored when computing that average so a bad
 * `0`/negative entry never skews or breaks the math.
 *
 * Only records carrying a `verdicts` sequence (v2) contribute phase
 * attribution: each such record increments `v2Samples` for every phase, and
 * folds its per-run `corregir` count into the `build` model's `avgCorregir`
 * accumulator and its per-run `replantear` count into the `plan` model's
 * `avgReplantear` accumulator. `avgCorregir`/`avgReplantear` are `null` when a
 * pair has no v2 evidence. An empty input yields an empty map.
 */
export function aggregate(records: RunRecord[]): Map<string, PhaseModelStat> {
  interface Acc {
    samples: number;
    passes: number;
    passRounds: number;
    passRoundCount: number;
    v2Samples: number;
    corregirTotal: number;
    replantearTotal: number;
  }
  const acc = new Map<string, { phase: (typeof RECORD_PHASES)[number]; model: string; data: Acc }>();

  for (const record of records) {
    const isPass = record.verdict === "pasa";
    const isV2 = record.verdicts !== undefined;
    const corregirCount = isV2
      ? (record.verdicts as RunRoundVerdict[]).filter((v) => v === "corregir").length
      : 0;
    const replantearCount = isV2
      ? (record.verdicts as RunRoundVerdict[]).filter((v) => v === "replantear").length
      : 0;

    for (const phase of RECORD_PHASES) {
      const phaseRun = record.phases[phase];
      const model = phaseRun?.model;
      if (typeof model !== "string" || model === "") continue;

      const key = statKey(phase, model);
      let bucket = acc.get(key);
      if (bucket === undefined) {
        bucket = {
          phase,
          model,
          data: {
            samples: 0,
            passes: 0,
            passRounds: 0,
            passRoundCount: 0,
            v2Samples: 0,
            corregirTotal: 0,
            replantearTotal: 0,
          },
        };
        acc.set(key, bucket);
      }
      bucket.data.samples += 1;
      if (isPass) {
        bucket.data.passes += 1;
        // Guard against non-positive `rounds`: a clean run is `>= 1`, so a
        // `0`/negative value is malformed and must not enter the average.
        if (typeof record.rounds === "number" && record.rounds > 0) {
          bucket.data.passRounds += record.rounds;
          bucket.data.passRoundCount += 1;
        }
      }
      if (isV2) {
        bucket.data.v2Samples += 1;
        // `corregir` blames the build phase's model, `replantear` the plan
        // phase's. The mapping is the pipeline contract, fixed and known.
        if (phase === "build") bucket.data.corregirTotal += corregirCount;
        if (phase === "plan") bucket.data.replantearTotal += replantearCount;
      }
    }
  }

  const stats = new Map<string, PhaseModelStat>();
  for (const [key, bucket] of acc) {
    const { samples, passes, passRounds, passRoundCount, v2Samples, corregirTotal, replantearTotal } =
      bucket.data;
    stats.set(key, {
      phase: bucket.phase,
      model: bucket.model,
      samples,
      passRate: samples > 0 ? passes / samples : 0,
      avgRounds: passRoundCount > 0 ? passRounds / passRoundCount : null,
      v2Samples,
      avgCorregir: v2Samples > 0 ? corregirTotal / v2Samples : null,
      avgReplantear: v2Samples > 0 ? replantearTotal / v2Samples : null,
    });
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Model tier ladder
// ---------------------------------------------------------------------------

/** Three Claude tiers, ordered `haiku < sonnet < opus`. */
const TIER = { haiku: 0, sonnet: 1, opus: 2 } as const;

/** A model's tier index, or `null` for an unrecognized (untierable) model. */
export type Tier = (typeof TIER)[keyof typeof TIER];

/** A single hardcoded representative model id per tier, used as the fallback
 *  step-up target when the user has no known model at the next tier. */
const TIER_REPRESENTATIVE: Record<Tier, string> = {
  [TIER.haiku]: "claude-haiku-4-5",
  [TIER.sonnet]: "claude-sonnet-4-6",
  [TIER.opus]: "claude-opus-4-8",
};

/**
 * Classify a model id into a tier by substring match — deliberate so future
 * point releases (`claude-sonnet-4-7`, etc.) classify with no code change.
 * Returns `null` for any id that is not recognizably haiku/sonnet/opus.
 */
export function tierOf(modelId: string): Tier | null {
  if (typeof modelId !== "string") return null;
  const id = modelId.toLowerCase();
  if (id.includes("haiku")) return TIER.haiku;
  if (id.includes("sonnet")) return TIER.sonnet;
  if (id.includes("opus")) return TIER.opus;
  return null;
}

/**
 * Step a model up exactly one tier.
 *
 * Among `knownModels` (the models the user already uses anywhere in their
 * `models` map) it picks one whose tier is exactly `tierOf(model) + 1`,
 * preferring deterministically the smallest id when several qualify. If the
 * user has no known model at the next tier, it falls back to the single
 * hardcoded representative for that tier. Never returns an arbitrary id, and
 * never steps more than one tier.
 *
 * Returns `null` when `model` is already at `opus` (no higher tier) or is
 * untierable (an unrecognized model id).
 */
export function stepUp(model: string, knownModels: readonly string[]): string | null {
  const tier = tierOf(model);
  if (tier === null) return null;
  if (tier === TIER.opus) return null;

  const nextTier = (tier + 1) as Tier;

  const candidates = knownModels
    .filter((m) => typeof m === "string" && tierOf(m) === nextTier)
    .sort();
  if (candidates.length > 0) return candidates[0];

  return TIER_REPRESENTATIVE[nextTier];
}

// ---------------------------------------------------------------------------
// Adjustment rules
// ---------------------------------------------------------------------------

/** Below this many samples a `(phase, model)` pair is ignored — too little
 *  evidence to act on (AC 5.1). */
export const MIN_SAMPLES = 5;

/** Pass-rate at or under this value marks a phase as under-performing. */
export const LOW_PASS_RATE = 0.6;

/** Average rounds-to-pass over this value marks a phase as struggling. */
export const HIGH_AVG_ROUNDS = 2.5;

/** Pass-rate at or over this value marks a phase as reliable — stay put. */
export const RELIABLE_PASS_RATE = 0.85;

/** Below this many `v:2` records a phase is left dormant — too little
 *  attributed evidence to act on (Story 7). Reuses v1's `MIN_SAMPLES` value. */
export const MIN_V2_SAMPLES = 5;

/** Mean `corregir`/run strictly above this value blames the `build` model. */
export const HIGH_AVG_CORREGIR = 1.0;

/** Mean `replantear`/run strictly above this value blames the `plan` model.
 *  Lower than `HIGH_AVG_CORREGIR` because a `replantear` is rarer and costlier. */
export const HIGH_AVG_REPLANTEAR = 0.5;

/**
 * A proposed change of model for one SDD phase. `reason` is a human-readable
 * string used verbatim in notifications.
 */
export interface Adjustment {
  /** SDD phase the change applies to. */
  phase: (typeof RECORD_PHASES)[number];
  /** Model the phase currently runs on. */
  from: string;
  /** Model the phase is proposed to move to (always one tier above `from`). */
  to: string;
  /** Human-readable justification, e.g. `"pass-rate 0.40 over 7 runs"`. */
  reason: string;
}

/** The phases v2 autotune can attribute blame to and adjust. `explore` and
 *  `veredicto` are structurally excluded — no round verdict ever blames them. */
const ATTRIBUTABLE_PHASES = ["build", "plan"] as const;

/**
 * Decide model adjustments from aggregated statistics — v2 phase-attributed.
 *
 * Only the `build` and `plan` phases are considered: a `corregir` verdict
 * re-runs build and a `replantear` verdict re-runs plan, so those are the only
 * phases the verdict sequence can blame. `explore` and `veredicto` are
 * structurally never iterated and so never adjusted (Story 6).
 *
 * For each attributable phase, looks up the `(phase, currentModel)` stat and:
 *   - skips an absent stat;
 *   - skips a phase with `v2Samples < MIN_V2_SAMPLES` — too little attributed
 *     evidence (the dormancy gate, Story 7);
 *   - reads the phase's blame measure (`build` → `avgCorregir` vs
 *     `HIGH_AVG_CORREGIR`, `plan` → `avgReplantear` vs `HIGH_AVG_REPLANTEAR`)
 *     and skips when it is `null` or not strictly above its threshold;
 *   - otherwise proposes one tier up via `stepUp`.
 *
 * Safety caps are baked in: a proposal is emitted only when `stepUp` returns a
 * model (so a phase already at `opus` or on an untierable model is left
 * alone), `stepUp` never jumps more than one tier, and it never returns a
 * model outside `knownModels`-or-the-fixed-representative set. v1's
 * `LOW_PASS_RATE`/`HIGH_AVG_ROUNDS`/`RELIABLE_PASS_RATE` constants remain
 * exported but no longer drive this function.
 */
export function decideAdjustments(
  stats: Map<string, PhaseModelStat>,
  currentModels: Partial<Record<(typeof RECORD_PHASES)[number], string>>,
  knownModels: readonly string[],
): Adjustment[] {
  const adjustments: Adjustment[] = [];

  for (const phase of ATTRIBUTABLE_PHASES) {
    const currentModel = currentModels[phase];
    if (typeof currentModel !== "string" || currentModel === "") continue;

    const stat = stats.get(statKey(phase, currentModel));
    if (stat === undefined) continue;

    // Dormancy gate: too few v2 records to attribute blame.
    if (stat.v2Samples < MIN_V2_SAMPLES) continue;

    const measure = phase === "build" ? stat.avgCorregir : stat.avgReplantear;
    const threshold = phase === "build" ? HIGH_AVG_CORREGIR : HIGH_AVG_REPLANTEAR;
    if (measure === null || !(measure > threshold)) continue;

    const to = stepUp(currentModel, knownModels);
    if (to === null) continue; // already at top tier, or untierable

    const blame = phase === "build" ? "corregir" : "replantear";
    const reason = `prom ${measure.toFixed(1)} ${blame}/run en ${stat.v2Samples} runs v2`;

    adjustments.push({ phase, from: currentModel, to, reason });
  }

  return adjustments;
}

// ---------------------------------------------------------------------------
// Autotune mode
// ---------------------------------------------------------------------------

/** The valid stored values of the `autotune` key, used for membership checks. */
const AUTOTUNE_MODES = ["auto", "ask", "off"] as const;

/**
 * Read the `autotune` mode out of a parsed `~/.pi/zero.json` object.
 *
 * Returns the stored value only when it is exactly `"auto"`, `"ask"`, or
 * `"off"`. A missing key, a non-string value, or any other string degrades to
 * the safe default `"auto"` — never throws. This is the single point of truth
 * for "absent ⇒ auto" (AC 3.2).
 */
export function readAutotuneMode(data: Record<string, unknown>): AutotuneMode {
  const value = data.autotune;
  if (typeof value === "string" && (AUTOTUNE_MODES as readonly string[]).includes(value)) {
    return value as AutotuneMode;
  }
  return "auto";
}
