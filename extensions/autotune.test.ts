// Unit tests for the adaptive-model-profiles pure-logic module.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aggregate,
  aggregateCostStats,
  decideAdjustments,
  dedupeRunRecords,
  HIGH_AVG_CORREGIR,
  HIGH_AVG_REPLANTEAR,
  MIN_COST_SAMPLES,
  MIN_V2_SAMPLES,
  parseRunLine,
  readAutotuneMode,
  readRunRecords,
  stepUp,
  tierOf,
  type PhaseModelStat,
  type RunRecord,
} from "./autotune.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Build a well-formed v1 run record (no `verdicts`), overriding any field. */
function makeRecord(over: Partial<RunRecord> = {}): RunRecord {
  return {
    v: 1,
    ts: "2026-05-17T12:00:00.000Z",
    feature: "some-feature",
    phases: {
      explore: { model: "claude-haiku-4-5" },
      plan: { model: "claude-opus-4-7" },
      build: { model: "claude-sonnet-4-6" },
      veredicto: { model: "claude-opus-4-7" },
    },
    verdict: "pasa",
    rounds: 1,
    ...over,
  };
}

/** The raw JSON object shape of a valid v1 record, for off-shape mutation
 *  tests. v1 records carry no `verdicts` field. */
function rawRecord(): Record<string, unknown> {
  return {
    v: 1,
    ts: "2026-05-17T12:00:00.000Z",
    feature: "some-feature",
    phases: {
      explore: { model: "claude-haiku-4-5" },
      plan: { model: "claude-opus-4-7" },
      build: { model: "claude-sonnet-4-6" },
      veredicto: { model: "claude-opus-4-7" },
    },
    verdict: "pasa",
    rounds: 1,
  };
}

/** Build a well-formed v2 run record (carries a `verdicts` sequence). The
 *  `verdicts`/`verdict`/`rounds` triple is left mutually consistent unless an
 *  override deliberately breaks it. */
function makeV2Record(over: Partial<RunRecord> = {}): RunRecord {
  return {
    v: 2,
    ts: "2026-05-18T12:00:00.000Z",
    feature: "some-feature",
    phases: {
      explore: { model: "claude-haiku-4-5" },
      plan: { model: "claude-opus-4-7" },
      build: { model: "claude-sonnet-4-6" },
      veredicto: { model: "claude-opus-4-7" },
    },
    verdict: "pasa",
    rounds: 1,
    verdicts: ["pasa"],
    ...over,
  };
}

/** The raw JSON object shape of a valid v2 record, for off-shape mutation
 *  tests. The default sequence is a clean single-round `pasa`. */
function rawV2Record(): Record<string, unknown> {
  return {
    v: 2,
    ts: "2026-05-18T12:00:00.000Z",
    feature: "some-feature",
    phases: {
      explore: { model: "claude-haiku-4-5" },
      plan: { model: "claude-opus-4-7" },
      build: { model: "claude-sonnet-4-6" },
      veredicto: { model: "claude-opus-4-7" },
    },
    verdict: "pasa",
    rounds: 1,
    verdicts: ["pasa"],
  };
}

// ---------------------------------------------------------------------------
// parseRunLine
// ---------------------------------------------------------------------------

test("parseRunLine parses a valid v1 JSONL line into a RunRecord", () => {
  const record = parseRunLine(JSON.stringify(rawRecord()));
  assert.notEqual(record, null);
  assert.equal(record!.v, 1);
  assert.equal(record!.feature, "some-feature");
  assert.equal(record!.verdict, "pasa");
  assert.equal(record!.rounds, 1);
  assert.equal(record!.phases.build.model, "claude-sonnet-4-6");
  assert.equal(record!.verdicts, undefined, "v1 records carry no verdicts sequence");
});

test("parseRunLine returns null for malformed JSON", () => {
  assert.equal(parseRunLine("{not json"), null);
  assert.equal(parseRunLine(""), null);
  assert.equal(parseRunLine("[1,2,3"), null);
});

test("parseRunLine returns null for a non-object JSON value", () => {
  assert.equal(parseRunLine("42"), null);
  assert.equal(parseRunLine('"a string"'), null);
  assert.equal(parseRunLine("[1,2,3]"), null);
  assert.equal(parseRunLine("null"), null);
});

test("parseRunLine returns null when phases is missing", () => {
  const raw = rawRecord();
  delete raw.phases;
  assert.equal(parseRunLine(JSON.stringify(raw)), null);
});

test("parseRunLine returns null when a single phase is missing", () => {
  const raw = rawRecord();
  delete (raw.phases as Record<string, unknown>).build;
  assert.equal(parseRunLine(JSON.stringify(raw)), null);
});

