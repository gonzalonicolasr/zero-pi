// zero-pi — hybrid working-phrase ticker and themed spinner.
//
// Pi shows a single static "Working..." line while the agent is busy. This
// extension replaces it with a context-aware, rotating phrase:
//
//   • a tool-specific line while a tool runs  ("Leyendo archivos…")
//   • an SDD-phase line while a zero sub-agent runs ("Construyendo…")
//   • a rotation of playful verbs while the model thinks ("Maquinando…")
//
// It also installs a braille spinner tinted with the active theme.
//
// Built only on pi's public extension API — no pi internals are touched. Every
// handler is defensive: visual sugar must never break an interactive session.

/** A pi theme — only the colouring helper is used here. */
interface Theme {
  fg(color: string, text: string): string;
}

/** The slice of pi's UI API this extension drives. */
interface PiUI {
  theme: Theme;
  setWorkingMessage(message?: string): void;
  setWorkingIndicator(options?: { frames: string[]; intervalMs?: number }): void;
}

interface Ctx {
  ui: PiUI;
}

/** The subset of the extension API this extension subscribes to. */
interface PiAPI {
  on(event: string, handler: (event: unknown, ctx: Ctx) => unknown): void;
}

// ── Phrase pools ───────────────────────────────────────────────────────────

/** Playful verbs shown while the model is thinking on ordinary work. */
const THINKING_PLAYFUL = [
  "Maquinando",
  "Rumiando",
  "Pensando",
  "Cocinando",
  "Tramando",
  "Conjurando",
  "Cavilando",
  "Hilando ideas",
  "Procesando",
  "Razonando",
  "Atando cabos",
  "Calibrando",
];

/** Thinking verbs biased toward SDD work — used once an SDD run is detected. */
const THINKING_SDD = [
  "Explorando ideas",
  "Trazando el plan",
  "Puliendo el diseño",
  "Revisando supuestos",
  "Ordenando las tareas",
  "Cuadrando el spec",
  "Maquinando",
  "Razonando",
];

/** SDD phase labels keyed by the zero sub-agent that owns the phase. */
const SDD_PHASE: Record<string, string> = {
  "zero-clarify": "Aclarando supuestos",
  "zero-explore": "Explorando el código",
  "zero-plan": "Planeando la solución",
  "zero-analyze": "Analizando el plan",
  "zero-build": "Construyendo la implementación",
  "zero-veredicto": "Revisando el veredicto",
};

/** Tool-name patterns → the phrase shown while that kind of tool runs. */
const TOOL_RULES: Array<[RegExp, string]> = [
  [/^(read|cat|view|open)/i, "Leyendo archivos"],
  [/(multi.?edit|str.?replace|edit|patch|apply)/i, "Aplicando cambios"],
  [/(write|create)/i, "Escribiendo archivos"],
  [/(bash|shell|exec|run|terminal|cmd)/i, "Ejecutando comandos"],
  [/(grep|search|ripgrep|^rg)/i, "Buscando en el código"],
  [/(glob|find|^ls$|list|tree)/i, "Rastreando archivos"],
  [/(web|fetch|http|url|browse|curl)/i, "Navegando la web"],
  [/(subagent|custom-agent|^task$|agent)/i, "Coordinando sub-agentes"],
  [/(todo|plan)/i, "Ordenando el plan"],
];

// ── Pure helpers (exported for tests) ──────────────────────────────────────

/** Resolve the phrase for a tool by its name; falls back to the raw name. */
export function toolPhrase(toolName: string): string {
  const name = (toolName ?? "").trim();
  if (name === "") return "Trabajando";
  // MCP tools come through as `mcp__server__tool` — name the server, not pi.
  if (name.includes("__") || /^mcp[._-]/i.test(name)) return "Consultando un MCP";
  for (const [pattern, phrase] of TOOL_RULES) {
    if (pattern.test(name)) return phrase;
  }
  return `Usando ${name}`;
}

/**
 * If a sub-agent invocation targets a zero SDD phase agent, return that phase's
 * label; otherwise return `null`. Accepts the single, chain, and parallel
 * shapes of the `subagent` tool's arguments.
 */
export function sddPhase(args: unknown): string | null {
  const names = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string") names.add(value);
  };
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    collect(a.agent);
    for (const key of ["chain", "tasks"] as const) {
      const list = a[key];
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (entry && typeof entry === "object") {
            const e = entry as Record<string, unknown>;
            collect(e.agent);
            if (Array.isArray(e.parallel)) {
              for (const p of e.parallel) {
                if (p && typeof p === "object") collect((p as Record<string, unknown>).agent);
              }
            }
          }
        }
      }
    }
  }
  for (const name of names) {
    const key = name.toLowerCase().split(".").pop() ?? name;
    if (SDD_PHASE[key]) return SDD_PHASE[key];
  }
  return null;
}

