import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mergeLinks, readLinks, writeLinks } from "./sdd-links.ts";

function fixture(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-links-"));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("readLinks returns empty for missing and corrupt files", () => fixture((dir) => {
  assert.deepEqual(readLinks(dir, "a"), {});
  mkdirSync(join(dir, "a"), { recursive: true });
  writeFileSync(join(dir, "a", "links.json"), "{");
  assert.deepEqual(readLinks(dir, "a"), {});
}));

test("readLinks accepts valid object records", () => fixture((dir) => {
  mkdirSync(join(dir, "a"), { recursive: true });
  writeFileSync(join(dir, "a", "links.json"), JSON.stringify({ issueNumber: 3 }));
  assert.equal(readLinks(dir, "a").issueNumber, 3);
}));

test("mergeLinks preserves unknown fields and supports git/archive fields", () => {
  const next = mergeLinks({ custom: "keep", issueNumber: 3 }, { branch: "sdd/a", baseBranch: "main", archivePath: ".sdd/archive/2026-01-01-a" });
  assert.deepEqual(next, { custom: "keep", issueNumber: 3, branch: "sdd/a", baseBranch: "main", archivePath: ".sdd/archive/2026-01-01-a" });
});

test("writeLinks atomically merges and preserves existing fields", () => fixture((dir) => {
  writeLinks(dir, "a", { issueNumber: 3, issueUrl: "u", custom: "keep" });
  const next = writeLinks(dir, "a", { prNumber: 4, branch: "sdd/a", baseBranch: "main" });
  assert.deepEqual(next, { issueNumber: 3, issueUrl: "u", custom: "keep", prNumber: 4, branch: "sdd/a", baseBranch: "main" });
  assert.deepEqual(readLinks(dir, "a"), next);
  assert.equal(readdirSync(join(dir, "a")).some((name) => name.endsWith(".tmp")), false);
}));
