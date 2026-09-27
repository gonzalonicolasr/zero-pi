import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createActivityState,
  finishActivePhase,
  isForgeInput,
  markPhaseActive,
  phaseFromSubagentArgs,
  renderActivityPanel,
  toolLabel,
  upsertTool,
} from "./zero-activity-panel.ts";
import { stripAnsi, visibleWidth } from "./zero-tui-layout.ts";

test("isForgeInput detects /forge and SDD signals", () => {
  assert.equal(isForgeInput("/forge mejorar hud"), true);
  assert.equal(isForgeInput("hacelo con sdd"), true);
  assert.equal(isForgeInput("zero sdd"), true);
  assert.equal(isForgeInput("solo mirá este archivo"), false);
});

test("phaseFromSubagentArgs detects single, dotted, chain, and parallel zero agents", () => {
  assert.equal(phaseFromSubagentArgs({ agent: "zero-build" }), "build");
  assert.equal(phaseFromSubagentArgs({ agent: "pkg.zero-veredicto" }), "veredicto");
  assert.equal(phaseFromSubagentArgs({ chain: [{ agent: "zero-plan" }] }), "plan");
  assert.equal(phaseFromSubagentArgs({ tasks: [{ parallel: [{ agent: "zero-explore" }] }] }), "explore");
  assert.equal(phaseFromSubagentArgs({ agent: "worker" }), undefined);
});

test("markPhaseActive advances previous pending phases to done", () => {
  const state = createActivityState();
  markPhaseActive(state, "plan");
  assert.equal(state.sddActive, true);
  assert.equal(state.phases.clarify, "done");
  assert.equal(state.phases.explore, "done");
  assert.equal(state.phases.plan, "active");
  assert.equal(state.phases.analyze, "pending");
});

test("finishActivePhase marks the current active phase as done or error", () => {
  const ok = createActivityState();
  markPhaseActive(ok, "build");
  finishActivePhase(ok, false);
  assert.equal(ok.phases.build, "done");

  const fail = createActivityState();
  markPhaseActive(fail, "veredicto");
  finishActivePhase(fail, true);
  assert.equal(fail.phases.veredicto, "error");
});

test("toolLabel extracts useful labels for common tools", () => {
  assert.equal(toolLabel("bash", { command: "npm test -- --watch=false" }), "bash npm test");
  assert.equal(toolLabel("read", { path: "/tmp/foo.json" }), "read foo.json");
  assert.equal(toolLabel("edit", { path: "/tmp/foo.ts" }), "edit foo.ts");
  assert.equal(toolLabel("mcp__cortex__memoria_save", {}), "cortex:memoria_save");
  assert.equal(toolLabel("subagent", {}), "subagent");
});

test("upsertTool keeps newest first, updates existing, and caps at five", () => {
  const state = createActivityState();
  for (let i = 0; i < 7; i++) {
    upsertTool(state, { id: String(i), name: "bash", label: `bash ${i}`, state: "running" });
  }
  assert.equal(state.tools.length, 5);
  assert.equal(state.tools[0].id, "6");
  upsertTool(state, { id: "4", name: "bash", label: "bash updated", state: "ok" });
  assert.equal(state.tools[0].id, "4");
  assert.equal(state.tools[0].state, "ok");
});

test("renderActivityPanel is empty when inactive and renders phase/tool lines when active", () => {
  const inactive = createActivityState();
  assert.deepEqual(renderActivityPanel(inactive, 80), []);
  upsertTool(inactive, { id: "ordinary", name: "read", label: "read foo.ts", state: "ok" });
  assert.deepEqual(renderActivityPanel(inactive, 80), [], "ordinary tools must not show the SDD panel");

  const state = createActivityState();
  markPhaseActive(state, "analyze");
  upsertTool(state, { id: "1", name: "bash", label: "bash npm test", state: "running" });
  const lines = renderActivityPanel(state, 80);
  const text = lines.join("\n");
  assert.equal(lines.length, 4);
  assert.match(text, /ZERO activity/);
  assert.match(text, /analyze/);
  assert.match(text, /bash npm test/);
});

// ---------------------------------------------------------------------------
// Responsive framing — the panel must fit whatever terminal it lands in
// ---------------------------------------------------------------------------

test("renderActivityPanel draws a closed box: every line exactly the given width", () => {
  const state = createActivityState();
  state.sddActive = true;
  state.phases.plan = "active";
  for (const label of ["bash: npm test", "read: zero-models.ts", "grep: width"]) {
    upsertTool(state, { id: label, name: "bash", label, state: "ok" });
  }
  for (const width of [40, 60, 80, 120, 200]) {
    const lines = renderActivityPanel(state, width);
    for (const line of lines) {
      assert.equal(visibleWidth(line), width, `ancho ${visibleWidth(line)} != ${width}`);
    }
  }
});

