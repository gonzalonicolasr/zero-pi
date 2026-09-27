import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAgentFile, PHASES } from "./sdd-agents.ts";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
test("Forge async fresh launch contract invokes durable identity, receipt, and readiness operations", () => {
  const o = read("prompts/orchestrator.md"), f = read("prompts/forge.md");
  for (const action of ["start", "resume", "attempt", "attach", "status", "analyze", "findings"]) assert.ok(o.includes(`action: "${action}"`), action);
  assert.match(o, /context: "fresh"/); assert.match(o, /async: true/); assert.match(o, /workflowScript/);
  assert.match(o, /workflowRunId/); assert.match(o, /asyncDir/); assert.match(o, /second.*replan|second.*decision/i);
  assert.match(o, /request\.md.*verbatim|verbatim.*request\.md/i); assert.match(o, /outputMode: "file-only"/);
  assert.match(o, /prompt-enforced/i); assert.match(f, /zero_execution/);
  assert.doesNotMatch(o, /proceed to build on the structural validation alone/);
});
test("all generated phases declare fresh defense without dropping isolation/skills rules", () => {
  for (const p of PHASES) {
    const a = buildAgentFile(p, "body", "desc", undefined);
    assert.match(a, /defaultContext: fresh/); assert.match(a, /inheritProjectContext: false/); assert.match(a, /inheritSkills: false/);
  }
});
test("read-only explore hands full report to runtime; TDD stays cumulative on disk and reviewer reruns", () => {
  const explore = read("prompts/phases/explore.md"), build = read("prompts/phases/build.md"), support = read("prompts/support/strict-tdd.md"), review = read("prompts/phases/veredicto.md");
  assert.match(explore, /runtime persists/i); assert.match(explore, /complete findings/i);
  assert.doesNotMatch(build, /and in your return envelope/); assert.doesNotMatch(support, /AND include it in your return envelope/);
  assert.match(build, /append.*rows|preserve.*rows/i); assert.match(review, /run the listed tests yourself/);
  assert.match(review, /Never write.*zero-runs\.jsonl/);
});
test("execution bookkeeping directory is never presented as a resumable feature", async () => {
  const { buildStatus } = await import("./zero-status.ts");
  const rows = buildStatus({ sddDir: { ".executions": ["id.json"], real: ["tasks.md"] }, archiveEntries: [], runRecords: [] });
  assert.deepEqual(rows.map(r => r.slug), ["real"]);
  for (const path of ["zero-status-extension.ts", "zero-checkpoint-extension.ts", "zero-rounds-extension.ts", "zero-pr-extension.ts", "zero-issue-extension.ts"]) {
    assert.match(read(`extensions/${path}`), /\.executions/);
  }
});

test("the orchestrator records rounds and the RunRecord through zero_execution, never by hand", () => {
  // `/zero-rounds` is a user command the model cannot call (1 of 119 runs had a
  // rounds.json) and a hand-typed RunRecord put junk in `model`. Both are tool
  // actions now; the prompt must route to them and stop teaching the manual path.
  const o = readFileSync(new URL("../prompts/orchestrator.md", import.meta.url), "utf8");
  assert.match(o, /zero_execution[^\n]*action: "round"/);
  assert.match(o, /zero_execution[^\n]*action: "finish"/);
  assert.doesNotMatch(o, /\/zero-rounds record/, "no manual round recording");
  assert.doesNotMatch(o, /Exact one-line shape to emit/, "no hand-written RunRecord template");
});
