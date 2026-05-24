import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { createGhRunner } from "./gh-runner.ts";

function fake(responses: Array<{ code?: number; out?: string; err?: string; error?: Error }>) {
  const calls: any[] = [];
  const spawn = (_cmd: string, args: string[]) => {
    calls.push(args);
    const r = responses.shift() ?? { code: 0, out: "" };
    if (r.error) throw r.error;
    const child = new EventEmitter() as any;
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    queueMicrotask(() => {
      if (r.out) child.stdout.emit("data", r.out);
      if (r.err) child.stderr.emit("data", r.err);
      child.emit("close", r.code ?? 0);
    });
    return child;
  };
  return { spawn, calls };
}

test("detect reports present gh version and absent gh with hint", async () => {
  assert.equal((await createGhRunner({ spawn: fake([{ out: "gh version 2.49.2 (2024-04-17)" }]).spawn }).detect()).data?.version, "2.49.2");
  const absent = await createGhRunner({ spawn: fake([{ error: new Error("ENOENT") }]).spawn }).detect();
  assert.equal(absent.data?.available, false);
  assert.match(absent.data?.hint ?? "", /winget/);
});

test("listLabels handles json, empty, and invalid output", async () => {
  assert.deepEqual((await createGhRunner({ spawn: fake([{ out: '[{"name":"bug"}]' }]).spawn }).listLabels()).data, ["bug"]);
  assert.deepEqual((await createGhRunner({ spawn: fake([{ out: "" }]).spawn }).listLabels()).data, []);
  assert.equal((await createGhRunner({ spawn: fake([{ out: "no" }]).spawn }).listLabels()).ok, false);
});

test("createPr uses --body-file, no --json, parses url, and returns failures", async () => {
  const f = fake([{ out: "https://github.com/o/r/pull/12\n" }, { code: 2, err: "bad" }]);
  const gh = createGhRunner({ spawn: f.spawn });
  assert.equal((await gh.createPr({ title: "t", bodyFile: "/tmp/b", labels: ["bug"] })).data?.number, 12);
  assert.deepEqual(f.calls[0], ["pr", "create", "--title", "t", "--body-file", "/tmp/b", "--label", "bug"]);
  assert.equal(f.calls[0].includes("--json"), false);
  assert.equal((await gh.createPr({ title: "t", bodyFile: "/tmp/b" })).ok, false);
});

test("searchIssues and createIssue use fake spawn only", async () => {
  const f = fake([{ out: '[{"number":2,"title":"T"}]' }, { out: "[]" }, { out: "https://github.com/o/r/issues/3" }, { code: 1, err: "no" }]);
  const gh = createGhRunner({ spawn: f.spawn });
  assert.equal((await gh.searchIssues("T")).data?.[0].number, 2);
  assert.deepEqual((await gh.searchIssues("none")).data, []);
  assert.equal((await gh.createIssue({ title: "T", bodyFile: "/tmp/B" })).data?.number, 3);
  assert.equal((await gh.createIssue({ title: "T", bodyFile: "/tmp/B" })).ok, false);
});
