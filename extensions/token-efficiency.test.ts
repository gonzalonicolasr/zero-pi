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

test("parallel waves and the on-disk verdict are driven by zero_execution actions, and resume reads spec.md and veredicto-r<N>.md", () => {
  const o = read("prompts/orchestrator.md"), build = read("prompts/phases/build.md"), review = read("prompts/phases/veredicto.md");
  for (const action of ["wave", "wave-close", "batch-close"]) assert.ok(o.includes(`action: "${action}"`), action);
  assert.match(o, /action: "round", runId: "<runId>",\nattemptId: "<veredicto attemptId>"/);
  assert.match(o, /tanda <i> \(paralelo: T002, T003\)/);
  assert.match(o, /never `runs\.all`/);
  assert.match(o, /retries once, alone, as a sequential batch/);
  assert.match(o, /`\.sdd\/<slug>\/spec\.md` is missing \(and so is the legacy/);
  assert.match(o, /veredicto-r<last>\.md[\s\S]{0,200}then the Cortex/);
  assert.doesNotMatch(o, /If `\.sdd\/<slug>\/requirements\.md` is missing/);
  assert.match(build, /parallel-wave child/i); assert.match(build, /tdd-evidence\/<T###>\.md/);
  assert.doesNotMatch(review, /Do not write a separate\s+verdict file/);
  assert.match(review, /VEREDICTO: pasa/);
});

test("clarify writes the exact Size line and the orchestrator turns `small` into one non-blocking NODD notice", () => {
  const clarify = read("prompts/phases/clarify.md"), o = read("prompts/orchestrator.md"), skill = read("skills/sdd-routing/SKILL.md");
  assert.match(clarify, /`Size: small` or\s+`Size: normal`/);
  assert.match(clarify, /any doubt, is\s+`Size: normal`/);
  assert.match(clarify, /Write boundary — `\.sdd` only/);
  assert.match(o, /## Request size notice/);
  assert.match(o, /missing or unreadable\s+line counts as `normal`/);
  assert.match(o, /npm i @gonrocca\/nodd/);
  assert.match(o, /right before\s+`¿Continuamos\?`/);
  assert.match(o, /never blocks, never\s+changes the route, and never skips/);
  assert.match(o, /On a `Size: small` run, add the one NODD line/);
  assert.match(skill, /NODD's territory/);
});

test("a NODD /nodd-promote handoff is adopted on --continue, skips clarify and resumes at explore; plain legacy still blocks", () => {
  const o = read("prompts/orchestrator.md"), f = read("prompts/forge.md");
  assert.ok(o.includes('action: "adopt", slug: "<slug>"'));
  assert.match(o, /Promoted from the NODD run/);
  assert.match(o, /`nodd-handoff`/);
  assert.match(o, /"Unfinished" = state `nodd-handoff`, `clarifying`/);
  assert.match(o, /skips? \*\*clarify\*\*[\s\S]{0,400}resume at \*\*explore\*\*/i);
  assert.match(o, /Already resolved — do not redo[\s\S]{0,300}context/);
  assert.match(o, /never a legacy spec/);
  assert.match(o, /still stops as blocked\/not verified/);
  assert.match(o, /`\.sdd\/<slug>\/spec\.md` is missing \(and so is the legacy/);
  assert.match(f, /NODD handoff[\s\S]{0,300}adopt/);
});
