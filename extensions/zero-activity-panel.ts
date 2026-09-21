// zero-pi — live activity panel for /forge progress and recent tool cards.
//
// This extension uses pi's public widget API (ctx.ui.setWidget) to render a
// compact panel above the input while the agent works. It intentionally avoids
// replacing pi's built-in tool renderer: the panel is a live dashboard, not a
// second source of truth.

import { padToWidth, truncateToWidth } from "./zero-tui-layout.ts";

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

/** Below this there is no room for a frame plus a readable label. */
const MIN_PANEL_WIDTH = 24;

/**
 * Draw the live panel as a closed box exactly `width` columns wide.
 *
 * `ctx.ui.setWidget` takes plain lines and pi prints them as-is, so a line
 * wider than the terminal wraps and tears the frame apart. The width therefore
 * has to come from the terminal on every draw — the panel used to be pinned at
 * a hardcoded 72 columns whose top and bottom borders did not even match each
 * other, and whose content rows had no right border at all.
 */
export function renderActivityPanel(state: ActivityState, width: number): string[] {
  if (!state.sddActive) return [];
  if (!Number.isFinite(width) || width < MIN_PANEL_WIDTH) {
    // Too narrow to frame: one honest, clamped status line beats a torn box.
    const label = truncateToWidth(`${color.gold("ZERO")} ${color.magenta(activePhase(state))}`, Math.max(0, width));
    return width > 0 ? [label] : [];
  }

  const TITLE = "ZERO activity";
  const inner = width - 4;
  const headFill = Math.max(0, width - 2 - 1 - TITLE.length - 1 - 1);
  const header = `${color.coral("╭─")} ${color.gold(TITLE)} ${color.coral("─".repeat(headFill))}${color.coral("╮")}`;
  const footer = `${color.coral("╰")}${color.coral("─".repeat(width - 2))}${color.coral("╯")}`;

  const phaseLine = PHASES
    .map((phase) => `${phaseGlyph(state.phases[phase])} ${state.phases[phase] === "active" ? color.cyan(phase) : color.muted(phase)}`)
    .join(color.dim(" › "));
  const toolLine = state.tools.length === 0
    ? color.dim("sin tools todavía")
    : state.tools.map((tool) => `${toolGlyph(tool.state)} ${color.muted(tool.label)}`).join(color.dim(" · "));

  const row = (label: string, body: string): string =>
    `${color.coral("│")} ${padToWidth(`${color.magenta(label)} ${body}`, inner)} ${color.coral("│")}`;

  return [header, row("SDD  ", phaseLine), row("Tools", toolLine), footer];
}

/** The phase to name when the panel is too narrow to list them all. */
function activePhase(state: ActivityState): string {
  return PHASES.find((phase) => state.phases[phase] === "active") ?? "sdd";
}

/** Live terminal width, falling back to a conservative 80 off a TTY. */
function terminalColumns(): number {
  const columns = process.stdout?.columns;
  return typeof columns === "number" && columns > 0 ? columns : 80;
}

/**
 * Columns a `setWidget(key, string[])` line may actually use.
 *
 * pi wraps every line of a string-array widget in `new Text(line, 1, 0)`
 * (`interactive-mode.js`, `setExtensionWidget`). `Text` renders its content at
 * `width - paddingX * 2` — one column of margin on each side — and it **word
 * wraps** the overflow instead of clipping it. So a line drawn at exactly the
 * terminal width comes out as two wrapped lines, which is precisely how the
 * frame ended up torn: corners on their own rows, borders at random columns.
 *
 * The container hands `Text` the full terminal width (`Container.render`
 * forwards it verbatim, and the root renders at `terminal.columns`), so the
 * budget is exactly two columns less than the terminal. Verified against
 * pi-coding-agent 0.84.2 / pi-tui.
 */
export const WIDGET_MARGIN = 2;

/** The drawable width of a string-array widget in a terminal of `columns`. */
export function widgetWidth(columns: number | undefined): number {
  const terminal = typeof columns === "number" && columns > 0 ? columns : 80;
  return Math.max(0, terminal - WIDGET_MARGIN);
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
      const lines = renderActivityPanel(state, widgetWidth(terminalColumns()));
      ui?.setWidget?.(WIDGET_ID, lines.length > 0 ? lines : undefined, { placement: "aboveEditor" });
    } catch {
      // Visual sugar must never break the session.
    }
  };

  // A widget is drawn once and then held by pi verbatim: `setWidget` stores the
  // lines, it does not re-ask for them when the terminal is resized. So a panel
  // framed for a 152-column window keeps those 152-column lines after the window
  // shrinks, and pi's `Text` *word wraps* every one of them — a 4-row box comes
  // out as 9 torn rows with corners stranded on their own lines.
  //
  // Redrawing on resize is therefore not a refinement, it is what keeps the frame
  // closed. Only while a panel is actually on screen, and coalesced: a drag emits
  // a burst of `resize` events and each one would otherwise be a full repaint.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const redrawOnResize = (): void => {
    if (!state.sddActive) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      draw();
    }, 60);
    resizeTimer.unref?.();
  };
  process.stdout?.on?.("resize", redrawOnResize);

  const clear = (): void => {
    state.sddActive = false;
    state.tools = [];
    for (const phase of PHASES) state.phases[phase] = "pending";
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = undefined;
    }
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
    if (state.sddActive || phase) {
      upsertTool(state, {
        id: e.toolCallId ?? `${Date.now()}`,
        name: e.toolName ?? "tool",
        label: toolLabel(e.toolName ?? "tool", e.args),
        state: "running",
      });
      draw();
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    capture(ctx);
    const e = event as { toolCallId?: string; toolName?: string; isError?: boolean };
    const id = e.toolCallId ?? "";
    const idx = state.tools.findIndex((tool) => tool.id === id);
    if (idx >= 0) state.tools[idx].state = e.isError ? "error" : "ok";
    if (e.toolName === "subagent") finishActivePhase(state, Boolean(e.isError));
    if (state.sddActive) draw();
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

  // `process.stdout` outlives the session, so the resize listener has to come off
  // explicitly: pi warns at 11 listeners, and a session switch would otherwise
  // leak one per switch until the warning fires.
  pi.on("session_shutdown", () => {
    process.stdout?.off?.("resize", redrawOnResize);
  });
}
