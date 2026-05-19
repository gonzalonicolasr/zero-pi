// zero-pi — static ZERO SDD startup banner.
//
// Renders the ZERO wordmark ONCE, at extension load, as an "ANSI Shadow" 3D
// block in ceroclawd.com violet — deep-violet faces, a lit top edge, dark
// shadow strokes and a cast shadow for depth.
//
// It writes a single block to stdout before pi's UI takes over. There is
// deliberately NO setHeader and NO animation timer: an animated header that
// re-renders on a timer spammed the terminal on pi 0.75.x and could crash the
// session. A one-time stdout write cannot re-render, so it cannot spam.
//
// Disable with the ZERO_HEADER=off environment variable.

type RGB = [number, number, number];

const WORD = "ZERO";
const ROWS = 6;

// Cast-shadow offset — light from the top-left, shadow falls bottom-right.
const SHADOW_DX = 2;
const SHADOW_DY = 1;

// ANSI Shadow glyphs — six rows each, glued edge to edge like figlet output.
const FONT: Record<string, string[]> = {
  Z: ["███████╗", "╚══███╔╝", "  ███╔╝ ", " ███╔╝  ", "███████╗", "╚══════╝"],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
  O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  " ": ["    ", "    ", "    ", "    ", "    ", "    "],
};

// ceroclawd.com palette — violet, glow and darkness.
const VIOLET_DEEP: RGB = [124, 58, 237];
const LAVENDER: RGB = [205, 188, 255];
const PEAK: RGB = [248, 244, 255];
const SHADOW: RGB = [38, 24, 66];
const INK: RGB = [20, 13, 34];
const VIOLET: RGB = [167, 139, 250];
const MUTED: RGB = [120, 110, 150];

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function fg([r, g, b]: RGB, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(lerp(a[0], b[0], k)),
    Math.round(lerp(a[1], b[1], k)),
    Math.round(lerp(a[2], b[2], k)),
  ];
}

/** Printable width of a string, ignoring ANSI colour escapes. */
export function visibleWidth(text: string): number {
  return text.replace(ANSI_RE, "").length;
}

function center(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
  return " ".repeat(pad) + text;
}

function matrixFor(text: string): { rows: string[]; width: number } {
  const rows = Array.from({ length: ROWS }, () => "");
  for (const raw of Array.from(text)) {
    const glyph = FONT[raw.toUpperCase()] ?? FONT[" "];
    for (let row = 0; row < ROWS; row++) rows[row] += glyph[row];
  }
  return { rows, width: rows[0]?.length ?? 0 };
}

/** Front-face colour: violet vertical gradient with a lit top edge. */
function faceColor(row: number, topEdge: boolean): RGB {
  const vt = Math.pow(row / (ROWS - 1), 0.85);
  const base = mix(LAVENDER, VIOLET_DEEP, vt);
  return topEdge ? mix(base, PEAK, 0.5) : base;
}

/** Extrusion side: a darker, shaded version of the face it belongs to. */
function sideColor(row: number): RGB {
  const vt = Math.pow(row / (ROWS - 1), 0.85);
  return mix(mix(LAVENDER, VIOLET_DEEP, vt), SHADOW, 0.66);
}

function renderLogo(width: number): string[] {
  const matrix = matrixFor(WORD);
  const W = matrix.width;
  const cellAt = (r: number, c: number): string =>
    r >= 0 && r < ROWS && c >= 0 && c < W ? matrix.rows[r][c] ?? " " : " ";
  const isFill = (r: number, c: number): boolean => cellAt(r, c) !== " ";

  const lines: string[] = [];
  for (let gr = 0; gr < ROWS + SHADOW_DY; gr++) {
    let out = "";
    for (let gc = 0; gc < W + SHADOW_DX; gc++) {
      const ch = cellAt(gr, gc);
      if (ch !== " ") {
        out += ch === "█" ? fg(faceColor(gr, !isFill(gr - 1, gc)), ch) : fg(sideColor(gr), ch);
      } else if ((gr >= ROWS || gc >= W) && isFill(gr - SHADOW_DY, gc - SHADOW_DX)) {
        out += fg(INK, "█");
      } else {
        out += " ";
      }
    }
    lines.push(center(out, width));
  }
  return lines;
}

/** A thin violet rule, brightest in the middle. */
function ornament(width: number): string {
  const length = Math.min(46, Math.max(22, Math.floor(width * 0.5)));
  let line = "";
  for (let i = 0; i < length; i++) {
    const t = i / Math.max(1, length - 1);
    line += fg(mix(VIOLET_DEEP, VIOLET, Math.sin(t * Math.PI)), "─");
  }
  return center(line, width);
}

/**
 * The full banner block, centered to the given width.
 *
 * Wide layout = exactly **10 lines**: top ornament + 7 logo rows (6 + cast
 * shadow) + tag + bottom ornament. Pi's `setWidget` caps managed widgets at
 * `MAX_WIDGET_LINES = 10` (hardcoded in interactive-mode.js); anything taller
 * is rendered with a `... (widget truncated)` line. Inner blank-line padding
 * was removed to fit that cap exactly — adding blanks back would re-truncate.
 */
export function bannerBlock(width: number): string[] {
  if (width < 64) {
    return [center(fg(VIOLET, "ZERO SDD"), width), center(fg(MUTED, "pi.dev · spec-driven work"), width)];
  }
  const tag = fg(VIOLET, "ZERO SDD") + fg(MUTED, "   explore → plan → build → veredicto");
  return [ornament(width), ...renderLogo(width), center(tag, width), ornament(width)];
}

/** The slice of pi's UI surface this extension uses. */
interface PiUI {
  setWidget(id: string, lines: string[]): void;
}
interface PiSessionContext {
  ui?: PiUI;
}
interface PiAPI {
  on(event: string, handler: (event: unknown, ctx: PiSessionContext) => void): void;
}

/** Stable widget id — re-installing with the same id replaces the previous lines. */
const WIDGET_ID = "zero-banner";

/**
 * Install (or refresh) the banner as a pi-managed widget above the editor.
 *
 * Using `ctx.ui.setWidget` instead of a one-shot `stdout.write` means pi owns
 * the lines and redraws them on every resize, every reload, every session
 * restart — so the banner survives maximize/minimize instead of vanishing into
 * scrollback. The crash this file's earlier comment warned about was the
 * animated 140 ms re-render loop; a static widget set once per `session_start`
 * has no timer and re-uses the same id, so it never spams.
 */
function installWidget(ctx: PiSessionContext): void {
  if (!ctx?.ui || typeof ctx.ui.setWidget !== "function") return;
  if (process.env.NO_COLOR) return;
  const cols = process.stdout?.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
  ctx.ui.setWidget(WIDGET_ID, bannerBlock(cols));
}

/**
 * The pi extension entry point.
 *
 * Hooks `session_start` (fires on startup, reload, new, resume, fork) and
 * installs the banner as a pi-managed widget above the editor — so pi keeps it
 * rendered and redraws it on resize. Disabled with `ZERO_HEADER=off`.
 * Defensive: any failure of registration or the widget install is swallowed —
 * a banner must never break a pi session.
 */
export default function register(pi?: unknown): void {
  try {
    if ((process.env.ZERO_HEADER ?? "").trim().toLowerCase() === "off") return;
    if (!pi || typeof (pi as PiAPI).on !== "function") return;
    (pi as PiAPI).on("session_start", (_event, ctx) => {
      try {
        installWidget(ctx);
      } catch {
        // A widget install failure must never break a pi session.
      }
    });
  } catch {
    // Registration itself must never break a pi session.
  }
}
