import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { executionOperation, readExecution, executionPath, reconcileExecution } from "./zero-execution.ts";
import register from "./zero-execution-extension.ts";
const capture = JSON.parse(readFileSync(new URL("./fixtures/forge-runtime.json", import.meta.url), "utf8"));
function fixture(fn: (cwd: string) => void) { const cwd = mkdtempSync(join(tmpdir(), "forge-ledger-")); try { fn(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); } }
function start(cwd: string, slug = "same") { return executionOperation(cwd, { action: "start", slug, request: " exact request\n\nwith trailing spaces  \n" }); }
function attempt(cwd: string, runId: string, phase = "build") { return executionOperation(cwd, { action: "attempt", runId, phase, round: 1, batch: 1 }); }
function runtime(cwd: string, attemptId: string, phase = "build") {
  const dir = join(cwd, "runtime", "workflow-captured"); mkdirSync(dir, { recursive: true });
  const receipt = structuredClone(capture.receipt); const entry = receipt.entries["connect-0"];
  entry.key = attemptId; entry.agent = `zero-${phase}`; receipt.entries = { [attemptId]: entry };
  writeFileSync(join(dir, "workflow-receipt.json"), JSON.stringify(receipt));
  const status = { ...capture.status, cwd, sessionId: join(cwd, "sessions", "parent.jsonl"), steps: [{ ...capture.status.steps[0], workflowKey: attemptId, agent: `zero-${phase}` }] };
  writeFileSync(join(dir, "status.json"), JSON.stringify(status));
  const metaPath = join(cwd, "sessions", "subagent-artifacts", `child-captured_zero-${phase}_0_meta.json`);
  mkdirSync(dirname(metaPath), { recursive: true }); writeFileSync(metaPath, JSON.stringify({ ...capture.meta, agent: `zero-${phase}` }));
  return { dir, metaPath, receipt };
}
test("execution start persists verbatim request; resume preserves identity and fresh same slug cannot mix", () => fixture(cwd => {
  const a = start(cwd); assert.equal(readFileSync(join(cwd, ".sdd/same/request.md"), "utf8"), " exact request\n\nwith trailing spaces  \n");
  assert.equal(executionOperation(cwd, { action: "resume", slug: "same" }).runId, a.runId);
  assert.throws(() => start(cwd), /exists|resume/);
  rmSync(join(cwd, ".sdd/same"), { recursive: true }); const b = start(cwd); assert.notEqual(a.runId, b.runId);
  assert.equal(readExecution(cwd, a.runId).attempts.length, 0);
  fixture(other => assert.throws(() => readExecution(other, a.runId), /ENOENT|missing/));
}));
test("captured redacted runtime receipt binds exact workflow/key/child + sums once, survives artifact cleanup", () => fixture(cwd => {
  const { runId } = start(cwd); const a = attempt(cwd, runId); const r = runtime(cwd, a.attemptId);
  executionOperation(cwd, { action: "attach", runId, attemptId: a.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir });
  const result = reconcileExecution(cwd, runId); assert.equal(result.metas.length, 1); assert.equal(result.metas[0].usage.input, capture.meta.usage.input);
  assert.equal(result.missing, 0); assert.equal(result.metas[0].slug, null);
  rmSync(r.dir, { recursive: true }); rmSync(r.metaPath);
  assert.equal(reconcileExecution(cwd, runId).metas.length, 1);
  const b = attempt(cwd, runId); assert.equal(reconcileExecution(cwd, runId).missing, 1);
  assert.throws(() => executionOperation(cwd, { action: "attach", runId, attemptId: b.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir }), /already|duplicate/);
}));
test("analyze decisions charge once per delivered attempt, second replan blocks durably; retries not rounds", () => fixture(cwd => {
  const { runId } = start(cwd);
  for (let i = 0; i < 2; i++) {
    const a = attempt(cwd, runId, "analyze"); const r = runtime(cwd, a.attemptId, "analyze");
    const wid = `workflow-${i}`; r.receipt.workflowRunId = wid;
    writeFileSync(join(r.dir, "workflow-receipt.json"), JSON.stringify(r.receipt));
    writeFileSync(join(r.dir, "status.json"), JSON.stringify({ ...capture.status, cwd, runId: wid, sessionId: join(cwd, "sessions/parent.jsonl"), steps: [{ ...capture.status.steps[0], workflowKey: a.attemptId, parentWorkflowRunId: wid, agent: "zero-analyze" }] }));
    executionOperation(cwd, { action: "attach", runId, attemptId: a.attemptId, workflowRunId: wid, asyncDir: r.dir });
    const op = { action: "analyze", runId, attemptId: a.attemptId, decision: "replan" };
    const out = executionOperation(cwd, op); assert.equal(out.replans, i + 1); assert.equal(executionOperation(cwd, op).replans, i + 1);
    assert.throws(() => executionOperation(cwd, { ...op, decision: "continue" }), /conflict/);
  }
  assert.equal(executionOperation(cwd, { action: "resume", slug: "same" }).state, "blocked");
  assert.throws(() => attempt(cwd, runId), /blocked/);
  assert.equal(readExecution(cwd, runId).attempts.length, 2);
}));
test("missing legacy/corrupt state fails closed; invalid ids and ledger tampering do not reset cap", () => fixture(cwd => {
  mkdirSync(join(cwd, ".sdd/legacy"), { recursive: true });
  assert.throws(() => executionOperation(cwd, { action: "resume", slug: "legacy" }), /legacy|missing/);
  assert.throws(() => start(cwd, "../escape"), /slug/);
  const { runId } = start(cwd); const p = executionPath(cwd, runId);
  writeFileSync(p, '{"v":1}'); assert.throws(() => readExecution(cwd, runId), /corrupt/);
}));
test("a corrupt neighbour ledger is skipped when merely enumerated, stays fatal for its own execution and is never repaired", () => fixture(cwd => {
  const alpha = start(cwd, "alpha"); const alphaPath = executionPath(cwd, alpha.runId);
  writeFileSync(alphaPath, '{"v":1}');
  const beta = start(cwd, "beta"); assert.ok(beta.runId); assert.notEqual(beta.runId, alpha.runId);
  const resumed = executionOperation(cwd, { action: "resume", slug: "beta" });
  assert.equal(resumed.runId, beta.runId); assert.equal(resumed.replans, 0);
  // Targeted access to the corrupt execution still fails closed, by runId and by its own slug.
  assert.throws(() => readExecution(cwd, alpha.runId), /corrupt/);
  assert.throws(() => executionOperation(cwd, { action: "resume", slug: "alpha" }), /corrupt/);
  // The duplicate-workflow scan cannot skip an unreadable neighbour: it fails and names the file.
  const at = attempt(cwd, beta.runId); const r = runtime(cwd, at.attemptId);
  assert.throws(() => executionOperation(cwd, { action: "attach", runId: beta.runId, attemptId: at.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir }), new RegExp(`${alpha.runId}\\.json`));
  // No auto-repair, no quarantine, no delete: the corrupt bytes are untouched.
  assert.equal(readFileSync(alphaPath, "utf8"), '{"v":1}');
}));
test("receipt mismatched cwd/id/key/context and missing metadata never become invented usage", () => fixture(cwd => {
  const { runId } = start(cwd); const a = attempt(cwd, runId); const r = runtime(cwd, a.attemptId);
  executionOperation(cwd, { action: "attach", runId, attemptId: a.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir });
  writeFileSync(join(r.dir, "status.json"), JSON.stringify({ ...capture.status, cwd: "/other" }));
  assert.equal(reconcileExecution(cwd, runId).missing, 1);
  writeFileSync(join(r.dir, "status.json"), JSON.stringify({ ...capture.status, cwd, sessionId: join(cwd, "sessions/parent.jsonl"), steps: [{ ...capture.status.steps[0], workflowKey: a.attemptId }] }));
  rmSync(r.metaPath); assert.equal(reconcileExecution(cwd, runId).missing, 1);
}));
test("zero_execution tool is registered and callable with Pi execute signature using ctx.cwd", () => fixture(cwd => {
  let tool: any; register({ registerTool(t: any) { tool = t; } }); assert.equal(tool.name, "zero_execution");
  const response = tool.execute("call", { action: "start", slug: "tool", request: "verbatim" }, undefined, undefined, { cwd });
  assert.ok(response.details.runId); assert.equal(response.isError, undefined);
}));
test("explore runtime debug artifact is durably copied by parent tool without child write permissions", () => fixture(cwd => {
  const { runId } = start(cwd); const a = attempt(cwd, runId, "explore"); const r = runtime(cwd, a.attemptId, "explore");
  executionOperation(cwd, { action: "attach", runId, attemptId: a.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir });
  const output = r.metaPath.replace("_meta.json", "_output.md");
  const findings = "## Code roots\n/fixture/code\n\n## Findings\ncomplete report\n";
  writeFileSync(output, findings);
  executionOperation(cwd, { action: "findings", runId, attemptId: a.attemptId });
  assert.equal(readFileSync(join(cwd, ".sdd/same/findings.md"), "utf8"), findings);
}));
test("delivery failures and missing receipts consume no readiness decisions; later metadata is reconciled", () => fixture(cwd => {
  const { runId } = start(cwd); const a = attempt(cwd, runId, "analyze");
  assert.throws(() => executionOperation(cwd, { action: "analyze", runId, attemptId: a.attemptId, decision: "replan" }), /delivery unverified/i);
  const r = runtime(cwd, a.attemptId, "analyze");
  r.receipt.state = "failed"; writeFileSync(join(r.dir, "workflow-receipt.json"), JSON.stringify(r.receipt));
  const statusPath = join(r.dir, "status.json"); const status = JSON.parse(readFileSync(statusPath, "utf8"));
  status.state = "failed"; status.steps[0].status = "failed"; writeFileSync(statusPath, JSON.stringify(status));
  executionOperation(cwd, { action: "attach", runId, attemptId: a.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir });
  const saved = readFileSync(r.metaPath, "utf8"); rmSync(r.metaPath);
  assert.equal(reconcileExecution(cwd, runId).missing, 1);
  writeFileSync(r.metaPath, saved); assert.equal(reconcileExecution(cwd, runId).missing, 0);
  assert.throws(() => executionOperation(cwd, { action: "analyze", runId, attemptId: a.attemptId, decision: "replan" }), /delivery unverified/i);
  assert.equal(executionOperation(cwd, { action: "resume", slug: "same" }).replans, 0);
  assert.ok(attempt(cwd, runId, "analyze").attemptId); // delivery retry is not a round/replan
}));
test("invalid receipt context, stale identity, lineage and key fail closed", () => {
  for (const mutate of [
    (r: any, a: string) => { r.entries[a].resolvedContext = "fork"; },
    (r: any, a: string) => { r.entries[a].continuation.runIds.unshift("old-child"); },
    (r: any, a: string) => { r.entries[a].key = "wrong"; },
    (r: any) => { r.workflowRunId = "wrong"; },
    (r: any) => { r.version = 99; },
  ]) fixture(cwd => {
    const { runId } = start(cwd); const a = attempt(cwd, runId); const r = runtime(cwd, a.attemptId); mutate(r.receipt, a.attemptId);
    writeFileSync(join(r.dir, "workflow-receipt.json"), JSON.stringify(r.receipt));
    executionOperation(cwd, { action: "attach", runId, attemptId: a.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir });
    assert.equal(reconcileExecution(cwd, runId).metas.length, 0);
  });
});
test("schema-corrupt decisions, duplicate ids, cap edits and stale locks fail closed", () => fixture(cwd => {
  const { runId } = start(cwd); attempt(cwd, runId, "analyze");
  const p = executionPath(cwd, runId), original = readFileSync(p, "utf8");
  for (const mutate of [
    (l: any) => { l.replanCap = 3; },
    (l: any) => { l.attempts.push(l.attempts[0]); },
    (l: any) => { l.attempts[0].decision = "replan"; },
    (l: any) => { l.cwd = "/other"; },
  ]) {
    const ledger = JSON.parse(original); mutate(ledger); writeFileSync(p, JSON.stringify(ledger));
    assert.throws(() => readExecution(cwd, runId), /corrupt/);
  }
  writeFileSync(p, original); mkdirSync(join(cwd, ".sdd/.executions/.lock"));
  assert.throws(() => executionOperation(cwd, { action: "resume", slug: "same" }), /locked/);
}));
test("a runtime workflow cannot be charged to a second fresh execution", () => fixture(cwd => {
  const a = start(cwd); const at = attempt(cwd, a.runId); const r = runtime(cwd, at.attemptId);
  executionOperation(cwd, { action: "attach", runId: a.runId, attemptId: at.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir });
  rmSync(join(cwd, ".sdd/same"), { recursive: true }); const b = start(cwd); const bt = attempt(cwd, b.runId);
  assert.throws(() => executionOperation(cwd, { action: "attach", runId: b.runId, attemptId: bt.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir }), /already|another execution/);
}));