test("renderActivityPanel closes every content row with the right border", () => {
  const state = createActivityState();
  state.sddActive = true;
  const lines = renderActivityPanel(state, 80);
  for (const line of lines.slice(1, -1)) {
    assert.ok(stripAnsi(line).endsWith("│"), `fila sin borde derecho: ${JSON.stringify(stripAnsi(line))}`);
  }
});

test("renderActivityPanel top and bottom borders are the same width", () => {
  const state = createActivityState();
  state.sddActive = true;
  const lines = renderActivityPanel(state, 74);
  assert.equal(visibleWidth(lines[0]), visibleWidth(lines[lines.length - 1]));
});

test("renderActivityPanel truncates a long tool list instead of overflowing", () => {
  const state = createActivityState();
  state.sddActive = true;
  for (let i = 0; i < 8; i++) {
    const label = `bash: un-comando-bastante-largo-numero-${i}`;
    upsertTool(state, { id: label, name: "bash", label, state: "ok" });
  }
  const lines = renderActivityPanel(state, 60);
  for (const line of lines) assert.equal(visibleWidth(line), 60);
  assert.ok(lines.some((l) => l.includes("…")), "recortó sin marcar el corte");
});

test("renderActivityPanel stays empty when the SDD run is not active, whatever the width", () => {
  const state = createActivityState();
  assert.deepEqual(renderActivityPanel(state, 120), []);
});

test("renderActivityPanel degrades instead of throwing on an absurd width", () => {
  const state = createActivityState();
  state.sddActive = true;
  for (const width of [0, 1, 8, 12]) {
    assert.doesNotThrow(() => renderActivityPanel(state, width));
    for (const line of renderActivityPanel(state, width)) {
      assert.ok(visibleWidth(line) <= Math.max(0, width), "se pasó del ancho");
    }
  }
});

test("the panel fits every width it is rendered at", () => {
  const state = createActivityState();
  state.sddActive = true;
  state.phases.plan = "active";
  for (let i = 0; i < 6; i++) {
    const label = `read: un-archivo-con-nombre-largo-${i}.ts`;
    upsertTool(state, { id: label, name: "read", label, state: "ok" });
  }
  for (const width of [28, 38, 78, 118, 158, 204, 298]) {
    for (const line of renderActivityPanel(state, width)) {
      assert.ok(visibleWidth(line) <= width, `ancho ${width}: línea de ${visibleWidth(line)}`);
    }
  }
});
test("the panel never exceeds pi's MAX_WIDGET_LINES", () => {
  const state = createActivityState();
  state.sddActive = true;
  assert.ok(renderActivityPanel(state, 120).length <= 10);
});

test("the panel is a component that pi sizes: every render fits the width pi passes", async () => {
  // A string[] widget has to guess its width from process.stdout.columns, and
  // pi wraps whatever overshoots. In tuiMode fullscreen the guess (terminal - 2)
  // was wrong and the box came out torn. A component receives the real width
  // from pi on every render — resizes included — so there is nothing to guess.
  const { default: register } = await import(`./zero-activity-panel.ts?component=${Date.now()}`);
  const handlers = new Map<string, (e: unknown, ctx: unknown) => void>();
  let content: unknown;
  const ctx = { ui: { setWidget: (_k: string, c: unknown) => { content = c; } } };
  register({ on: (name: string, h: (e: unknown, ctx: unknown) => void) => handlers.set(name, h) });
  handlers.get("input")!({ text: "/forge algo" }, ctx);
  handlers.get("tool_execution_start")!({ toolCallId: "1", toolName: "bash", args: { command: "cd /home/gon/zero/packages/zero-pi && npm test" } }, ctx);

  assert.equal(typeof content, "function", "setWidget recibe una factory de componente, no string[]");
  const component = (content as (tui: unknown, theme: unknown) => { render(w: number): string[] })({}, {});
  for (const width of [20, 40, 79, 118, 153, 206]) {
    const lines = component.render(width);
    assert.ok(lines.length > 0);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `ancho ${width}: línea de ${visibleWidth(line)}`);
    if (width >= 24) {
      assert.equal(visibleWidth(lines[0]), width, "el marco ocupa exactamente el ancho que da pi");
      assert.ok(stripAnsi(lines[lines.length - 1]).endsWith("╯"));
    }
  }
  handlers.get("session_shutdown")!({}, ctx);
});
