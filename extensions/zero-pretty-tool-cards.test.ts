import { test } from "node:test";
import assert from "node:assert/strict";

import { fallbackWidthFns, frameToolCard, setWidthFns, toolCardStatus, toolCardTitle } from "./zero-pretty-tool-cards.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const WIDE_RE = /[✅❌　-ヿ一-鿿＀-｠]/;

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

test("toolCardTitle extracts path basename and line range", () => {
	assert.equal(
		toolCardTitle("read", { path: "/home/gon/zero/packages/zero-pi/extensions/zero-hud.ts", offset: 10, limit: 5 }),
		"read · zero-hud.ts:10-14",
	);
});

test("toolCardTitle extracts a short command", () => {
	assert.equal(toolCardTitle("bash", { command: "npm test -- --watch false" }), "bash · npm test --");
});

test("toolCardStatus maps running, ok and error states", () => {
	assert.equal(toolCardStatus(true, false).label, "running");
	assert.equal(toolCardStatus(false, false).label, "ok");
	assert.equal(toolCardStatus(false, true).label, "error");
});

test("frameToolCard wraps content with a border and trims outer blanks", () => {
	const framed = frameToolCard(["", "hello", "world", ""], 48, "read · file.ts");
	assert.equal(framed.length, 4);
	assert.match(framed[0], /╭/);
	assert.match(framed[0], /read · file\.ts/);
	assert.match(framed[1], /│/);
	assert.match(framed.at(-1) ?? "", /╰/);
});

test("frameToolCard leaves narrow renderings untouched", () => {
	const raw = ["hello"];
	assert.equal(frameToolCard(raw, 20, "read"), raw);
});

test("frameToolCard never exceeds width for emoji/CJK when measured like pi-tui", () => {
	// Regresión del crash "Rendered line 10735 exceeds terminal width (212 > 210)":
	// el padding se calculaba con .length y los glifos de 2 celdas desbordaban.
	setWidthFns({ visibleWidth: wideVisibleWidth, truncateToWidth: wideTruncateToWidth });
	try {
		const framed = frameToolCard(
			["+ 49 // (✅ ❌) o CJK se pasaban 1-2 celdas del ancho", "日本語のテキスト y contenido normal mezclado"],
			60,
			"edit · pretty-tool-cards.ts",
		);
		for (const line of framed) {
			assert.ok(wideVisibleWidth(line) <= 60, `line exceeds width: ${wideVisibleWidth(line)} > 60`);
		}
	} finally {
		setWidthFns(fallbackWidthFns);
	}
});

test("frameToolCard clamps titles wider than the terminal", () => {
	const framed = frameToolCard(
		["hola"],
		40,
		"bash · /un/path/absurdamente/largo/que/no/entra/en/cuarenta/columnas/final.ts",
	);
	for (const line of framed) {
		assert.ok(fallbackWidthFns.visibleWidth(line) <= 40, `line exceeds width: ${fallbackWidthFns.visibleWidth(line)} > 40`);
	}
});