test("parseRunLine returns null when a phase model is non-string or empty", () => {
  const badType = rawRecord();
  (badType.phases as Record<string, unknown>).build = { model: 42 };
  assert.equal(parseRunLine(JSON.stringify(badType)), null);

  const empty = rawRecord();
  (empty.phases as Record<string, unknown>).build = { model: "" };
  assert.equal(parseRunLine(JSON.stringify(empty)), null);
});

test("parseRunLine returns null for a verdict outside the enum", () => {
  assert.equal(parseRunLine(JSON.stringify({ ...rawRecord(), verdict: "maybe" })), null);
  assert.equal(parseRunLine(JSON.stringify({ ...rawRecord(), verdict: 1 })), null);
});

test("parseRunLine accepts the cap-reached verdict", () => {
  const record = parseRunLine(JSON.stringify({ ...rawRecord(), verdict: "cap-reached" }));
  assert.notEqual(record, null);
  assert.equal(record!.verdict, "cap-reached");
});

test("parseRunLine returns null for an unexpected schema version", () => {
  // v:1 and v:2 are the only accepted versions; anything else is dropped.
  assert.equal(parseRunLine(JSON.stringify({ ...rawRecord(), v: 3 })), null);
  assert.equal(parseRunLine(JSON.stringify({ ...rawRecord(), v: 0 })), null);
  assert.equal(parseRunLine(JSON.stringify({ ...rawRecord(), v: "1" })), null);
});

test("parseRunLine returns null for a missing or non-string ts/feature", () => {
  assert.equal(parseRunLine(JSON.stringify({ ...rawRecord(), ts: "" })), null);
  assert.equal(parseRunLine(JSON.stringify({ ...rawRecord(), feature: 7 })), null);
});

test("parseRunLine returns null for a non-integer rounds", () => {
  assert.equal(parseRunLine(JSON.stringify({ ...rawRecord(), rounds: 1.5 })), null);
  assert.equal(parseRunLine(JSON.stringify({ ...rawRecord(), rounds: "3" })), null);
});

// ---------------------------------------------------------------------------
// parseRunLine — v2 records (verdicts sequence)
// ---------------------------------------------------------------------------

test("parseRunLine parses a valid v2 record and exposes the verdicts sequence", () => {
  const raw = { ...rawV2Record(), verdict: "pasa", rounds: 3, verdicts: ["corregir", "corregir", "pasa"] };
  const record = parseRunLine(JSON.stringify(raw));
  assert.notEqual(record, null);
  assert.equal(record!.v, 2);
  assert.equal(record!.verdict, "pasa");
  assert.equal(record!.rounds, 3);
  assert.deepEqual(record!.verdicts, ["corregir", "corregir", "pasa"]);
});

test("parseRunLine parses a valid v2 cap-reached record with no pasa entry", () => {
  const raw = { ...rawV2Record(), verdict: "cap-reached", rounds: 2, verdicts: ["corregir", "replantear"] };
  const record = parseRunLine(JSON.stringify(raw));
  assert.notEqual(record, null);
  assert.equal(record!.verdict, "cap-reached");
  assert.deepEqual(record!.verdicts, ["corregir", "replantear"]);
});

test("parseRunLine rejects a v2 record with missing verdicts", () => {
  const raw = rawV2Record();
  delete raw.verdicts;
  assert.equal(parseRunLine(JSON.stringify(raw)), null);
});

test("parseRunLine rejects a v2 record with non-array verdicts", () => {
  assert.equal(parseRunLine(JSON.stringify({ ...rawV2Record(), verdicts: "pasa" })), null);
  assert.equal(parseRunLine(JSON.stringify({ ...rawV2Record(), verdicts: 3 })), null);
  assert.equal(parseRunLine(JSON.stringify({ ...rawV2Record(), verdicts: {} })), null);
});

test("parseRunLine rejects a v2 record with an empty verdicts array", () => {
  assert.equal(parseRunLine(JSON.stringify({ ...rawV2Record(), verdicts: [] })), null);
});

test("parseRunLine rejects a v2 verdicts entry outside the round-verdict set", () => {
  // `cap-reached` is a run-level terminal state, never a round verdict.
  assert.equal(
    parseRunLine(JSON.stringify({ ...rawV2Record(), verdicts: ["cap-reached"] })),
    null,
  );
  assert.equal(parseRunLine(JSON.stringify({ ...rawV2Record(), verdicts: ["maybe"] })), null);
  assert.equal(parseRunLine(JSON.stringify({ ...rawV2Record(), verdicts: [1] })), null);
});

test("parseRunLine rejects a v2 record whose verdicts length differs from rounds", () => {
  const raw = { ...rawV2Record(), verdict: "pasa", rounds: 3, verdicts: ["pasa"] };
  assert.equal(parseRunLine(JSON.stringify(raw)), null);
});

