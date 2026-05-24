import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runZeroGitValidate } from "./zero-git-validate-extension.ts";

function ctx() { const notes: any[] = []; return { notes, ctx: { ui: { notify: (m: string, t?: string) => notes.push([m, t]) } } }; }
function git(opts: { dirty?: boolean; branch?: string; remote?: boolean } = {}) { return { run: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), currentBranch: async () => opts.branch ?? "sdd/alpha", isDirty: async () => Boolean(opts.dirty), branchExists: async () => true, createBranch: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), switchBranch: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), revParse: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), hasRemote: async () => opts.remote !== false }; }
function ghOk() { const spawn = () => { const { EventEmitter } = require("node:events"); return new EventEmitter(); }; return spawn as any; }
async function fixture(fn: (dir: string) => Promise<void>) { const dir = mkdtempSync(join(tmpdir(), "zero-git-validate-")); const old = process.cwd(); const oldEnv = process.env.ZERO_RUNS_PATH; process.chdir(dir); process.env.ZERO_RUNS_PATH = join(dir, "runs.jsonl"); mkdirSync(join(".sdd", "alpha"), { recursive: true }); writeFileSync(join(".sdd", "alpha", "links.json"), JSON.stringify({ branch: "sdd/alpha" })); writeFileSync(join(dir, "runs.jsonl"), JSON.stringify({ v: 2, ts: "2026-01-01T00:00:00Z", feature: "alpha", phases: { explore: { model: "m" }, plan: { model: "m" }, build: { model: "m" }, veredicto: { model: "m" } }, verdict: "pasa", rounds: 1, verdicts: ["pasa"] }) + "\n"); try { await fn(dir); } finally { process.chdir(old); if (oldEnv === undefined) delete process.env.ZERO_RUNS_PATH; else process.env.ZERO_RUNS_PATH = oldEnv; rmSync(dir, { recursive: true, force: true }); } }

test("/zero-git-validate reports ok checks as json", () => fixture(async () => { const c = ctx(); await runZeroGitValidate("alpha --for=archive --json", c.ctx as any, git() as any); const payload = JSON.parse(c.notes[0][0]); assert.equal(payload.ok, true); assert.equal(c.notes[0][1], "info"); }));
test("/zero-git-validate reports failed checks", () => fixture(async () => { const c = ctx(); await runZeroGitValidate("alpha --for=archive", c.ctx as any, git({ dirty: true, branch: "main", remote: false }) as any); assert.equal(c.notes[0][1], "error"); assert.match(c.notes[0][0], /worktree/); assert.match(c.notes[0][0], /branch/); assert.match(c.notes[0][0], /remote/); }));
