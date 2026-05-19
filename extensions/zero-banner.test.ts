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
