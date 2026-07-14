export type MarkdownToken = { type?: string; text?: string; lang?: string; raw?: string };

const EMPTY_HTML_COMMENT = /^<!--\s*-->$/;

export function isEmptyHtmlComment(token: MarkdownToken): boolean {
	return token.type === "html" && typeof token.raw === "string" && EMPTY_HTML_COMMENT.test(token.raw.trim());
}
