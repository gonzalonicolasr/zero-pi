import { test } from "node:test";
import assert from "node:assert/strict";

import { fallbackWidthFns, frameInputBox, inputBoxBorder, setWidthFns } from "./zero-pretty-input-box.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const WIDE_RE = /[✅❌　-ヿ一-鿿＀-｠]/;

function visibleWidth(text: string): number {
	return text.replace(ANSI_RE, "").length;
}

// Réplica mínima de la medición de pi-tui: emojis BMP tipo ✅/❌ y CJK = 2 celdas.
function wideVisibleWidth(text: string): number {
	let width = 0;
	for (const ch of text.replace(ANSI_RE, "")) width += WIDE_RE.test(ch) ? 2 : 1;
	return width;
}

function wideTruncateToWidth(text: string, maxWidth: number, ellipsis = "…"): string {
	if (wideVisibleWidth(text) <= maxWidth) return text;
	const budget = maxWidth - wideVisibleWidth(ellipsis);
	let out = "";
	let width = 0;
	for (const ch of text.replace(ANSI_RE, "")) {
		const chWidth = WIDE_RE.test(ch) ? 2 : 1;
		if (width + chWidth > budget) break;
		out += ch;
		width += chWidth;
	}
	return out + ellipsis;
}

test("inputBoxBorder never exceeds the terminal width", () => {
	// Regresión del crash "Rendered line 1414 exceeds terminal width (33 > 31)":
	// las etiquetas del borde superior no entraban y el fill mínimo desbordaba.
	for (let width = 4; width <= 120; width++) {
		for (const side of ["top", "bottom"] as const) {
			const line = inputBoxBorder(width, side);
			assert.equal(visibleWidth(line), width, `${side} @ ${width}: ${visibleWidth(line)} != ${width}`);
		}
	}
});

test("inputBoxBorder degrades labels instead of overflowing on a narrow terminal", () => {
	const narrow = inputBoxBorder(31, "top");
	assert.equal(visibleWidth(narrow), 31);
	assert.match(narrow, /ZERO/);
	assert.match(narrow, /Enter ↵/);
	assert.doesNotMatch(narrow, /prompt/);
});

test("inputBoxBorder keeps the full labels when there is room", () => {
	const wide = inputBoxBorder(100, "top");
	assert.equal(visibleWidth(wide), 100);
	assert.match(wide, /ZERO/);
	assert.match(wide, /prompt/);
	assert.match(wide, /Enter ↵/);

	const bottom = inputBoxBorder(100, "bottom");
	assert.equal(visibleWidth(bottom), 100);
	assert.match(bottom, /ctrl\+j newline/);
	assert.match(bottom, /esc stop/);
});

test("inputBoxBorder surfaces the scroll indicator over the Enter hint", () => {
	const line = inputBoxBorder(60, "top", "─── ↑ 12 more ───");
	assert.equal(visibleWidth(line), 60);
	assert.match(line, /↑ 12 more/);
	assert.doesNotMatch(line, /Enter/);
});

test("frameInputBox emits lines of exactly the terminal width", () => {
	for (const width of [24, 31, 40, 80, 211]) {
		const framed = frameInputBox(["─".repeat(width - 2), "hola mundo", "segunda línea", "─".repeat(width - 2)], width);
		for (const line of framed) {
			assert.equal(visibleWidth(line), width, `line exceeds width: ${visibleWidth(line)} != ${width}`);
		}
	}
});

test("frameInputBox never exceeds width for emoji/CJK when measured like pi-tui", () => {
	setWidthFns({ visibleWidth: wideVisibleWidth, truncateToWidth: wideTruncateToWidth });
	try {
		const framed = frameInputBox(
			["─".repeat(58), "✅ ❌ glifos de 2 celdas", "日本語のテキスト y contenido normal mezclado", "─".repeat(58)],
			60,
		);
		for (const line of framed) {
			assert.ok(wideVisibleWidth(line) <= 60, `line exceeds width: ${wideVisibleWidth(line)} > 60`);
		}
	} finally {
		setWidthFns(fallbackWidthFns);
	}
});
