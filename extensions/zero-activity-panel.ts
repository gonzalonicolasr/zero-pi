// zero-pi — live activity panel for /forge progress and recent tool cards.
//
// This extension uses pi's public widget API (ctx.ui.setWidget) to render a
// compact panel above the input while the agent works. It intentionally avoids
// replacing pi's built-in tool renderer: the panel is a live dashboard, not a
// second source of truth.

interface Ctx {
  ui?: {
    setWidget?: (key: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }) => void;
  };
}

interface PiAPI {
  on(event: string, handler: (event: unknown, ctx: Ctx) => unknown): void;
}

export const PHASES = ["clarify", "explore", "plan", "analyze", "build", "veredicto"] as const;
export type Phase = (typeof PHASES)[number];
export type PhaseState = "pending" | "active" | "done" | "error";
export type ToolState = "running" | "ok" | "error";

export interface ToolCard {
  id: string;
  name: string;
  label: string;
  state: ToolState;
}

export interface ActivityState {
  sddActive: boolean;
  phases: Record<Phase, PhaseState>;
  tools: ToolCard[];
}

const WIDGET_ID = "zero-activity-panel";
const MAX_TOOLS = 5;

const PHASE_FROM_AGENT: Record<string, Phase> = {
  "zero-clarify": "clarify",
  "zero-explore": "explore",
  "zero-plan": "plan",
  "zero-analyze": "analyze",
  "zero-build": "build",
  "zero-veredicto": "veredicto",
};

function esc(code: string, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

const color = {
  dim: (s: string) => esc("38;2;112;99;88", s),
  muted: (s: string) => esc("38;2;184;155;120", s),
  gold: (s: string) => esc("38;2;246;184;90", s),
  coral: (s: string) => esc("38;2;255;107;95", s),
  green: (s: string) => esc("38;2;0;255;138", s),
  cyan: (s: string) => esc("38;2;0;215;255", s),
  magenta: (s: string) => esc("38;2;216;107;255", s),
  red: (s: string) => esc("38;2;255;79;123", s),
};

export function createActivityState(): ActivityState {
  return {
    sddActive: false,
    phases: Object.fromEntries(PHASES.map((phase) => [phase, "pending"])) as Record<Phase, PhaseState>,
    tools: [],
  };
}

export function isForgeInput(text: string): boolean {
  return /(?:^|\s)\/forge\b|\bzero[\s-]?sdd\b|\bsdd\b/i.test(text ?? "");
}

function collectAgents(args: unknown, out = new Set<string>()): Set<string> {
  if (!args || typeof args !== "object") return out;
  const a = args as Record<string, unknown>;
  if (typeof a.agent === "string") out.add(a.agent);
  for (const key of ["chain", "tasks"] as const) {
    const list = a[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.agent === "string") out.add(e.agent);
      const parallel = e.parallel;
      if (Array.isArray(parallel)) {
        for (const p of parallel) collectAgents(p, out);
      }
    }
  }
  return out;
}

export function phaseFromSubagentArgs(args: unknown): Phase | undefined {
  for (const name of collectAgents(args)) {
    const key = name.toLowerCase().split(".").pop() ?? name.toLowerCase();
    const phase = PHASE_FROM_AGENT[key];
    if (phase) return phase;
  }
  return undefined;
}

export function markPhaseActive(state: ActivityState, phase: Phase): void {
  state.sddActive = true;
  const activeIndex = PHASES.indexOf(phase);
  for (const [index, name] of PHASES.entries()) {
    if (index < activeIndex && state.phases[name] === "pending") state.phases[name] = "done";
    if (name === phase) state.phases[name] = "active";
  }
}

export function finishActivePhase(state: ActivityState, failed: boolean): void {
  const active = PHASES.find((phase) => state.phases[phase] === "active");
  if (!active) return;
  state.phases[active] = failed ? "error" : "done";
}

export function toolLabel(toolName: string, args?: unknown): string {
  const name = (toolName || "tool").split(/[._-]/)[0] || toolName || "tool";
  if (toolName === "bash" && args && typeof args === "object") {
    const command = String((args as Record<string, unknown>).command ?? "").trim();
    const first = command.split(/\s+/).slice(0, 2).join(" ");
    return first ? `bash ${first}` : "bash";
  }
  if (/read/i.test(toolName) && args && typeof args === "object") {
    const path = String((args as Record<string, unknown>).path ?? "");
    const short = path.split("/").filter(Boolean).pop();
    return short ? `read ${short}` : "read";
  }
  if (/edit|write/i.test(toolName) && args && typeof args === "object") {
    const path = String((args as Record<string, unknown>).path ?? "");
    const short = path.split("/").filter(Boolean).pop();
    return short ? `${name} ${short}` : name;
  }
  if (toolName.includes("__")) {
    const [, server, tool] = toolName.split("__");
    return `${server ?? "mcp"}:${tool ?? "tool"}`;
  }
  return toolName || "tool";
}

