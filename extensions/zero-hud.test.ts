// Unit tests for the ZERO HUD pure helpers.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composeHud,
  computeSessionUsage,
  createUsageTracker,
  formatTokenCount,
  formatUsd,
  normalizePreset,
  phaseFromInput,
  phaseFromSubagentArgs,
  shortModel,
} from "./zero-hud.ts";
import { visibleWidth } from "./zero-tui-layout.ts";

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

// ---------------------------------------------------------------------------
// Responsive status line — it must fit the terminal it is drawn in
// ---------------------------------------------------------------------------

const FAT_HUD = {
  preset: "full" as const,
  phase: "veredicto" as const,
  model: "claude-opus-5",
  tokensIn: 153_000,
  tokensOut: 536_000,
  cacheRead: 94_000,
  costUsd: 0.096,
  diffAdded: 312,
  diffRemoved: 108,
  ctxPercent: 72,
  branch: "feature/zero-tui-responsive",
};

test("composeHud without a width keeps its current, unconstrained output", () => {
  const free = composeHud(FAT_HUD);
  assert.ok(visibleWidth(free) > 0);
  assert.equal(composeHud({ ...FAT_HUD, width: 0 }), free, "width 0 debe comportarse como sin ancho");
});

test("composeHud never returns a line wider than the width it was given", () => {
  for (const width of [20, 40, 60, 80, 120, 200]) {
    const out = composeHud({ ...FAT_HUD, width });
    assert.ok(visibleWidth(out) <= width, `${visibleWidth(out)} celdas en ${width} columnas`);
  }
});

test("composeHud drops to a narrower preset before it starts truncating", () => {
  const narrow = composeHud({ ...FAT_HUD, width: 44 });
  // `full` is the only preset that shows the cache segment — degrading drops it.
  assert.ok(!narrow.includes("cache"), "siguió en preset full sin lugar");
  assert.ok(visibleWidth(narrow) <= 44);
});

test("composeHud still says which phase is running on a very narrow terminal", () => {
  const tiny = composeHud({ ...FAT_HUD, width: 24 });
  assert.ok(visibleWidth(tiny) <= 24);
  assert.ok(tiny.includes("veredicto") || tiny.includes("…"), "no quedó nada legible");
});

test("composeHud leaves `off` empty whatever the width", () => {
  assert.equal(composeHud({ preset: "off", model: "x", width: 10 }), "");
});

test("sessionUsage only sums the entries it has not seen, and resets on a new list", () => {
  // message_update fires per streamed token and the HUD re-rendered by walking
  // the whole session each time — ~1 ms per token on a 14k-entry session. The
  // streaming message is not in getEntries() until message_end, so the sum only
  // changes when entries are appended: add just those.
  const tracker = createUsageTracker();
  const entries: any[] = [
    { type: "message", message: { role: "assistant", usage: { input: 10, output: 1, cost: 0.5 } } },
  ];
  let calls = 0;
  const sm = { getEntries: () => { calls++; return entries; } };
  assert.equal(tracker.usage(sm).input, 10);
  entries.push({ type: "message", message: { role: "assistant", usage: { input: 5, output: 2, cacheRead: 3 } } });
  assert.deepEqual(tracker.usage(sm), { input: 15, output: 3, cacheRead: 3, cacheWrite: 0, costUsd: 0.5 });
  // Same length again: no re-walk, same totals.
  assert.deepEqual(tracker.usage(sm), { input: 15, output: 3, cacheRead: 3, cacheWrite: 0, costUsd: 0.5 });
  // A shorter list (session switch, compaction rewrite) is a new session: recount from scratch.
  entries.splice(0, 2, { type: "message", message: { role: "assistant", usage: { input: 7 } } });
  assert.equal(tracker.usage(sm).input, 7);
  // A different session manager also recounts.
  assert.equal(tracker.usage({ getEntries: () => [] }).input, 0);
  assert.ok(calls >= 4);
  // A fork/branch keeps the manager but mints a new session id with a longer list.
  let id = "a"; const list: any[] = [{ type: "message", message: { role: "assistant", usage: { input: 1 } } }];
  const same = { getEntries: () => list, getSessionId: () => id };
  assert.equal(tracker.usage(same).input, 1);
  id = "b"; list.splice(0, 1, ...Array.from({ length: 3 }, () => ({ type: "message", message: { role: "assistant", usage: { input: 100 } } })));
  assert.equal(tracker.usage(same).input, 300, "nuevo id: se recuenta, no se suma sobre el viejo");
});

test("sessionUsage equals computeSessionUsage on a real-shaped session", () => {
  const tracker = createUsageTracker();
  const entries: any[] = [];
  const sm = { getEntries: () => entries };
  for (let i = 0; i < 300; i++) {
    entries.push({ type: i % 3 ? "message" : "tool_call", message: { role: i % 2 ? "assistant" : "user", usage: { input: i, output: i % 7, cacheRead: i % 5, cost: { total: i / 1000 } } } });
    assert.deepEqual(tracker.usage(sm), computeSessionUsage(sm), `tras ${i + 1} entradas`);
  }
});

test("streamed tokens do not re-render the HUD; message_end does", async () => {
  // Nothing the HUD shows moves mid-stream: session usage lands on message_end,
  // and pi's getContextUsage() rebuilds the whole session projection — the most
  // expensive thing it could do, and it was being done once per token.
  const { default: register } = await import(`./zero-hud.ts?stream=${Date.now()}`);
  const handlers = new Map<string, (e: unknown, ctx: unknown) => void>();
  register({ on: (n: string, h: (e: unknown, ctx: unknown) => void) => handlers.set(n, h), registerCommand() {} });
  let renders = 0, projections = 0;
  const ctx = { ui: { setStatus: () => { renders++; } }, getContextUsage: () => { projections++; return { tokens: 1 }; }, sessionManager: { getEntries: () => [] } };
  handlers.get("session_start")!({}, ctx);
  const base = renders; const baseProj = projections;
  for (let i = 0; i < 200; i++) handlers.get("message_update")?.({}, ctx);
  assert.equal(renders, base, "200 tokens: ningún render");
  assert.equal(projections, baseProj, "200 tokens: ninguna proyección de contexto");
  handlers.get("message_end")!({}, ctx);
  assert.equal(renders, base + 1, "message_end renderiza una vez");
});
