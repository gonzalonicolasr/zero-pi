import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { executionOperation, readExecution, executionPath, reconcileExecution, selectExecution } from "./zero-execution.ts";
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

function launch(cwd: string, runId: string, phase: string, n: number, opts: { status?: "completed" | "failed"; output?: string; batch?: number; noIndex?: boolean } = {}) {
  const a = executionOperation(cwd, { action: "attempt", runId, phase, round: 1, batch: opts.batch ?? n });
  const wid = `wf-${n}`, child = `child-${n}`;
  const dir = join(cwd, "runtime", wid); mkdirSync(dir, { recursive: true });
  const failed = opts.status === "failed";
  writeFileSync(join(dir, "workflow-receipt.json"), JSON.stringify({ version: 1, workflowRunId: wid, state: failed ? "failed" : "complete", entries: { [a.attemptId]: { key: a.attemptId, agent: `zero-${phase}`, requestedContext: "fresh", resolvedContext: "fresh", continuation: { runIds: [child] }, latestRunId: child } } }));
  writeFileSync(join(dir, "status.json"), JSON.stringify({ runId: wid, cwd, sessionId: join(cwd, "sessions", "parent.jsonl"), state: failed ? "failed" : "complete", steps: [{ workflowKey: a.attemptId, parentWorkflowRunId: wid, agent: `zero-${phase}`, runId: child, status: failed ? "failed" : "completed" }] }));
  const meta = join(cwd, "sessions", "subagent-artifacts", `${child}_zero-${phase}${opts.noIndex ? "" : "_0"}_meta.json`);
  mkdirSync(dirname(meta), { recursive: true });
  writeFileSync(meta, JSON.stringify({ ...capture.meta, runId: child, agent: `zero-${phase}` }));
  if (opts.output !== undefined) writeFileSync(meta.replace("_meta.json", "_output.md"), opts.output);
  executionOperation(cwd, { action: "attach", runId, attemptId: a.attemptId, workflowRunId: wid, asyncDir: dir });
  return a.attemptId as string;
}

const waveTasks = [
  "# Tasks", "", "Code root: `/code`", "",
  "### T001 — [x] Base", "- files:", "  - `/code/base.ts`", "- depends: []", "- evidence: x", "- review: ~10 changed lines", "",
  "### T002 — Parser [P]", "- files:", "  - `/code/a.ts`", "- depends: T001", "- evidence: x", "- review: ~10 changed lines", "",
  "- [ ] **T003. Writer** [P]", "  - files: `b.ts` (new)", "  - depends: []", "  - evidence: x", "  - review: ~10 changed lines", "",
  "## [ ] T004 — Glue", "- files:", "  - `/code/a.ts`", "- depends: T002, T003", "- evidence: x", "- review: ~10 changed lines", "",
].join("\n");

test("wave returns the next parallel wave, then the sequential remainder", () => fixture(cwd => {
  const { runId } = start(cwd, "feat");
  writeFileSync(join(cwd, ".sdd/feat/tasks.md"), waveTasks);
  const w = executionOperation(cwd, { action: "wave", runId });
  assert.deepEqual([w.mode, w.tasks, w.remaining, w.round], ["parallel", ["T002", "T003"], 2, 1]);
  assert.equal(readFileSync(join(cwd, ".sdd/feat/tasks.md"), "utf8"), waveTasks);
  writeFileSync(join(cwd, ".sdd/feat/tasks.md"), waveTasks.replace("[P]", "").replace("[P]", ""));
  assert.deepEqual(executionOperation(cwd, { action: "wave", runId }).tasks, ["T002", "T003", "T004"]);
}));

