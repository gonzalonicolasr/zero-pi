// Unit tests for the ZERO HUD pure helpers.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composeHud,
  computeSessionUsage,
  formatTokenCount,
  formatUsd,
  normalizePreset,
  phaseFromInput,
  phaseFromSubagentArgs,
  shortModel,
} from "./zero-hud.ts";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("normalizePreset accepts supported presets and on/off aliases", () => {
  assert.equal(normalizePreset("compact"), "compact");
  assert.equal(normalizePreset("minimal"), "minimal");
  assert.equal(normalizePreset("full"), "full");
  assert.equal(normalizePreset("ascii"), "ascii");
  assert.equal(normalizePreset("off"), "off");
  assert.equal(normalizePreset("on"), "compact");
  assert.equal(normalizePreset("wat"), null);
});

test("computeSessionUsage sums assistant tokens, cache and cost defensively", () => {
  const sm = {
    getEntries: () => [
      { type: "message", message: { role: "user", usage: { input: 999, output: 999, cost: 99 } } },
      { type: "message", message: { role: "assistant", usage: { input: 1000, output: 200, cacheRead: 300, cacheWrite: 40, cost: { total: 0.01 } } } },
      { type: "message", message: { role: "assistant", usage: { input: 500, output: 50, cost: { input: 0.001, output: 0.002 } } } },
      { type: "tool_call", message: { role: "assistant", usage: { input: 9999, output: 9999 } } },
    ],
  };
  assert.deepEqual(computeSessionUsage(sm), {
    input: 1500,
    output: 250,
    cacheRead: 300,
    cacheWrite: 40,
    costUsd: 0.013,
  });
});

test("computeSessionUsage handles missing or malformed session managers", () => {
  assert.deepEqual(computeSessionUsage(undefined), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
  assert.deepEqual(computeSessionUsage({}), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
});

test("format helpers compact tokens, model ids and tiny USD costs", () => {
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1500), "1.5K");
  assert.equal(formatTokenCount(2_400_000), "2.4M");
  assert.equal(formatUsd(0), undefined);
  assert.equal(formatUsd(0.0042), "$0.0042");
  assert.equal(formatUsd(0.042), "$0.042");
  assert.equal(formatUsd(1.2), "$1.20");
  assert.equal(shortModel("anthropic/claude-opus-4-7"), "claude-opus-4-7");
});

test("phase detection understands /forge text and zero subagent shapes", () => {
  assert.equal(phaseFromInput("/forge migrar auth"), "forge");
  assert.equal(phaseFromInput("hacelo con SDD"), "forge");
  assert.equal(phaseFromSubagentArgs({ agent: "zero-build" }), "build");
  assert.equal(phaseFromSubagentArgs({ chain: [{ agent: "zero-explore" }, { parallel: [{ agent: "zero-plan" }] }] }), "explore");
  assert.equal(phaseFromSubagentArgs({ agent: "code-review" }), undefined);
});

test("composeHud renders compact colored content with ZERO, phase, cost and diff", () => {
  const out = composeHud({
    preset: "compact",
    phase: "build",
    model: "claude-opus-4-7",
    tokensIn: 128_400,
    tokensOut: 8_120,
    costUsd: 0.042,
    diffAdded: 120,
    diffRemoved: 8,
    ctxPercent: 42,
    branch: "sdd/zero-hud",
  });
  const plain = stripAnsi(out);
  assert.ok(plain.includes("ZERO"));
  assert.ok(plain.includes("phase ◆ build"));
  assert.ok(plain.includes("claude-opus-4-7"));
  assert.ok(plain.includes("tok ↑128.4K ↓8.1K"));
  assert.ok(plain.includes("cost $0.042"));
  assert.ok(plain.includes("diff +120/-8"));
  assert.ok(plain.includes("ctx 42%"));
  assert.ok(out.includes("\x1b[38;2;"), "uses 24-bit color");
});

test("composeHud supports ascii and off presets", () => {
  assert.equal(composeHud({ preset: "off", model: "x" }), "");
  const ascii = composeHud({ preset: "ascii", phase: "plan", tokensIn: 1000, tokensOut: 20, diffAdded: 1 });
  assert.equal(ascii.includes("\x1b["), true, "ascii preset keeps dim separators but values are plain");
  const plain = stripAnsi(ascii);
  assert.ok(plain.includes("ZERO | phase:plan | tok:↑1.0K ↓20 | diff:+1/-0"));
});
