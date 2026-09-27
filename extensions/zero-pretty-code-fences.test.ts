import assert from "node:assert/strict";
import test from "node:test";
import { isEmptyHtmlComment } from "./markdown-cleanup.ts";
import { FENCE_MIN_WIDTH, FENCE_PROSE_WIDTH, fenceBody, fenceWidth } from "./zero-pretty-code-fences.ts";
import { visibleWidth } from "./zero-tui-layout.ts";

test("hides only empty HTML comment separators", () => {
	assert.equal(isEmptyHtmlComment({ type: "html", raw: "<!-- -->" }), true);
	assert.equal(isEmptyHtmlComment({ type: "html", raw: "  <!--   -->\n" }), true);
	assert.equal(isEmptyHtmlComment({ type: "html", raw: "<!-- useful -->" }), false);
	assert.equal(isEmptyHtmlComment({ type: "paragraph", raw: "<!-- -->" }), false);
});

// ---------------------------------------------------------------------------
// Responsive fences — the box must survive any code line and any terminal
// ---------------------------------------------------------------------------

test("fenceWidth keeps a comfortable reading width for short code", () => {
	assert.equal(fenceWidth(200, ["const a = 1;"]), FENCE_PROSE_WIDTH);
});

test("fenceWidth grows past the prose cap when the code is wider and the terminal allows", () => {
	const long = "x".repeat(140);
	assert.equal(fenceWidth(200, [long]), 142);
});

test("fenceWidth never exceeds the terminal", () => {
	const long = "x".repeat(300);
	assert.equal(fenceWidth(80, [long]), 80);
	assert.equal(fenceWidth(40, ["short"]), 40);
});

test("fenceWidth never goes below the documented minimum", () => {
	assert.equal(fenceWidth(2, ["hola"]), FENCE_MIN_WIDTH);
	assert.equal(fenceWidth(0, []), FENCE_MIN_WIDTH);
});

test("fenceBody clamps every code row to the fence's inner width", () => {
	const rows = fenceBody(["x".repeat(200), "corto"], 80);
	for (const row of rows) assert.ok(visibleWidth(row) <= 78, `fila de ${visibleWidth(row)} celdas en una caja de 80`);
});

test("fenceBody marks a clamped row so nothing looks silently complete", () => {
	const [row] = fenceBody(["x".repeat(200)], 80);
	assert.ok(row.endsWith("…"), "recortó sin marcar el corte");
});

test("fenceBody leaves code that already fits byte-identical", () => {
	const code = ["const a = 1;", "const b = 2;"];
	assert.deepEqual(fenceBody(code, 96), code);
});

test("a fence plus its gutter never overflows the terminal", () => {
	const code = ["y".repeat(500), "z".repeat(3)];
	for (const terminal of [24, 40, 80, 120, 200]) {
		const fence = fenceWidth(terminal, code);
		assert.ok(fence <= terminal, `caja de ${fence} en una terminal de ${terminal}`);
		for (const row of fenceBody(code, fence)) {
			assert.ok(visibleWidth(row) + 2 <= terminal, "la fila más el gutter se pasa del ancho");
		}
	}
});
