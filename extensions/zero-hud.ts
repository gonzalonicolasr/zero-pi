// zero-pi — ZERO HUD statusline.
//
// A segmented footer inspired by omp's status-line presets, adapted to ZERO SDD:
// phase-aware, cost-aware, compact by default, and fully defensive. This
// replaces the older one-piece `zero-statusline` package extension while keeping
// that file around for backwards-compatible imports/tests.
//
// Runtime controls:
//   ZERO_HUD_PRESET=compact|minimal|full|ascii|off
//   /zero-hud compact|minimal|full|ascii|off|on|preview

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

type RGB = [number, number, number];
type HudPreset = "minimal" | "compact" | "full" | "ascii" | "off";
type Phase = "clarify" | "explore" | "plan" | "analyze" | "build" | "veredicto" | "forge";

const CORAL: RGB = [255, 124, 92];
const GOLD: RGB = [255, 214, 130];
const PEACH: RGB = [255, 168, 99];
const ROSE: RGB = [255, 106, 122];
const ORCHID: RGB = [176, 106, 179];
const MINT: RGB = [79, 221, 171];
const AMBER: RGB = [238, 190, 92];
const SKY: RGB = [109, 184, 230];
const STEEL: RGB = [176, 152, 142];
const DIM: RGB = [120, 104, 98];

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const STATUS_ID = "zero-hud";
const BRAND = "ZERO";

