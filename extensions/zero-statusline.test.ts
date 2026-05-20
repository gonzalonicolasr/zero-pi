// Unit tests for the zero-statusline pure formatters.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composeStatusline,
  computeSessionTokens,
  ctxColor,
  formatTokenCount,
  shortModel,
} from "./zero-statusline.ts";

// ─── computeSessionTokens ──────────────────────────────────────────────────

test("computeSessionTokens: sums assistant input/output across entries", () => {
  const sm = {
    getEntries: () => [
      { type: "message", message: { role: "user", usage: { input: 999, output: 999 } } },
      { type: "message", message: { role: "assistant", usage: { input: 1000, output: 200 } } },
      { type: "tool_call", message: { role: "assistant", usage: { input: 9999, output: 9999 } } },
      { type: "message", message: { role: "assistant", usage: { input: 500, output: 50 } } },
    ],
  };
  assert.deepEqual(computeSessionTokens(sm), { input: 1500, output: 250 });
});

test("computeSessionTokens: missing sessionManager / entries returns zeros", () => {
  assert.deepEqual(computeSessionTokens(undefined), { input: 0, output: 0 });
  assert.deepEqual(computeSessionTokens({}), { input: 0, output: 0 });
  assert.deepEqual(computeSessionTokens({ getEntries: () => [] }), { input: 0, output: 0 });
});

test("computeSessionTokens: malformed entries / usage fields are ignored", () => {
  const sm = {
    getEntries: () => [
      { type: "message" }, // no message field
      { type: "message", message: { role: "assistant" } }, // no usage
      { type: "message", message: { role: "assistant", usage: {} } }, // empty usage
      { type: "message", message: { role: "assistant", usage: { input: "x", output: null } } as any },
      { type: "message", message: { role: "assistant", usage: { input: -5, output: 10 } } },
    ],
  };
  assert.deepEqual(computeSessionTokens(sm), { input: 0, output: 10 });
});

// ─── formatTokenCount ──────────────────────────────────────────────────────

test("formatTokenCount: zero, sub-1K, K range, M range", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(500), "500");
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1000), "1.0K");
  assert.equal(formatTokenCount(1500), "1.5K");
  assert.equal(formatTokenCount(858_400), "858.4K");
  assert.equal(formatTokenCount(1_000_000), "1.0M");
  assert.equal(formatTokenCount(2_400_000), "2.4M");
});

test("formatTokenCount: negative or non-finite falls back to '0'", () => {
  assert.equal(formatTokenCount(-1), "0");
  assert.equal(formatTokenCount(Number.NaN), "0");
  assert.equal(formatTokenCount(Number.POSITIVE_INFINITY), "0");
});

// ─── ctxColor ──────────────────────────────────────────────────────────────

test("ctxColor: mint under 50, amber 50-80, rose 80+", () => {
  assert.deepEqual(ctxColor(0), [79, 221, 171]);
  assert.deepEqual(ctxColor(49), [79, 221, 171]);
  assert.deepEqual(ctxColor(50), [238, 190, 92]);
  assert.deepEqual(ctxColor(79), [238, 190, 92]);
  assert.deepEqual(ctxColor(80), [255, 106, 122]);
  assert.deepEqual(ctxColor(100), [255, 106, 122]);
});

test("ctxColor: non-finite defaults to mint (safe / low)", () => {
  assert.deepEqual(ctxColor(Number.NaN), [79, 221, 171]);
});

// ─── shortModel ────────────────────────────────────────────────────────────

test("shortModel: strips provider/ prefix; leaves bare ids unchanged", () => {
  assert.equal(shortModel("anthropic/claude-opus-4-7"), "claude-opus-4-7");
  assert.equal(shortModel("openai-codex/gpt-5.5"), "gpt-5.5");
  assert.equal(shortModel("claude-opus-4-7"), "claude-opus-4-7");
  assert.equal(shortModel(undefined), undefined);
  assert.equal(shortModel(""), undefined);
});

// ─── composeStatusline ─────────────────────────────────────────────────────

test("composeStatusline: empty parts yields the empty string", () => {
  assert.equal(composeStatusline({}), "");
});

test("composeStatusline: every present part shows up in the rendered text", () => {
  const out = composeStatusline({
    model: "claude-opus-4-7",
    tokensIn: 858_400,
    tokensOut: 241,
    diffAdded: 322,
    diffRemoved: 113,
    ctxPercent: 45,
    branch: "master",
    brand: "www.ceroclawd.com",
  });
  // Strip ANSI to assert plain content
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(plain.includes("claude-opus-4-7"), "model");
  assert.ok(plain.includes("↑858.4K"), "tokens in");
  assert.ok(plain.includes("↓241"), "tokens out");
  assert.ok(plain.includes("+322"), "diff added");
  assert.ok(plain.includes("-113"), "diff removed");
  assert.ok(plain.includes("ctx 45%"), "ctx percent");
  assert.ok(plain.includes("master"), "branch");
  assert.ok(plain.includes("www.ceroclawd.com"), "brand");
});

test("composeStatusline: carries 24-bit colour escapes", () => {
  const out = composeStatusline({ model: "x", brand: "y" });
  assert.ok(out.includes("\x1b[38;2;"), "uses 24-bit ANSI fg");
});

test("composeStatusline: tokens skipped when both undefined; diff skipped when both undefined", () => {
  const out = composeStatusline({ model: "x" });
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(!plain.includes("tok"), "no tok label");
  assert.ok(!plain.includes("diff"), "no diff label");
});

test("composeStatusline: tokens emits zeros when one side is provided and the other absent", () => {
  const out = composeStatusline({ tokensIn: 1500 });
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(plain.includes("↑1.5K"));
  assert.ok(plain.includes("↓0"));
});
