// Forge execution identity and readiness accounting. No task-text attribution or
// workflowScript parsing. Runtime files are read only through attached receipts.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { COST_PHASES, parseMeta, type CostPhase, type PhaseMeta } from "./zero-cost.ts";

export interface ExecutionAttempt {
  id: string;
  phase: CostPhase;
  round: number;
  batch: number;
  workflow?: { runId: string; asyncDir: string };
  receipt?: { childRunId: string; context: "fresh"; state: string; metadataPath?: string; outputPath?: string };
  meta?: PhaseMeta;
  decision?: "continue" | "replan";
}
export interface ExecutionLedger {
  v: 1;
  cwd: string;
  runId: string;
  slug: string;
  createdAt: number;
  replanCap: 2;
  attempts: ExecutionAttempt[];
}
export interface ExecutionInput {
  action: string;
  slug?: string;
  request?: string;
  runId?: string;
  phase?: string;
  round?: number;
  batch?: number;
  attemptId?: string;
  workflowRunId?: string;
  asyncDir?: string;
  decision?: string;
}
function token(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function project(cwd: string): string { return realpathSync(cwd); }
export function executionPath(cwd: string, runId: string): string {
  return join(project(cwd), ".sdd", ".executions", `${token(runId, "runId")}.json`);
}
function positive(n: unknown): boolean { return Number.isSafeInteger(n) && (n as number) > 0; }
function object(v: any): boolean { return v !== null && typeof v === "object" && !Array.isArray(v); }
function validMeta(m: any): boolean {
  return object(m) && typeof m.runId === "string" && COST_PHASES.includes(m.phase) && m.slug === null && typeof m.model === "string" &&
    object(m.usage) && ["input", "output", "cacheRead", "cacheWrite", "turns"].every(k => Number.isFinite(m.usage[k]) && m.usage[k] >= 0) &&
    (m.usage.cost === null || (Number.isFinite(m.usage.cost) && m.usage.cost >= 0)) &&
    [m.durationMs, m.toolCount, m.timestamp].every(n => Number.isFinite(n) && n >= 0);
}
function validate(raw: any, cwd: string, runId: string): ExecutionLedger {
  const corrupt = () => { throw new Error("Forge execution ledger corrupt; blocked/not verified (never reset on resume)"); };
  if (!object(raw) || raw.v !== 1 || raw.cwd !== project(cwd) || raw.runId !== runId || raw.replanCap !== 2 || !positive(raw.createdAt) || !Array.isArray(raw.attempts)) return corrupt();
  try { token(raw.slug, "slug"); } catch { return corrupt(); }
  const ids = new Set<string>(), workflows = new Set<string>(); let replans = 0;
  for (const a of raw.attempts) {
    if (!object(a) || !COST_PHASES.includes(a.phase) || !positive(a.round) || !positive(a.batch) || ids.has(a.id) || replans >= 2) return corrupt();
    try { token(a.id, "attemptId"); } catch { return corrupt(); } ids.add(a.id);
    if (a.workflow !== undefined) {
      if (!object(a.workflow) || typeof a.workflow.asyncDir !== "string" || !isAbsolute(a.workflow.asyncDir) || workflows.has(a.workflow.runId)) return corrupt();
      try { token(a.workflow.runId, "workflowRunId"); } catch { return corrupt(); } workflows.add(a.workflow.runId);
    }
    if (a.receipt !== undefined) {
      if (!a.workflow || !object(a.receipt) || a.receipt.context !== "fresh" || !["complete", "failed", "paused", "stopped"].includes(a.receipt.state)) return corrupt();
      try { token(a.receipt.childRunId, "childRunId"); } catch { return corrupt(); }
      for (const key of ["metadataPath", "outputPath"]) if (a.receipt[key] !== undefined && (typeof a.receipt[key] !== "string" || !isAbsolute(a.receipt[key]))) return corrupt();
    }
    if (a.meta !== undefined && (!validMeta(a.meta) || a.meta.runId !== a.receipt?.childRunId || a.meta.phase !== a.phase)) return corrupt();
    if (a.decision !== undefined) {
      if (a.phase !== "analyze" || a.receipt?.state !== "complete" || !["continue", "replan"].includes(a.decision)) return corrupt();
      if (a.decision === "replan") replans++;
    }
  }
  return raw;
}
export function readExecution(cwd: string, runId: string): ExecutionLedger {
  let raw;
  try { raw = JSON.parse(readFileSync(executionPath(cwd, runId), "utf8")); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") throw err; throw new Error("Forge execution ledger corrupt; blocked/not verified"); }
  return validate(raw, cwd, runId);
}
function save(ledger: ExecutionLedger): void {
  validate(ledger, ledger.cwd, ledger.runId);
  const path = executionPath(ledger.cwd, ledger.runId), tmp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", { mode: 0o600 }); renameSync(tmp, path); }
  finally { rmSync(tmp, { force: true }); }
}
function locked<T>(cwd: string, fn: () => T): T {
  const root = join(project(cwd), ".sdd", ".executions"); mkdirSync(root, { recursive: true });
  const lock = join(root, ".lock");
  try { mkdirSync(lock); } catch { throw new Error("Forge ledger locked; blocked until the writer finishes (stale locks require human recovery)"); }
  try { return fn(); } finally { rmSync(lock, { recursive: true }); }
}
function state(ledger: ExecutionLedger) {
  const replans = ledger.attempts.filter(a => a.decision === "replan").length;
  return { runId: ledger.runId, cwd: ledger.cwd, slug: ledger.slug, replans, replanCap: 2, state: replans >= 2 ? "blocked" : "proceed" };
}

/** pi-subagents 0.55.0 workflow-receipt v1 + status.json; unknown fields ignored.
 * Only one fresh child per attempt. Retained child resumes are excluded because
 * their usage can be cumulative. Forge resume launches NEW children instead. */
function reconcileAttempt(ledger: ExecutionLedger, a: ExecutionAttempt): string | undefined {
  if (!a.workflow) return "workflow receipt not attached";
  try {
    if (!a.receipt || !a.meta) {
      const r = JSON.parse(readFileSync(join(a.workflow.asyncDir, "workflow-receipt.json"), "utf8"));
      const s = JSON.parse(readFileSync(join(a.workflow.asyncDir, "status.json"), "utf8"));
      if (r.version !== 1 || r.workflowRunId !== a.workflow.runId || s.runId !== a.workflow.runId || project(s.cwd) !== ledger.cwd || !["complete", "failed", "paused", "stopped"].includes(r.state)) throw new Error("receipt identity/state mismatch");
      if (!object(r.entries) || Object.keys(r.entries).length !== 1) throw new Error("expected one phase/batch per workflow");
      const e = r.entries[a.id];
      if (!e || e.key !== a.id || e.agent !== `zero-${a.phase}` || e.requestedContext !== "fresh" || e.resolvedContext !== "fresh") throw new Error("receipt key/agent/fresh context unverified");
      const childRunId = token(e.latestRunId, "childRunId");
      if (!Array.isArray(e.continuation?.runIds) || e.continuation.runIds.length !== 1 || e.continuation.runIds[0] !== childRunId) throw new Error("retained child resume accounting unsupported");
      // Workflow completion is not child success (a stopped child can return normally).
      const step = Array.isArray(s.steps) && s.steps.length === 1 ? s.steps[0] : undefined;
      if (!step || step.workflowKey !== a.id || step.parentWorkflowRunId !== a.workflow.runId ||
          step.runId !== childRunId || step.agent !== `zero-${a.phase}` ||
          !["completed", "failed", "stopped", "paused"].includes(step.status)) throw new Error("terminal child delivery unverified");
      if (s.state !== r.state) throw new Error("workflow status/receipt state mismatch");
      const delivery = r.state === "complete"
        ? (step.status === "completed" ? "complete" : step.status)
        : r.state;
      // Exact filenames from getArtifactPaths(..., index=0), not directory scans.
      // Temp/custom locations remain partial; do not guess globally.
      const base = `${childRunId}_zero-${a.phase}_0_meta.json`;
      const candidates = [join(ledger.cwd, ".pi", "subagents", "artifacts", base)];
      if (typeof s.sessionId === "string" && isAbsolute(s.sessionId)) candidates.unshift(join(dirname(s.sessionId), "subagent-artifacts", base));
      const metadataPath = candidates.find(existsSync);
      const outputPath = candidates.map(p => p.replace(/_meta\.json$/, "_output.md")).find(existsSync);
      a.receipt = { childRunId, context: "fresh", state: delivery, metadataPath, outputPath };
    }
    if (!a.meta) {
      if (!a.receipt.metadataPath) throw new Error("metadata path unavailable (temp/custom or disabled artifacts)");
      const raw = JSON.parse(readFileSync(a.receipt.metadataPath, "utf8"));
      const meta = parseMeta(raw);
      if (!meta || meta.runId !== a.receipt.childRunId || meta.phase !== a.phase) throw new Error("metadata identity mismatch");
      meta.slug = null; // Task text is redacted and is NEVER attribution evidence.
      if (!validMeta(meta)) throw new Error("metadata usage invalid");
      a.meta = meta;
    }
    return undefined;
  } catch (err) { return err instanceof Error ? err.message : String(err); }
}
function reconcile(ledger: ExecutionLedger) {
  const issues: string[] = [], metas: PhaseMeta[] = [], seen = new Set<string>();
  for (const a of ledger.attempts) {
    const issue = reconcileAttempt(ledger, a);
    if (issue) issues.push(`${a.id}: ${issue}`);
    if (a.meta) {
      if (seen.has(a.meta.runId)) { issues.push(`${a.id}: duplicate child identity excluded`); continue; }
      seen.add(a.meta.runId); metas.push(a.meta);
    }
  }
  return {
    metas, missing: ledger.attempts.length - metas.length, attempts: ledger.attempts.length, issues,
    receipts: ledger.attempts.map(a => ({ attemptId: a.id, phase: a.phase, round: a.round, batch: a.batch,
      workflowRunId: a.workflow?.runId, childRunId: a.receipt?.childRunId,
      context: a.receipt?.context ?? "unverified", delivery: a.receipt?.state ?? "unverified", decision: a.decision })),
  };
}
export function reconcileExecution(cwd: string, runId: string) {
  return locked(cwd, () => { const ledger = readExecution(cwd, runId); const result = reconcile(ledger); save(ledger); return { ...state(ledger), ...result }; });
}
/** Read one ledger file while enumerating neighbours: never throws, marks an
 *  unreadable file instead. Targeted access still goes through readExecution. */
function readLedgerFile(cwd: string, file: string): { ledger: ExecutionLedger } | { file: string; error: string } {
  try { return { ledger: readExecution(cwd, file.slice(0, -5)) }; }
  catch (err) { return { file, error: err instanceof Error ? err.message : String(err) }; }
}
/** Diagnostics for the ledgers enumeration had to skip. Never usage, never zero:
 *  /zero-cost names the files it could not read so a human can recover them. */
export function unreadableLedgers(cwd: string): { file: string; error: string }[] {
  const root = join(project(cwd), ".sdd", ".executions");
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(f => f.endsWith(".json")).map(f => readLedgerFile(cwd, f)).flatMap(r => "ledger" in r ? [] : [r]);
}
export function selectExecution(cwd: string, selector?: string): ExecutionLedger | null {
  if (selector && existsSync(executionPath(cwd, selector))) return readExecution(cwd, selector);
  const root = join(project(cwd), ".sdd", ".executions");
  if (!existsSync(root)) return null;
  const ledgers = readdirSync(root).filter(f => f.endsWith(".json")).map(f => readLedgerFile(cwd, f)).flatMap(r => "ledger" in r ? [r.ledger] : []);
  return ledgers.filter(l => !selector || l.slug === selector).sort((a, b) => b.createdAt - a.createdAt || b.runId.localeCompare(a.runId))[0] ?? null;
}
export function executionOperation(cwd: string, input: ExecutionInput): any {
  return locked(cwd, () => {
    cwd = project(cwd);
    if (input.action === "start") {
      const slug = token(input.slug, "slug");
      if (["specs", "archive"].includes(slug)) throw new Error("Invalid slug");
      if (typeof input.request !== "string" || !input.request.trim()) throw new Error("Complete verbatim request required");
      const dir = join(cwd, ".sdd", slug);
      if (existsSync(dir) && readdirSync(dir).length) throw new Error("Run exists; resume or explicitly confirm artifact removal first");
      mkdirSync(dir, { recursive: true });
      const latest = selectExecution(cwd);
      const ledger: ExecutionLedger = { v: 1, cwd, runId: randomUUID(), slug, createdAt: Math.max(Date.now(), (latest?.createdAt ?? 0) + 1), replanCap: 2, attempts: [] };
      writeFileSync(join(dir, "request.md"), input.request, { flag: "wx", mode: 0o600 });
      save(ledger);
      writeFileSync(join(dir, "execution.json"), JSON.stringify({ v: 1, cwd, runId: ledger.runId }), { flag: "wx", mode: 0o600 });
      return state(ledger);
    }
    let runId = input.runId;
    if (input.action === "resume") {
      const slug = token(input.slug, "slug");
      let pointer;
      try { pointer = JSON.parse(readFileSync(join(cwd, ".sdd", slug, "execution.json"), "utf8")); }
      catch { throw new Error("Execution identity missing/corrupt (legacy); blocked/not verified. Do not reset readiness accounting on resume."); }
      if (pointer.v !== 1 || pointer.cwd !== cwd) throw new Error("Execution pointer corrupt; blocked/not verified");
      runId = pointer.runId;
      const ledger = readExecution(cwd, runId!);
      if (ledger.slug !== slug || !readFileSync(join(cwd, ".sdd", slug, "request.md"), "utf8").trim()) throw new Error("Request/pointer corrupt; blocked/not verified");
      return state(ledger);
    }
    const ledger = readExecution(cwd, token(runId, "runId"));
    if (input.action === "status") { const result = reconcile(ledger); save(ledger); return { ...state(ledger), ...result }; }
    if (input.action === "attempt") {
      if (state(ledger).state === "blocked") throw new Error("Readiness replan cap reached; blocked/not verified");
      if (!COST_PHASES.includes(input.phase as CostPhase) || !positive(input.round) || !positive(input.batch)) throw new Error("phase, positive round and batch required");
      const id = randomUUID();
      ledger.attempts.push({ id, phase: input.phase as CostPhase, round: input.round!, batch: input.batch! }); save(ledger);
      return { ...state(ledger), attemptId: id };
    }
    const a = ledger.attempts.find(a => a.id === input.attemptId);
    if (!a) throw new Error("Unknown attemptId");
    if (input.action === "attach") {
      const wid = token(input.workflowRunId, "workflowRunId");
      if (typeof input.asyncDir !== "string" || !isAbsolute(input.asyncDir)) throw new Error("Absolute asyncDir from launch receipt required");
      if (ledger.attempts.some(other => other !== a && other.workflow?.runId === wid)) throw new Error("Workflow already attached to another attempt");
      // Project-local accounting only; never scan global runtime artifacts.
      for (const file of readdirSync(dirname(executionPath(cwd, ledger.runId))).filter(f => f.endsWith(".json"))) {
        if (file === `${ledger.runId}.json`) continue;
        const other = readLedgerFile(cwd, file);
        if (!("ledger" in other)) throw new Error(`Workflow uniqueness unverified; unreadable execution ledger ${file}: ${other.error}`);
        if (other.ledger.attempts.some(at => at.workflow?.runId === wid)) throw new Error("Workflow already attached to another execution");
      }
      if (a.workflow && (a.workflow.runId !== wid || a.workflow.asyncDir !== input.asyncDir)) throw new Error("Attachment conflict");
      a.workflow = { runId: wid, asyncDir: input.asyncDir }; save(ledger); return { ...state(ledger), attemptId: a.id };
    }
    if (input.action === "findings") {
      if (a.phase !== "explore") throw new Error("findings requires explore attempt");
      reconcileAttempt(ledger, a);
      if (a.receipt?.state !== "complete" || !a.receipt.outputPath) throw new Error("Explore output receipt unavailable; blocked handoff");
      const content = readFileSync(a.receipt.outputPath, "utf8");
      if (!content.trim() || !/^## Code roots\s*$/m.test(content)) throw new Error("Explore output incomplete; missing Code roots");
      const target = join(cwd, ".sdd", ledger.slug, "findings.md");
      const pointer = JSON.parse(readFileSync(join(dirname(target), "execution.json"), "utf8"));
      if (pointer.runId !== ledger.runId || pointer.cwd !== cwd) throw new Error("Findings target execution mismatch");
      const tmp = `${target}.${randomUUID()}.tmp`;
      try { writeFileSync(tmp, content, { mode: 0o600 }); renameSync(tmp, target); }
      finally { rmSync(tmp, { force: true }); }
      save(ledger); return { ...state(ledger), findingsPath: target, bytes: Buffer.byteLength(content) };
    }
    if (input.action === "analyze") {
      if (a.phase !== "analyze" || !["continue", "replan"].includes(input.decision!)) throw new Error("Expected analyze continue|replan");
      if (a.decision && a.decision !== input.decision) throw new Error("Analyze outcome conflict");
      reconcileAttempt(ledger, a);
      if (a.receipt?.state !== "complete") throw new Error("Analyze delivery unverified; retry delivery, do not charge a replan");
      a.decision = input.decision as "continue" | "replan"; save(ledger); return { ...state(ledger), attemptId: a.id, decision: a.decision };
    }
    throw new Error("Unknown zero_execution action");
  });
}
