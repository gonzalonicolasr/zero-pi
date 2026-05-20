// zero-pi — colored statusline footer.
//
// Updates pi's footer (`ctx.ui.setStatus`) with a powerline-style line:
//
//   claude-opus-4-7 · tok ↑12.3K ↓4.1K · diff +50/-12 · ctx 45% · master · www.ceroclawd.com
//
// Themed: model violet, tokens cyan/blue, diff mint/rose, ctx mint→amber→rose
// by load, branch steel, brand amber. Pure 24-bit ANSI, no runtime deps.
//
// Refreshes on `session_start`, `model_select`, `message_update`
// (accumulates tokens), and `tool_execution_end` (re-reads git, since tools
// edit files). No timer — the 140 ms re-render loop that crashed pi 0.75.x
// is the cautionary tale; event-driven updates are safe.

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ─── Color palette (matches the zero-sdd theme `vars`) ─────────────────────

type RGB = [number, number, number];
const VIOLET: RGB = [175, 138, 255];
const CYAN: RGB = [80, 210, 255];
const BLUE: RGB = [116, 151, 255];
const MINT: RGB = [79, 221, 171];
const AMBER: RGB = [238, 190, 92];
const ROSE: RGB = [255, 106, 122];
const STEEL: RGB = [143, 152, 168];
const DIM: RGB = [95, 104, 120];

