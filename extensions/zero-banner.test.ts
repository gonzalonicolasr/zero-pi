// Unit tests for the ZERO startup banner.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { bannerBlock, visibleWidth } from "./zero-banner.ts";

test("visibleWidth ignores ANSI colour escapes", () => {
  assert.equal(visibleWidth("ABC"), 3);
  assert.equal(visibleWidth("\x1b[38;2;1;2;3mABC\x1b[0m"), 3);
  assert.equal(visibleWidth(""), 0);
});

test("bannerBlock renders the full wide layout at a wide width", () => {
  const lines = bannerBlock(100);
  // ornament + 7 logo rows (6 + cast shadow) + tag + ornament — 10 lines max,
  // matching pi's MAX_WIDGET_LINES cap so setWidget never truncates.
  assert.equal(lines.length, 10);
  assert.ok(
    lines.every((line) => typeof line === "string"),
    "every line is a string",
  );
});

test("bannerBlock falls back to a two-line block on a narrow width", () => {
  const lines = bannerBlock(40);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("ZERO SDD"), "the narrow block still names ZERO SDD");
});

test("bannerBlock carries 24-bit colour escapes", () => {
  assert.ok(bannerBlock(100).join("\n").includes("\x1b[38;2;"));
});

test("bannerBlock wide tag advertises the gated pipeline, not the old four-phase-only flow", () => {
  const joined = bannerBlock(100).join("\n");
  assert.ok(joined.includes("clarify"), "the clarify gate is named in the pipeline copy");
  assert.ok(joined.includes("analyze"), "the analyze gate is named in the pipeline copy");
  assert.ok(
    !joined.includes("explore → plan → build → veredicto"),
    "the stale four-phase-only flow string is gone",
  );
});

// ---------------------------------------------------------------------------
// Responsive banner — it is written straight to stdout, so it must fit
// ---------------------------------------------------------------------------

test("bannerBlock never emits a line wider than the terminal", () => {
  for (let width = 20; width <= 200; width++) {
    for (const line of bannerBlock(width)) {
      assert.ok(
        visibleWidth(line) <= width,
        `ancho ${width}: una línea de ${visibleWidth(line)} celdas se pasa`,
      );
    }
  }
});

test("bannerBlock switches to the wide layout only once the logo really fits", () => {
  // The exact switch point is whatever the art needs — what must hold is that
  // the layout it picks always fits, on both sides of the boundary.
  let firstWide = -1;
  for (let width = 20; width <= 200; width++) {
    if (bannerBlock(width).length === 10) {
      firstWide = width;
      break;
    }
  }
  assert.ok(firstWide > 0, "nunca llegó al layout ancho");
  for (const line of bannerBlock(firstWide)) assert.ok(visibleWidth(line) <= firstWide);
  assert.equal(bannerBlock(firstWide - 1).length, 2, "justo debajo del umbral debe caer al bloque angosto");
});
