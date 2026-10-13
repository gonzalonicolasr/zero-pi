import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { createGitRunner } from "./git-runner.ts";

function fake(responses: Array<{ code?: number; out?: string; err?: string; error?: Error }>) {
  const calls: string[][] = [];
  const spawn = (_cmd: string, args: string[]) => {
    calls.push(args);
    const r = responses.shift() ?? {};
    if (r.error) throw r.error;
    const child = new EventEmitter() as any;
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    queueMicrotask(() => { if (r.out) child.stdout.emit("data", r.out); if (r.err) child.stderr.emit("data", r.err); child.emit("close", r.code ?? 0); });
    return child;
  };
  return { spawn, calls };
}

test("git-runner wraps successful commands", async () => {
  const f = fake([{ out: "main\n" }, { out: " M a.ts\n" }]);
  const git = createGitRunner(f.spawn as any);
  assert.equal(await git.currentBranch(), "main");
  assert.equal(await git.isDirty(), true);
  assert.deepEqual(f.calls, [["branch", "--show-current"], ["status", "--porcelain"]]);
});

test("git-runner: untracked NODD and pi state alone is not a dirty worktree", async () => {
  const f = fake([{ out: "?? .nodd/\n?? .pi/\n" }, { out: "?? .nodd/\n?? src/new.ts\n" }, { out: " M .nodd/x.md\n" }]);
  const git = createGitRunner(f.spawn as any);
  assert.equal(await git.isDirty(), false);
  assert.equal(await git.isDirty(), true, "other untracked files still count");
  assert.equal(await git.isDirty(), true, "a tracked change still counts");
});

test("git-runner: untracked tool state in a monorepo subfolder or with a quoted path is not dirty", async () => {
  const f = fake([{ out: "?? packages/zero-pi/.nodd/\n?? packages/zero-pi/.pi/\n" }, { out: "?? \".nodd/a b.md\"\n" }, { out: "?? src/foo.nodd/\n" }, { out: " M packages/zero-pi/.nodd/x.md\n" }]);
  const git = createGitRunner(f.spawn as any);
  assert.equal(await git.isDirty(), false, "subfolder tool state");
  assert.equal(await git.isDirty(), false, "quoted tool state");
  assert.equal(await git.isDirty(), true, "a .nodd suffix is not a tool state segment");
  assert.equal(await git.isDirty(), true, "a tracked change in a subfolder still counts");
});

test("git-runner returns structured errors for non-zero and spawn errors", async () => {
  const f = fake([{ code: 1, err: "missing" }, { error: new Error("ENOENT") }]);
  const git = createGitRunner(f.spawn as any);
  assert.equal(await git.branchExists("x"), false);
  const result = await git.run(["status"]);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /ENOENT/);
});
