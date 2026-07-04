import { test } from "node:test";
import assert from "node:assert/strict";

import {
  phaseFromAgent,
  extractSlug,
  parseMeta,
  selectRunMetas,
  aggregateRun,
  formatDuration,
  formatUsd,
  formatReport,
  type PhaseMeta,
} from "./zero-cost.ts";

function meta(over: Partial<PhaseMeta> & { phase: PhaseMeta["phase"] }): PhaseMeta {
  return {
    runId: "r",
    slug: "feat",
    model: "anthropic/claude-x",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
    durationMs: 0,
    toolCount: 0,
    timestamp: 0,
    ...over,
  };
}

test("phaseFromAgent: maps zero-<phase> and rejects everything else", () => {
  assert.equal(phaseFromAgent("zero-clarify"), "clarify");
  assert.equal(phaseFromAgent("zero-explore"), "explore");
  assert.equal(phaseFromAgent("zero-plan"), "plan");
  assert.equal(phaseFromAgent("zero-analyze"), "analyze");
  assert.equal(phaseFromAgent("zero-build"), "build");
  assert.equal(phaseFromAgent("zero-veredicto"), "veredicto");
  assert.equal(phaseFromAgent("zero-other"), null);
  assert.equal(phaseFromAgent("explore"), null);
  assert.equal(phaseFromAgent(""), null);
});

test("aggregateRun: gate phases sort in pipeline order (clarify first, analyze after plan)", () => {
  const metas = [
    meta({ phase: "veredicto", slug: "f", timestamp: 6 }),
    meta({ phase: "analyze", slug: "f", timestamp: 4 }),
    meta({ phase: "build", slug: "f", timestamp: 5 }),
    meta({ phase: "plan", slug: "f", timestamp: 3 }),
    meta({ phase: "explore", slug: "f", timestamp: 2 }),
    meta({ phase: "clarify", slug: "f", timestamp: 1 }),
  ];
  const run = aggregateRun(metas, "f");
  assert.deepEqual(
    run.phases.map((p) => p.phase),
    ["clarify", "explore", "plan", "analyze", "build", "veredicto"],
    "the six phases are ordered by the pipeline, gates in place",
  );
});

test("extractSlug: first .sdd/<slug>/ wins, specs/archive rejected", () => {
  assert.equal(extractSlug("Operate on .sdd/billing-incentive/ now"), "billing-incentive");
  assert.equal(extractSlug("read .sdd/my-feature/request.md"), "my-feature");
  assert.equal(extractSlug("touch .sdd/specs/requirements.md"), null);
  assert.equal(extractSlug("see .sdd/archive/2026-01-01-x/"), null);
  assert.equal(extractSlug("Slug: looply-provider-compat-improvements\nProject root: /tmp/x"), "looply-provider-compat-improvements");
  assert.equal(extractSlug("Slug: archive"), null);
  assert.equal(extractSlug("no slug here"), null);
});

test("parseMeta: happy path normalizes fields", () => {
  const m = parseMeta({
    runId: "c79c5444",
    agent: "zero-explore",
    task: "Operate on .sdd/feat/ ...",
    usage: { input: 211828, output: 13395, cacheRead: 2041856, cacheWrite: 0, cost: 2.48, turns: 35 },
    model: "openai-codex/gpt-5.5:high",
    durationMs: 330648,
    toolCount: 34,
    timestamp: 1782237427376,
  });
  assert.ok(m);
  assert.equal(m?.phase, "explore");
  assert.equal(m?.slug, "feat");
  assert.equal(m?.usage.input, 211828);
  assert.equal(m?.toolCount, 34);
  assert.equal(m?.model, "openai-codex/gpt-5.5:high");
});

test("parseMeta: non-zero agent and missing usage are skipped", () => {
  assert.equal(parseMeta({ agent: "delegate", usage: { input: 1 } }), null);
  assert.equal(parseMeta({ agent: "zero-build" }), null);
  assert.equal(parseMeta(null), null);
  assert.equal(parseMeta("nope"), null);
});