test("complete workflow never promotes failed/stopped child; failed usage remains counted", () => {
  for (const phase of ["analyze", "explore"]) for (const outcome of ["failed", "stopped"]) fixture(cwd => {
    const { runId } = start(cwd); const a = attempt(cwd, runId, phase); const r = runtime(cwd, a.attemptId, phase);
    const statusPath = join(r.dir, "status.json"); const status = JSON.parse(readFileSync(statusPath, "utf8"));
    status.steps[0].status = outcome; writeFileSync(statusPath, JSON.stringify(status));
    writeFileSync(r.metaPath.replace("_meta.json", "_output.md"), "## Code roots\n/code\n");
    executionOperation(cwd, { action: "attach", runId, attemptId: a.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir });
    const result = reconcileExecution(cwd, runId);
    assert.equal(result.metas.length, 1); assert.equal(result.receipts[0].delivery, outcome);
    assert.throws(() => executionOperation(cwd, { action: phase === "analyze" ? "analyze" : "findings", runId, attemptId: a.attemptId, decision: "replan" }), /unverified|unavailable/);
    assert.equal(executionOperation(cwd, { action: "resume", slug: "same" }).replans, 0);
  });
});
test("missing or mismatched child outcome cannot verify delivery", () => {
  for (const change of [(s: any) => { delete s.steps; }, (s: any) => { s.steps[0].runId = "foreign-child"; }, (s: any) => { s.state = "failed"; }]) fixture(cwd => {
    const { runId } = start(cwd); const a = attempt(cwd, runId, "analyze"); const r = runtime(cwd, a.attemptId, "analyze");
    const path = join(r.dir, "status.json"); const status = JSON.parse(readFileSync(path, "utf8")); change(status); writeFileSync(path, JSON.stringify(status));
    executionOperation(cwd, { action: "attach", runId, attemptId: a.attemptId, workflowRunId: "workflow-captured", asyncDir: r.dir });
    assert.throws(() => executionOperation(cwd, { action: "analyze", runId, attemptId: a.attemptId, decision: "continue" }), /unverified/);
  });
});

