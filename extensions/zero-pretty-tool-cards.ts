// zero-pi — prettier tool execution cards.
//
// Runtime patch only: pi owns the ToolExecutionComponent. This extension keeps
// the visual change defensive and dependency-free for tests by importing pi's
// component and pi-tui's width helpers dynamically at runtime.

const PATCHED = Symbol.for("gon.pi.pretty-tool-cards.patched");
const ANSI_RE = /\x1b\[[0-9;]*m/g;

interface ExtensionAPI {}

type ToolExecutionClass = {
	prototype: {
		render: (width: number) => string[];
		toolName?: string;
		args?: unknown;
		isPartial?: boolean;
		result?: { isError?: boolean };
		[PATCHED]?: boolean;
	};
};

type WidthFns = {
	visibleWidth: (text: string) => number;
	truncateToWidth: (text: string, maxWidth: number, ellipsis?: string) => string;
};

function rgb(hex: string, text: string): string {
	const clean = hex.replace(/^#/, "");
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

const c = {
	border: (s: string) => rgb("#a78bfa", s),
	borderDim: (s: string) => rgb("#3c3552", s),
	cyan: (s: string) => rgb("#35e8ff", s),
	gold: (s: string) => rgb("#ffd166", s),
	mint: (s: string) => rgb("#2dfcb3", s),
	rose: (s: string) => rgb("#ff4f7b", s),
	dim: (s: string) => rgb("#6e657e", s),
};

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

// Width MUST be measured with the same rule pi-tui's doRender validates with:
// emoji/CJK count as 2 cells, ANSI and OSC sequences count as 0. Inside pi the
// real pi-tui helpers are injected at register time; this naive fallback only
// serves tests and non-pi contexts, where nothing enforces terminal width.
export const fallbackWidthFns: WidthFns = {
	visibleWidth: (text) => stripAnsi(text).length,
	truncateToWidth: (text, maxWidth, ellipsis = "…") => {
		const plain = stripAnsi(text);
		if (plain.length <= maxWidth) return text;
		return plain.slice(0, Math.max(0, maxWidth - 1)) + ellipsis;
	},
};

let widthFns: WidthFns = fallbackWidthFns;

export function setWidthFns(fns: WidthFns): void {
	widthFns = fns;
}

function padAnsi(text: string, width: number): string {
	const clipped = widthFns.truncateToWidth(text, width, "…");
	return clipped + " ".repeat(Math.max(0, width - widthFns.visibleWidth(clipped)));
}

function basename(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function toolCardTitle(toolName: string, args?: unknown): string {
	const name = toolName || "tool";
	if (args && typeof args === "object") {
		const a = args as Record<string, unknown>;
		const path = typeof a.path === "string" ? a.path : typeof a.url === "string" ? a.url : "";
		if (path) {
			const lineRange = typeof a.offset === "number"
				? `:${a.offset}${typeof a.limit === "number" ? `-${a.offset + a.limit - 1}` : ""}`
				: "";
			return `${name} · ${basename(path)}${lineRange}`;
		}
		const command = typeof a.command === "string" ? a.command.trim() : "";
		if (command) return `${name} · ${command.split(/\s+/).slice(0, 3).join(" ")}`;
	}
	return name;
}

export function toolCardStatus(isPartial: boolean, isError: boolean): { glyph: string; color: (s: string) => string; label: string } {
	if (isPartial) return { glyph: "⠋", color: c.cyan, label: "running" };
	if (isError) return { glyph: "✗", color: c.rose, label: "error" };
	return { glyph: "✓", color: c.mint, label: "ok" };
}

export function frameToolCard(lines: string[], width: number, title: string, status = toolCardStatus(false, false)): string[] {
	if (width < 28) return lines;
	const inner = Math.max(8, width - 4);
	const cleanLines = [...lines];
	while (cleanLines.length > 0 && stripAnsi(cleanLines[0] ?? "").trim() === "") cleanLines.shift();
	while (cleanLines.length > 0 && stripAnsi(cleanLines[cleanLines.length - 1] ?? "").trim() === "") cleanLines.pop();

	const label = `${status.color(status.glyph)} ${c.gold(title)} ${c.dim(`(${status.label})`)}`;
	const topPrefix = `${c.border("╭─")} ${label} `;
	const topSuffix = c.border("╮");
	const topFill = Math.max(1, width - widthFns.visibleWidth(topPrefix) - widthFns.visibleWidth(topSuffix));
	const bottom = `${c.border("╰")}${c.borderDim("─".repeat(Math.max(1, width - 2)))}${c.border("╯")}`;

	// Clamp: a title wider than the terminal would also trip doRender's width check.
	const framed = [widthFns.truncateToWidth(`${topPrefix}${c.borderDim("─".repeat(topFill))}${topSuffix}`, width, "…")];
	for (const line of cleanLines) {
		framed.push(`${c.border("│")} ${padAnsi(line, inner)} ${c.border("│")}`);
	}
	framed.push(bottom);
	return framed;
}

export function patchToolCards(ToolExecutionComponent: ToolExecutionClass): boolean {
	const proto = ToolExecutionComponent.prototype;
	if (!proto || typeof proto.render !== "function") return false;
	if (proto[PATCHED]) return false;
	proto[PATCHED] = true;

	const originalRender = proto.render;
	proto.render = function prettyToolCardRender(width: number): string[] {
		const raw = originalRender.call(this, Math.max(24, width - 4));
		if (raw.length === 0) return raw;
		const status = toolCardStatus(Boolean(this.isPartial), Boolean(this.result?.isError));
		return frameToolCard(raw, width, toolCardTitle(this.toolName ?? "tool", this.args), status);
	};
	return true;
}

export default function (_pi: ExtensionAPI) {
	void Promise.all([
		import("@earendil-works/pi-coding-agent"),
		import("@earendil-works/pi-tui"),
	])
		.then(([agent, tui]) => {
			const helpers = tui as { visibleWidth?: WidthFns["visibleWidth"]; truncateToWidth?: WidthFns["truncateToWidth"] };
			if (!helpers.visibleWidth || !helpers.truncateToWidth) return;
			setWidthFns({ visibleWidth: helpers.visibleWidth, truncateToWidth: helpers.truncateToWidth });
			const ToolExecutionComponent = (agent as { ToolExecutionComponent?: ToolExecutionClass }).ToolExecutionComponent;
			if (ToolExecutionComponent) patchToolCards(ToolExecutionComponent);
		})
		.catch(() => {
			// Dependencies are only available inside pi's runtime. Tests and non-TUI
			// modes skip the patch instead of rendering cards measured with the fallback.
		});
}
