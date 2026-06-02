import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_SDD_CONFIG, loadSddConfig } from "./sdd-config.ts";

function fixture(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-config-"));
  try { mkdirSync(join(dir, ".sdd")); fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("loadSddConfig returns defaults when file is absent", () => fixture((dir) => {
  assert.deepEqual(loadSddConfig(dir), DEFAULT_SDD_CONFIG);
}));

test("loadSddConfig applies partial overrides", () => fixture((dir) => {
  writeFileSync(join(dir, ".sdd", "config.json"), JSON.stringify({ git: { branchPrefix: "feat/", baseBranch: "develop", autoCommit: true, commitStyle: "plain" } }));
  assert.deepEqual(loadSddConfig(dir).git, { branchPrefix: "feat/", numbering: false, autoCommit: true, commitStyle: "plain", baseBranch: "develop" });
}));

test("loadSddConfig rejects malformed JSON", () => fixture((dir) => {
  writeFileSync(join(dir, ".sdd", "config.json"), "{");
  assert.throws(() => loadSddConfig(dir), /invalid \.sdd\/config\.json/);
}));

test("loadSddConfig defaults tdd to strict mode with no test command", () => fixture((dir) => {
  assert.deepEqual(loadSddConfig(dir).tdd, { mode: "strict", testCommand: "" });
}));

test("loadSddConfig defaults tdd to strict when the file omits the tdd block", () => fixture((dir) => {
  writeFileSync(join(dir, ".sdd", "config.json"), JSON.stringify({ git: { branchPrefix: "feat/" } }));
  assert.deepEqual(loadSddConfig(dir).tdd, { mode: "strict", testCommand: "" });
}));

test("loadSddConfig honours tdd off and an explicit test command", () => fixture((dir) => {
  writeFileSync(join(dir, ".sdd", "config.json"), JSON.stringify({ tdd: { mode: "off", testCommand: "pnpm test" } }));
  assert.deepEqual(loadSddConfig(dir).tdd, { mode: "off", testCommand: "pnpm test" });
}));

test("loadSddConfig falls back to strict for an unknown tdd mode", () => fixture((dir) => {
  writeFileSync(join(dir, ".sdd", "config.json"), JSON.stringify({ tdd: { mode: "loose", testCommand: 42 } }));
  assert.deepEqual(loadSddConfig(dir).tdd, { mode: "strict", testCommand: "" });
}));