// ── round / finish: the RunRecord comes from the tool, not from the model ──────
// The orchestrator used to type the ~/.pi/zero-runs.jsonl line itself, and junk
// landed in `model` ("orchestrator (subagentes bloqueados por NODD)"). It was also
// told to run `/zero-rounds record`, a user command it cannot call: 1 of 119 runs
// on this machine had a rounds.json. Both move into the tool.
function withRuns(fn: (cwd: string, runsPath: string, zeroJson: string) => void) {
  fixture(cwd => {
    const old = { runs: process.env.ZERO_RUNS_PATH, cfg: process.env.ZERO_CONFIG_PATH };
    const runsPath = join(cwd, "runs.jsonl"); const zeroJson = join(cwd, "zero.json");
    writeFileSync(zeroJson, JSON.stringify({ models: { explore: "ds/deepseek-flash", plan: "claude-opus-5", build: "gpt-5.6-sol high", veredicto: "claude-opus-5" }, providers: { plan: "personal", build: "prolite", veredicto: "personal" } }));
    process.env.ZERO_RUNS_PATH = runsPath; process.env.ZERO_CONFIG_PATH = zeroJson;
    try { fn(cwd, runsPath, zeroJson); } finally {
      if (old.runs === undefined) delete process.env.ZERO_RUNS_PATH; else process.env.ZERO_RUNS_PATH = old.runs;
      if (old.cfg === undefined) delete process.env.ZERO_CONFIG_PATH; else process.env.ZERO_CONFIG_PATH = old.cfg;
    }
  });
}

