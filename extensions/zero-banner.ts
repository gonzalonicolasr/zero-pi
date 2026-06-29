// zero-pi — static ZERO SDD startup banner.
//
// Renders the ZERO wordmark ONCE, at extension load, as an "ANSI Shadow" 3D
// block in a sunset gradient — gold at the lit top edge melting down through
// coral and magenta to a ceroclawd-violet base, with dark shadow strokes and
// a cast shadow for depth.
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

// Sunset palette — a warm sky gradient (gold → peach → coral → rose → magenta
// → violet) for the letter faces, plus glow, shadow and darkness. The violet
// base keeps the ZERO wordmark ending on the ceroclawd brand colour.
const SKY: RGB[] = [
  [255, 214, 130], // gold
  [255, 168, 99], //  peach
  [255, 124, 92], //  coral
  [255, 92, 122], //  rose
  [214, 74, 140], //  magenta
  [142, 59, 158], //  violet
];
const PEAK: RGB = [255, 244, 224];
const SHADOW: RGB = [46, 22, 54];
const INK: RGB = [22, 12, 30];
const CORAL: RGB = [255, 124, 92];
const PEACH: RGB = [255, 168, 99];
const MUTED: RGB = [150, 120, 130];

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

/** Sample a multi-stop colour ramp at t∈[0,1] — the sunset sky, top to base. */
function ramp(stops: RGB[], t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  const seg = k * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  return mix(stops[i], stops[i + 1], seg - i);
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

/** Front-face colour: sunset vertical gradient with a lit top edge. */
function faceColor(row: number, topEdge: boolean): RGB {
  const vt = Math.pow(row / (ROWS - 1), 0.82);
  const base = ramp(SKY, vt);
  return topEdge ? mix(base, PEAK, 0.55) : base;
}

/** Extrusion side: a darker, shaded version of the face it belongs to. */
function sideColor(row: number): RGB {
  const vt = Math.pow(row / (ROWS - 1), 0.82);
  return mix(ramp(SKY, vt), SHADOW, 0.62);
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

/** A thin sunset rule, brightest in the middle. */
function ornament(width: number): string {
  const length = Math.min(46, Math.max(22, Math.floor(width * 0.5)));
  let line = "";
  for (let i = 0; i < length; i++) {
    const t = i / Math.max(1, length - 1);
    line += fg(mix(CORAL, PEACH, Math.sin(t * Math.PI)), "─");
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
    return [center(fg(PEACH, "ZERO SDD"), width), center(fg(MUTED, "pi.dev · spec-driven work"), width)];
  }
  const tag = fg(PEACH, "ZERO SDD") + fg(MUTED, "   explore → plan → build → veredicto");
  return [ornament(width), ...renderLogo(width), center(tag, width), ornament(width)];
}

/**
 * The pi extension entry point.
 *
 * Writes the banner ONCE to stdout at extension load — pi loads extensions
 * before its TUI takes over the screen, so the banner ends up at the very top
 * of the terminal scrollback, above everything else. `setWidget` was tried
 * (0.1.33–0.1.37) but pi positions widgets above the editor, not at the top
 * of the viewport — short chats showed the banner in the middle.
 *
 * Known tradeoff: resizing the terminal lets pi clear/reflow its TUI area, and
 * the one-shot banner in scrollback can scroll out of view. That is normal
 * CLI startup-banner behavior. `ZERO_HEADER=off` disables it.
 */
export default function register(_pi?: unknown): void {
  try {
    if ((process.env.ZERO_HEADER ?? "").trim().toLowerCase() === "off") return;
    const stream = process.stdout;
    if (!stream || !stream.isTTY || process.env.NO_COLOR) return;
    const width = stream.columns && stream.columns > 0 ? stream.columns : 80;
    stream.write("\n" + bannerBlock(width).join("\n") + "\n\n");
  } catch {
    // A banner failure must never break a pi session.
  }
}
