// zero-pi — prettier tool execution cards.
//
// Runtime patch only: pi owns the ToolExecutionComponent. This extension keeps
// the visual change defensive and dependency-free for tests by importing pi's
// component and pi-tui's width helpers dynamically at runtime.

const PATCHED = Symbol.for("gon.pi.pretty-tool-cards.patched");
const FRAME_CACHE = Symbol.for("gon.pi.pretty-tool-cards.frameCache");
const ANSI_RE = /\x1b\[[0-9;]*m/g;

// Tools whose activity is pi-subagents plumbing (the intercom / supervisor
// channel), not something to dress up as a card in the user's main terminal.
const SILENCED_TOOL_NAMES = new Set(["intercom", "contact_supervisor"]);

/** Whether a tool card should be suppressed entirely (kept out of the TUI). */
export function shouldSilenceToolCard(toolName?: string): boolean {
	return SILENCED_TOOL_NAMES.has((toolName ?? "").toLowerCase());
}

// Quiet mode: during a long run (a /forge pipeline, a big refactor) the framed
// cards bury the few lines that matter — phase summaries and the verdict. Quiet
// mode collapses every card to a single line; ctrl+o still expands one card.
let quietMode = false;

/** Parse ZERO_QUIET from an env bag. Anything other than 1/true/on/yes is off. */
export function readQuietEnv(env: Record<string, string | undefined>): boolean {
	const raw = (env.ZERO_QUIET ?? "").trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

export function setQuietMode(on: boolean): void {
	quietMode = on;
}

export function isQuietMode(): boolean {
	return quietMode;
}

interface CommandContext {
	ui?: { notify?: (message: string, level?: "info" | "warning" | "error") => void };
}

interface ExtensionAPI {
	registerCommand?: (
		name: string,
		options: { description?: string; handler: (args: string, ctx: CommandContext) => void },
	) => void;
}

type ToolExecutionClass = {
	prototype: {
		render: (width: number) => string[];
		toolName?: string;
		args?: unknown;
		isPartial?: boolean;
		expanded?: boolean;
		result?: { isError?: boolean };
		[PATCHED]?: boolean;
		[FRAME_CACHE]?: { key: string; lines: string[] };
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

/** One-line stand-in for a framed card: status glyph, title, and what it hides. */
export function quietToolCardLine(
	title: string,
	status: ReturnType<typeof toolCardStatus>,
	rawLines: string[],
	width: number,
): string {
	const meta = rawLines.length > 1 ? `(${status.label} · ${rawLines.length} lines · ctrl+o)` : `(${status.label})`;
	return widthFns.truncateToWidth(`${status.color(status.glyph)} ${c.gold(title)} ${c.dim(meta)}`, width, "…");
}

export function frameToolCard(lines: string[], width: number, title: string, status = toolCardStatus(false, false)): string[] {
	// Demasiado angosto para el marco: se devuelve el render crudo, pero recortado
	// igual — acá no hay padAnsi que garantice el ancho y doRender mata pi entero.
	if (width < 28) return lines.map((line) => widthFns.truncateToWidth(line, width, "…"));
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
		// Intercom / supervisor-channel chatter is pi-subagents plumbing, not our
		// tool — keep it out of the main terminal instead of framing it.
		if (shouldSilenceToolCard(this.toolName)) return [];

		// Las 4 celdas son el marco ("│ " + " │"). Debajo del umbral de
		// frameToolCard la tarjeta va sin marco, así que el render interno se lleva
		// el ancho entero. Nunca pedir MÁS de lo que mide la terminal: un piso fijo
		// acá dibujaba tarjetas de 24 celdas en un pane de 15 y doRender mataba pi.
		const raw = originalRender.call(this, width >= 28 ? width - 4 : Math.max(1, width));
		if (raw.length === 0) return raw;
		const status = toolCardStatus(Boolean(this.isPartial), Boolean(this.result?.isError));
		const title = toolCardTitle(this.toolName ?? "tool", this.args);

		// pi-tui re-invokes render() on every visible component each frame with no
		// upstream memoization, and framing costs visibleWidth() per line — which
		// scales with terminal height. Reuse the framed output while the underlying
		// render is unchanged so static cards cost ~nothing per frame.
		const quiet = quietMode && !this.expanded;
		const cache = this[FRAME_CACHE];
		const key = JSON.stringify([width, status.label, title, raw, quiet]);
		if (cache && cache.key === key) return cache.lines;
		const lines = quiet ? [quietToolCardLine(title, status, raw, width)] : frameToolCard(raw, width, title, status);
		this[FRAME_CACHE] = { key, lines };
		return lines;
	};
	return true;
}

export default function (pi: ExtensionAPI) {
	setQuietMode(readQuietEnv(process.env));
	try {
		pi?.registerCommand?.("zero-quiet", {
			description: "Colapsa cada tool card a una línea (on|off, sin argumento alterna)",
			handler: (args: string, ctx: CommandContext): void => {
				const arg = (args ?? "").trim().toLowerCase();
				const next = arg === "" || arg === "toggle" ? !isQuietMode() : readQuietEnv({ ZERO_QUIET: arg });
				setQuietMode(next);
				ctx?.ui?.notify?.(
					next ? "zero-quiet: on — una línea por tool card, ctrl+o expande" : "zero-quiet: off — tool cards completas",
					"info",
				);
			},
		});
	} catch {
		// Older pi builds without registerCommand keep the env-var control only.
	}

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
