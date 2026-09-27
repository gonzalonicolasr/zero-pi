// pi-tui is imported dynamically (see the default export) so `node --test` can
// load this module and exercise the pure fence-layout helpers without the
// dependency, exactly as `zero-pretty-tool-cards.ts` does.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isEmptyHtmlComment, type MarkdownToken } from "./markdown-cleanup.ts";
import { setWidthFns, truncateToWidth, visibleWidth } from "./zero-tui-layout.ts";

type MarkdownClass = { prototype: MarkdownInstance & { [PATCHED]?: boolean } };

type MarkdownInstance = {
	theme: {
		codeBlock: (text: string) => string;
		codeBlockBorder: (text: string) => string;
		codeBlockIndent?: string;
		highlightCode?: (code: string, lang?: string) => string[];
	};
	renderToken: (token: MarkdownToken, width: number, nextTokenType?: string, styleContext?: unknown) => string[];
};

const PATCHED = Symbol.for("gon.pi.pretty-code-fences.patched.v2");
const FENCE_CACHE = Symbol.for("gon.pi.pretty-code-fences.cache");
const MAX_FENCE_CACHE = 256;

function displayLang(lang?: string): string {
	const raw = (lang ?? "").trim().toLowerCase();
	if (!raw || raw === "txt" || raw === "text" || raw === "plain") return "";
	if (raw === "typescript") return "ts";
	if (raw === "javascript") return "js";
	if (raw === "shell" || raw === "bash") return "sh";
	return raw;
}

/** Narrowest fence worth drawing. */
export const FENCE_MIN_WIDTH = 10;
/** Comfortable reading width for a fence whose code is short. */
export const FENCE_PROSE_WIDTH = 96;
/** Cells the left gutter (`"│ "`) takes off every code row. */
const FENCE_GUTTER = 2;

/**
 * Outer width of a fence in a `terminalWidth`-column terminal.
 *
 * Fences are capped at a comfortable reading width, but that cap used to apply
 * even when the code was far wider than it — so a long command was cut (or,
 * worse, left to overflow and wrap, tearing the frame) on a terminal with
 * plenty of room. The cap now *grows* to fit the code whenever the terminal
 * allows it, and the terminal is always the hard ceiling.
 */
export function fenceWidth(terminalWidth: number, codeLines: readonly string[]): number {
	let longest = 0;
	for (const line of codeLines) longest = Math.max(longest, visibleWidth(line));
	const wanted = Math.max(FENCE_PROSE_WIDTH, longest + FENCE_GUTTER);
	return Math.max(FENCE_MIN_WIDTH, Math.min(terminalWidth, wanted));
}

/**
 * Clamp every code row to what fits inside the fence.
 *
 * pi prints a widget's lines verbatim: a row wider than the terminal wraps,
 * loses its gutter on the wrapped part and breaks the block apart. Marked
 * truncation keeps the fence a fence.
 */
export function fenceBody(codeLines: readonly string[], fenceOuterWidth: number): string[] {
	const inner = Math.max(1, fenceOuterWidth - FENCE_GUTTER);
	return codeLines.map((line) => truncateToWidth(line, inner));
}

function border(theme: MarkdownInstance["theme"], width: number, position: "top" | "bottom", lang = ""): string {
	const maxWidth = Math.max(FENCE_MIN_WIDTH, width);
	if (position === "bottom") {
		return theme.codeBlockBorder(`╰${"─".repeat(Math.max(1, maxWidth - 2))}╯`);
	}

	const label = lang ? ` ${lang} ` : "";
	const prefix = `╭─${label}`;
	const suffix = "╮";
	const fill = "─".repeat(Math.max(1, maxWidth - visibleWidth(prefix) - visibleWidth(suffix)));
	return theme.codeBlockBorder(`${prefix}${fill}${suffix}`);
}

function patchMarkdownRenderer(Markdown: MarkdownClass): void {
	const proto = Markdown.prototype as unknown as MarkdownInstance & { [PATCHED]?: boolean };
	if (proto[PATCHED]) return;
	proto[PATCHED] = true;

	const original = proto.renderToken;
	proto.renderToken = function prettyRenderToken(token, width, nextTokenType, styleContext): string[] {
		if (isEmptyHtmlComment(token)) return [];

		if (token?.type !== "code") {
			return original.call(this, token, width, nextTokenType, styleContext);
		}

		// pi-tui re-renders visible markdown on every frame with no memoization,
		// and building a fenced block scans/segments every code line. Cache the
		// output per (width, lang, nextTokenType, text), scoped to the active theme
		// object so a /theme switch invalidates it. Bounded to avoid unbounded
		// growth over a long session.
		const self = this as MarkdownInstance & { [FENCE_CACHE]?: { theme: unknown; map: Map<string, string[]> } };
		let store = self[FENCE_CACHE];
		if (!store || store.theme !== this.theme) {
			store = { theme: this.theme, map: new Map<string, string[]>() };
			self[FENCE_CACHE] = store;
		}
		const key = JSON.stringify([width, token.lang ?? "", nextTokenType ?? "", token.text ?? ""]);
		const cached = store.map.get(key);
		if (cached) return cached;

		const lang = displayLang(token.lang);
		const lines: string[] = [];
		const gutter = this.theme.codeBlockBorder("│ ");

		const rawLines = this.theme.highlightCode
			? this.theme.highlightCode(token.text ?? "", token.lang)
			: (token.text ?? "").split("\n").map((codeLine) => this.theme.codeBlock(codeLine));
		// Size the fence from the code, then clamp the code to the fence — in
		// that order, so a wide terminal is used before anything gets cut.
		const fence = fenceWidth(width, rawLines);

		lines.push(border(this.theme, fence, "top", lang));
		for (const codeLine of fenceBody(rawLines, fence)) lines.push(`${gutter}${codeLine}`);
		lines.push(border(this.theme, fence, "bottom"));
		if (nextTokenType && nextTokenType !== "space") {
			lines.push("");
		}

		store.map.set(key, lines);
		if (store.map.size > MAX_FENCE_CACHE) {
			const oldest = store.map.keys().next().value;
			if (oldest !== undefined) store.map.delete(oldest);
		}
		return lines;
	};
}

export default function (_pi: ExtensionAPI) {
	void import("@earendil-works/pi-tui")
		.then((tui) => {
			const helpers = tui as {
				Markdown?: MarkdownClass;
				visibleWidth?: (text: string) => number;
				truncateToWidth?: (text: string, maxWidth: number, ellipsis?: string) => string;
			};
			// Measure with pi-tui's own rule — the same one `doRender` validates
			// a line against — whenever it is available.
			setWidthFns({ visibleWidth: helpers.visibleWidth, truncateToWidth: helpers.truncateToWidth });
			if (helpers.Markdown) patchMarkdownRenderer(helpers.Markdown);
		})
		.catch(() => {
			// pi-tui only exists inside pi's runtime; tests skip the patch.
		});
}