test("parseMeta: missing numerics coerce to 0", () => {
  const m = parseMeta({
    agent: "zero-build",
    task: ".sdd/feat/",
    usage: { input: 10, output: 5, cacheRead: 0, cost: 0.1, turns: 2 },
  });
  assert.ok(m);
  assert.equal(m?.usage.cacheWrite, 0);
  assert.equal(m?.toolCount, 0);
  assert.equal(m?.durationMs, 0);
  assert.equal(m?.timestamp, 0);
});

test("selectRunMetas: slug filter keeps only that slug", () => {
  const metas = [
    meta({ phase: "explore", slug: "a", timestamp: 1 }),
    meta({ phase: "build", slug: "b", timestamp: 2 }),
  ];
  const sel = selectRunMetas(metas, "a");
  assert.equal(sel.length, 1);
  assert.equal(sel[0]?.slug, "a");
});

test("selectRunMetas: default picks newest slug by max timestamp", () => {
  const metas = [
    meta({ phase: "explore", slug: "old", timestamp: 10 }),
    meta({ phase: "build", slug: "old", timestamp: 20 }),
    meta({ phase: "explore", slug: "new", timestamp: 30 }),
    meta({ phase: "plan", slug: null, timestamp: 99 }),
  ];
  const sel = selectRunMetas(metas);
  assert.equal(sel.length, 1);
  assert.equal(sel[0]?.slug, "new");
});

test("aggregateRun: phase order, multi-subagent build fold, model=newest, total", () => {
  const metas = [
    meta({ phase: "veredicto", slug: "f", model: "v", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.5, turns: 1 }, toolCount: 2, durationMs: 100, timestamp: 5 }),
    meta({ phase: "explore", slug: "f", model: "e", usage: { input: 10, output: 2, cacheRead: 100, cacheWrite: 0, cost: 0.1, turns: 3 }, toolCount: 4, durationMs: 200, timestamp: 1 }),
    meta({ phase: "build", slug: "f", model: "b-old", usage: { input: 5, output: 5, cacheRead: 50, cacheWrite: 0, cost: 0.2, turns: 2 }, toolCount: 3, durationMs: 300, timestamp: 2 }),
    meta({ phase: "build", slug: "f", model: "b-new", usage: { input: 7, output: 3, cacheRead: 70, cacheWrite: 0, cost: 0.3, turns: 4 }, toolCount: 6, durationMs: 400, timestamp: 9 }),
  ];
  const run = aggregateRun(metas, "f");
  assert.deepEqual(run.phases.map((p) => p.phase), ["explore", "build", "veredicto"]);
  const build = run.phases.find((p) => p.phase === "build");
  assert.equal(build?.subAgents, 2);
  assert.equal(build?.input, 12);
  assert.equal(build?.toolCount, 9);
  assert.equal(build?.cost, 0.5);
  assert.equal(build?.model, "b-new"); // newest by timestamp
  assert.equal(run.total.input, 23);
  assert.equal(run.total.cost, 1.1);
  assert.equal(run.total.subAgents, 4);
  assert.equal(run.total.toolCount, 15);
});

test("formatDuration: sub-minute vs minutes", () => {
  assert.equal(formatDuration(12000), "12s");
  assert.equal(formatDuration(330648), "5m31s");
  assert.equal(formatDuration(0), "0s");
});

test("formatUsd: two decimals", () => {
  assert.equal(formatUsd(2.4819), "$2.48");
  assert.equal(formatUsd(0), "$0.00");
});

test("formatReport: names slug, has TOTAL, uses compact tokens", () => {
  const run = aggregateRun(
    [meta({ phase: "explore", slug: "feat", usage: { input: 211828, output: 13395, cacheRead: 0, cacheWrite: 0, cost: 2.48, turns: 1 }, toolCount: 3, durationMs: 1000, timestamp: 1 })],
    "feat",
  );
  const out = formatReport(run);
  assert.match(out, /feat/);
  assert.match(out, /TOTAL/);
  assert.match(out, /211\.8k/);
  assert.match(out, /\$2\.48/);
});

test("formatReport: empty run is a friendly message", () => {
  const out = formatReport(aggregateRun([], null));
  assert.match(out, /no encontré|sin datos/i);
});
