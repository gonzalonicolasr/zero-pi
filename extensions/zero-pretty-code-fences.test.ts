import assert from "node:assert/strict";
import test from "node:test";
import { isEmptyHtmlComment } from "./markdown-cleanup.ts";

test("hides only empty HTML comment separators", () => {
	assert.equal(isEmptyHtmlComment({ type: "html", raw: "<!-- -->" }), true);
	assert.equal(isEmptyHtmlComment({ type: "html", raw: "  <!--   -->\n" }), true);
	assert.equal(isEmptyHtmlComment({ type: "html", raw: "<!-- useful -->" }), false);
	assert.equal(isEmptyHtmlComment({ type: "paragraph", raw: "<!-- -->" }), false);
});