/** Whether a piece of user input signals an SDD run is starting. */
export function looksLikeSdd(text: string): boolean {
  return /\/forge\b|\bforge\b|\bsdd\b|zero[\s-]?sdd/i.test(text ?? "");
}

/** Pick a thinking phrase, avoiding an immediate repeat of `previous`. */
export function pickThinking(previous: string | undefined, sddBias: boolean): string {
  const pool = sddBias ? THINKING_SDD : THINKING_PLAYFUL;
  const choices = pool.length > 1 ? pool.filter((p) => p !== previous) : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

// ── Spinner ────────────────────────────────────────────────────────────────

/** Braille spinner glyphs, in rotation order. */
const SPIN_GLYPHS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** A per-frame colour cycle that makes the spinner gently breathe. */
const SPIN_COLORS = ["dim", "muted", "accent", "accent", "accent", "muted"];

/** Build the themed spinner frames. */
export function spinnerFrames(theme: Theme): string[] {
  return SPIN_GLYPHS.map((glyph, i) => {
    const color = SPIN_COLORS[i % SPIN_COLORS.length];
    try {
      return theme.fg(color, glyph);
    } catch {
      return glyph;
    }
  });
}

// ── Extension entry point ──────────────────────────────────────────────────

/** Module guard so a double-load never stacks handlers or a second timer. */
let registered = false;

export default function register(pi?: PiAPI): void {
  if (!pi || typeof pi.on !== "function") return;
  if (registered) return;
  registered = true;

  // The last UI handle seen on any event — the rotation timer uses it.
  let ui: PiUI | undefined;
  // The phrase-rotation interval; defined only while the agent is busy.
  let timer: ReturnType<typeof setInterval> | undefined;
  // Active tools, keyed by tool-call id, in start order. The most recently
  // started tool's phrase wins the indicator.
  const activeTools = new Map<string, string>();
  // The phrase the model-thinking rotation last produced.
  let lastThinking: string | undefined;
  // Whether the most recent prompt looks like an SDD run.
  let sddBias = false;

  /** The phrase to show right now, given current state. */
  const currentPhrase = (): string => {
    if (activeTools.size > 0) {
      // Last inserted entry — most recently started tool.
      let phrase = "Trabajando";
      for (const value of activeTools.values()) phrase = value;
      return phrase;
    }
    lastThinking = pickThinking(lastThinking, sddBias);
    return lastThinking;
  };

  /** Push the current phrase into pi's working indicator. */
  const render = (): void => {
    if (!ui) return;
    try {
      ui.setWorkingMessage(`${currentPhrase()}… (esc)`);
    } catch {
      // Indicator failures must never surface.
    }
  };

  /** Begin the rotation if it is not already running. */
  const start = (): void => {
    render();
    if (timer) return;
    timer = setInterval(render, 2400);
    // Don't keep the process alive purely for the ticker.
    (timer as { unref?: () => void }).unref?.();
  };

  /** Stop the rotation and restore pi's default working message. */
  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    activeTools.clear();
    try {
      ui?.setWorkingMessage();
    } catch {
      // ignore
    }
  };

  /** Install the themed spinner once a UI handle is available. */
  const installSpinner = (): void => {
    if (!ui) return;
    try {
      ui.setWorkingIndicator({ frames: spinnerFrames(ui.theme), intervalMs: 90 });
    } catch {
      // A spinner failure is harmless — pi keeps its default.
    }
  };

  const capture = (ctx: Ctx): void => {
    if (ctx && ctx.ui) ui = ctx.ui;
  };

  pi.on("session_start", (_event, ctx) => {
    capture(ctx);
    installSpinner();
  });

  pi.on("input", (event, ctx) => {
    capture(ctx);
    const text = (event as { text?: string })?.text ?? "";
    if (text) sddBias = looksLikeSdd(text);
  });

  pi.on("agent_start", (_event, ctx) => {
    capture(ctx);
    start();
  });

  pi.on("message_update", (_event, ctx) => {
    capture(ctx);
  });

  pi.on("tool_execution_start", (event, ctx) => {
    capture(ctx);
    const e = event as { toolCallId?: string; toolName?: string; args?: unknown };
    const id = e.toolCallId ?? `${activeTools.size}`;
    const phrase = sddPhase(e.args) ?? toolPhrase(e.toolName ?? "");
    activeTools.set(id, phrase);
    sddBias = sddBias || sddPhase(e.args) !== null;
    render();
  });

  pi.on("tool_execution_end", (event, ctx) => {
    capture(ctx);
    const id = (event as { toolCallId?: string }).toolCallId;
    if (id !== undefined) activeTools.delete(id);
    render();
  });

  pi.on("agent_end", (_event, ctx) => {
    capture(ctx);
    stop();
  });

  // Tidy up if the session is torn down mid-run.
  for (const lifecycle of ["session_shutdown", "session_before_switch"]) {
    pi.on(lifecycle, (_event, ctx) => {
      capture(ctx);
      stop();
    });
  }
}