test("parseRunLine rejects a pasa v2 run whose last entry is not pasa", () => {
  const raw = { ...rawV2Record(), verdict: "pasa", rounds: 2, verdicts: ["pasa", "corregir"] };
  assert.equal(parseRunLine(JSON.stringify(raw)), null);
});

test("parseRunLine rejects a pasa v2 run with a pasa entry mid-sequence", () => {
  const raw = { ...rawV2Record(), verdict: "pasa", rounds: 3, verdicts: ["pasa", "corregir", "pasa"] };
  assert.equal(parseRunLine(JSON.stringify(raw)), null);
});

test("parseRunLine rejects a cap-reached v2 run containing a pasa entry", () => {
  const raw = { ...rawV2Record(), verdict: "cap-reached", rounds: 2, verdicts: ["corregir", "pasa"] };
  assert.equal(parseRunLine(JSON.stringify(raw)), null);
});

// ---------------------------------------------------------------------------
// readRunRecords
// ---------------------------------------------------------------------------

test("readRunRecords returns [] for a missing file", () => {
  const missing = join(tmpdir(), "zero-autotune-does-not-exist-xyz.jsonl");
  assert.deepEqual(readRunRecords(missing), []);
});

test("readRunRecords reads valid lines and drops malformed/empty ones", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "zero-autotune-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const file = join(dir, "zero-runs.jsonl");
  const lines = [
    JSON.stringify(makeRecord({ feature: "alpha" })),
    "", // empty line — skipped
    "{ broken json", // malformed — dropped
    JSON.stringify({ ...rawRecord(), verdict: "bogus" }), // off-shape — dropped
    "   ", // whitespace-only — skipped
    JSON.stringify(makeRecord({ feature: "beta" })),
  ];
  writeFileSync(file, lines.join("\n"), "utf8");

  const records = readRunRecords(file);
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((r) => r.feature),
    ["alpha", "beta"],
  );
});

test("readRunRecords reads a mixed v1/v2 log, dropping only malformed lines", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "zero-autotune-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const file = join(dir, "zero-runs.jsonl");
  const lines = [
    JSON.stringify(makeRecord({ feature: "v1-clean" })),
    JSON.stringify(
      makeV2Record({ feature: "v2-clean", verdict: "pasa", rounds: 2, verdicts: ["corregir", "pasa"] }),
    ),
    // Malformed v2 — verdicts length mismatches rounds — dropped.
    JSON.stringify({ ...rawV2Record(), feature: "v2-bad", rounds: 3, verdicts: ["pasa"] }),
    JSON.stringify(makeV2Record({ feature: "v2-cap", verdict: "cap-reached", rounds: 1, verdicts: ["corregir"] })),
  ];
  writeFileSync(file, lines.join("\n"), "utf8");

  const records = readRunRecords(file);
  assert.deepEqual(
    records.map((r) => r.feature),
    ["v1-clean", "v2-clean", "v2-cap"],
  );
  assert.equal(records[0].verdicts, undefined, "the v1 record has no verdicts");
  assert.deepEqual(records[1].verdicts, ["corregir", "pasa"]);
});

// ---------------------------------------------------------------------------
// dedupeRunRecords
// ---------------------------------------------------------------------------

test("dedupeRunRecords collapses two records with the same (feature, ts) to one", () => {
  const a = makeRecord({ feature: "dup", ts: "2026-05-17T12:00:00.000Z" });
  const b = makeRecord({ feature: "dup", ts: "2026-05-17T12:00:00.000Z" });
  const out = dedupeRunRecords([a, b]);
  assert.equal(out.length, 1, "the identical (feature, ts) pair collapses to a single record");
});

test("dedupeRunRecords keeps the FIRST occurrence on an identity tie", () => {
  // Same (feature, ts) identity, distinguishable content: the kept record must
  // be the first one's content, not the second's.
  const first = makeRecord({
    feature: "dup",
    ts: "2026-05-17T12:00:00.000Z",
    verdict: "pasa",
    rounds: 1,
  });
  const second = makeRecord({
    feature: "dup",
    ts: "2026-05-17T12:00:00.000Z",
    verdict: "cap-reached",
    rounds: 7,
  });
  const out = dedupeRunRecords([first, second]);
  assert.equal(out.length, 1);
  assert.equal(out[0].verdict, "pasa", "the first record's verdict is kept");
  assert.equal(out[0].rounds, 1, "the first record's rounds are kept");
  assert.strictEqual(out[0], first, "the kept record is the first object, not the second");
});

