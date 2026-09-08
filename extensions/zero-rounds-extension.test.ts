import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runRounds } from "./zero-rounds-extension.ts";
import { readLedger } from "./zero-rounds.ts";

function fixture(fn: (dir: string, messages: string[], ctx: { ui: { notify(m: string): void } }) => void) {
  const dir = mkdtempSync(join(tmpdir(), "zero-rounds-ext-"));
  const messages: string[] = [];
  const ctx = { ui: { notify(m: string) { messages.push(m); } } };
  try { fn(dir, messages, ctx); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("record appends a round and reports the resulting state", () => fixture((dir, messages, ctx) => {
  mkdirSync(join(dir, ".sdd", "alpha"), { recursive: true });
  runRounds("record corregir alpha", ctx, dir);
  assert.equal(readLedger("alpha", dir)?.rounds, 1);
  assert.match(messages[0], /1\/3/);
}));

test("record uses the cap from .sdd/config.json", () => fixture((dir, _messages, ctx) => {
  mkdirSync(join(dir, ".sdd", "alpha"), { recursive: true });
  writeFileSync(join(dir, ".sdd", "config.json"), JSON.stringify({ rounds: { cap: 5 } }));
  runRounds("record corregir alpha", ctx, dir);
  assert.equal(readLedger("alpha", dir)?.cap, 5);
}));

test("a second record keeps the ledger's original cap", () => fixture((dir, _messages, ctx) => {
  mkdirSync(join(dir, ".sdd", "alpha"), { recursive: true });
  runRounds("record corregir alpha --cap 4", ctx, dir);
  runRounds("record replantear alpha", ctx, dir);
  const ledger = readLedger("alpha", dir);
  assert.equal(ledger?.cap, 4);
  assert.deepEqual(ledger?.verdicts, ["corregir", "replantear"]);
}));

test("status --json exposes the routing state", () => fixture((dir, messages, ctx) => {
  mkdirSync(join(dir, ".sdd", "alpha"), { recursive: true });
  runRounds("record pasa alpha", ctx, dir);
  runRounds("status alpha --json", ctx, dir);
  assert.equal(JSON.parse(messages.at(-1)!).state, "done");
}));

test("status on a run with no ledger reports zero rounds", () => fixture((dir, messages, ctx) => {
  mkdirSync(join(dir, ".sdd", "alpha"), { recursive: true });
  runRounds("status alpha", ctx, dir);
  assert.match(messages[0], /sin rondas/i);
}));

test("reset clears the counter", () => fixture((dir, messages, ctx) => {
  mkdirSync(join(dir, ".sdd", "alpha"), { recursive: true });
  runRounds("record corregir alpha", ctx, dir);
  runRounds("reset alpha", ctx, dir);
  assert.equal(readLedger("alpha", dir), null);
  assert.match(messages.at(-1)!, /reiniciado/);
}));

test("an unknown verdict explains the usage instead of writing", () => fixture((dir, messages, ctx) => {
  mkdirSync(join(dir, ".sdd", "alpha"), { recursive: true });
  runRounds("record aprobado alpha", ctx, dir);
  assert.match(messages[0], /uso/);
  assert.equal(readLedger("alpha", dir), null);
}));

test("an ambiguous run asks for an explicit slug", () => fixture((dir, messages, ctx) => {
  mkdirSync(join(dir, ".sdd", "alpha"), { recursive: true });
  mkdirSync(join(dir, ".sdd", "beta"), { recursive: true });
  runRounds("status", ctx, dir);
  assert.match(messages[0], /no hay un único run/);
}));

test("a single run resolves the slug on its own", () => fixture((dir, _messages, ctx) => {
  mkdirSync(join(dir, ".sdd", "alpha"), { recursive: true });
  mkdirSync(join(dir, ".sdd", "specs"), { recursive: true });
  runRounds("record corregir", ctx, dir);
  assert.equal(readLedger("alpha", dir)?.rounds, 1);
}));