test("round records each verdict in rounds.json and reports the routing state", () => withRuns(cwd => {
  const { runId } = start(cwd, "feat");
  const r1 = executionOperation(cwd, { action: "round", runId, verdict: "corregir", cap: 3 });
  assert.deepEqual([r1.rounds, r1.routing], [1, "proceed"]);
  const r2 = executionOperation(cwd, { action: "round", runId, verdict: "pasa" });
  assert.deepEqual([r2.rounds, r2.routing], [2, "done"]);
  const ledger = JSON.parse(readFileSync(join(cwd, ".sdd/feat/rounds.json"), "utf8"));
  assert.deepEqual(ledger.verdicts, ["corregir", "pasa"]); assert.equal(ledger.cap, 3);
  assert.throws(() => executionOperation(cwd, { action: "round", runId, verdict: "corregir" }), /pasa|done|finish/);
  assert.throws(() => executionOperation(cwd, { action: "round", runId, verdict: "maybe" as any }), /verdict/);
}));

test("round refuses past the cap", () => withRuns(cwd => {
  const { runId } = start(cwd, "feat");
  executionOperation(cwd, { action: "round", runId, verdict: "corregir", cap: 1 });
  assert.throws(() => executionOperation(cwd, { action: "round", runId, verdict: "corregir" }), /cap/);
}));

