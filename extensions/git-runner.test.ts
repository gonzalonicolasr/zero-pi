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

test("git-runner returns structured errors for non-zero and spawn errors", async () => {
  const f = fake([{ code: 1, err: "missing" }, { error: new Error("ENOENT") }]);
  const git = createGitRunner(f.spawn as any);
  assert.equal(await git.branchExists("x"), false);
  const result = await git.run(["status"]);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /ENOENT/);
});
