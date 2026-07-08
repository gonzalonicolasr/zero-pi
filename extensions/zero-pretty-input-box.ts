import { Editor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PATCHED = Symbol.for("gon.pi.pretty-input-box.patched");
const ANSI_RE = /\x1b\[[0-9;]*m/g;

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

function padAnsi(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function line(width: number, side: "top" | "bottom", original = ""): string {
	if (width < 20) return c.border("─".repeat(width));

	const isTop = side === "top";
	const leftCorner = isTop ? "╭" : "╰";
	const rightCorner = isTop ? "╮" : "╯";
	const strippedOriginal = stripAnsi(original);
	const scrollMatch = strippedOriginal.match(/[↑↓] \d+ more/);

	const leftLabel = isTop
		? `${c.border(leftCorner + "─")} ${c.cyan("π")} ${c.muted("•")} ${c.green("ZERO")} ${c.muted("•")} ${c.gold("prompt")} `
		: `${c.border(leftCorner + "─")} ${c.muted("ctrl+j newline")} `;
	const rightLabel = isTop
		? ` ${scrollMatch ? c.gold(scrollMatch[0]) : c.muted("Enter ↵")} ${c.border("─" + rightCorner)}`
		: ` ${c.muted("esc stop")} ${c.border("─" + rightCorner)}`;

	const fill = Math.max(1, width - visibleWidth(leftLabel) - visibleWidth(rightLabel));
	return leftLabel + c.borderDim("─".repeat(fill)) + rightLabel;
}

function isHorizontalEditorLine(text: string): boolean {
	const stripped = stripAnsi(text).trim();
	return /^─+$/.test(stripped) || /^─── [↑↓] \d+ more/.test(stripped);
}

function patchEditor(): void {
	const proto = Editor.prototype as unknown as {
		render: (width: number) => string[];
		[PATCHED]?: boolean;
	};
	if (proto[PATCHED]) return;
	proto[PATCHED] = true;

	const originalRender = proto.render;
	proto.render = function prettyEditorRender(width: number): string[] {
		if (width < 24) return originalRender.call(this, width);

		const innerWidth = Math.max(1, width - 2);
		const raw = originalRender.call(this, innerWidth);
		if (raw.length < 3) return originalRender.call(this, width);

		const bottomIndex = raw.findIndex((rawLine, index) => index > 0 && isHorizontalEditorLine(rawLine));
		const resolvedBottomIndex = bottomIndex === -1 ? raw.length - 1 : bottomIndex;
		const result: string[] = [];

		result.push(line(width, "top", raw[0]));
		for (let i = 1; i < resolvedBottomIndex; i++) {
			result.push(`${c.border("│")} ${padAnsi(raw[i], innerWidth - 2)} ${c.border("│")}`);
		}
		result.push(line(width, "bottom", raw[resolvedBottomIndex]));
		for (let i = resolvedBottomIndex + 1; i < raw.length; i++) {
			result.push(`${c.border("│")} ${padAnsi(raw[i], innerWidth - 2)} ${c.border("│")}`);
		}

		return result;
	};
}

export default function (_pi: ExtensionAPI) {
	patchEditor();
}
