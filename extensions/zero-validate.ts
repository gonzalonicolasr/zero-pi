import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { checkGuardrails, parseDelta, type MergeError, type RenameBlock, type RequirementBlock } from "./spec-merge.ts";

export interface ValidationDefect {
  kind: string;
  message: string;
  task?: string;
  path?: string;
  name?: string;
  declaredTotal?: number;
  computedTotal?: number;
}

export interface TaskRecord {
  id: string;
  title: string;
  files: { path: string; isNew: boolean }[];
  depends: string[] | null;
  evidence: string | null;
  review: number | null;
  reviewRaw: string | null;
}

export interface WorkloadSection {
  estimates: Map<string, number>;
  declaredTotal: number | null;
}

export function parseDepends(raw: string): string[] {
  const value = raw.trim();
  if (value === "" || value === "[]" || /^(none|n\/a|na)$/i.test(value)) return [];
  const ids = [...value.matchAll(/\bT\d+\b/g)].map((m) => m[0]);
  return [...new Set(ids)];
}

export function parseTasks(text: string): { tasks: TaskRecord[]; workload: WorkloadSection | null; defects: ValidationDefect[] } {
  const tasks: TaskRecord[] = [];
  const defects: ValidationDefect[] = [];
  const lines = typeof text === "string" ? text.split(/\r?\n/) : [];
  let current: TaskRecord | null = null;
  let collectingFiles = false;

  const pushFile = (line: string): void => {
    if (!current) return;
    const matches = [...line.matchAll(/`([^`]+)`\s*(\(new\))?/g)];
    for (const m of matches) current.files.push({ path: m[1], isNew: Boolean(m[2]) });
  };

  for (const line of lines) {
    const task = line.match(/^\s*- \[[ xX]\]\s+\*\*(T\d+)\.\s+([^*]+)\*\*/) ?? line.match(/^###\s+(T\d+)\s+[—-]\s+(.+)$/) ?? line.match(/^##\s+\[[ xX]\]\s+(T\d+)\s*(?:[—-]\s*(.+))?$/);
    if (task) {
      current = { id: task[1], title: (task[2] ?? "").trim(), files: [], depends: null, evidence: null, review: null, reviewRaw: null };
      tasks.push(current);
      collectingFiles = false;
      continue;
    }
    if (!current) continue;
    if (/^\s*-\s+files:/.test(line)) {
      collectingFiles = true;
      pushFile(line);
      continue;
    }
    if (/^\s*-\s+depends:/.test(line)) {
      collectingFiles = false;
      current.depends = parseDepends(line.replace(/^\s*-\s+depends:\s*/, ""));
      continue;
    }
    if (/^\s*-\s+evidence:/.test(line)) {
      collectingFiles = false;
      current.evidence = line.replace(/^\s*-\s+evidence:\s*/, "").trim();
      continue;
    }
    if (/^\s*-\s+review:/.test(line)) {
      collectingFiles = false;
      const raw = line.replace(/^\s*-\s+review:\s*/, "").trim();
      current.reviewRaw = raw;
      const m = raw.match(/~?(\d+)\s+changed lines/i);
      current.review = m ? Number(m[1]) : null;
      continue;
    }
    if (collectingFiles) {
      if (/^\s*`[^`]+`/.test(line) || /^\s+`[^`]+`/.test(line) || /^\s*-\s+`[^`]+`/.test(line)) pushFile(line);
      else if (/^\s*-\s+/.test(line)) collectingFiles = false;
    }
  }

  const order = new Map(tasks.map((task, index) => [task.id, index] as const));
  for (const [index, task] of tasks.entries()) {
    if (task.files.length === 0) defects.push({ kind: "missing-files", task: task.id, message: `${task.id} is missing files list` });
    if (task.depends === null) defects.push({ kind: "missing-depends", task: task.id, message: `${task.id} is missing depends list` });
    else for (const dep of task.depends) {
      const depIndex = order.get(dep);
      if (dep === task.id) defects.push({ kind: "self-depends", task: task.id, message: `${task.id} cannot depend on itself` });
      else if (depIndex === undefined) defects.push({ kind: "unknown-depends", task: task.id, message: `${task.id} depends on unknown ${dep}` });
      else if (depIndex > index) defects.push({ kind: "forward-depends", task: task.id, message: `${task.id} depends on later task ${dep}` });
    }
    if (task.evidence === null || task.evidence === "") defects.push({ kind: "missing-evidence", task: task.id, message: `${task.id} is missing evidence` });
    if (task.reviewRaw === null) defects.push({ kind: "missing-review", task: task.id, message: `${task.id} is missing review estimate` });
    else if (task.review === null) defects.push({ kind: "non-integer-review", task: task.id, message: `${task.id} review estimate is not an integer` });
  }

  const workload = parseWorkload(lines);
  return { tasks, workload, defects };
}