function fg([r, g, b]: RGB, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

function plain(text: string): string {
  return text.replace(ANSI_RE, "");
}

function dim(text: string): string {
  return fg(DIM, text);
}

function phaseColor(phase: Phase | undefined): RGB {
  switch (phase) {
    case "clarify": return GOLD;
    case "explore": return SKY;
    case "plan": return PEACH;
    case "analyze": return ORCHID;
    case "build": return CORAL;
    case "veredicto": return MINT;
    case "forge": return GOLD;
    default: return DIM;
  }
}

export function normalizePreset(value: string | undefined): HudPreset | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "minimal" || raw === "compact" || raw === "full" || raw === "ascii" || raw === "off") return raw;
  if (raw === "on") return "compact";
  return raw === "" ? null : null;
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return `${Math.floor(n)}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatUsd(n: number | undefined): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function ctxColor(percent: number): RGB {
  if (!Number.isFinite(percent) || percent < 50) return MINT;
  if (percent < 80) return AMBER;
  return ROSE;
}

export function shortModel(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const slash = id.lastIndexOf("/");
  const bare = slash >= 0 ? id.slice(slash + 1) : id;
  return bare || undefined;
}

function shortBranch(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length <= 24 ? value : `…${value.slice(-23)}`;
}

export interface SessionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

interface PiSessionEntry {
  type?: string;
  message?: {
    role?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      cost?: number | { total?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    };
  };
}
interface PiSessionManager {
  getEntries?(): PiSessionEntry[];
}

function positive(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

function usageCost(usage: PiSessionEntry["message"] extends infer M ? M extends { usage?: infer U } ? U : never : never): number {
  if (!usage || typeof usage !== "object") return 0;
  const cost = (usage as { cost?: unknown }).cost;
  if (typeof cost === "number") return positive(cost);
  if (cost && typeof cost === "object") {
    const c = cost as { total?: unknown; input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown };
    return positive(c.total) || positive(c.input) + positive(c.output) + positive(c.cacheRead) + positive(c.cacheWrite);
  }
  return 0;
}

export function computeSessionUsage(sessionManager: PiSessionManager | undefined): SessionUsage {
  const totals: SessionUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
  if (!sessionManager || typeof sessionManager.getEntries !== "function") return totals;
  try {
    for (const entry of sessionManager.getEntries()) {
      if (entry?.type !== "message") continue;
      if (entry.message?.role !== "assistant") continue;
      const u = entry.message.usage;
      if (!u) continue;
      totals.input += positive(u.input);
      totals.output += positive(u.output);
      totals.cacheRead += positive(u.cacheRead);
      totals.cacheWrite += positive(u.cacheWrite);
      totals.costUsd += usageCost(u);
    }
  } catch {
    // Return what we collected so far.
  }
  totals.costUsd = Math.round((totals.costUsd + Number.EPSILON) * 1_000_000) / 1_000_000;
  return totals;
}

const SDD_AGENT_TO_PHASE: Record<string, Phase> = {
  "zero-clarify": "clarify",
  "zero-explore": "explore",
  "zero-plan": "plan",
  "zero-analyze": "analyze",
  "zero-build": "build",
  "zero-veredicto": "veredicto",
};

export function phaseFromSubagentArgs(args: unknown): Phase | undefined {
  const names = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) names.add(value.trim());
  };
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    collect(record.agent);
    for (const key of ["chain", "tasks", "parallel"] as const) {
      const list = record[key];
      if (Array.isArray(list)) for (const item of list) walk(item);
    }
  };
  walk(args);
  for (const name of names) {
    const key = name.toLowerCase().split(".").pop() ?? name.toLowerCase();
    if (SDD_AGENT_TO_PHASE[key]) return SDD_AGENT_TO_PHASE[key];
  }
  return undefined;
}

export function phaseFromInput(text: string): Phase | undefined {
  return /\/forge\b|\bforge\b|zero[\s-]?sdd|\bsdd\b/i.test(text ?? "") ? "forge" : undefined;
}

export interface HudParts {
  phase?: Phase;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  costUsd?: number;
  diffAdded?: number;
  diffRemoved?: number;
  ctxPercent?: number;
  branch?: string;
  preset?: HudPreset;
}

function separator(preset: HudPreset): string {
  if (preset === "ascii") return dim(" | ");
  if (preset === "minimal") return dim(" / ");
  return dim(" ▸ ");
}

function segment(label: string, value: string, color: RGB, preset: HudPreset): string {
  if (preset === "ascii") return `${label}:${plain(value)}`;
  return `${dim(label)} ${fg(color, value)}`;
}

export function composeHud(parts: HudParts): string {
  const preset = parts.preset ?? "compact";
  if (preset === "off") return "";

  const out: string[] = [];
  const sep = separator(preset);

  if (preset !== "minimal") {
    out.push(preset === "ascii" ? BRAND : fg(GOLD, BRAND));
  }

  if (parts.phase) {
    const value = preset === "ascii" ? parts.phase : `◆ ${parts.phase}`;
    out.push(segment("phase", value, phaseColor(parts.phase), preset));
  }

  if (parts.model && preset !== "minimal") {
    out.push(fg(CORAL, parts.model));
  }

  if (parts.tokensIn != null || parts.tokensOut != null) {
    const tokenText = `↑${formatTokenCount(parts.tokensIn ?? 0)} ↓${formatTokenCount(parts.tokensOut ?? 0)}`;
    out.push(segment("tok", tokenText, PEACH, preset));
  }

  if (preset === "full" && parts.cacheRead && parts.cacheRead > 0) {
    out.push(segment("cache", `↺${formatTokenCount(parts.cacheRead)}`, SKY, preset));
  }

  const cost = formatUsd(parts.costUsd);
  if (cost && preset !== "minimal") {
    out.push(segment("cost", cost, ORCHID, preset));
  }

  if (parts.diffAdded != null || parts.diffRemoved != null) {
    const diff = `+${parts.diffAdded ?? 0}/-${parts.diffRemoved ?? 0}`;
    out.push(segment("diff", diff, (parts.diffAdded ?? 0) || (parts.diffRemoved ?? 0) ? MINT : DIM, preset));
  }

  if (parts.ctxPercent != null && Number.isFinite(parts.ctxPercent)) {
    out.push(segment("ctx", `${Math.round(parts.ctxPercent)}%`, ctxColor(parts.ctxPercent), preset));
  }

  const branch = shortBranch(parts.branch);
  if (branch && preset !== "minimal") {
    out.push(segment("git", branch, STEEL, preset));
  }

  return out.join(sep);
}

interface PiUI {
  setStatus(id: string, text: string | undefined): void;
  notify?(message: string, level?: "info" | "warning" | "error"): void;
}
interface PiModel {
  id?: string;
  name?: string;
  contextWindow?: number;
}
interface PiCtx {
  ui?: PiUI;
  model?: PiModel;
  cwd?: string;
  sessionManager?: PiSessionManager;
  getContextUsage?(): { tokens?: number } | null | undefined;
}
interface PiAPI {
  on(event: string, handler: (event: unknown, ctx: PiCtx) => void): void;
  registerCommand?(name: string, options: { description: string; handler: (args: string, ctx: PiCtx) => unknown }): void;
}

let branch: string | undefined;
let added = 0;
let removed = 0;
let lastCtx: PiCtx | undefined;
let gitInFlight = false;
let preset: HudPreset = normalizePreset(process.env.ZERO_HUD_PRESET) ?? "compact";
let activePhase: Phase | undefined;

function resetSessionState(): void {
  branch = undefined;
  added = 0;
  removed = 0;
  activePhase = undefined;
}

async function readGit(cwdHint: string | undefined): Promise<void> {
  const cwd = cwdHint || process.cwd();
  if (!cwd || gitInFlight) return;
  gitInFlight = true;
  try {
    try {
      const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd, timeout: 1500, windowsHide: true });
      branch = stdout.trim() || undefined;
    } catch {
      branch = undefined;
    }
    try {
      const { stdout } = await execAsync("git diff --shortstat", { cwd, timeout: 1500, windowsHide: true });
      const ins = stdout.match(/(\d+)\s+insertions?\(\+\)/);
      const del = stdout.match(/(\d+)\s+deletions?\(-\)/);
      added = ins ? parseInt(ins[1], 10) : 0;
      removed = del ? parseInt(del[1], 10) : 0;
    } catch {
      added = 0;
      removed = 0;
    }
  } finally {
    gitInFlight = false;
  }
}

function render(ctx: PiCtx): void {
  try {
    if (!ctx?.ui || typeof ctx.ui.setStatus !== "function") return;
    if (preset === "off") {
      ctx.ui.setStatus(STATUS_ID, undefined);
      return;
    }
    const window = ctx.model?.contextWindow && ctx.model.contextWindow > 0 ? ctx.model.contextWindow : 200_000;
    const used = ctx.getContextUsage?.()?.tokens;
    const ctxPercent = typeof used === "number" && used >= 0 ? Math.min(100, (used / window) * 100) : undefined;
    const usage = computeSessionUsage(ctx.sessionManager);
    const text = composeHud({
      preset,
      phase: activePhase,
      model: shortModel(ctx.model?.id ?? ctx.model?.name),
      tokensIn: usage.input,
      tokensOut: usage.output,
      cacheRead: usage.cacheRead,
      costUsd: usage.costUsd,
      diffAdded: added,
      diffRemoved: removed,
      ctxPercent,
      branch,
    });
    ctx.ui.setStatus(STATUS_ID, text || undefined);
  } catch {
    // HUD failures must never break a pi session.
  }
}

function preview(nextPreset: HudPreset): string {
  return plain(composeHud({
    preset: nextPreset,
    phase: "build",
    model: "claude-opus-4-7",
    tokensIn: 128_400,
    tokensOut: 8_120,
    cacheRead: 512_000,
    costUsd: 0.042,
    diffAdded: 120,
    diffRemoved: 8,
    ctxPercent: 42,
    branch: "sdd/zero-hud",
  }));
}

export default function register(pi?: unknown): void {
  try {
    if (!pi || typeof (pi as PiAPI).on !== "function") return;
    const api = pi as PiAPI;

    api.registerCommand?.("zero-hud", {
      description: "Preview or switch the ZERO HUD footer (minimal|compact|full|ascii|off|on|preview).",
      handler: (args, ctx) => {
        const raw = (args ?? "").trim().toLowerCase();
        const next = raw === "preview" || raw === "" ? preset : normalizePreset(raw);
        if (!next) {
          ctx.ui?.notify?.("Uso: /zero-hud minimal|compact|full|ascii|off|on|preview", "warning");
          return;
        }
        if (raw !== "preview" && raw !== "") preset = next;
        render(ctx);
        ctx.ui?.notify?.(`ZERO HUD ${raw === "preview" || raw === "" ? "preview" : "preset"}: ${next}\n${preview(next)}`, "info");
      },
    });

    api.on("session_start", (_event, ctx) => {
      lastCtx = ctx;
      resetSessionState();
      render(ctx);
      void readGit(ctx?.cwd).then(() => render(ctx));
    });

    api.on("input", (event, ctx) => {
      lastCtx = ctx;
      const phase = phaseFromInput((event as { text?: string })?.text ?? "");
      if (phase) activePhase = phase;
      render(ctx);
    });

    api.on("model_select", (_event, ctx) => {
      lastCtx = ctx;
      render(ctx);
    });

    api.on("message_update", (_event, ctx) => {
      lastCtx = ctx;
      render(ctx);
    });

    api.on("tool_execution_start", (event, ctx) => {
      lastCtx = ctx;
      const e = event as { toolName?: string; args?: unknown };
      const phase = /subagent|task/i.test(e.toolName ?? "") ? phaseFromSubagentArgs(e.args) : undefined;
      if (phase) activePhase = phase;
      render(ctx);
    });

    api.on("tool_execution_end", (_event, ctx) => {
      lastCtx = ctx;
      void readGit(ctx?.cwd).then(() => render(ctx));
    });

    api.on("agent_end", (_event, ctx) => {
      lastCtx = ctx;
      render(ctx);
    });

    api.on("session_shutdown", () => {
      try {
        lastCtx?.ui?.setStatus?.(STATUS_ID, undefined);
      } catch {
        // ignore
      }
    });
  } catch {
    // Registration itself must never break a pi session.
  }
}
