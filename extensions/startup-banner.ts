// zero-pi - animated startup banner.
//
// A pi extension that renders the ZERO wordmark as ASCII-safe Tetris cells.
// The animated mode progressively assembles the wordmark from the bottom up,
// then settles into the complete banner. The extension stays dependency-free
// and keeps the historical ZERO_BANNER controls.

type RGB = [number, number, number];

const COLORS: Record<string, RGB> = {
  cyan: [80, 210, 255],
  blue: [116, 151, 255],
  mint: [79, 221, 171],
  amber: [238, 190, 92],
  rose: [255, 106, 122],
  violet: [175, 138, 255],
  peak: [255, 245, 218],
};

/** Number of rows in every glyph. */
const ROWS = 6;

// Five-cell-wide glyphs. Non-space characters become visible Tetris cells.
const FONT: Record<string, string[]> = {
  Z: ["ZZZZZ", "   ZZ", "  ZZ ", " ZZ  ", "ZZ   ", "ZZZZZ"],
  E: ["EEEEE", "EE   ", "EEEE ", "EE   ", "EE   ", "EEEEE"],
  R: ["RRRR ", "RR RR", "RRRR ", "RR RR", "RR  R", "RR  R"],
  O: [" OOO ", "OO OO", "OO OO", "OO OO", "OO OO", " OOO "],
  P: ["PPPP ", "PP PP", "PP PP", "PPPP ", "PP   ", "PP   "],
  I: ["IIIII", "  II ", "  II ", "  II ", "  II ", "IIIII"],
  "-": ["     ", "     ", "-----", "     ", "     ", "     "],
  " ": ["     ", "     ", "     ", "     ", "     ", "     "],
};

const PIECE_COLORS: Record<string, RGB> = {
  Z: COLORS.cyan,
  E: COLORS.amber,
  R: COLORS.mint,
  O: COLORS.rose,
  P: COLORS.violet,
  I: COLORS.blue,
  "-": COLORS.amber,
};

interface Matrix {
  rows: string[];
  width: number;
  totalCells: number;
  ranks: Map<string, number>;
}

function glyphFor(ch: string): string[] {
  return FONT[ch.toUpperCase()] ?? FONT[" "];
}

function matrixForText(text: string): Matrix {
  const rows = Array.from({ length: ROWS }, () => "");
  for (const [index, raw] of Array.from(text).entries()) {
    const glyph = glyphFor(raw);
    for (let r = 0; r < ROWS; r++) {
      rows[r] += (index === 0 ? "" : " ") + glyph[r];
    }
  }

  const cells: Array<{ row: number; col: number }> = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      if (rows[row][col] !== " ") cells.push({ row, col });
    }
  }

  // Tetris reads as a pile building upward: bottom rows settle first.
  cells.sort((a, b) => b.row - a.row || a.col - b.col);

  const ranks = new Map<string, number>();
  for (const [rank, cell] of cells.entries()) {
    ranks.set(`${cell.row}:${cell.col}`, rank);
  }

  return {
    rows,
    width: rows[0]?.length ?? 0,
    totalCells: cells.length,
    ranks,
  };
}

/** Lay a word out as six rows of ASCII-safe Tetris cells. */
export function bannerLines(text = "ZERO"): string[] {
  return matrixForText(text).rows.map((row) =>
    Array.from(row)
      .map((cell) => (cell === " " ? "  " : "[]"))
      .join(""),
  );
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

function ansiFg([r, g, b]: RGB, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

function colorForPiece(piece: string, row: number, rank: number, active: boolean): RGB {
  if (active) return COLORS.peak;
  const base = PIECE_COLORS[piece] ?? COLORS.blue;
  const heightWarmth = (ROWS - 1 - row) / Math.max(1, ROWS - 1);
  const rankPulse = (rank % 7) / 18;
  return lerpColor(base, COLORS.peak, heightWarmth * 0.18 + rankPulse);
}

function paintMatrixLine(matrix: Matrix, row: number, visibleCells: number): string {
  let out = "";
  const line = matrix.rows[row] ?? "";
  for (let col = 0; col < matrix.width; col++) {
    const piece = line[col] ?? " ";
    if (piece === " ") {
      out += "  ";
      continue;
    }
    const rank = matrix.ranks.get(`${row}:${col}`) ?? Number.POSITIVE_INFINITY;
    if (rank >= visibleCells) {
      out += "  ";
      continue;
    }
    out += ansiFg(colorForPiece(piece, row, rank, rank === visibleCells - 1), "[]");
  }
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

// Atomics.wait gives us a synchronous sleep without adding a dependency. The
// banner renders before Pi's TUI takes over, so blocking briefly is intentional.
const SLEEP_SLOT = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number): void {
  if (ms > 0) Atomics.wait(SLEEP_SLOT, 0, 0, ms);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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
 * On a non-colour stream the banner is printed plain. Otherwise the animated
 * mode assembles cells frame by frame, then settles on the completed wordmark.
 */
export function renderBanner(options: RenderOptions = {}): void {
  const mode = options.mode ?? resolveBannerMode(process.env.ZERO_BANNER);
  if (mode === "off") return;

  const stream: OutStream = options.stream ?? process.stdout;
  const matrix = matrixForText(options.text ?? "ZERO");

  if (!shouldColor(stream)) {
    stream.write("\n" + bannerLines(options.text ?? "ZERO").join("\n") + "\n\n");
    return;
  }

  stream.write("\n" + Array.from({ length: ROWS }, () => "").join("\n") + "\n");

  if (mode === "shimmer") {
    const frames = Math.max(2, options.frames ?? 42);
    const frameMs = Math.max(1, options.frameMs ?? 18);
    for (let f = 0; f < frames; f++) {
      const t = easeOutCubic(f / (frames - 1));
      const visibleCells = Math.max(1, Math.ceil(matrix.totalCells * t));
      stream.write(`\x1b[${ROWS}A\r`);
      for (let r = 0; r < ROWS; r++) {
        stream.write("\x1b[2K" + paintMatrixLine(matrix, r, visibleCells) + "\n");
      }
      sleepSync(frameMs);
    }
  }

  stream.write(`\x1b[${ROWS}A\r`);
  for (let r = 0; r < ROWS; r++) {
    stream.write("\x1b[2K" + paintMatrixLine(matrix, r, matrix.totalCells) + "\n");
  }
  stream.write("\n");
}

/**
 * The pi extension entry point.
 *
 * The pi argument is accepted for API compatibility. The banner is rendered
 * defensively: visual sugar should never break an interactive session.
 */
export default function register(_pi?: unknown): void {
  try {
    renderBanner();
  } catch {
    // A banner failure must never break a pi session.
  }
}
