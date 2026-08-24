// zero-pi — prettier prompt input box.
//
// Runtime patch only: pi owns the Editor component. Like the tool cards, the
// framing logic stays dependency-free so tests can measure it; pi-tui's real
// width helpers are injected at register time.

const PATCHED = Symbol.for("gon.pi.pretty-input-box.patched");
const FRAME_CACHE = Symbol.for("gon.pi.pretty-input-box.frameCache");
const ANSI_RE = /\x1b\[[0-9;]*m/g;

type WidthFns = {
	visibleWidth: (text: string) => number;
	truncateToWidth: (text: string, maxWidth: number, ellipsis?: string) => string;
};

type EditorClass = {
	prototype: {
		render: (width: number) => string[];
		[PATCHED]?: boolean;
		[FRAME_CACHE]?: { key: string; lines: string[] };
	};
};

function rgb(hex: string, text: string): string {
	const clean = hex.replace(/^#/, "");
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

const c = {
	border: (s: string) => rgb("#ff6b5f", s),
	borderDim: (s: string) => rgb("#8b514a", s),
	cyan: (s: string) => rgb("#00d7ff", s),
	green: (s: string) => rgb("#00ff8a", s),
	gold: (s: string) => rgb("#f6b85a", s),
	muted: (s: string) => rgb("#7a6d62", s),
};

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

// Width MUST be measured with the same rule pi-tui's doRender validates with.
// Inside pi the real helpers are injected; this naive fallback only serves
// tests and non-pi contexts, where nothing enforces terminal width.
export const fallbackWidthFns: WidthFns = {
	visibleWidth: (text) => stripAnsi(text).length,
	truncateToWidth: (text, maxWidth, ellipsis = "…") => {
		const plain = stripAnsi(text);
		if (plain.length <= maxWidth) return text;
		return plain.slice(0, Math.max(0, maxWidth - ellipsis.length)) + ellipsis;
	},
};

let widthFns: WidthFns = fallbackWidthFns;

export function setWidthFns(fns: WidthFns): void {
	widthFns = fns;
}

function padAnsi(text: string, width: number): string {
	const clipped = widthFns.truncateToWidth(text, width, "");
	return clipped + " ".repeat(Math.max(0, width - widthFns.visibleWidth(clipped)));
}

/**
 * Border line of the prompt box, exactly `width` cells wide.
 *
 * Las etiquetas se degradan de mayor a menor (completa → corta → solo esquina)
 * en vez de forzar un relleno mínimo: en una terminal angosta la versión larga
 * no entra y la línea desbordaba el ancho, que es lo que pi-tui rechaza.
 */
export function inputBoxBorder(width: number, side: "top" | "bottom", original = ""): string {
	if (width < 4) return c.border("─".repeat(Math.max(0, width)));

	const isTop = side === "top";
	const leftCorner = isTop ? "╭" : "╰";
	const rightCorner = isTop ? "╮" : "╯";
	const scroll = stripAnsi(original).match(/[↑↓] \d+ more/)?.[0];

	const lefts = isTop
		? [
			`${c.border(leftCorner + "─")} ${c.cyan("π")} ${c.muted("•")} ${c.green("ZERO")} ${c.muted("•")} ${c.gold("prompt")} `,
			`${c.border(leftCorner + "─")} ${c.green("ZERO")} `,
			c.border(leftCorner),
		]
		: [
			`${c.border(leftCorner + "─")} ${c.muted("ctrl+j newline")} `,
			`${c.border(leftCorner + "─")} ${c.muted("ctrl+j")} `,
			c.border(leftCorner),
		];
	const rights = isTop
		? [` ${scroll ? c.gold(scroll) : c.muted("Enter ↵")} ${c.border("─" + rightCorner)}`, c.border(rightCorner)]
		: [` ${c.muted("esc stop")} ${c.border("─" + rightCorner)}`, c.border(rightCorner)];

	// El label derecho (scroll / Enter) es información, el izquierdo es marca:
	// se achica primero la izquierda y recién después se suelta la derecha.
	for (const right of rights) {
		for (const left of lefts) {
			const fill = width - widthFns.visibleWidth(left) - widthFns.visibleWidth(right);
			if (fill >= 1) {
				// Clamp: si la medición del host difiere, truncar antes que crashear.
				return widthFns.truncateToWidth(left + c.borderDim("─".repeat(fill)) + right, width, "");
			}
		}
	}
	return c.border(leftCorner) + c.borderDim("─".repeat(width - 2)) + c.border(rightCorner);
}

function isHorizontalEditorLine(text: string): boolean {
	const stripped = stripAnsi(text).trim();
	return /^─+$/.test(stripped) || /^─── [↑↓] \d+ more/.test(stripped);
}

/** Frame an Editor rendering (already rendered at `width - 2`) in the ZERO box. */
export function frameInputBox(raw: string[], width: number): string[] {
	const innerWidth = Math.max(1, width - 2);
	const bottomIndex = raw.findIndex((rawLine, index) => index > 0 && isHorizontalEditorLine(rawLine));
	const resolvedBottomIndex = bottomIndex === -1 ? raw.length - 1 : bottomIndex;
	const result: string[] = [];

	result.push(inputBoxBorder(width, "top", raw[0]));
	for (let i = 1; i < resolvedBottomIndex; i++) {
		result.push(`${c.border("│")} ${padAnsi(raw[i], innerWidth - 2)} ${c.border("│")}`);
	}
	result.push(inputBoxBorder(width, "bottom", raw[resolvedBottomIndex]));
	for (let i = resolvedBottomIndex + 1; i < raw.length; i++) {
		result.push(`${c.border("│")} ${padAnsi(raw[i], innerWidth - 2)} ${c.border("│")}`);
	}

	return result;
}

export function patchEditor(Editor: EditorClass): boolean {
	const proto = Editor.prototype;
	if (!proto || typeof proto.render !== "function") return false;
	if (proto[PATCHED]) return false;
	proto[PATCHED] = true;

	const originalRender = proto.render;
	proto.render = function prettyEditorRender(width: number): string[] {
		if (width < 24) return originalRender.call(this, width);

		const innerWidth = Math.max(1, width - 2);
		const raw = originalRender.call(this, innerWidth);
		// Too short to frame: return the inner render as-is. Re-rendering at full
		// width here (the previous behaviour) doubled the per-frame work for the
		// common short prompt — a full extra Editor render on every keystroke.
		if (raw.length < 3) return raw;

		// pi-tui re-renders every visible component each frame with no upstream
		// memoization, and framing costs visibleWidth() per line. Reuse the framed
		// output while the editor content is unchanged (e.g. while the model
		// streams) so only real edits pay the cost.
		const cache = this[FRAME_CACHE];
		const key = JSON.stringify([width, raw]);
		if (cache && cache.key === key) return cache.lines;

		const lines = frameInputBox(raw, width);
		this[FRAME_CACHE] = { key, lines };
		return lines;
	};
	return true;
}

export default function (_pi: unknown) {
	void import("@earendil-works/pi-tui")
		.then((tui) => {
			const helpers = tui as {
				Editor?: EditorClass;
				visibleWidth?: WidthFns["visibleWidth"];
				truncateToWidth?: WidthFns["truncateToWidth"];
			};
			if (!helpers.Editor || !helpers.visibleWidth || !helpers.truncateToWidth) return;
			setWidthFns({ visibleWidth: helpers.visibleWidth, truncateToWidth: helpers.truncateToWidth });
			patchEditor(helpers.Editor);
		})
		.catch(() => {
			// pi-tui only resolves inside pi's runtime. Tests and non-TUI modes skip
			// the patch instead of framing with the fallback measurement.
		});
}
