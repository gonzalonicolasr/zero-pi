// zero-pi — per-run cost/usage report, pure-logic module.
//
// A `/forge` run delegates each phase to a sub-agent that writes a
// `*_meta.json` under `~/.pi/agent/sessions/<session>/subagent-artifacts/`
// carrying real `usage` (tokens + cost), `model`, `durationMs` and
// `toolCount`. `~/.pi/zero-runs.jsonl` records the verdict/rounds/model but
// never cost — so there is no aggregate view of what a run cost, by phase.
//
// This module turns those raw meta records into a per-phase + total report.
// Every decision (phase mapping, slug extraction, selection, aggregation,
// formatting) lives here as plain, dependency-free TypeScript so it is
// testable in isolation. The pi wiring lives in `zero-cost-extension.ts`.

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
  cost: number;
  turns: number;
}

/** One normalized sub-agent `meta.json` belonging to a phase. */
export interface PhaseMeta {
  runId: string;
  phase: CostPhase;
  /** Feature slug extracted from the sub-agent task, or `null`. */
  slug: string | null;
  model: string;
  usage: PhaseUsage;
  durationMs: number;
  toolCount: number;
  /** Epoch ms the meta was written (newest wins for selection/model). */
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

/** The aggregated cost of a whole run. */
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

/** Extract the feature slug from the first `.sdd/<slug>/` in a task string.
 *  The internal `specs` and `archive` directories are never slugs. */
export function extractSlug(task: unknown): string | null {
  if (typeof task !== "string") return null;
  const re = /\.sdd\/([A-Za-z0-9._-]+)\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(task)) !== null) {
    const slug = m[1];
    if (slug && slug !== "specs" && slug !== "archive") return slug;
  }
  const label = /(?:^|\n)\s*Slug:\s*([A-Za-z0-9._-]+)/i.exec(task);
  const slug = label?.[1];
  return slug && slug !== "specs" && slug !== "archive" ? slug : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function asUsage(raw: unknown): PhaseUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  // A usage object must carry at least the token fields as numbers.
  if (typeof u.input !== "number" && typeof u.output !== "number") return null;
  return {
    input: num(u.input),
    output: num(u.output),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    cost: num(u.cost),
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
    slug: extractSlug(r.task),
    model: typeof r.model === "string" ? r.model : "",
    usage,
    durationMs: num(r.durationMs),
    toolCount: num(r.toolCount),
    timestamp: num(r.timestamp),
  };
}

/** Select the phase-metas for one run: the given slug, or — by default — the
 *  slug whose newest meta has the greatest timestamp. Slug-less metas are
 *  ignored for the default pick. */
export function selectRunMetas(metas: readonly PhaseMeta[], slug?: string | null): PhaseMeta[] {
  if (slug) return metas.filter((m) => m.slug === slug);
  let bestSlug: string | null = null;
  let bestTs = -Infinity;
  for (const m of metas) {
    if (m.slug && m.timestamp > bestTs) {
      bestTs = m.timestamp;
      bestSlug = m.slug;
    }
  }
  if (bestSlug === null) return [];
  return metas.filter((m) => m.slug === bestSlug);
}

/** Aggregate selected phase-metas into per-phase rows (pipeline order) plus a
 *  run total. A phase that ran multiple sub-agents sums them; its model is the
 *  newest meta's model. */
export function aggregateRun(metas: readonly PhaseMeta[], slug: string | null): RunCost {
  const byPhase = new Map<CostPhase, PhaseAggregate & { _modelTs: number }>();
  for (const m of metas) {
    let agg = byPhase.get(m.phase);
    if (!agg) {
      agg = {
        phase: m.phase,
        model: m.model,
        subAgents: 0,
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0,
        durationMs: 0, toolCount: 0,
        _modelTs: -Infinity,
      };
      byPhase.set(m.phase, agg);
    }
    agg.subAgents += 1;
    agg.input += m.usage.input;
    agg.output += m.usage.output;
    agg.cacheRead += m.usage.cacheRead;
    agg.cacheWrite += m.usage.cacheWrite;
    agg.cost += m.usage.cost;
    agg.turns += m.usage.turns;
    agg.durationMs += m.durationMs;
    agg.toolCount += m.toolCount;
    if (m.timestamp >= agg._modelTs) {
      agg._modelTs = m.timestamp;
      agg.model = m.model;
    }
  }
  const phases = [...byPhase.values()]
    .sort((a, b) => PHASE_INDEX[a.phase] - PHASE_INDEX[b.phase])
    .map(({ _modelTs, ...row }) => row);

  const total = phases.reduce(
    (t, p) => {
      t.input += p.input; t.output += p.output; t.cacheRead += p.cacheRead;
      t.cacheWrite += p.cacheWrite; t.cost += p.cost; t.turns += p.turns;
      t.durationMs += p.durationMs; t.toolCount += p.toolCount; t.subAgents += p.subAgents;
      return t;
    },
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0, durationMs: 0, toolCount: 0, subAgents: 0 },
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
export function formatUsd(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  return `$${safe.toFixed(2)}`;
}

/** Render an aligned per-phase + total report. */
export function formatReport(run: RunCost): string {
  if (run.phases.length === 0) return "zero-cost: no encontré datos de costo para ese run.";
  const head = `zero-cost: ${run.slug ?? "(run reciente)"}`;
  const cols = `fase       sub  in      out     cache    tools  dur     costo`;
  const lines = [head, cols];
  const row = (
    label: string, subs: string, inn: number, out: number, cache: number,
    tools: number, dur: number, cost: number,
  ): string =>
    `${label.padEnd(10)} ${subs.padStart(3)}  ${formatTokens(inn).padStart(6)}  ${formatTokens(out).padStart(6)}  ${formatTokens(cache).padStart(7)}  ${String(tools).padStart(5)}  ${formatDuration(dur).padStart(6)}  ${formatUsd(cost).padStart(7)}`;
  for (const p of run.phases) {
    lines.push(row(p.phase, String(p.subAgents), p.input, p.output, p.cacheRead, p.toolCount, p.durationMs, p.cost));
  }
  const t = run.total;
  lines.push(row("TOTAL", String(t.subAgents), t.input, t.output, t.cacheRead, t.toolCount, t.durationMs, t.cost));
  return lines.join("\n");
}