test("dedupeRunRecords is order-independent: same unique set wherever the duplicate sits", () => {
  const a = makeRecord({ feature: "alpha", ts: "2026-05-17T01:00:00.000Z" });
  const b = makeRecord({ feature: "beta", ts: "2026-05-17T02:00:00.000Z" });
  const c = makeRecord({ feature: "gamma", ts: "2026-05-17T03:00:00.000Z" });
  const dupOfB = makeRecord({ feature: "beta", ts: "2026-05-17T02:00:00.000Z" });

  // The duplicate of beta sits at three different positions in the list.
  const dupEarly = dedupeRunRecords([dupOfB, a, b, c]);
  const dupMiddle = dedupeRunRecords([a, dupOfB, b, c]);
  const dupLate = dedupeRunRecords([a, b, c, dupOfB]);

  // Each de-duplicated set carries exactly the three distinct identities.
  const identities = (records: RunRecord[]) =>
    records.map((r) => `${r.feature}|${r.ts}`).sort();
  assert.deepEqual(identities(dupEarly), ["alpha|2026-05-17T01:00:00.000Z", "beta|2026-05-17T02:00:00.000Z", "gamma|2026-05-17T03:00:00.000Z"]);
  assert.deepEqual(identities(dupEarly), identities(dupMiddle));
  assert.deepEqual(identities(dupMiddle), identities(dupLate));
  assert.equal(dupEarly.length, 3);
  assert.equal(dupMiddle.length, 3);
  assert.equal(dupLate.length, 3);
});

test("dedupeRunRecords does not collapse same feature with different ts", () => {
  const a = makeRecord({ feature: "same-feature", ts: "2026-05-17T10:00:00.000Z" });
  const b = makeRecord({ feature: "same-feature", ts: "2026-05-17T11:00:00.000Z" });
  const out = dedupeRunRecords([a, b]);
  assert.equal(out.length, 2, "differing ts is a distinct identity — no collapse");
});

test("dedupeRunRecords does not collapse same ts with different feature", () => {
  const a = makeRecord({ feature: "feature-a", ts: "2026-05-17T10:00:00.000Z" });
  const b = makeRecord({ feature: "feature-b", ts: "2026-05-17T10:00:00.000Z" });
  const out = dedupeRunRecords([a, b]);
  assert.equal(out.length, 2, "differing feature is a distinct identity — no collapse");
});

test("dedupeRunRecords passes a duplicate-free log through unchanged (identity)", () => {
  const records = [
    makeRecord({ feature: "alpha", ts: "2026-05-17T01:00:00.000Z" }),
    makeRecord({ feature: "beta", ts: "2026-05-17T02:00:00.000Z" }),
    makeRecord({ feature: "gamma", ts: "2026-05-17T03:00:00.000Z" }),
  ];
  const out = dedupeRunRecords(records);
  assert.equal(out.length, 3);
  assert.deepEqual(out, records, "a log with no duplicates is the identity");
});

test("dedupeRunRecords returns an empty array for empty input", () => {
  assert.deepEqual(dedupeRunRecords([]), []);
});

test("dedupeRunRecords dedupes v1 and v2 records identically — identity ignores v/verdicts", () => {
  // A v1 record and a v2 record share the same (feature, ts) identity; they
  // must collapse despite the differing `v` and `verdicts` fields.
  const v1 = makeRecord({ feature: "cross-ver", ts: "2026-05-17T12:00:00.000Z" });
  const v2 = makeV2Record({
    feature: "cross-ver",
    ts: "2026-05-17T12:00:00.000Z",
    verdict: "pasa",
    rounds: 2,
    verdicts: ["corregir", "pasa"],
  });
  const out = dedupeRunRecords([v1, v2]);
  assert.equal(out.length, 1, "(feature, ts) collapses across schema versions");
  assert.strictEqual(out[0], v1, "the first occurrence (the v1 record) is kept");

  // Two v2 records with the same identity collapse the same way.
  const v2a = makeV2Record({ feature: "v2-dup", ts: "2026-05-18T09:00:00.000Z" });
  const v2b = makeV2Record({ feature: "v2-dup", ts: "2026-05-18T09:00:00.000Z" });
  const v2Out = dedupeRunRecords([v2a, v2b]);
  assert.equal(v2Out.length, 1, "two v2 records with the same identity collapse to one");
  assert.strictEqual(v2Out[0], v2a, "the first v2 record is kept");
});

