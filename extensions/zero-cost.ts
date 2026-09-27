// Child usage normalization and reporting. Execution attribution belongs to
// zero-execution.ts, never prompt text or a cross-project artifact scan.

import { formatTokens } from "./format-tokens.ts";

/** The SDD phases a run is composed of, in pipeline order — the `clarify` and
 *  `analyze` gate sub-agents write cost meta like any other phase. */
export const COST_PHASES = ["clarify", "explore", "plan", "analyze", "build", "veredicto"] as const;
export type CostPhase = (typeof COST_PHASES)[number];

/** Token + cost usage of a single sub-agent run. */
export interface PhaseUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
  turns: number;
}

/** One normalized sub-agent `meta.json` belonging to a phase. */
export interface PhaseMeta {
  runId: string;
  phase: CostPhase;
  /** Always null for runtime metadata; execution ledger supplies the report label. */
  slug: string | null;
  model: string;
  usage: PhaseUsage;
  durationMs: number;
  toolCount: number;
  /** Epoch ms the runtime metadata was written. */
  timestamp: number;
}

/** One phase row: summed usage of every sub-agent that ran that phase. */
export interface PhaseAggregate extends PhaseUsage {
  phase: CostPhase;
  model: string;
  subAgents: number;
  durationMs: number;
  toolCount: number;
}

/** Aggregated registered child usage, not whole-Forge/parent cost. */
export interface RunCost {
  slug: string | null;
  phases: PhaseAggregate[];
  total: PhaseUsage & { durationMs: number; toolCount: number; subAgents: number };
}

const PHASE_INDEX: Record<CostPhase, number> = { clarify: 0, explore: 1, plan: 2, analyze: 3, build: 4, veredicto: 5 };

/** Map a sub-agent name `zero-<phase>` to its phase, or `null`. */
export function phaseFromAgent(agent: unknown): CostPhase | null {
  if (typeof agent !== "string") return null;
  const m = /^zero-(clarify|explore|plan|analyze|build|veredicto)$/.exec(agent);
  return m ? (m[1] as CostPhase) : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function asUsage(raw: unknown): PhaseUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  // Installed runtime always emits all token classes. Missing/invalid classes
  // are incomplete metadata, not proof of zero consumption.
  if (!["input", "output", "cacheRead", "cacheWrite", "turns"].every(k => typeof u[k] === "number" && Number.isFinite(u[k]) && (u[k] as number) >= 0)) return null;
  return {
    input: num(u.input),
    output: num(u.output),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    cost: typeof u.cost === "number" && Number.isFinite(u.cost) && u.cost >= 0 ? u.cost : null,
    turns: num(u.turns),
  };
}

/** Parse one raw `meta.json` object into a `PhaseMeta`, or `null` if it is not
 *  a zero-<phase> sub-agent or lacks a usage object. */
export function parseMeta(raw: unknown): PhaseMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const phase = phaseFromAgent(r.agent);
  if (!phase) return null;
  const usage = asUsage(r.usage);
  if (!usage) return null;
  return {
    runId: typeof r.runId === "string" ? r.runId : "",
    phase,
    slug: null,
    model: typeof r.model === "string" ? r.model : "",
    usage,
    durationMs: num(r.durationMs),
    toolCount: num(r.toolCount),
    timestamp: num(r.timestamp),
  };
}

/** Aggregate selected phase-metas into per-phase rows (pipeline order) plus a
 *  run total. A phase that ran multiple sub-agents sums them; its model is the
 *  union of reported models. */
export function aggregateRun(metas: readonly PhaseMeta[], slug: string | null): RunCost {
  const byPhase = new Map<CostPhase, PhaseAggregate>();
  for (const m of metas) {
    let agg = byPhase.get(m.phase);
    if (!agg) {
      agg = {
        phase: m.phase,
        model: m.model,
        subAgents: 0,
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0,
        durationMs: 0, toolCount: 0,
      };
      byPhase.set(m.phase, agg);
    }
    agg.subAgents += 1;
    agg.input += m.usage.input;
    agg.output += m.usage.output;
    agg.cacheRead += m.usage.cacheRead;
    agg.cacheWrite += m.usage.cacheWrite;
    agg.cost = agg.cost === null || m.usage.cost === null ? null : agg.cost + m.usage.cost;
    agg.turns += m.usage.turns;
    agg.durationMs += m.durationMs;
    agg.toolCount += m.toolCount;
    agg.model = [...new Set([...agg.model.split(", "), m.model])].filter(Boolean).join(", ");
  }
  const phases = [...byPhase.values()]
    .sort((a, b) => PHASE_INDEX[a.phase] - PHASE_INDEX[b.phase]);

  const total = phases.reduce(
    (t, p) => {
      t.input += p.input; t.output += p.output; t.cacheRead += p.cacheRead;
      t.cacheWrite += p.cacheWrite; t.cost = t.cost === null || p.cost === null ? null : t.cost + p.cost; t.turns += p.turns;
      t.durationMs += p.durationMs; t.toolCount += p.toolCount; t.subAgents += p.subAgents;
      return t;
    },
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 as number | null, turns: 0, durationMs: 0, toolCount: 0, subAgents: 0 },
  );

  return { slug, phases, total };
}

/** Human-readable duration: `12s`, `5m31s`. */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSec = Math.round(safe / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m${sec.toString().padStart(2, "0")}s` : `${sec}s`;
}

/** USD with two decimals: `$2.48`. */
export function formatUsd(n: number | null): string {
  if (n === null) return "unknown";
  const safe = Number.isFinite(n) ? n : 0;
  return `$${safe.toFixed(2)}`;
}

/** Render an aligned per-phase + total report. */
export function formatReport(run: RunCost): string {
  if (run.phases.length === 0) return "zero-cost: no encontré datos de costo para ese run.";
  const head = `zero-cost: ${run.slug ?? "(run reciente)"}`;
  // Header and cells share this one padding contract so they cannot drift apart.
  const row = (
    label: string, subs: string, inn: string, out: string, cache: string, cacheWrite: string,
    tools: string, dur: string, cost: string,
  ): string =>
    `${label.padEnd(10)} ${subs.padStart(3)}  ${inn.padStart(6)}  ${out.padStart(6)}  ${cache.padStart(9)}  ${cacheWrite.padStart(10)}  ${tools.padStart(5)}  ${dur.padStart(6)}  ${cost.padStart(7)}`;
  const data = (
    label: string, subs: number, inn: number, out: number, cache: number, cacheWrite: number,
    tools: number, dur: number, cost: number | null,
  ): string =>
    row(label, String(subs), formatTokens(inn), formatTokens(out), formatTokens(cache), formatTokens(cacheWrite), String(tools), formatDuration(dur), formatUsd(cost));
  const lines = [head, `${row("fase", "sub", "in", "out", "cacheRead", "cacheWrite", "tools", "dur", "costo")} reportado`];
  for (const p of run.phases) {
    lines.push(data(p.phase, p.subAgents, p.input, p.output, p.cacheRead, p.cacheWrite, p.toolCount, p.durationMs, p.cost));
  }
  const t = run.total;
  lines.push(data("TOTAL", t.subAgents, t.input, t.output, t.cacheRead, t.cacheWrite, t.toolCount, t.durationMs, t.cost));
  lines.push("Solo hijos registrados; no incluye padre, compacciones ni total Forge. Duración = suma de hijos, no tiempo de pared.", "USD reportado por runtime/proveedor; $0.00 no implica tokens/cuota gratis. unknown = costo no reportado.");
  for (const p of run.phases) lines.push(`${p.phase} modelos reportados: ${p.model || "unknown"}`);
  return lines.join("\n");
}
