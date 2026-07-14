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
		return lines;
	};
}

export default function (_pi: ExtensionAPI) {
	patchMarkdownRenderer();
}
