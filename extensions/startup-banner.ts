// zero-pi — animated startup banner.
//
// A pi extension that renders the "ZERO" wordmark in ANSI Shadow figlet style
// — heavy block glyphs with box-drawing trim for a chunky pixel-art feel — the
// instant a pi session starts. A purple -> amber shimmer sweeps left -> right
// once, then the glyphs settle into a static gradient glow.
//
// The render runs synchronously inside the extension's register() call, before
// pi draws its interactive UI, so the animation never fights pi's renderer and
// no extra dependency is needed. A banner failure is swallowed: it must never
// break a pi session.
//
// Behaviour is controlled by the ZERO_BANNER environment variable:
//   ZERO_BANNER=off        render nothing
//   ZERO_BANNER=static     render the settled gradient, no animation
//   (unset) / shimmer      render the animated shimmer sweep (default)
//
// Pure ANSI 24-bit colour, zero runtime dependencies.

type RGB = [number, number, number];

const COLORS: Record<string, RGB> = {
  purpleDim: [82, 70, 124],
  purpleMid: [157, 124, 216],
  amber: [255, 180, 84],
  peak: [255, 240, 210],
};

/** Number of rows in every glyph of the ANSI Shadow font. */
const ROWS = 6;

// The ANSI Shadow font, one entry per supported character. Each glyph is six
// rows tall; widths vary per letter and the layout adds one space between
// glyphs for breathing room.
const FONT: Record<string, string[]> = {
  Z: [
    "███████╗",
    "╚══███╔╝",
    "  ███╔╝ ",
    " ███╔╝  ",
    "███████╗",
    "╚══════╝",
  ],
  E: [
    "███████╗",
    "██╔════╝",
    "█████╗  ",
    "██╔══╝  ",
    "███████╗",
    "╚══════╝",
  ],
  R: [
    "██████╗ ",
    "██╔══██╗",
    "██████╔╝",
    "██╔══██╗",
    "██║  ██║",
    "╚═╝  ╚═╝",
  ],
  O: [
    " ██████╗ ",
    "██╔═══██╗",
    "██║   ██║",
    "██║   ██║",
    "╚██████╔╝",
    " ╚═════╝ ",
  ],
  P: [
    "██████╗ ",
    "██╔══██╗",
    "██████╔╝",
    "██╔═══╝ ",
    "██║     ",
    "╚═╝     ",
  ],
  I: [
    "██╗",
    "██║",
    "██║",
    "██║",
    "██║",
    "╚═╝",
  ],
  "-": [
    "        ",
    "        ",
    " █████╗ ",
    " ╚════╝ ",
    "        ",
    "        ",
  ],
  " ": ["  ", "  ", "  ", "  ", "  ", "  "],
};

/** Lay a word out as six text rows of ANSI Shadow glyphs. */
export function bannerLines(text = "ZERO"): string[] {
  const lines: string[] = Array.from({ length: ROWS }, () => "");
  for (const ch of text) {
    const glyph = FONT[ch.toUpperCase()] ?? FONT[" "];
    for (let r = 0; r < ROWS; r++) {
      lines[r] += glyph[r] + " ";
    }
  }
  return lines;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c1: RGB, c2: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(lerp(c1[0], c2[0], k)),
    Math.round(lerp(c1[1], c2[1], k)),
    Math.round(lerp(c1[2], c2[2], k)),
  ];
}

/**
 * The colour of one glyph cell.
 *
 * When `spotlight` is null the banner is in its settled state: a subtle
 * horizontal purple -> amber gradient with a top-to-bottom warmth bias so the
 * lower rows glow like embers. Otherwise the cell's colour depends on its
 * distance from the moving spotlight column.
 */
function colorAt(col: number, row: number, spotlight: number | null, width: number): RGB {
  if (spotlight === null) {
    const horizontal = col / Math.max(1, width - 1);
    const vertical = row / (ROWS - 1);
    const base = lerpColor(COLORS.purpleMid, COLORS.amber, horizontal * 0.55);
    return lerpColor(base, COLORS.amber, vertical * 0.25);
  }
  const dx = Math.abs(col - spotlight);
  if (dx < 1.5) return COLORS.peak;
  if (dx < 4) return lerpColor(COLORS.peak, COLORS.amber, (dx - 1.5) / 2.5);
  if (dx < 9) return lerpColor(COLORS.amber, COLORS.purpleMid, (dx - 4) / 5);
  if (dx < 16) return lerpColor(COLORS.purpleMid, COLORS.purpleDim, (dx - 9) / 7);
  return COLORS.purpleDim;
}