test("wave-close ticks delivered tasks, folds per-task evidence in id order and logs the wave; a failed child stays [ ]", () => fixture(cwd => {
  const { runId } = start(cwd, "feat");
  const dir = join(cwd, ".sdd/feat");
  writeFileSync(join(dir, "tasks.md"), waveTasks);
  writeFileSync(join(dir, "tdd-evidence.md"), "# TDD Cycle Evidence\n\n## T001\nrow\n");
  mkdirSync(join(dir, "tdd-evidence"));
  writeFileSync(join(dir, "tdd-evidence/T002.md"), "| T002 | RED | GREEN |\n");
  writeFileSync(join(dir, "tdd-evidence/T003.md"), "| T003 | RED | GREEN |\n");
  const a3 = launch(cwd, runId, "build", 3, { output: "T003 envelope\n" });
  const a2 = launch(cwd, runId, "build", 2, { output: "T002 envelope\n" });
  const out = executionOperation(cwd, { action: "wave-close", runId, batch: 1, total: 2, members: [{ attemptId: a3, task: "T003" }, { attemptId: a2, task: "T002" }] });
  assert.deepEqual([out.ticked, out.failed, out.evidenceMissing, out.round], [["T002", "T003"], [], [], 1]);
  const tasks = readFileSync(join(dir, "tasks.md"), "utf8");
  assert.match(tasks, /^### T002 — \[x\] Parser \[P\]$/m);
  assert.match(tasks, /^- \[x\] \*\*T003\. Writer\*\* \[P\]$/m);
  assert.match(tasks, /^## \[ \] T004 — Glue$/m);
  const evidence = readFileSync(join(dir, "tdd-evidence.md"), "utf8");
  assert.ok(evidence.startsWith("# TDD Cycle Evidence\n\n## T001\nrow\n"));
  assert.ok(evidence.indexOf("## T002 (parallel wave 1)") < evidence.indexOf("## T003 (parallel wave 1)"));
  assert.match(evidence, /## T003 \(parallel wave 1\)\n\n\| T003 \| RED \| GREEN \|/);
  const build = readFileSync(join(dir, "build-r1.md"), "utf8");
  assert.match(build, /^## Wave 1\/2: T002, T003$/m);
  assert.ok(build.indexOf("T002 envelope") < build.indexOf("T003 envelope"));
  const again = executionOperation(cwd, { action: "wave-close", runId, batch: 1, total: 2, members: [{ attemptId: a3, task: "T003" }, { attemptId: a2, task: "T002" }] });
  assert.deepEqual([again.ticked, again.already], [[], ["T002", "T003"]]);
  assert.equal(readFileSync(join(dir, "tdd-evidence.md"), "utf8"), evidence);
  assert.equal(readFileSync(join(dir, "build-r1.md"), "utf8"), build);
}));

test("wave-close leaves a failed or orchestrator-rejected child unticked and reports it for a solo retry", () => fixture(cwd => {
  const { runId } = start(cwd, "feat");
  const dir = join(cwd, ".sdd/feat");
  writeFileSync(join(dir, "tasks.md"), waveTasks);
  const a2 = launch(cwd, runId, "build", 2, { status: "failed", output: "T002 crashed\n" });
  const a3 = launch(cwd, runId, "build", 3, { output: "T003 ok\n" });
  const out = executionOperation(cwd, { action: "wave-close", runId, batch: 1, total: 2, members: [{ attemptId: a2, task: "T002" }, { attemptId: a3, task: "T003" }] });
  assert.deepEqual([out.ticked, out.failed, out.evidenceMissing], [["T003"], ["T002"], ["T003"]]);
  const tasks = readFileSync(join(dir, "tasks.md"), "utf8");
  assert.match(tasks, /^### T002 — Parser \[P\]$/m);
  assert.match(tasks, /^- \[x\] \*\*T003\./m);
  assert.equal(existsSync(join(dir, "tdd-evidence.md")), false);
  assert.match(readFileSync(join(dir, "build-r1.md"), "utf8"), /### T002 — failed[\s\S]*T002 crashed/);
  const b = start(cwd, "other"); const odir = join(cwd, ".sdd/other");
  writeFileSync(join(odir, "tasks.md"), waveTasks);
  const r2 = launch(cwd, b.runId, "build", 12, { output: "claims done but tests red\n" });
  const r3 = launch(cwd, b.runId, "build", 13, { output: "ok\n" });
  const rejected = executionOperation(cwd, { action: "wave-close", runId: b.runId, batch: 1, total: 1, members: [{ attemptId: r2, task: "T002", ok: false }, { attemptId: r3, task: "T003" }] });
  assert.deepEqual([rejected.ticked, rejected.failed], [["T003"], ["T002"]]);
}));

test("wave-close refuses unknown tasks, non-build attempts and a single member before writing anything", () => fixture(cwd => {
  const { runId } = start(cwd, "feat");
  const dir = join(cwd, ".sdd/feat");
  writeFileSync(join(dir, "tasks.md"), waveTasks);
  const a2 = launch(cwd, runId, "build", 2, { output: "x" });
  const a3 = launch(cwd, runId, "build", 3, { output: "y" });
  const v = launch(cwd, runId, "veredicto", 4, { output: "z" });
  assert.throws(() => executionOperation(cwd, { action: "wave-close", runId, batch: 1, total: 1, members: [{ attemptId: a2, task: "T002" }, { attemptId: a3, task: "T099" }] }), /T099/);
  assert.throws(() => executionOperation(cwd, { action: "wave-close", runId, batch: 1, total: 1, members: [{ attemptId: a2, task: "T002" }, { attemptId: v, task: "T003" }] }), /build/);
  assert.throws(() => executionOperation(cwd, { action: "wave-close", runId, batch: 1, total: 1, members: [{ attemptId: a2, task: "T002" }] }), /2|members/);
  assert.equal(readFileSync(join(dir, "tasks.md"), "utf8"), waveTasks);
  assert.equal(existsSync(join(dir, "build-r1.md")), false);
}));

test("batch-close appends each sequential batch envelope to build-r<N>.md once", () => fixture(cwd => {
  const { runId } = start(cwd, "feat");
  const a = launch(cwd, runId, "build", 1, { output: "batch one envelope\n" });
  const b = launch(cwd, runId, "build", 2, { output: "batch two envelope\n" });
  executionOperation(cwd, { action: "batch-close", runId, attemptId: a, batch: 1, total: 2, tasks: ["T001", "T002"] });
  executionOperation(cwd, { action: "batch-close", runId, attemptId: b, batch: 2, total: 2, tasks: ["T003"] });
  executionOperation(cwd, { action: "batch-close", runId, attemptId: b, batch: 2, total: 2, tasks: ["T003"] });
  const build = readFileSync(join(cwd, ".sdd/feat/build-r1.md"), "utf8");
  assert.match(build, /^## Batch 1\/2: T001, T002\n\nbatch one envelope\n\n## Batch 2\/2: T003\n\nbatch two envelope\n$/m);
  assert.equal(build.split("## Batch 2/2").length, 2);
}));

test("round with the veredicto attempt writes veredicto-r<N>.md from the child output and refuses a mismatched verdict", () => withRuns(cwd => {
  const { runId } = start(cwd, "feat");
  const dir = join(cwd, ".sdd/feat");
  const v1 = launch(cwd, runId, "veredicto", 1, { output: "Defects: x\n\nVEREDICTO: corregir\n" });
  assert.throws(() => executionOperation(cwd, { action: "round", runId, attemptId: v1, verdict: "pasa", cap: 3 }), /mismatch/);
  assert.equal(existsSync(join(dir, "rounds.json")), false);
  const r1 = executionOperation(cwd, { action: "round", runId, attemptId: v1, cap: 3 });
  assert.deepEqual([r1.rounds, r1.verdicts, r1.verdictPath], [1, ["corregir"], join(cwd, ".sdd/feat/veredicto-r1.md")]);
  assert.equal(readFileSync(join(dir, "veredicto-r1.md"), "utf8"), "Defects: x\n\nVEREDICTO: corregir\n");
  const v2 = launch(cwd, runId, "veredicto", 2, { output: "All good, verdict: pasa.\n" });
  executionOperation(cwd, { action: "round", runId, attemptId: v2, verdict: "pasa" });
  assert.equal(readFileSync(join(dir, "veredicto-r2.md"), "utf8"), "All good, verdict: pasa.\n\nVEREDICTO: pasa\n");
}));

test("round refuses an undelivered or non-veredicto attempt and a missing output", () => withRuns(cwd => {
  const { runId } = start(cwd, "feat");
  const failed = launch(cwd, runId, "veredicto", 1, { status: "failed", output: "VEREDICTO: pasa\n" });
  assert.throws(() => executionOperation(cwd, { action: "round", runId, attemptId: failed, cap: 3 }), /unverified/);
  const b = launch(cwd, runId, "build", 2, { output: "VEREDICTO: pasa\n" });
  assert.throws(() => executionOperation(cwd, { action: "round", runId, attemptId: b, cap: 3 }), /veredicto/);
  const empty = launch(cwd, runId, "veredicto", 3);
  assert.throws(() => executionOperation(cwd, { action: "round", runId, attemptId: empty, verdict: "pasa", cap: 3 }), /output/);
  assert.equal(existsSync(join(cwd, ".sdd/feat/rounds.json")), false);
}));

// ── NODD handoff: /nodd-promote writes only requirements.md ──────────────────
// Shape copied from ~/projects/nodd/src/promote.ts `promotedRequirements`; kept
// as a literal so this package never imports across repos.
const noddRequirements = [
  "# Retry failed uploads",
  "",
  "Promoted from the NODD run `uploader-retry`. NODD kept the inline route until the work",
  "outgrew it; this document is the handoff, not a fresh start.",
  "",
  "## Objective",
  "",
  "Retry a failed upload up to three times with exponential backoff.",
  "",
  "## Problem",
  "",
  "A transient 503 from the bucket fails the whole sync.",
  "",
  "## Scope",
  "",
  "src/uploader.ts only; the CLI flags stay as they are.",
  "",
  "## Constraints",
  "",
  "No new dependency.",
  "",
  "## Remaining work",
  "",
  "- T002 — Backoff between attempts",
  "- T003 — Surface the final error",
  "",
  "## Already resolved — do not redo",
  "",
  "The work below is **already done and verified**. It must not be redone, re-planned or",
  "re-implemented. Treat it as existing context; plan only what remains.",
  "",
  "- **T001 — Detect retryable errors**",
  "  - verified by: `npm test -- uploader`",
  "  - observed: success",
  "  - review candidate: 3f2a9c1",
  "",
].join("\n");
function handoff(cwd: string, slug = "uploader-retry", text = noddRequirements) {
  const dir = join(cwd, ".sdd", slug); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "requirements.md"), text);
  return dir;
}
function snapshot(dir: string) {
  return Object.fromEntries(readdirSync(dir).sort().map(f => [f, readFileSync(join(dir, f), "utf8")]));
}

test("adopt turns a NODD handoff into a run: request.md is requirements.md byte for byte, identity and ledger exist", () => withRuns(cwd => {
  const dir = handoff(cwd);
  const out = executionOperation(cwd, { action: "adopt", slug: "uploader-retry" });
  assert.equal(out.adopted, true); assert.equal(out.resumeAt, "explore");
  assert.equal(out.slug, "uploader-retry"); assert.equal(out.state, "proceed"); assert.equal(out.replans, 0);
  assert.ok(readFileSync(join(dir, "request.md")).equals(readFileSync(join(dir, "requirements.md"))));
  const pointer = JSON.parse(readFileSync(join(dir, "execution.json"), "utf8"));
  assert.equal(pointer.runId, out.runId);
  const ledger = readExecution(cwd, out.runId);
  assert.equal(ledger.slug, "uploader-retry"); assert.deepEqual(ledger.attempts, []);
  assert.equal(ledger.models?.plan, "personal/claude-opus-5");
  assert.equal(readFileSync(join(dir, "requirements.md"), "utf8"), noddRequirements);
}));

test("adopt refuses anything that is not a NODD handoff and writes nothing in the run directory", () => fixture(cwd => {
  const cases: [string, (dir: string) => void, RegExp][] = [
    ["no marker", dir => writeFileSync(join(dir, "requirements.md"), "# Legacy spec\n\n## Requirements\n- R1\n"), /Promoted from the NODD run/],
    ["execution.json", dir => writeFileSync(join(dir, "execution.json"), '{"v":1}'), /execution\.json/],
    ["run.json", dir => writeFileSync(join(dir, "run.json"), "{}"), /run\.json/],
    ["design.md", dir => writeFileSync(join(dir, "design.md"), "# Design\n"), /design\.md/],
    ["tasks.md", dir => writeFileSync(join(dir, "tasks.md"), "# Tasks\n"), /tasks\.md/],
    ["request.md", dir => writeFileSync(join(dir, "request.md"), "original request\n"), /request\.md/],
  ];
  for (const [label, mutate, reason] of cases) {
    const slug = `case-${label.replace(/\W/g, "-")}`;
    const dir = handoff(cwd, slug); mutate(dir);
    const before = snapshot(dir);
    assert.throws(() => executionOperation(cwd, { action: "adopt", slug }), reason, label);
    assert.deepEqual(snapshot(dir), before, label);
  }
  assert.throws(() => executionOperation(cwd, { action: "adopt", slug: "absent" }), /requirements\.md/);
  assert.equal(existsSync(join(cwd, ".sdd/absent")), false);
  assert.throws(() => executionOperation(cwd, { action: "adopt", slug: "../escape" }), /slug/);
  assert.equal(selectExecution(cwd), null);
}));

test("resume on an un-adopted handoff names adopt; after adopt, resume and status keep the same identity", () => fixture(cwd => {
  handoff(cwd);
  assert.throws(() => executionOperation(cwd, { action: "resume", slug: "uploader-retry" }), /NODD handoff[\s\S]*adopt/);
  const adopted = executionOperation(cwd, { action: "adopt", slug: "uploader-retry" });
  const resumed = executionOperation(cwd, { action: "resume", slug: "uploader-retry" });
  assert.equal(resumed.runId, adopted.runId); assert.equal(resumed.state, "proceed");
  const status = executionOperation(cwd, { action: "status", runId: resumed.runId });
  assert.deepEqual([status.runId, status.attempts, status.missing, status.issues], [adopted.runId, 0, 0, []]);
}));

test("adopt is not repeatable: the second call finds the identity it wrote and changes nothing", () => fixture(cwd => {
  const dir = handoff(cwd);
  const first = executionOperation(cwd, { action: "adopt", slug: "uploader-retry" });
  const before = snapshot(dir);
  assert.throws(() => executionOperation(cwd, { action: "adopt", slug: "uploader-retry" }), /execution\.json/);
  assert.deepEqual(snapshot(dir), before);
  assert.equal(executionOperation(cwd, { action: "resume", slug: "uploader-retry" }).runId, first.runId);
}));

test("a plain legacy run without identity still fails closed on resume, with no adopt hint", () => fixture(cwd => {
  handoff(cwd, "legacy", "# Legacy spec\n\n- R1\n");
  assert.throws(() => executionOperation(cwd, { action: "resume", slug: "legacy" }), err => /legacy/.test((err as Error).message) && !/adopt/.test((err as Error).message));
}));

test("findings and status read artifacts that pi-subagents names without an index (0.70+: no _0)", () => fixture(cwd => {
  const { runId } = start(cwd, "feat");
  const report = "# Findings\n\n## Code roots\n\n- `/code`\n";
  const attemptId = launch(cwd, runId, "explore", 1, { output: report, noIndex: true });
  const out = executionOperation(cwd, { action: "findings", runId, attemptId });
  assert.equal(readFileSync(out.findingsPath, "utf8"), report);
  const st = executionOperation(cwd, { action: "status", runId });
  assert.equal(st.metas.length, 1);
  assert.equal(st.missing, 0);
}));
