// A slug names a directory under `.sdd/`. Every command joins it onto that
// directory, and `/zero-archive` then renames the result — so a slug that can
// climb out of `.sdd/` moves arbitrary directories.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isSafeSlug } from "./sdd-slug.ts";
import { runZeroArchive } from "./zero-archive-extension.ts";
import { runZeroBranch } from "./zero-branch-extension.ts";

test("ordinary slugs, including dotted versions, are safe", () => {
  for (const s of ["alpha", "fix-v1.2", "Feature_X", "a.b-c_d", "release-2026.09"]) assert.equal(isSafeSlug(s), true, s);
});

test("anything that can leave .sdd/ or name a hidden/special dir is refused", () => {
  for (const s of ["", " ", "..", ".", "../x", "../../etc", "a/b", "a\\b", "C:\\x", "/abs", ".hidden", ".executions", "a\0b", "a b", "a..b/.."])
    assert.equal(isSafeSlug(s), false, JSON.stringify(s));
});

function ctx() { const notes: [string, string | undefined][] = []; return { notes, ctx: { ui: { notify: (m: string, t?: string) => notes.push([m, t]) } } }; }
const git = () => ({ isDirty: async () => false, run: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), currentBranch: async () => "main", branchExists: async () => false, createBranch: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), switchBranch: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), revParse: async () => ({ ok: true, stdout: "", stderr: "", code: 0 }), hasRemote: async () => true });

async function inTmp(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "zero-slug-")); const old = process.cwd(); process.chdir(dir); mkdirSync(".sdd");
  try { await fn(dir); } finally { process.chdir(old); rmSync(dir, { recursive: true, force: true }); }
}

test("/zero-archive refuses a traversal slug before touching the disk", () => inTmp(async () => {
  mkdirSync("outside"); const c = ctx();
  await runZeroArchive("../outside", c.ctx as any, git() as any);
  assert.equal(c.notes[0][1], "error"); assert.match(c.notes[0][0], /slug/i);
  assert.equal(existsSync("outside"), true);
}));

test("/zero-branch refuses a traversal slug instead of writing links.json outside .sdd/", () => inTmp(async () => {
  const c = ctx();
  await runZeroBranch("../outside", c.ctx as any, git() as any);
  assert.equal(c.notes[0][1], "error"); assert.match(c.notes[0][0], /slug/i);
  assert.equal(existsSync(join("outside", "links.json")), false);
}));