test("readRunRecords de-duplicates a .jsonl file with duplicate lines", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "zero-autotune-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const file = join(dir, "zero-runs.jsonl");
  // Three distinct runs, but two of them are written twice — exactly what a
  // careless Cortex PULL re-appending records already present would produce.
  const dupLine = JSON.stringify(makeRecord({ feature: "alpha", ts: "2026-05-17T01:00:00.000Z" }));
  const lines = [
    dupLine,
    JSON.stringify(makeRecord({ feature: "beta", ts: "2026-05-17T02:00:00.000Z" })),
    JSON.stringify(makeRecord({ feature: "gamma", ts: "2026-05-17T03:00:00.000Z" })),
    JSON.stringify(makeRecord({ feature: "beta", ts: "2026-05-17T02:00:00.000Z" })), // dup of beta
    dupLine, // dup of alpha
  ];
  writeFileSync(file, lines.join("\n"), "utf8");

  const records = readRunRecords(file);
  assert.equal(records.length, 3, "five lines, three distinct (feature, ts) identities");
  assert.deepEqual(
    records.map((r) => r.feature),
    ["alpha", "beta", "gamma"],
    "the first occurrence of each identity is kept, in input order",
  );
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

test("aggregate returns an empty map for empty input", () => {
  assert.equal(aggregate([]).size, 0);
});

test("aggregate computes pass-rate per (phase, model) pair", () => {
  const records = [
    makeRecord({ verdict: "pasa" }),
    makeRecord({ verdict: "pasa" }),
    makeRecord({ verdict: "cap-reached" }),
    makeRecord({ verdict: "cap-reached" }),
  ];
  const stats = aggregate(records);
  const explore = stats.get("explore claude-haiku-4-5") as PhaseModelStat;
  assert.equal(explore.samples, 4);
  assert.equal(explore.passRate, 0.5);
});

test("aggregate averages avgRounds only over pasa runs", () => {
  const records = [
    makeRecord({ verdict: "pasa", rounds: 2 }),
    makeRecord({ verdict: "pasa", rounds: 4 }),
    makeRecord({ verdict: "cap-reached", rounds: 10 }), // excluded from avg
  ];
  const stats = aggregate(records);
  const build = stats.get("build claude-sonnet-4-6") as PhaseModelStat;
  assert.equal(build.samples, 3);
  assert.equal(build.avgRounds, 3, "avg of 2 and 4, the cap-reached run ignored");
});

test("aggregate yields avgRounds null when a pair has no pasa run", () => {
  const stats = aggregate([makeRecord({ verdict: "cap-reached", rounds: 5 })]);
  const build = stats.get("build claude-sonnet-4-6") as PhaseModelStat;
  assert.equal(build.passRate, 0);
  assert.equal(build.avgRounds, null);
});

test("aggregate ignores non-positive rounds in the avgRounds average", () => {
  const records = [
    makeRecord({ verdict: "pasa", rounds: 0 }), // non-positive — ignored
    makeRecord({ verdict: "pasa", rounds: -3 }), // negative — ignored
    makeRecord({ verdict: "pasa", rounds: 3 }),
  ];
  const stats = aggregate(records);
  const build = stats.get("build claude-sonnet-4-6") as PhaseModelStat;
  assert.equal(build.samples, 3);
  assert.equal(build.passRate, 1);
  assert.equal(build.avgRounds, 3, "only the rounds=3 run feeds the average");
});

test("aggregate buckets each phase under the model that phase ran on", () => {
  const stats = aggregate([makeRecord()]);
  // The default fixture runs plan and veredicto on opus, build on sonnet,
  // explore on haiku — four distinct buckets.
  assert.equal(stats.size, 4);
  assert.ok(stats.has("explore claude-haiku-4-5"));
  assert.ok(stats.has("plan claude-opus-4-7"));
  assert.ok(stats.has("build claude-sonnet-4-6"));
  assert.ok(stats.has("veredicto claude-opus-4-7"));
});

test("aggregate leaves v2 attribution fields dormant for a v1-only input", () => {
  const stats = aggregate([makeRecord(), makeRecord({ verdict: "cap-reached" })]);
  for (const stat of stats.values()) {
    assert.equal(stat.v2Samples, 0, "no v2 records → no v2 samples");
    assert.equal(stat.avgCorregir, null);
    assert.equal(stat.avgReplantear, null);
  }
});

test("aggregate counts v2Samples per (phase, model) from v2 records only", () => {
  const records = [
    makeRecord(), // v1 — contributes samples but no v2Samples
    makeV2Record({ verdict: "pasa", rounds: 1, verdicts: ["pasa"] }),
    makeV2Record({ verdict: "pasa", rounds: 2, verdicts: ["corregir", "pasa"] }),
  ];
  const stats = aggregate(records);
  const build = stats.get("build claude-sonnet-4-6") as PhaseModelStat;
  assert.equal(build.samples, 3, "all three runs feed samples");
  assert.equal(build.v2Samples, 2, "only the two v2 runs feed v2Samples");
});

test("aggregate computes avgCorregir for the build model from v2 verdicts", () => {
  const records = [
    makeV2Record({ verdict: "pasa", rounds: 3, verdicts: ["corregir", "corregir", "pasa"] }),
    makeV2Record({ verdict: "pasa", rounds: 1, verdicts: ["pasa"] }),
  ];
  const stats = aggregate(records);
  const build = stats.get("build claude-sonnet-4-6") as PhaseModelStat;
  assert.equal(build.v2Samples, 2);
  assert.equal(build.avgCorregir, 1, "mean of 2 and 0 corregir counts");
  assert.equal(build.avgReplantear, 0, "build runs carried no replantear");
});

test("aggregate computes avgReplantear for the plan model from v2 verdicts", () => {
  const records = [
    makeV2Record({ verdict: "pasa", rounds: 2, verdicts: ["replantear", "pasa"] }),
    makeV2Record({ verdict: "pasa", rounds: 3, verdicts: ["replantear", "replantear", "pasa"] }),
  ];
  const stats = aggregate(records);
  const plan = stats.get("plan claude-opus-4-7") as PhaseModelStat;
  assert.equal(plan.v2Samples, 2);
  assert.equal(plan.avgReplantear, 1.5, "mean of 1 and 2 replantear counts");
});

test("aggregate attributes corregir to build and replantear to plan, not vice versa", () => {
  const records = [
    makeV2Record({
      verdict: "cap-reached",
      rounds: 3,
      verdicts: ["corregir", "replantear", "corregir"],
    }),
  ];
  const stats = aggregate(records);
  const build = stats.get("build claude-sonnet-4-6") as PhaseModelStat;
  const plan = stats.get("plan claude-opus-4-7") as PhaseModelStat;
  assert.equal(build.avgCorregir, 2, "two corregir verdicts blame the build model");
  assert.equal(plan.avgReplantear, 1, "one replantear verdict blames the plan model");
});

// ---------------------------------------------------------------------------
// aggregateCostStats
// ---------------------------------------------------------------------------

test("aggregateCostStats computes average cost per phase/model", () => {
  const stats = aggregateCostStats([
    { phase: "build", model: "claude-sonnet-4-6", usage: { cost: 2 } },
    { phase: "build", model: "claude-sonnet-4-6", usage: { cost: 4 } },
    { phase: "plan", model: "claude-opus-4-7", usage: { cost: 9 } },
    { phase: "build", model: "", usage: { cost: 99 } },
    { phase: "other", model: "claude-sonnet-4-6", usage: { cost: 99 } },
  ]);
  const build = stats.get("build claude-sonnet-4-6");
  assert.equal(build?.samples, 2);
  assert.equal(build?.totalCost, 6);
  assert.equal(build?.avgCost, 3);
  assert.equal(stats.get("plan claude-opus-4-7")?.avgCost, 9);
  assert.equal(stats.size, 2);
});

// ---------------------------------------------------------------------------
// tierOf
// ---------------------------------------------------------------------------

test("tierOf classifies each tier by substring", () => {
  assert.equal(tierOf("claude-haiku-4-5"), 0);
  assert.equal(tierOf("claude-sonnet-4-6"), 1);
  assert.equal(tierOf("claude-opus-4-7"), 2);
  assert.equal(tierOf("CLAUDE-OPUS-4-7"), 2, "case-insensitive");
});

test("tierOf returns null for an untierable model id", () => {
  assert.equal(tierOf("gpt-4o"), null);
  assert.equal(tierOf(""), null);
});

// ---------------------------------------------------------------------------
// stepUp
// ---------------------------------------------------------------------------

test("stepUp moves a model up exactly one tier", () => {
  assert.equal(tierOf(stepUp("claude-haiku-4-5", [])!), 1);
  assert.equal(tierOf(stepUp("claude-sonnet-4-6", [])!), 2);
});

test("stepUp returns null at the opus ceiling", () => {
  assert.equal(stepUp("claude-opus-4-7", []), null);
});

test("stepUp returns null for an untierable model", () => {
  assert.equal(stepUp("gpt-4o", []), null);
});

test("stepUp prefers a known model at the next tier over the representative", () => {
  const known = ["claude-sonnet-4-7-custom"];
  assert.equal(stepUp("claude-haiku-4-5", known), "claude-sonnet-4-7-custom");
});

test("stepUp picks the smallest known id deterministically when several qualify", () => {
  const known = ["claude-sonnet-z", "claude-sonnet-a", "claude-sonnet-m"];
  assert.equal(stepUp("claude-haiku-4-5", known), "claude-sonnet-a");
});

test("stepUp falls back to the fixed representative when no known model qualifies", () => {
  // Only a same-tier known model — no next-tier candidate.
  assert.equal(stepUp("claude-haiku-4-5", ["claude-haiku-other"]), "claude-sonnet-4-6");
});

// ---------------------------------------------------------------------------
// decideAdjustments — v2 surgical phase attribution
// ---------------------------------------------------------------------------

/** A stat map carrying one v2 (phase, model) bucket. v1 fields are filled with
 *  benign defaults; the v2 fields are what `decideAdjustments` now reads. */
function v2StatsFor(
  phase: PhaseModelStat["phase"],
  model: string,
  over: Partial<PhaseModelStat>,
): Map<string, PhaseModelStat> {
  const stat: PhaseModelStat = {
    phase,
    model,
    samples: MIN_V2_SAMPLES,
    passRate: 1,
    avgRounds: 1,
    v2Samples: MIN_V2_SAMPLES,
    avgCorregir: 0,
    avgReplantear: 0,
    ...over,
  };
  return new Map([[`${phase} ${model}`, stat]]);
}

test("decideAdjustments steps up the build phase when corregir blame is high", () => {
  const stats = v2StatsFor("build", "claude-sonnet-4-6", {
    v2Samples: 9,
    avgCorregir: HIGH_AVG_CORREGIR + 0.7,
  });
  const out = decideAdjustments(stats, { build: "claude-sonnet-4-6" }, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].phase, "build");
  assert.equal(out[0].from, "claude-sonnet-4-6");
  assert.equal(tierOf(out[0].to), 2, "stepped exactly one tier up to opus");
  assert.ok(out[0].reason.includes("corregir/run"));
  assert.ok(out[0].reason.includes("9 runs v2"));
});

