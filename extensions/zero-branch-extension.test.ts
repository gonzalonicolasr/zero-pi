import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runZeroBranch, sanitizeSlug } from "./zero-branch-extension.ts";

function ctx() { const notes: any[] = []; return { notes, ctx: { ui: { notify: (m: string, t?: string) => notes.push([m, t]) } } }; }
function runner(opts: { dirty?: boolean; local?: boolean; remote?: boolean } = {}) {
  const calls: string[][] = [];
  return { calls, r: {
    run: async (args: string[]) => { calls.push(args); return { ok: true, stdout: "", stderr: "", code: 0 }; },
    currentBranch: async () => "main",
    isDirty: async () => Boolean(opts.dirty),
    branchExists: async (_b: string, remote?: boolean) => remote ? Boolean(opts.remote) : Boolean(opts.local),
    createBranch: async (b: string, base?: string) => { calls.push(["create", b, base ?? ""]); return { ok: true, stdout: "", stderr: "", code: 0 }; },
    switchBranch: async (b: string) => { calls.push(["switch", b]); return { ok: true, stdout: "", stderr: "", code: 0 }; },
    revParse: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }),
    hasRemote: async () => true,
  }};
}
async function fixture(fn: (dir: string) => Promise<void>) { const dir = mkdtempSync(join(tmpdir(), "zero-branch-")); const old = process.cwd(); process.chdir(dir); mkdirSync(".sdd"); try { await fn(dir); } finally { process.chdir(old); rmSync(dir, { recursive: true, force: true }); } }

test("sanitizeSlug normalizes branch-safe slugs", () => { assert.equal(sanitizeSlug("Mi Feature!!"), "mi-feature"); });
test("/zero-branch creates a new branch and persists links", () => fixture(async () => { const c = ctx(); const f = runner(); await runZeroBranch("Alpha", c.ctx as any, f.r as any); assert.deepEqual(f.calls[0], ["create", "sdd/alpha", "main"]); assert.equal(JSON.parse(readFileSync(join(".sdd", "Alpha", "links.json"), "utf8")).branch, "sdd/alpha"); }));
test("/zero-branch reuses local branch", () => fixture(async () => { const c = ctx(); const f = runner({ local: true }); await runZeroBranch("alpha", c.ctx as any, f.r as any); assert.deepEqual(f.calls[0], ["switch", "sdd/alpha"]); }));
test("/zero-branch tracks remote branch", () => fixture(async () => { const c = ctx(); const f = runner({ remote: true }); await runZeroBranch("alpha", c.ctx as any, f.r as any); assert.deepEqual(f.calls[0], ["switch", "--track", "origin/sdd/alpha"]); }));
test("/zero-branch fails on dirty worktree unless allowed", () => fixture(async () => { const c = ctx(); const f = runner({ dirty: true }); await runZeroBranch("alpha", c.ctx as any, f.r as any); assert.equal(c.notes[0][1], "error"); assert.equal(f.calls.length, 0); }));
test("/zero-branch supports dry-run json without mutation", () => fixture(async () => { const c = ctx(); const f = runner(); await runZeroBranch("alpha --dry-run --json", c.ctx as any, f.r as any); const payload = JSON.parse(c.notes[0][0]); assert.equal(payload.dryRun, true); assert.equal(f.calls.length, 0); }));
