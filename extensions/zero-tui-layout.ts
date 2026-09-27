// zero-pi — shared terminal-layout helpers for every zero widget and panel.
//
// pi has no windows. A widget is not a floating pane with its own viewport and
// z-order: `ctx.ui.custom()` hands a component `render(width): string[]` and
// `ctx.ui.setWidget()` takes a plain `string[]`. pi prints those lines into the
// terminal flow — it never clips them. So a block that returns more lines than
// the terminal has rows scrolls its own top off screen (the frame's top border
// and title go first), and a line wider than the terminal wraps and breaks the
// box. Fitting the viewport is each block's own job, and this module is the
// one place that job is implemented.
//
// Pure and dependency-free (no `node:*`, no pi imports) so `node --test`
// exercises it directly. The terminal size is always passed in by the caller.

/** The escape byte, spelled as a unicode escape so the source stays printable. */
const ESC = "\u001b";

/** Matches ANSI CSI/SGR sequences and OSC strings — zero display cells. */
const ANSI_RE = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^]*?(?:\\u0007|${ESC}\\\\)`,
  "g",
);

/** The reset sequence appended when a truncation cuts inside a styled run. */
const ANSI_RESET = `${ESC}[0m`;

/** Strip every ANSI escape, leaving only the characters that occupy cells. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * How many terminal cells one code point occupies.
 *
 * Mirrors the rule pi-tui's `doRender` validates a line with: combining marks
 * and zero-width joiners take no cell, East-Asian Wide/Fullwidth and emoji
 * take two, everything else takes one. Deliberately a table of ranges rather
 * than a dependency — pi-tui's own helpers are used when available (see
 * `setWidthFns`), and this is the fallback for tests and non-pi contexts.
 */
function codePointWidth(cp: number): number {
  // C0/C1 controls and DEL.
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  // Combining marks, ZWJ/ZWNJ, variation selectors.
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  ) {
    return 0;
  }
  // East-Asian Wide / Fullwidth blocks and the emoji planes.
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f680 && cp <= 0x1f6ff) ||
    (cp >= 0x1f7e0 && cp <= 0x1f7eb) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Printable width of `text` in terminal cells, ANSI escapes excluded. */
function fallbackVisibleWidth(text: string): number {
  let width = 0;
  for (const ch of stripAnsi(text)) width += codePointWidth(ch.codePointAt(0) ?? 0);
  return width;
}

/**
 * Cut `text` to at most `maxWidth` cells, marking the cut with `ellipsis`.
 *
 * Iterates by code point (never by UTF-16 unit) so a surrogate pair is never
 * split in half, and accounts for wide glyphs so the result never overshoots
 * the budget. ANSI escapes are carried through verbatim and a reset is
 * appended when the cut lands inside a styled run, so a truncated coloured
 * label cannot bleed its colour into the rest of the frame.
 */
function fallbackTruncateToWidth(text: string, maxWidth: number, ellipsis = "…"): string {
  if (maxWidth <= 0) return "";
  if (fallbackVisibleWidth(text) <= maxWidth) return text;

  const mark = fallbackVisibleWidth(ellipsis) <= maxWidth ? ellipsis : "";
  const budget = maxWidth - fallbackVisibleWidth(mark);

  let out = "";
  let width = 0;
  let styled = false;
  let index = 0;

  while (index < text.length) {
    ANSI_RE.lastIndex = index;
    const match = ANSI_RE.exec(text);
    if (match && match.index === index) {
      out += match[0];
      styled = match[0] !== ANSI_RESET;
      index += match[0].length;
      continue;
    }
    const ch = String.fromCodePoint(text.codePointAt(index) ?? 0);
    const cells = codePointWidth(ch.codePointAt(0) ?? 0);
    if (width + cells > budget) break;
    out += ch;
    width += cells;
    index += ch.length;
  }

  return out + mark + (styled ? ANSI_RESET : "");
}

/** The two width primitives, swappable for pi-tui's real implementations. */
export interface WidthFns {
  visibleWidth(text: string): number;
  truncateToWidth(text: string, maxWidth: number, ellipsis?: string): string;
}

/** The dependency-free fallbacks, used until pi injects its own. */
export const fallbackWidthFns: WidthFns = {
  visibleWidth: fallbackVisibleWidth,
  truncateToWidth: fallbackTruncateToWidth,
};

let widthFns: WidthFns = fallbackWidthFns;

/**
 * Adopt pi-tui's own width helpers.
 *
 * Width MUST be measured with the same rule `doRender` validates with, so when
 * a widget runs inside a real pi session it should hand pi's helpers over at
 * register time. Called with anything incomplete, the fallbacks stay.
 */
export function setWidthFns(fns: Partial<WidthFns> | null | undefined): void {
  if (!fns || typeof fns.visibleWidth !== "function" || typeof fns.truncateToWidth !== "function") return;
  widthFns = { visibleWidth: fns.visibleWidth, truncateToWidth: fns.truncateToWidth };
}

/** Printable width of `text` in terminal cells, ANSI escapes excluded. */
export function visibleWidth(text: string): number {
  return widthFns.visibleWidth(text);
}

/** Cut `text` to at most `maxWidth` cells, marking the cut with `ellipsis`. */
export function truncateToWidth(text: string, maxWidth: number, ellipsis = "…"): string {
  return widthFns.truncateToWidth(text, maxWidth, ellipsis);
}

/** Truncate *and* space-pad `text` so it occupies exactly `width` cells. */
export function padToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  const clipped = truncateToWidth(text, width);
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** The slice of a long list that is actually drawn, plus what it hides. */
export interface RowWindow {
  /** First drawn index, inclusive. */
  start: number;
  /** Last drawn index, exclusive. */
  end: number;
  /** How many items sit above `start`. */
  hiddenBefore: number;
  /** How many items sit below `end`. */
  hiddenAfter: number;
}

/**
 * Pick the slice of `total` items to draw so `cursor` is always visible.
 *
 * The window is centred on the cursor and clamped at both ends, so moving
 * through a long list scrolls only once the cursor reaches the edge instead of
 * jumping the viewport on every keystroke.
 */
export function windowRows(total: number, cursor: number, capacity: number): RowWindow {
  if (capacity <= 0 || total <= 0) {
    return { start: 0, end: 0, hiddenBefore: 0, hiddenAfter: Math.max(0, total) };
  }
  if (total <= capacity) {
    return { start: 0, end: total, hiddenBefore: 0, hiddenAfter: 0 };
  }
  const safeCursor = Math.min(Math.max(0, cursor), total - 1);
  const start = Math.min(Math.max(0, safeCursor - Math.floor(capacity / 2)), total - capacity);
  const end = start + capacity;
  return { start, end, hiddenBefore: start, hiddenAfter: total - end };
}

/**
 * Rows pi's own chrome (input box, status line, spacing) takes off the top of
 * the terminal height before a widget gets any.
 */
const PI_CHROME_ROWS = 8;

/** Never render a block shorter than this, however small the terminal claims to be. */
const MIN_BLOCK_ROWS = 8;

/**
 * How many rows a zero block may use in a terminal of `terminalRows` rows.
 *
 * A terminal too short to host the reserve still gets `MIN_BLOCK_ROWS` — a
 * slightly-too-tall block beats an empty frame.
 */
export function usableRows(terminalRows: number | undefined): number {
  if (!terminalRows || !Number.isFinite(terminalRows) || terminalRows <= 0) return MIN_BLOCK_ROWS * 2;
  return Math.max(MIN_BLOCK_ROWS, terminalRows - PI_CHROME_ROWS);
}

/**
 * Last-resort height clamp for an already-rendered block.
 *
 * Keeps the *first* `maxRows` lines: when something still overflows, losing the
 * bottom border beats losing the frame top and the title, which is exactly what
 * the terminal's own scroll takes away.
 */
export function fitRows(lines: readonly string[], maxRows: number): string[] {
  if (maxRows <= 0) return [];
  return lines.length <= maxRows ? [...lines] : lines.slice(0, maxRows);
}