test("finish appends exactly one v2 RunRecord built from start-time models and rounds.json", async () => {
  const { parseRunLine: parseRunRecord } = await import("./autotune.ts");
  withRuns((cwd, runsPath, zeroJson) => {
    const { runId } = start(cwd, "feat");
    // A profile switch mid-run must not rewrite history: models are the ones the run started with.
    writeFileSync(zeroJson, JSON.stringify({ models: { explore: "other", plan: "other", build: "other", veredicto: "other" } }));
    executionOperation(cwd, { action: "round", runId, verdict: "corregir", cap: 3 });
    executionOperation(cwd, { action: "round", runId, verdict: "pasa" });
    const out = executionOperation(cwd, { action: "finish", runId });
    const lines = readFileSync(runsPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]);
    assert.deepEqual(rec.phases, { explore: { model: "ds/deepseek-flash" }, plan: { model: "personal/claude-opus-5" }, build: { model: "prolite/gpt-5.6-sol" }, veredicto: { model: "personal/claude-opus-5" } });
    assert.deepEqual([rec.v, rec.feature, rec.verdict, rec.rounds], [2, "feat", "pasa", 2]);
    assert.deepEqual(rec.verdicts, ["corregir", "pasa"]);
    assert.ok(parseRunRecord(lines[0]), "the autotune reader accepts it");
    assert.equal(out.recorded, true);
    // Idempotent: finishing again does not append a second line.
    executionOperation(cwd, { action: "finish", runId });
    assert.equal(readFileSync(runsPath, "utf8").trim().split("\n").length, 1);
  });
});

test("finish records cap-reached, and refuses a run with no verdict or still in progress", () => withRuns((cwd, runsPath) => {
  const a = start(cwd, "a");
  assert.throws(() => executionOperation(cwd, { action: "finish", runId: a.runId }), /round|verdict/);
  executionOperation(cwd, { action: "round", runId: a.runId, verdict: "corregir", cap: 2 });
  assert.throws(() => executionOperation(cwd, { action: "finish", runId: a.runId }), /progress|proceed/);
  executionOperation(cwd, { action: "round", runId: a.runId, verdict: "replantear" });
  executionOperation(cwd, { action: "finish", runId: a.runId });
  const rec = JSON.parse(readFileSync(runsPath, "utf8").trim());
  assert.deepEqual([rec.verdict, rec.rounds, rec.verdicts], ["cap-reached", 2, ["corregir", "replantear"]]);
}));

test("finish without a model for a required phase records nothing instead of guessing", () => withRuns((cwd, runsPath, zeroJson) => {
  writeFileSync(zeroJson, JSON.stringify({ models: { plan: "x" } }));
  const { runId } = start(cwd, "feat");
  executionOperation(cwd, { action: "round", runId, verdict: "pasa", cap: 3 });
  const out = executionOperation(cwd, { action: "finish", runId });
  assert.equal(out.recorded, false); assert.match(out.reason, /explore/);
  assert.equal(existsSync(runsPath), false);
}));

test("round takes the cap from .sdd/config.json (default 3) when the call omits it", () => withRuns(cwd => {
  const { runId } = start(cwd, "feat");
  assert.equal(executionOperation(cwd, { action: "round", runId, verdict: "corregir" }).cap, 3);
  writeFileSync(join(cwd, ".sdd/config.json"), JSON.stringify({ rounds: { cap: 5 } }));
  const b = start(cwd, "other");
  assert.equal(executionOperation(cwd, { action: "round", runId: b.runId, verdict: "corregir" }).cap, 5);
}));

test("recordModel resolves exactly like the agent generator's phaseModel", async () => {
  const { phaseModel } = await import("./sdd-agents.ts");
  const { recordModel } = await import("./zero-execution.ts");
  const cfgs = [
    { models: { build: "gpt-5.6-sol high" }, providers: { build: "prolite" } },
    { models: { build: "ds/deepseek-flash" }, providers: { build: "x" } },
    { models: { build: "  " } }, { models: {} }, {}, null,
    { models: { build: "claude-opus-5" }, providers: { build: "" } },
  ];
  for (const c of cfgs) assert.equal(recordModel(c, "build"), phaseModel(c, "build" as any), JSON.stringify(c));
});
