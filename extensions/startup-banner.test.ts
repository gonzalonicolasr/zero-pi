// Unit tests for the zero-pi startup banner extension.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { bannerLines, renderBanner, resolveBannerMode } from "./startup-banner.ts";

/** A stream stub that collects everything written to it. */
function collector(isTTY: boolean): { write(c: string): void; isTTY: boolean; text(): string } {
  const chunks: string[] = [];
  return {
    isTTY,
    write(chunk: string): void {
      chunks.push(chunk);
    },
    text(): string {
      return chunks.join("");
    },
  };
}

test("bannerLines lays the word out as six glyph rows", () => {
  const lines = bannerLines("ZERO");
  assert.equal(lines.length, 6);
  assert.ok(lines.every((line) => line.length === lines[0].length), "rows are equal width");
  assert.ok(lines[0].includes("[]"), "rows carry Tetris cells");
});

test("bannerLines falls back to a blank glyph for unknown characters", () => {
  const lines = bannerLines("Z?");
  assert.equal(lines.length, 6);
  assert.ok(lines.every((line) => line.length === lines[0].length), "rows stay equal width");
});

test("resolveBannerMode reads the ZERO_BANNER values", () => {
  assert.equal(resolveBannerMode("off"), "off");
  assert.equal(resolveBannerMode("0"), "off");
  assert.equal(resolveBannerMode("static"), "static");
  assert.equal(resolveBannerMode("no-animate"), "static");
  assert.equal(resolveBannerMode(undefined), "shimmer");
  assert.equal(resolveBannerMode("anything-else"), "shimmer");
});

test("renderBanner in off mode writes nothing", () => {
  const out = collector(true);
  renderBanner({ mode: "off", stream: out });
  assert.equal(out.text(), "");
});

/** Run `fn` with NO_COLOR / FORCE_COLOR set to the given values, then restore. */
function withColorEnv(
  noColor: string | null,
  forceColor: string | null,
  fn: () => void,
): void {
  const prevNo = process.env.NO_COLOR;
  const prevForce = process.env.FORCE_COLOR;
  const apply = (key: string, value: string | null): void => {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  };
  apply("NO_COLOR", noColor);
  apply("FORCE_COLOR", forceColor);
  try {
    fn();
  } finally {
    apply("NO_COLOR", prevNo ?? null);
    apply("FORCE_COLOR", prevForce ?? null);
  }
}

test("renderBanner on a non-tty stream prints the banner plain", () => {
  // npm sets FORCE_COLOR for lifecycle scripts; clear it so the non-tty
  // stream genuinely resolves to the no-colour path.
  withColorEnv(null, null, () => {
    const out = collector(false);
    renderBanner({ mode: "static", stream: out });
    const text = out.text();
    assert.ok(text.includes("[]"), "the plain banner carries the Tetris cells");
    assert.ok(!text.includes("\x1b["), "the plain banner carries no ANSI escapes");
  });
});

test("renderBanner shimmer on a tty stream assembles coloured frames", () => {
  withColorEnv(null, "1", () => {
    const out = collector(true);
    renderBanner({ mode: "shimmer", stream: out, frames: 3, frameMs: 1, sparkleFrames: 0 });
    const text = out.text();
    assert.ok(text.includes("\x1b[38;2;"), "frames carry 24-bit colour escapes");
    assert.ok(text.includes("\x1b[6A"), "frames reposition the cursor to redraw in place");
    assert.ok(text.includes("[]"), "the settled frame carries the completed cells");
  });
});

test("renderBanner shimmer runs a sparkle pass after settling", () => {
  withColorEnv(null, "1", () => {
    const countRepaints = (text: string): number => text.split("\x1b[6A").length - 1;

    const noSparkle = collector(true);
    renderBanner({ mode: "shimmer", stream: noSparkle, frames: 3, frameMs: 1, sparkleFrames: 0 });

    const withSparkle = collector(true);
    renderBanner({
      mode: "shimmer",
      stream: withSparkle,
      frames: 3,
      frameMs: 1,
      sparkleFrames: 5,
      sparkleMs: 1,
    });

    assert.ok(
      countRepaints(withSparkle.text()) > countRepaints(noSparkle.text()),
      "the sparkle pass adds extra in-place repaint frames",
    );
  });
});