function parseWorkload(lines: string[]): WorkloadSection | null {
  const start = lines.findIndex((l) => /^##\s+Review Workload\s*$/.test(l));
  if (start < 0) return null;
  const estimates = new Map<string, number>();
  let declaredTotal: number | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line)) break;
    let m = line.match(/^\|\s*(T\d+)\s*\|\s*~?(\d+)\s*\|/);
    if (m) estimates.set(m[1], Number(m[2]));
    m = line.match(/^\s*-\s*(T\d+)\s*[:|-]\s*~?(\d+)/);
    if (m) estimates.set(m[1], Number(m[2]));
    m = line.match(/\*\*Total:\s*~?(\d+)\s+changed lines\*\*/i);
    if (m) declaredTotal = Number(m[1]);
  }
  return { estimates, declaredTotal };
}

export function validateTasksFile(text: string): ValidationDefect[] {
  const parsed = parseTasks(text);
  const defects = [...parsed.defects];
  if (parsed.workload === null) {
    defects.push({ kind: "missing-review-workload", message: "tasks.md is missing ## Review Workload" });
  } else {
    const computedTotal = parsed.tasks.reduce((sum, task) => sum + (task.review ?? 0), 0);
    if (parsed.workload.declaredTotal === null) defects.push({ kind: "missing-workload-total", message: "Review Workload is missing total" });
    else if (parsed.workload.declaredTotal !== computedTotal) defects.push({ kind: "total-mismatch", declaredTotal: parsed.workload.declaredTotal, computedTotal, message: `Review Workload total ${parsed.workload.declaredTotal} does not match computed ${computedTotal}` });
    for (const task of parsed.tasks) {
      const est = parsed.workload.estimates.get(task.id);
      if (est !== undefined && task.review !== null && est !== task.review) defects.push({ kind: "workload-task-mismatch", task: task.id, declaredTotal: est, computedTotal: task.review, message: `${task.id} workload estimate does not match task review` });
    }
  }
  return defects;
}

function allBlocks(delta: ReturnType<typeof parseDelta>): Array<RequirementBlock | RenameBlock> {
  return [...delta.added, ...delta.modified, ...delta.removed, ...delta.renamed];
}

export function validateSpecDelta(text: string): ValidationDefect[] {
  const delta = parseDelta(text);
  const defects: ValidationDefect[] = checkGuardrails([], delta).map((e: MergeError) => ({ kind: e.kind, name: e.name, message: e.message }));
  for (const block of allBlocks(delta)) {
    const name = "name" in block ? block.name : block.to;
    if (block.body.trim() === "") defects.push({ kind: "empty-body", name, message: `Requirement ${name} has an empty body` });
    if (!block.body.includes("Acceptance criteria")) defects.push({ kind: "missing-acceptance-criteria", name, message: `Requirement ${name} is missing Acceptance criteria` });
  }
  return defects;
}

export function discoverSpecFiles(runDir: string): string[] {
  const files: string[] = [];
  if (existsSync(join(runDir, "spec.md"))) files.push(join(runDir, "spec.md"));
  const specsDir = join(runDir, "specs");
  try {
    for (const e of readdirSync(specsDir, { withFileTypes: true })) if (e.isDirectory()) {
      const file = join(specsDir, e.name, "spec.md");
      if (existsSync(file)) files.push(file);
    }
  } catch {}
  return files;
}

export function validateSpecInputs(runDir: string): ValidationDefect[] {
  const files = discoverSpecFiles(runDir);
  if (files.length === 0) return [{ kind: "missing-spec", path: "spec.md", message: "spec.md or specs/<domain>/spec.md is missing" }];
  return files.flatMap((file) => validateSpecDelta(readFileSync(file, "utf8")).map((d) => ({ ...d, path: file })));
}

export function validateArtifactSet(present: { proposal: boolean; spec: boolean; design: boolean; tasks: boolean }): ValidationDefect[] {
  const defects: ValidationDefect[] = [];
  for (const key of ["proposal", "spec", "design", "tasks"] as const) {
    if (!present[key]) defects.push({ kind: `missing-${key}`, path: `${key}.md`, message: `${key}.md is missing` });
  }
  return defects;
}
