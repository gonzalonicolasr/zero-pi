// Unit tests for the shared TUI layout helpers.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fitRows,
  padToWidth,
  stripAnsi,
  truncateToWidth,
  usableRows,
  visibleWidth,
  windowRows,
} from "./zero-tui-layout.ts";

const ESC = String.fromCharCode(27);
const red = (s: string): string => `${ESC}[31m${s}${ESC}[0m`;

// ---------------------------------------------------------------------------
// visibleWidth / stripAnsi
// ---------------------------------------------------------------------------

test("stripAnsi removes SGR colour escapes and leaves the text", () => {
  assert.equal(stripAnsi(red("hola")), "hola");
});

test("visibleWidth ignores ANSI escapes", () => {
  assert.equal(visibleWidth(red("hola")), 4);
});

test("visibleWidth counts box-drawing and bullet glyphs as one cell each", () => {
  assert.equal(visibleWidth("│ ○ → · ┐"), 9);
});

test("visibleWidth counts CJK and emoji as two cells", () => {
  assert.equal(visibleWidth("漢字"), 4);
  assert.equal(visibleWidth("🚀"), 2);
});

test("visibleWidth counts combining marks as zero cells", () => {
  assert.equal(visibleWidth("é"), 1);
});

// ---------------------------------------------------------------------------
// truncateToWidth
// ---------------------------------------------------------------------------

test("truncateToWidth leaves a string that already fits untouched", () => {
  assert.equal(truncateToWidth("hola", 10), "hola");
  assert.equal(truncateToWidth("hola", 4), "hola");
});

test("truncateToWidth cuts and marks the cut with an ellipsis", () => {
  assert.equal(truncateToWidth("abcdefgh", 5), "abcd…");
  assert.equal(visibleWidth(truncateToWidth("abcdefgh", 5)), 5);
});

test("truncateToWidth never exceeds the budget for a wide-char string", () => {
  const out = truncateToWidth("漢字漢字漢字", 5);
  assert.ok(visibleWidth(out) <= 5, `ancho ${visibleWidth(out)} > 5`);
});

test("truncateToWidth never splits a surrogate pair", () => {
  const out = truncateToWidth("🚀🚀🚀", 3);
  assert.ok(visibleWidth(out) <= 3);
  assert.ok(!/[\uD800-\uDBFF]$/.test(stripAnsi(out)), "quedó media surrogate pair");
});

test("truncateToWidth with a zero or negative budget yields an empty string", () => {
  assert.equal(truncateToWidth("abc", 0), "");
  assert.equal(truncateToWidth("abc", -3), "");
});

test("truncateToWidth with a one-cell budget does not emit an ellipsis alone plus text", () => {
  assert.equal(visibleWidth(truncateToWidth("abcdef", 1)), 1);
});

test("truncateToWidth keeps the leading ANSI colour of a truncated string", () => {
  const out = truncateToWidth(red("abcdefgh"), 5);
  assert.ok(out.includes(`${ESC}[31m`), "se perdió el color");
  assert.equal(visibleWidth(out), 5);
});

test("truncateToWidth closes the ANSI style it kept", () => {
  const out = truncateToWidth(red("abcdefgh"), 5);
  assert.ok(out.endsWith(`${ESC}[0m`), "quedó el color abierto y sangra a la línea siguiente");
});

// ---------------------------------------------------------------------------
// padToWidth
// ---------------------------------------------------------------------------

test("padToWidth pads a short string with spaces to exactly the width", () => {
  assert.equal(padToWidth("ab", 5), "ab   ");
});

test("padToWidth truncates a long string to exactly the width", () => {
  assert.equal(visibleWidth(padToWidth("abcdefgh", 5)), 5);
});

test("padToWidth measures an ANSI string by its visible width", () => {
  assert.equal(visibleWidth(padToWidth(red("ab"), 5)), 5);
});

// ---------------------------------------------------------------------------
// windowRows
// ---------------------------------------------------------------------------

test("windowRows returns every item when they all fit", () => {
  const w = windowRows(5, 0, 10);
  assert.deepEqual(w, { start: 0, end: 5, hiddenBefore: 0, hiddenAfter: 0 });
});

test("windowRows centres the window on the cursor when the list overflows", () => {
  const w = windowRows(100, 50, 10);
  assert.equal(w.end - w.start, 10);
  assert.ok(w.start <= 50 && 50 < w.end, "el cursor quedó fuera de la ventana");
});

test("windowRows clamps to the top when the cursor is near the start", () => {
  const w = windowRows(100, 1, 10);
  assert.equal(w.start, 0);
  assert.equal(w.end, 10);
  assert.equal(w.hiddenBefore, 0);
  assert.equal(w.hiddenAfter, 90);
});

test("windowRows clamps to the bottom when the cursor is near the end", () => {
  const w = windowRows(100, 99, 10);
  assert.equal(w.end, 100);
  assert.equal(w.start, 90);
  assert.equal(w.hiddenAfter, 0);
  assert.equal(w.hiddenBefore, 90);
});

test("windowRows keeps the cursor visible for every cursor position", () => {
  for (let cursor = 0; cursor < 60; cursor++) {
    const w = windowRows(60, cursor, 7);
    assert.ok(w.start <= cursor && cursor < w.end, `cursor ${cursor} fuera de [${w.start},${w.end})`);
    assert.equal(w.end - w.start, 7);
  }
});

test("windowRows with a non-positive capacity yields an empty window", () => {
  const w = windowRows(10, 3, 0);
  assert.equal(w.start, w.end);
});

test("windowRows tolerates an out-of-range cursor", () => {
  const w = windowRows(10, 999, 4);
  assert.ok(w.start >= 0 && w.end <= 10);
  assert.equal(w.end - w.start, 4);
});

// ---------------------------------------------------------------------------
// usableRows / fitRows
// ---------------------------------------------------------------------------

test("usableRows subtracts pi's own chrome from the terminal height", () => {
  assert.ok(usableRows(40) < 40);
  assert.ok(usableRows(40) > 0);
});

test("usableRows never returns less than the documented floor", () => {
  assert.ok(usableRows(3) >= 6);
  assert.ok(usableRows(0) >= 6);
});

test("fitRows leaves a block that already fits untouched", () => {
  const lines = ["a", "b", "c"];
  assert.deepEqual(fitRows(lines, 10), lines);
});

test("fitRows keeps the first rows of an overflowing block so the frame top survives", () => {
  const lines = ["1", "2", "3", "4", "5"];
  const out = fitRows(lines, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out, ["1", "2", "3"]);
});
