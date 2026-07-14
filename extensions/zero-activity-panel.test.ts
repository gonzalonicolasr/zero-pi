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
  assert.deepEqual(renderActivityPanel(inactive), []);
  upsertTool(inactive, { id: "ordinary", name: "read", label: "read foo.ts", state: "ok" });
  assert.deepEqual(renderActivityPanel(inactive), [], "ordinary tools must not show the SDD panel");

  const state = createActivityState();
  markPhaseActive(state, "analyze");
  upsertTool(state, { id: "1", name: "bash", label: "bash npm test", state: "running" });
  const lines = renderActivityPanel(state);
  const text = lines.join("\n");
  assert.equal(lines.length, 4);
  assert.match(text, /ZERO activity/);
  assert.match(text, /analyze/);
  assert.match(text, /bash npm test/);
});