test("decideAdjustments steps up the plan phase when replantear blame is high", () => {
  const stats = v2StatsFor("plan", "claude-sonnet-4-6", {
    v2Samples: 6,
    avgReplantear: HIGH_AVG_REPLANTEAR + 0.3,
  });
  const out = decideAdjustments(stats, { plan: "claude-sonnet-4-6" }, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].phase, "plan");
  assert.ok(out[0].reason.includes("replantear/run"));
});

test("decideAdjustments blames build only when corregir is high, not plan", () => {
  // build is the model at fault; plan runs on a healthy opus already.
  const stats = new Map<string, PhaseModelStat>([
    [
      "build claude-sonnet-4-6",
      {
        phase: "build",
        model: "claude-sonnet-4-6",
        samples: 8,
        passRate: 1,
        avgRounds: 1,
        v2Samples: 8,
        avgCorregir: HIGH_AVG_CORREGIR + 1,
        avgReplantear: 0,
      },
    ],
    [
      "plan claude-sonnet-4-6",
      {
        phase: "plan",
        model: "claude-sonnet-4-6",
        samples: 8,
        passRate: 1,
        avgRounds: 1,
        v2Samples: 8,
        avgCorregir: 0,
        avgReplantear: 0, // plan is healthy
      },
    ],
  ]);
  const out = decideAdjustments(
    stats,
    { build: "claude-sonnet-4-6", plan: "claude-sonnet-4-6" },
    [],
  );
  assert.equal(out.length, 1, "only the blamed build phase is adjusted");
  assert.equal(out[0].phase, "build");
});