/** Paint one banner row with 24-bit ANSI colour, leaving spaces uncoloured. */
function paintLine(line: string, row: number, spotlight: number | null, width: number): string {
  let out = "";
  let colored = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") {
      if (colored) {
        out += "\x1b[0m";
        colored = false;
      }
      out += " ";
      continue;
    }
    const [r, g, b] = colorAt(i, row, spotlight, width);
    out += `\x1b[38;2;${r};${g};${b}m${ch}`;
    colored = true;
  }
  if (colored) out += "\x1b[0m";
  return out;
}

interface OutStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

/** Whether colour output is appropriate for the given stream. */
function shouldColor(stream: OutStream): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream && stream.isTTY);
}

/** The three banner modes, resolved from the ZERO_BANNER environment variable. */
export type BannerMode = "off" | "static" | "shimmer";

/** Resolve the banner mode from an environment-variable value. */
export function resolveBannerMode(raw: string | undefined): BannerMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "off" || value === "0" || value === "false" || value === "none") return "off";
  if (value === "static" || value === "plain" || value === "no-animate") return "static";
  return "shimmer";
}

// A synchronous millisecond sleep — Atomics.wait blocks the thread until the
// timeout elapses (the value never changes). Used to pace animation frames
// without making register() async, so the whole banner is drawn before pi's
// UI takes over.
const SLEEP_SLOT = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number): void {
  if (ms > 0) Atomics.wait(SLEEP_SLOT, 0, 0, ms);
}

/** Options for {@link renderBanner}. */
export interface RenderOptions {
  mode?: BannerMode;
  text?: string;
  frames?: number;
  frameMs?: number;
  stream?: OutStream;
}

/**
 * Render the ZERO banner synchronously.
 *
 * On a non-colour stream the banner is printed plain. Otherwise the shimmer
 * sweep is animated frame by frame (mode `shimmer`) or skipped (mode `static`),
 * settling on the static gradient either way.
 */
export function renderBanner(options: RenderOptions = {}): void {
  const mode = options.mode ?? resolveBannerMode(process.env.ZERO_BANNER);
  if (mode === "off") return;

  const stream: OutStream = options.stream ?? process.stdout;
  const lines = bannerLines(options.text ?? "ZERO");
  const width = lines[0].length;

  if (!shouldColor(stream)) {
    stream.write("\n" + lines.join("\n") + "\n\n");
    return;
  }

  // Reserve the vertical space the banner will occupy, then redraw in place.
  stream.write("\n" + lines.map(() => "").join("\n") + "\n");

  if (mode === "shimmer") {
    const frames = Math.max(2, options.frames ?? 28);
    const frameMs = Math.max(1, options.frameMs ?? 24);
    const startCol = -10;
    const endCol = width + 10;
    for (let f = 0; f < frames; f++) {
      const t = f / (frames - 1);
      // ease-in-out so the sweep slows at the edges
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const spotlight = startCol + (endCol - startCol) * eased;
      stream.write(`\x1b[${ROWS}A\r`);
      for (let r = 0; r < ROWS; r++) {
        stream.write("\x1b[2K" + paintLine(lines[r], r, spotlight, width) + "\n");
      }
      sleepSync(frameMs);
    }
  }

  // Settle on the static gradient.
  stream.write(`\x1b[${ROWS}A\r`);
  for (let r = 0; r < ROWS; r++) {
    stream.write("\x1b[2K" + paintLine(lines[r], r, null, width) + "\n");
  }
  stream.write("\n");
}

/**
 * The pi extension entry point.
 *
 * pi calls this once when the extension loads, before the interactive UI
 * starts — exactly when the banner should be drawn. The `pi` argument is
 * accepted for API compatibility but not needed: the banner is self-contained.
 */
export default function register(_pi?: unknown): void {
  try {
    renderBanner();
  } catch {
    // A banner failure must never break a pi session.
  }
}
