import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatRoundsReport,
  ledgerPath,
  parseRoundsArgs,
  readLedger,
  recordRound,
  stateOf,
  writeLedger,
  type RoundLedger,
} from "./zero-rounds.ts";

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), "zero-rounds-"));
}

test("parseRoundsArgs defaults to status", () => {
  assert.deepEqual(parseRoundsArgs(""), { action: "status", verdict: null, slug: null, cap: null, json: false });
  assert.deepEqual(parseRoundsArgs("alpha"), { action: "status", verdict: null, slug: "alpha", cap: null, json: false });
});

test("parseRoundsArgs reads record, verdict, slug, cap and --json", () => {
  assert.deepEqual(parseRoundsArgs("record corregir alpha --cap 4 --json"), {
    action: "record",
    verdict: "corregir",
    slug: "alpha",
    cap: 4,
    json: true,
  });
});

test("parseRoundsArgs rejects a record with no verdict or an unknown one", () => {
  assert.equal(parseRoundsArgs("record").action, "invalid");
  assert.equal(parseRoundsArgs("record aprobado").action, "invalid");
});

test("parseRoundsArgs accepts reset", () => {
  assert.deepEqual(parseRoundsArgs("reset alpha"), { action: "reset", verdict: null, slug: "alpha", cap: null, json: false });
});

test("stateOf: a pasa verdict settles the run", () => {
  const ledger: RoundLedger = { v: 1, slug: "a", cap: 3, rounds: 2, verdicts: ["corregir", "pasa"], updatedAt: "" };
  assert.equal(stateOf(ledger), "done");
});

test("stateOf: rounds at or over the cap without pasa is cap-reached", () => {
  const ledger: RoundLedger = { v: 1, slug: "a", cap: 2, rounds: 2, verdicts: ["corregir", "replantear"], updatedAt: "" };
  assert.equal(stateOf(ledger), "cap-reached");
});

test("stateOf: rounds left and no pasa is proceed", () => {
  const ledger: RoundLedger = { v: 1, slug: "a", cap: 3, rounds: 1, verdicts: ["corregir"], updatedAt: "" };
  assert.equal(stateOf(ledger), "proceed");
});

test("stateOf: a fresh run (no ledger) proceeds", () => {
  assert.equal(stateOf(null), "proceed");
});

test("recordRound increments the count and appends the verdict", () => {
  const first = recordRound(null, "corregir", { slug: "a", cap: 3, now: new Date("2026-09-08T10:00:00Z") });
  assert.equal(first.rounds, 1);
  assert.deepEqual(first.verdicts, ["corregir"]);
  assert.equal(first.cap, 3);
  assert.equal(first.updatedAt, "2026-09-08T10:00:00.000Z");

  const second = recordRound(first, "pasa", { slug: "a", cap: 3, now: new Date("2026-09-08T10:05:00Z") });
  assert.equal(second.rounds, 2);
  assert.deepEqual(second.verdicts, ["corregir", "pasa"]);
});

test("recordRound keeps the ledger's own cap when no override is given", () => {
  const first: RoundLedger = { v: 1, slug: "a", cap: 5, rounds: 1, verdicts: ["corregir"], updatedAt: "" };
  assert.equal(recordRound(first, "corregir", { slug: "a", cap: null }).cap, 5);
});

test("recordRound rejects a verdict outside the vocabulary", () => {
  assert.throws(() => recordRound(null, "aprobado" as never, { slug: "a", cap: 3 }), /verdicto/i);
});

test("writeLedger then readLedger round-trips", () => {
  const root = tmpRepo();
  try {
    mkdirSync(join(root, ".sdd", "alpha"), { recursive: true });
    const ledger = recordRound(null, "corregir", { slug: "alpha", cap: 3 });
    writeLedger(ledger, root);
    assert.deepEqual(readLedger("alpha", root), ledger);
    assert.equal(ledgerPath("alpha", root), join(root, ".sdd", "alpha", "rounds.json"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeLedger creates the run directory when it does not exist yet", () => {
  const root = tmpRepo();
  try {
    writeLedger(recordRound(null, "corregir", { slug: "nuevo", cap: 3 }), root);
    assert.equal(readLedger("nuevo", root)?.rounds, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readLedger returns null when the file is absent, corrupt or a foreign version", () => {
  const root = tmpRepo();
  try {
    assert.equal(readLedger("ausente", root), null);
    mkdirSync(join(root, ".sdd", "roto"), { recursive: true });
    writeFileSync(join(root, ".sdd", "roto", "rounds.json"), "{ no json", "utf8");
    assert.equal(readLedger("roto", root), null);
    mkdirSync(join(root, ".sdd", "viejo"), { recursive: true });
    writeFileSync(join(root, ".sdd", "viejo", "rounds.json"), JSON.stringify({ v: 99, slug: "viejo", cap: 3, rounds: 1, verdicts: [] }), "utf8");
    assert.equal(readLedger("viejo", root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatRoundsReport states rounds spent, cap and state in Spanish", () => {
  const ledger: RoundLedger = { v: 1, slug: "alpha", cap: 3, rounds: 2, verdicts: ["corregir", "replantear"], updatedAt: "2026-09-08T10:00:00.000Z" };
  const report = formatRoundsReport(ledger);
  assert.match(report, /alpha/);
  assert.match(report, /2\s*\/\s*3/);
  assert.match(report, /corregir, replantear/);
  assert.match(report, /proceed|queda/i);
});

test("formatRoundsReport handles a run with no ledger yet", () => {
  assert.match(formatRoundsReport(null, "alpha"), /sin rondas|0/i);
});