test("decideAdjustments blames plan only when replantear is high, not build", () => {
  const stats = new Map<string, PhaseModelStat>([
    [
      "build claude-sonnet-4-6",
      {
        phase: "build",
        model: "claude-sonnet-4-6",
        samples: 8,
        passRate: 1,
        avgRounds: 1,
        v2Samples: 8,
        avgCorregir: 0, // build is healthy
        avgReplantear: 0,
      },
    ],
    [
      "plan claude-sonnet-4-6",
      {
        phase: "plan",
        model: "claude-sonnet-4-6",
        samples: 8,
        passRate: 1,
        avgRounds: 1,
        v2Samples: 8,
        avgCorregir: 0,
        avgReplantear: HIGH_AVG_REPLANTEAR + 1,
      },
    ],
  ]);
  const out = decideAdjustments(
    stats,
    { build: "claude-sonnet-4-6", plan: "claude-sonnet-4-6" },
    [],
  );
  assert.equal(out.length, 1, "only the blamed plan phase is adjusted");
  assert.equal(out[0].phase, "plan");
});

test("decideAdjustments never proposes explore or veredicto", () => {
  // Even with extreme stats on those phases, they are structurally excluded.
  const stats = new Map<string, PhaseModelStat>([
    [
      "explore claude-haiku-4-5",
      {
        phase: "explore",
        model: "claude-haiku-4-5",
        samples: 50,
        passRate: 0,
        avgRounds: 9,
        v2Samples: 50,
        avgCorregir: 9,
        avgReplantear: 9,
      },
    ],
    [
      "veredicto claude-sonnet-4-6",
      {
        phase: "veredicto",
        model: "claude-sonnet-4-6",
        samples: 50,
        passRate: 0,
        avgRounds: 9,
        v2Samples: 50,
        avgCorregir: 9,
        avgReplantear: 9,
      },
    ],
  ]);
  const out = decideAdjustments(
    stats,
    { explore: "claude-haiku-4-5", veredicto: "claude-sonnet-4-6" },
    [],
  );
  assert.deepEqual(out, [], "explore/veredicto are never tuned");
});