function fg([r, g, b]: RGB, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

// ─── Pure formatters (unit-tested) ─────────────────────────────────────────

/** Compact a token count: `500` → `500`, `1500` → `1.5K`, `2_400_000` → `2.4M`. */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return `${Math.floor(n)}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Pick a load-based color for context-usage display. */
export function ctxColor(percent: number): RGB {
  if (!Number.isFinite(percent) || percent < 50) return MINT;
  if (percent < 80) return AMBER;
  return ROSE;
}

/** Strip a `provider/` prefix from a model id for compact display. */
export function shortModel(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

/** The shape of one statusline render. All fields optional — missing parts skip. */
export interface StatuslineParts {
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  diffAdded?: number;
  diffRemoved?: number;
  ctxPercent?: number;
  branch?: string;
  brand?: string;
}

const SEP = fg(DIM, " · ");

/**
 * Compose the themed statusline string from its parts. Missing parts are
 * skipped — an empty parts object yields the empty string.
 */
export function composeStatusline(p: StatuslineParts): string {
  const parts: string[] = [];

  if (p.model) parts.push(fg(VIOLET, p.model));

  if (p.tokensIn != null || p.tokensOut != null) {
    const inS = fg(CYAN, `↑${formatTokenCount(p.tokensIn ?? 0)}`);
    const outS = fg(BLUE, `↓${formatTokenCount(p.tokensOut ?? 0)}`);
    parts.push(`${fg(DIM, "tok")} ${inS} ${outS}`);
  }

  if (p.diffAdded != null || p.diffRemoved != null) {
    const added = fg(MINT, `+${p.diffAdded ?? 0}`);
    const removed = fg(ROSE, `-${p.diffRemoved ?? 0}`);
    parts.push(`${fg(DIM, "diff")} ${added}/${removed}`);
  }

  if (p.ctxPercent != null && Number.isFinite(p.ctxPercent)) {
    parts.push(fg(ctxColor(p.ctxPercent), `ctx ${Math.round(p.ctxPercent)}%`));
  }

  if (p.branch) parts.push(fg(STEEL, p.branch));

  if (p.brand) parts.push(fg(VIOLET, p.brand));

  return parts.join(SEP);
}

// ─── pi API surfaces (minimal slices) ──────────────────────────────────────

interface PiUI {
  setStatus(id: string, text: string | undefined): void;
}
interface PiModel {
  id?: string;
  name?: string;
  contextWindow?: number;
}
interface PiSessionEntry {
  type?: string;
  message?: {
    role?: string;
    usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  };
}
interface PiSessionManager {
  getEntries?(): PiSessionEntry[];
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
}

const STATUS_ID = "zero-statusline";
const BRAND = "www.ceroclawd.com";

// ─── Session-scoped state ──────────────────────────────────────────────────
// Only git stays in state (it's expensive to re-shell on every render);
// tokens are computed fresh from sessionManager.getEntries() per render —
// the same pattern pi's native footer uses, so it can never double-count a
// streamed message_update.

let branch: string | undefined;
let added = 0;
let removed = 0;
let lastCtx: PiCtx | undefined;
let gitInFlight = false;

function resetSessionState(): void {
  branch = undefined;
  added = 0;
  removed = 0;
}

/**
 * Sum assistant input/output tokens across the full session, matching pi's
 * own footer logic. Defensive: a missing sessionManager or entries iteration
 * failure yields zero, never throws.
 */
export function computeSessionTokens(
  sessionManager: PiSessionManager | undefined,
): { input: number; output: number } {
  if (!sessionManager || typeof sessionManager.getEntries !== "function") {
    return { input: 0, output: 0 };
  }
  let input = 0;
  let output = 0;
  try {
    for (const entry of sessionManager.getEntries()) {
      if (entry?.type !== "message") continue;
      if (entry.message?.role !== "assistant") continue;
      const u = entry.message.usage;
      if (typeof u?.input === "number" && u.input > 0) input += u.input;
      if (typeof u?.output === "number" && u.output > 0) output += u.output;
    }
  } catch {
    // session iteration failure — return what we summed so far.
  }
  return { input, output };
}

// ─── Git read (best-effort, async, deduped) ────────────────────────────────

async function readGit(cwdHint: string | undefined): Promise<void> {
  const cwd = cwdHint || process.cwd();
  if (!cwd || gitInFlight) return;
  gitInFlight = true;
  try {
    try {
      const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        timeout: 1500,
        windowsHide: true,
      });
      branch = stdout.trim() || undefined;
    } catch {
      branch = undefined;
    }
    try {
      const { stdout } = await execAsync("git diff --shortstat", {
        cwd,
        timeout: 1500,
        windowsHide: true,
      });
      // "1 file changed, 12 insertions(+), 3 deletions(-)"
      const ins = stdout.match(/(\d+)\s+insertions?\(\+\)/);
      const del = stdout.match(/(\d+)\s+deletions?\(-\)/);
      added = ins ? parseInt(ins[1], 10) : 0;
      removed = del ? parseInt(del[1], 10) : 0;
    } catch {
      // not a git repo or no diff
    }
  } finally {
    gitInFlight = false;
  }
}

// ─── Render: read everything from ctx + state, push to footer ──────────────

function render(ctx: PiCtx): void {
  try {
    if (!ctx?.ui || typeof ctx.ui.setStatus !== "function") return;
    const window = ctx.model?.contextWindow && ctx.model.contextWindow > 0 ? ctx.model.contextWindow : 200_000;
    const used = ctx.getContextUsage?.()?.tokens;
    const ctxPercent = typeof used === "number" && used >= 0 ? Math.min(100, (used / window) * 100) : undefined;
    const tokens = computeSessionTokens(ctx.sessionManager);
    const text = composeStatusline({
      model: shortModel(ctx.model?.id ?? ctx.model?.name),
      tokensIn: tokens.input,
      tokensOut: tokens.output,
      diffAdded: added,
      diffRemoved: removed,
      ctxPercent,
      branch,
      brand: BRAND,
    });
    ctx.ui.setStatus(STATUS_ID, text);
  } catch {
    // setStatus failure must never break a pi session.
  }
}

// ─── Registration ──────────────────────────────────────────────────────────

/**
 * The pi extension entry point. Wires four events: `session_start` (reset +
 * initial git read), `model_select` (re-render with the new model name),
 * `message_update` (accumulate token usage), `tool_execution_end` (re-read git
 * since the tool may have edited files). Defensive: every callback is wrapped,
 * and registration itself never throws.
 */
export default function register(pi?: unknown): void {
  try {
    if (!pi || typeof (pi as PiAPI).on !== "function") return;
    const api = pi as PiAPI;

    api.on("session_start", (_event, ctx) => {
      try {
        lastCtx = ctx;
        resetSessionState();
        render(ctx);
        void readGit(ctx?.cwd).then(() => render(ctx));
      } catch {
        // never break a session
      }
    });

    api.on("model_select", (_event, ctx) => {
      try {
        lastCtx = ctx;
        render(ctx);
      } catch {
        // never break a session
      }
    });

    api.on("message_update", (_event, ctx) => {
      try {
        lastCtx = ctx;
        // Tokens are computed from sessionManager.getEntries() in render() —
        // no event-side accumulation, so a streamed message_update repeat
        // can never double-count.
        render(ctx);
      } catch {
        // never break a session
      }
    });

    api.on("tool_execution_end", (_event, ctx) => {
      try {
        lastCtx = ctx;
        void readGit(ctx?.cwd).then(() => render(ctx));
      } catch {
        // never break a session
      }
    });
  } catch {
    // Registration itself must never break a pi session.
  }
}
