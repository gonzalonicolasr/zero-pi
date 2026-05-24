import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runZeroArchive } from "./zero-archive-extension.ts";

function ctx() { const notes: any[] = []; return { notes, ctx: { ui: { notify: (m: string, t?: string) => notes.push([m, t]) } } }; }
const git = (dirty = false) => ({ isDirty: async () => dirty, run: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), currentBranch: async () => "sdd/alpha", branchExists: async () => true, createBranch: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), switchBranch: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), revParse: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), hasRemote: async () => true });
function writeRun(dir: string, verdict = "pasa") { writeFileSync(join(dir, "runs.jsonl"), JSON.stringify({ v: 2, ts: "2026-01-01T00:00:00Z", feature: "alpha", phases: { explore: { model: "m" }, plan: { model: "m" }, build: { model: "m" }, veredicto: { model: "m" } }, verdict, rounds: 1, verdicts: [verdict] }) + "\n"); }
function artifacts() { mkdirSync(join(".sdd", "alpha"), { recursive: true }); writeFileSync(join(".sdd", "alpha", "spec.md"), "## ADDED\n\n### REQ: a\n\nBody.\n\nAcceptance criteria:\n- ok\n"); writeFileSync(join(".sdd", "alpha", "tasks.md"), "# Tasks\n\n### T001 — Do\n\n- files:\n  - `a.ts`\n- evidence: npm test\n- review: ~1 changed lines\n\n## Review Workload\n\n- T001: ~1\n\n**Total: ~1 changed lines**\n"); }
async function fixture(fn: (dir: string) => Promise<void>) { const dir = mkdtempSync(join(tmpdir(), "zero-archive-")); const old = process.cwd(); const oldEnv = process.env.ZERO_RUNS_PATH; process.chdir(dir); process.env.ZERO_RUNS_PATH = join(dir, "runs.jsonl"); mkdirSync(".sdd"); try { await fn(dir); } finally { process.chdir(old); if (oldEnv === undefined) delete process.env.ZERO_RUNS_PATH; else process.env.ZERO_RUNS_PATH = oldEnv; rmSync(dir, { recursive: true, force: true }); } }

test("/zero-archive happy path merges canonical and moves run", () => fixture(async (dir) => { writeRun(dir); artifacts(); const c = ctx(); await runZeroArchive("alpha", c.ctx as any, git() as any); assert.equal(existsSync(join(".sdd", "specs", "requirements.md")), true); assert.match(readFileSync(join(".sdd", "specs", "requirements.md"), "utf8"), /REQ: a/); assert.equal(existsSync(join(".sdd", "alpha")), false); assert.equal(c.notes[0][1], "info"); }));
test("/zero-archive dry-run does not move", () => fixture(async (dir) => { writeRun(dir); artifacts(); const c = ctx(); await runZeroArchive("alpha --dry-run --json", c.ctx as any, git() as any); assert.equal(JSON.parse(c.notes[0][0]).dryRun, true); assert.equal(existsSync(join(".sdd", "alpha")), true); }));
test("/zero-archive rejects non-pasa and dirty", () => fixture(async (dir) => { writeRun(dir, "corregir"); artifacts(); const c = ctx(); await runZeroArchive("alpha", c.ctx as any, git() as any); assert.equal(c.notes[0][1], "error"); }));