export function upsertTool(state: ActivityState, card: ToolCard): void {
  const existing = state.tools.findIndex((tool) => tool.id === card.id);
  if (existing >= 0) state.tools.splice(existing, 1);
  state.tools.unshift(card);
  state.tools = state.tools.slice(0, MAX_TOOLS);
}

function phaseGlyph(state: PhaseState): string {
  switch (state) {
    case "active": return color.cyan("⠋");
    case "done": return color.green("✓");
    case "error": return color.red("✗");
    default: return color.dim("·");
  }
}

function toolGlyph(state: ToolState): string {
  switch (state) {
    case "running": return color.cyan("⠋");
    case "ok": return color.green("✓");
    case "error": return color.red("✗");
  }
}

export function renderActivityPanel(state: ActivityState): string[] {
  if (!state.sddActive && state.tools.length === 0) return [];
  const rule = (n: number) => color.coral("─".repeat(n));
  const border = rule(72);
  const header = `${color.coral("╭─")} ${color.gold("ZERO activity")} ${rule(54)}${color.coral("╮")}`;
  const phaseLine = PHASES
    .map((phase) => `${phaseGlyph(state.phases[phase])} ${state.phases[phase] === "active" ? color.cyan(phase) : color.muted(phase)}`)
    .join(color.dim(" › "));
  const toolLine = state.tools.length === 0
    ? color.dim("sin tools todavía")
    : state.tools.map((tool) => `${toolGlyph(tool.state)} ${color.muted(tool.label)}`).join(color.dim(" · "));
  return [
    header,
    `${color.coral("│")} ${color.magenta("SDD ")} ${phaseLine}`,
    `${color.coral("│")} ${color.magenta("Tools")} ${toolLine}`,
    `${color.coral("╰")}${border}${color.coral("╯")}`,
  ];
}

let registered = false;

export default function register(pi?: PiAPI): void {
  if (!pi || typeof pi.on !== "function") return;
  if (registered) return;
  registered = true;

  const state = createActivityState();
  let ui: Ctx["ui"] | undefined;

  const capture = (ctx: Ctx): void => {
    if (ctx?.ui?.setWidget) ui = ctx.ui;
  };

  const draw = (): void => {
    try {
      const lines = renderActivityPanel(state);
      ui?.setWidget?.(WIDGET_ID, lines.length > 0 ? lines : undefined, { placement: "aboveEditor" });
    } catch {
      // Visual sugar must never break the session.
    }
  };

  const clear = (): void => {
    state.sddActive = false;
    state.tools = [];
    for (const phase of PHASES) state.phases[phase] = "pending";
    try { ui?.setWidget?.(WIDGET_ID, undefined); } catch { /* ignore */ }
  };

  pi.on("session_start", (_event, ctx) => {
    capture(ctx);
    draw();
  });

  pi.on("input", (event, ctx) => {
    capture(ctx);
    const text = String((event as { text?: unknown })?.text ?? "");
    if (isForgeInput(text)) {
      state.sddActive = true;
      draw();
    }
  });

  pi.on("tool_execution_start", (event, ctx) => {
    capture(ctx);
    const e = event as { toolCallId?: string; toolName?: string; args?: unknown };
    const phase = e.toolName === "subagent" ? phaseFromSubagentArgs(e.args) : undefined;
    if (phase) markPhaseActive(state, phase);
    upsertTool(state, {
      id: e.toolCallId ?? `${Date.now()}`,
      name: e.toolName ?? "tool",
      label: toolLabel(e.toolName ?? "tool", e.args),
      state: "running",
    });
    draw();
  });

  pi.on("tool_execution_end", (event, ctx) => {
    capture(ctx);
    const e = event as { toolCallId?: string; toolName?: string; isError?: boolean };
    const id = e.toolCallId ?? "";
    const idx = state.tools.findIndex((tool) => tool.id === id);
    if (idx >= 0) state.tools[idx].state = e.isError ? "error" : "ok";
    if (e.toolName === "subagent") finishActivePhase(state, Boolean(e.isError));
    draw();
  });

  pi.on("agent_end", (_event, ctx) => {
    capture(ctx);
    // Leave the completed panel visible briefly in the next render cycle, then clear.
    setTimeout(clear, 1800).unref?.();
  });

  for (const lifecycle of ["session_shutdown", "session_before_switch"]) {
    pi.on(lifecycle, (_event, ctx) => {
      capture(ctx);
      clear();
    });
  }
}
