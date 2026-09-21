import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createActivityState,
  finishActivePhase,
  isForgeInput,
  markPhaseActive,
  phaseFromSubagentArgs,
  renderActivityPanel,
  widgetWidth,
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

test("widgetWidth leaves room for the padding pi's own Text wrapper adds", () => {
  // `setWidget(key, string[])` wraps every line in `new Text(line, 1, 0)`, whose
  // content width is `width - paddingX * 2` = `width - 2`. A line of exactly the
  // terminal width gets *wrapped*, not clipped — which is what tore the box.
  assert.equal(widgetWidth(206), 204);
  assert.equal(widgetWidth(80), 78);
});

test("widgetWidth falls back to a sane width off a TTY", () => {
  assert.equal(widgetWidth(undefined), 78);
  assert.equal(widgetWidth(0), 78);
});

test("widgetWidth never goes negative on an absurd terminal", () => {
  assert.ok(widgetWidth(1) >= 0);
  assert.ok(widgetWidth(2) >= 0);
});

test("the panel fits inside pi's Text content width for every terminal size", () => {
  const state = createActivityState();
  state.sddActive = true;
  state.phases.plan = "active";
  for (let i = 0; i < 6; i++) {
    const label = `read: un-archivo-con-nombre-largo-${i}.ts`;
    upsertTool(state, { id: label, name: "read", label, state: "ok" });
  }
  for (const terminal of [30, 40, 80, 120, 160, 206, 300]) {
    const content = widgetWidth(terminal);
    for (const line of renderActivityPanel(state, content)) {
      // pi re-adds one column of margin on each side; this is the real budget.
      assert.ok(
        visibleWidth(line) + 2 <= terminal,
        `terminal ${terminal}: línea de ${visibleWidth(line)} + 2 de margen se pasa`,
      );
    }
  }
});

test("the panel never exceeds pi's MAX_WIDGET_LINES", () => {
  const state = createActivityState();
  state.sddActive = true;
  assert.ok(renderActivityPanel(state, 120).length <= 10);
});

test("a panel framed for a wide terminal is torn once the window shrinks", () => {
  // The regression this guards: `setWidget` stores lines, it does not re-ask for
  // them on resize. Lines framed at 152 columns stay 152 columns wide, and pi
  // word wraps every one of them into the smaller window — the closed box turns
  // into stranded corners. The fix is redrawing on `resize`; this test states the
  // invariant that makes the redraw necessary.
  const state = createActivityState();
  state.sddActive = true;
  markPhaseActive(state, "build");
  upsertTool(state, { id: "1", name: "bash", label: "bash ls ~/.pi/agent/subagents", state: "ok" });

  const stale = renderActivityPanel(state, widgetWidth(152));
  const overflows = stale.some((line) => visibleWidth(line) + 2 > 100);
  assert.ok(overflows, "las líneas de 152 deberían desbordar una terminal de 100");

  // Redrawn at the new size, every line fits again and the frame stays closed.
  const fresh = renderActivityPanel(state, widgetWidth(100));
  for (const line of fresh) {
    assert.ok(visibleWidth(line) + 2 <= 100, `línea de ${visibleWidth(line)} no entra en 100`);
  }
  assert.equal(fresh.length, stale.length, "el redibujado conserva la altura del panel");
  assert.ok(stripAnsi(fresh[0]).startsWith("╭"), "sigue abriendo el marco");
  assert.ok(stripAnsi(fresh[fresh.length - 1]).endsWith("╯"), "sigue cerrando el marco");
});
