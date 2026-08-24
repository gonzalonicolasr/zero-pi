import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isEmptyHtmlComment, type MarkdownToken } from "./markdown-cleanup.ts";

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

function border(theme: MarkdownInstance["theme"], width: number, position: "top" | "bottom", lang = ""): string {
	const maxWidth = Math.max(10, Math.min(width, 96));
	if (position === "bottom") {
		return theme.codeBlockBorder(`╰${"─".repeat(Math.max(1, maxWidth - 2))}╯`);
	}

	const label = lang ? ` ${lang} ` : "";
	const prefix = `╭─${label}`;
	const suffix = "╮";
	const fill = "─".repeat(Math.max(1, maxWidth - visibleWidth(prefix) - visibleWidth(suffix)));
	return theme.codeBlockBorder(`${prefix}${fill}${suffix}`);
}

function patchMarkdownRenderer(): void {
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
		lines.push(border(this.theme, width, "top", lang));

		if (this.theme.highlightCode) {
			const highlightedLines = this.theme.highlightCode(token.text ?? "", token.lang);
			for (const hlLine of highlightedLines) {
				lines.push(`${gutter}${hlLine}`);
			}
		} else {
			const codeLines = (token.text ?? "").split("\n");
			for (const codeLine of codeLines) {
				lines.push(`${gutter}${this.theme.codeBlock(codeLine)}`);
			}
		}

		lines.push(border(this.theme, width, "bottom"));
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
	patchMarkdownRenderer();
}
