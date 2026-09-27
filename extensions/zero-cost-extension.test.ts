import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runZeroCost } from "./zero-cost-extension.ts";
import { executionOperation, executionPath } from "./zero-execution.ts";
function fixture(fn: (dir: string) => void) { const dir = mkdtempSync(join(tmpdir(), "zero-cost-ext-")); try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } }
function report(cwd: string, selector = "") { let text = ""; runZeroCost(selector, { ui: { notify(m: string) { text = m; } } }, { cwd }); return text; }
test("legacy slug metadata is explicitly unattributed, not zero or global total", () => fixture(cwd => {
  mkdirSync(join(cwd, ".pi-subagents/artifacts"), { recursive: true });
  writeFileSync(join(cwd, ".pi-subagents/artifacts/x_meta.json"), JSON.stringify({ runId: "legacy", agent: "zero-build", task: "Slug: same", usage: { input: 9000, output: 40, cost: 10 } }));
  const text = report(cwd, "same"); assert.match(text, /unattributed|sin atribución/); assert.doesNotMatch(text, /TOTAL|\$0\.00|\$10/);
}));
test("missing attempt receipts report partial coverage without fake zero totals", () => fixture(cwd => {
  const { runId } = executionOperation(cwd, { action: "start", slug: "same", request: "request" });
  executionOperation(cwd, { action: "attempt", runId, phase: "explore", round: 1, batch: 1 });
  const text = report(cwd, runId); assert.match(text, /partial|parcial/); assert.match(text, /0\/1/); assert.doesNotMatch(text, /TOTAL|\$0\.00/);
}));
test("cost command selects newest execution of a reused slug, explicit old id stays isolated", () => fixture(cwd => {
  const a = executionOperation(cwd, { action: "start", slug: "same", request: "first" });
  executionOperation(cwd, { action: "attempt", runId: a.runId, phase: "explore", round: 1, batch: 1 });
  rmSync(join(cwd, ".sdd/same"), { recursive: true });
  const b = executionOperation(cwd, { action: "start", slug: "same", request: "second" });
  assert.match(report(cwd, b.runId), new RegExp(b.runId)); assert.match(report(cwd, "same"), new RegExp(b.runId)); assert.match(report(cwd, a.runId), /0\/1/);
}));
test("an unreadable neighbour ledger is named as an issue while the valid selection still reports", () => fixture(cwd => {
  const alpha = executionOperation(cwd, { action: "start", slug: "alpha", request: "first" });
  writeFileSync(executionPath(cwd, alpha.runId), '{"v":1}');
  const beta = executionOperation(cwd, { action: "start", slug: "beta", request: "second" });
  const text = report(cwd, "beta");
  assert.match(text, new RegExp(beta.runId)); // the valid selection is unchanged
  assert.match(text, new RegExp(`${alpha.runId}\\.json`)); // the unreadable file is named
  assert.match(text, /corrupt/); // and so is its error
  assert.doesNotMatch(text, /\$0\.00/);
}));
test("a corrupt selected slug names its unreadable ledger instead of claiming there is no identity", () => fixture(cwd => {
  const alpha = executionOperation(cwd, { action: "start", slug: "alpha", request: "first" });
  writeFileSync(executionPath(cwd, alpha.runId), '{"v":1}');
  const text = report(cwd, "alpha");
  assert.match(text, new RegExp(`${alpha.runId}\\.json`)); assert.match(text, /corrupt/);
  assert.doesNotMatch(text, /No hay identidad de ejecución en este cwd/);
  assert.doesNotMatch(text, /\$0\.00|TOTAL/);
}));
test("every unreadable ledger is named once, and targeted access by its runId still fails closed", () => fixture(cwd => {
  const a = executionOperation(cwd, { action: "start", slug: "a", request: "one" });
  const b = executionOperation(cwd, { action: "start", slug: "b", request: "two" });
  const ok = executionOperation(cwd, { action: "start", slug: "ok", request: "three" });
  for (const id of [a.runId, b.runId]) writeFileSync(executionPath(cwd, id), '{"v":1}');
  const text = report(cwd, "ok");
  assert.match(text, new RegExp(ok.runId));
  for (const id of [a.runId, b.runId]) assert.equal(text.split(`${id}.json`).length - 1, 1);
  // Explicit runId of an unreadable ledger is targeted access: it still throws, it is not downgraded to an issues line.
  assert.throws(() => report(cwd, a.runId), /corrupt/);
}));
test("with no ledger and nothing unreadable the unattributed message carries no issues line", () => fixture(cwd => {
  const text = report(cwd, "ghost");
  assert.match(text, /No hay identidad de ejecución en este cwd/);
  assert.doesNotMatch(text, /\.json/); assert.doesNotMatch(text, /corrupt/);
}));