test("decideAdjustments leaves the build phase dormant below MIN_V2_SAMPLES", () => {
  const stats = v2StatsFor("build", "claude-sonnet-4-6", {
    v2Samples: MIN_V2_SAMPLES - 1,
    avgCorregir: HIGH_AVG_CORREGIR + 5, // would be over threshold with enough data
  });
  assert.deepEqual(decideAdjustments(stats, { build: "claude-sonnet-4-6" }, []), []);
});

test("decideAdjustments proposes nothing for an all-v1 history (v2Samples 0)", () => {
  // aggregate of v1-only records: every stat has v2Samples 0 and null measures.
  const stats = aggregate([
    makeRecord({ verdict: "cap-reached" }),
    makeRecord({ verdict: "cap-reached" }),
    makeRecord({ verdict: "cap-reached" }),
    makeRecord({ verdict: "cap-reached" }),
    makeRecord({ verdict: "cap-reached" }),
    makeRecord({ verdict: "cap-reached" }),
  ]);
  const out = decideAdjustments(
    stats,
    { build: "claude-sonnet-4-6", plan: "claude-opus-4-7" },
    [],
  );
  assert.deepEqual(out, [], "v1-only history never triggers a v2 adjustment");
});

test("decideAdjustments does not act on a blame measure exactly at threshold", () => {
  // The check is strictly greater-than, so equality is not enough.
  const stats = v2StatsFor("build", "claude-sonnet-4-6", {
    v2Samples: 10,
    avgCorregir: HIGH_AVG_CORREGIR,
  });
  assert.deepEqual(decideAdjustments(stats, { build: "claude-sonnet-4-6" }, []), []);
});

test("decideAdjustments makes no change when the stat is absent", () => {
  assert.deepEqual(decideAdjustments(new Map(), { build: "claude-sonnet-4-6" }, []), []);
});

test("decideAdjustments leaves a blamed opus phase unchanged at the tier ceiling", () => {
  const stats = v2StatsFor("build", "claude-opus-4-7", {
    v2Samples: 12,
    avgCorregir: HIGH_AVG_CORREGIR + 3, // strong blame, but stepUp returns null
  });
  assert.deepEqual(decideAdjustments(stats, { build: "claude-opus-4-7" }, []), []);
});

test("decideAdjustments suppresses a step-up when cost guard says the current phase is already expensive", () => {
  const stats = v2StatsFor("build", "claude-sonnet-4-6", {
    v2Samples: 12,
    avgCorregir: HIGH_AVG_CORREGIR + 2,
  });
  const costStats = aggregateCostStats([
    { phase: "build", model: "claude-sonnet-4-6", usage: { cost: 3 } },
    { phase: "build", model: "claude-sonnet-4-6", usage: { cost: 5 } },
    { phase: "build", model: "claude-sonnet-4-6", usage: { cost: 4 } },
  ]);
  const out = decideAdjustments(
    stats,
    { build: "claude-sonnet-4-6" },
    [],
    costStats,
    { maxPhaseCostUsd: 4, minSamples: MIN_COST_SAMPLES },
  );
  assert.deepEqual(out, []);
});

test("decideAdjustments ignores the cost guard below its sample floor", () => {
  const stats = v2StatsFor("build", "claude-sonnet-4-6", {
    v2Samples: 12,
    avgCorregir: HIGH_AVG_CORREGIR + 2,
  });
  const costStats = aggregateCostStats([
    { phase: "build", model: "claude-sonnet-4-6", usage: { cost: 99 } },
    { phase: "build", model: "claude-sonnet-4-6", usage: { cost: 99 } },
  ]);
  const out = decideAdjustments(stats, { build: "claude-sonnet-4-6" }, [], costStats, {
    maxPhaseCostUsd: 4,
    minSamples: MIN_COST_SAMPLES,
  });
  assert.equal(out.length, 1, "two cost samples are not enough to suppress a step-up");
});

// ---------------------------------------------------------------------------
// readAutotuneMode
// ---------------------------------------------------------------------------

test("readAutotuneMode defaults to auto for an empty object", () => {
  assert.equal(readAutotuneMode({}), "auto");
});

test("readAutotuneMode defaults to auto for a junk value", () => {
  assert.equal(readAutotuneMode({ autotune: "sometimes" }), "auto");
  assert.equal(readAutotuneMode({ autotune: 1 }), "auto");
  assert.equal(readAutotuneMode({ autotune: null }), "auto");
});

test("readAutotuneMode returns each of the three valid modes verbatim", () => {
  assert.equal(readAutotuneMode({ autotune: "auto" }), "auto");
  assert.equal(readAutotuneMode({ autotune: "ask" }), "ask");
  assert.equal(readAutotuneMode({ autotune: "off" }), "off");
});
