import { test } from "node:test";
import assert from "node:assert/strict";

import {
	fallbackWidthFns,
	frameToolCard,
	patchToolCards,
	quietToolCardLine,
	readQuietEnv,
	setQuietMode,
	setWidthFns,
	shouldSilenceToolCard,
	toolCardStatus,
	toolCardTitle,
} from "./zero-pretty-tool-cards.ts";

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

test("shouldSilenceToolCard suppresses only intercom / supervisor plumbing", () => {
	assert.equal(shouldSilenceToolCard("intercom"), true);
	assert.equal(shouldSilenceToolCard("Intercom"), true);
	assert.equal(shouldSilenceToolCard("contact_supervisor"), true);
	assert.equal(shouldSilenceToolCard("read"), false);
	assert.equal(shouldSilenceToolCard(""), false);
	assert.equal(shouldSilenceToolCard(undefined), false);
});

// Minimal stand-in for pi's ToolExecutionComponent: a class whose prototype has
// a render() we can patch, exactly like patchToolCards expects.
function fakeToolComponent(renderImpl: (width: number) => string[], toolName?: string) {
	const Klass = function () {} as unknown as {
		prototype: { render: (width: number) => string[]; toolName?: string };
		new (): { render: (width: number) => string[]; expanded?: boolean };
	};
	Klass.prototype.render = renderImpl;
	if (toolName !== undefined) Klass.prototype.toolName = toolName;
	patchToolCards(Klass as never);
	return new Klass();
}

test("patched render hides intercom tool cards", () => {
	setWidthFns(fallbackWidthFns);
	const inst = fakeToolComponent(() => ["mensaje al subagente", "otra linea"], "intercom");
	assert.deepEqual(inst.render(80), []);
});

test("patched render memoizes framed output while the inner render is unchanged", () => {
	setWidthFns(fallbackWidthFns);
	let raw = ["alpha", "beta"];
	const inst = fakeToolComponent(() => raw, "read");
	const first = inst.render(80);
	const second = inst.render(80);
	assert.equal(first === second, true, "same content must return the cached array");
	assert.match(first[0], /╭/);
	raw = ["alpha", "beta", "gamma"];
	const third = inst.render(80);
	assert.equal(third === first, false, "changed content must recompute");
});

test("readQuietEnv reads ZERO_QUIET and defaults to off", () => {
	assert.equal(readQuietEnv({ ZERO_QUIET: "1" }), true);
	assert.equal(readQuietEnv({ ZERO_QUIET: "ON" }), true);
	assert.equal(readQuietEnv({ ZERO_QUIET: "true" }), true);
	assert.equal(readQuietEnv({ ZERO_QUIET: "0" }), false);
	assert.equal(readQuietEnv({ ZERO_QUIET: "off" }), false);
	assert.equal(readQuietEnv({ ZERO_QUIET: "" }), false);
	assert.equal(readQuietEnv({}), false);
});

test("quietToolCardLine collapses a card into one width-safe line", () => {
	setWidthFns(fallbackWidthFns);
	const status = toolCardStatus(false, false);
	const line = quietToolCardLine("bash · grep tasks.md", status, ["a", "b", "c"], 60);
	assert.equal(typeof line, "string");
	assert.equal(line.includes("\n"), false, "quiet output must be a single line");
	assert.match(line.replace(ANSI_RE, ""), /bash · grep tasks\.md/);
	assert.match(line.replace(ANSI_RE, ""), /3 lines/);
	assert.match(line.replace(ANSI_RE, ""), /ctrl\+o/);
	assert.ok(fallbackWidthFns.visibleWidth(line) <= 60, "quiet line must fit the terminal");

	const single = quietToolCardLine("read · design.md", status, ["only"], 60);
	assert.equal(single.replace(ANSI_RE, "").includes("ctrl+o"), false, "nothing to expand, no hint");
});

test("quiet mode renders one line per tool card and honours ctrl+o expansion", () => {
	setWidthFns(fallbackWidthFns);
	const inst = fakeToolComponent(() => ["alpha", "beta", "gamma"], "bash");
	try {
		const framed = inst.render(80);
		assert.ok(framed.length > 1, "default mode still frames the full card");

		setQuietMode(true);
		const quiet = inst.render(80);
		assert.equal(quiet.length, 1, "quiet mode collapses the card to one line");
		assert.equal(quiet[0] === framed[0], false, "toggling quiet must invalidate the cache");

		inst.expanded = true;
		const expanded = inst.render(80);
		assert.ok(expanded.length > 1, "ctrl+o still expands the card in quiet mode");
		assert.match(expanded[0], /╭/);
	} finally {
		setQuietMode(false);
	}
});
