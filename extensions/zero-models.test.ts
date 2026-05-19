// Unit tests for the /zero-models command's pure logic.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatAutotune,
  formatPhases,
  groupByProvider,
  isPhase,
  parseAssignment,
  parseAutotuneArg,
  PHASES,
  readModels,
  readProviders,
  type PhaseModels,
  type PhaseProviders,
} from "./zero-models.ts";

test("isPhase recognises the four SDD phases and nothing else", () => {
  for (const phase of PHASES) assert.ok(isPhase(phase));
  assert.ok(!isPhase("bogus"));
  assert.ok(!isPhase("Explore"));
});

test("parseAssignment accepts <phase>=<model> and <phase> <model>", () => {
  assert.deepEqual(parseAssignment("build=claude-opus-4-7"), {
    phase: "build",
    model: "claude-opus-4-7",
  });
  assert.deepEqual(parseAssignment("  explore  claude-haiku-4-5 "), {
    phase: "explore",
    model: "claude-haiku-4-5",
  });
  assert.deepEqual(parseAssignment("VEREDICTO=x"), { phase: "veredicto", model: "x" });
});

test("parseAssignment splits an explicit <provider>/<model>", () => {
  assert.deepEqual(parseAssignment("build=codex/gpt-5-codex"), {
    phase: "build",
    provider: "codex",
    model: "gpt-5-codex",
  });
  assert.deepEqual(parseAssignment("plan = anthropic / claude-opus-4-7"), {
    phase: "plan",
    provider: "anthropic",
    model: "claude-opus-4-7",
  });
});

test("parseAssignment rejects an unknown phase, an empty model, or no value", () => {
  assert.equal(parseAssignment("bogus=x"), null);
  assert.equal(parseAssignment("build="), null);
  assert.equal(parseAssignment("build"), null);
  assert.equal(parseAssignment(""), null);
});

test("readModels fills missing phases with the defaults", () => {
  const models = readModels({});
  for (const phase of PHASES) assert.equal(typeof models[phase], "string");
  assert.equal(models.explore, "claude-haiku-4-5");
});

test("readModels keeps the values present in zero.json", () => {
  const models = readModels({ models: { build: "my-model" } });
  assert.equal(models.build, "my-model");
  assert.equal(models.plan, "claude-opus-4-7", "untouched phases keep the default");
});

test("readModels ignores non-string model entries", () => {
  const models = readModels({ models: { build: 42 } });
  assert.equal(models.build, "claude-sonnet-4-6", "a non-string value falls back");
});

test("readProviders reads stored providers and defaults the rest to empty", () => {
  const providers = readProviders({ providers: { build: "codex" } });
  assert.equal(providers.build, "codex");
  assert.equal(providers.plan, "");
  for (const phase of PHASES) assert.equal(typeof providers[phase], "string");
});

test("readProviders ignores non-string provider entries", () => {
  const providers = readProviders({ providers: { build: 7 } });
  assert.equal(providers.build, "");
});

test("groupByProvider buckets model ids by provider, sorted and de-duplicated", () => {
  const groups = groupByProvider([
    { provider: "anthropic", id: "claude-opus-4-7" },
    { provider: "anthropic", id: "claude-haiku-4-5" },
    { provider: "anthropic", id: "claude-opus-4-7" },
    { provider: "codex", id: "gpt-5-codex" },
  ]);
  assert.deepEqual(groups.get("anthropic"), ["claude-haiku-4-5", "claude-opus-4-7"]);
  assert.deepEqual(groups.get("codex"), ["gpt-5-codex"]);
});

test("groupByProvider skips malformed entries", () => {
  const groups = groupByProvider([
    { provider: "", id: "x" },
    { provider: "ok", id: "" },
    // @ts-expect-error — exercising the runtime guard
    { provider: 1, id: "y" },
    { provider: "ok", id: "good" },
  ]);
  assert.deepEqual([...groups.keys()], ["ok"]);
  assert.deepEqual(groups.get("ok"), ["good"]);
});

test("formatPhases shows provider/model when a provider is set, model alone otherwise", () => {
  const models: PhaseModels = { explore: "m-e", plan: "m-p", build: "m-b", veredicto: "m-v" };
  const providers: PhaseProviders = { explore: "anthropic", plan: "", build: "codex", veredicto: "" };
  const out = formatPhases(models, providers);
  for (const phase of PHASES) assert.ok(out.includes(phase));
  assert.ok(out.includes("anthropic/m-e"));
  assert.ok(out.includes("codex/m-b"));
  assert.ok(out.includes(" m-p"), "no provider → bare model");
});

test("parseAutotuneArg accepts each valid mode", () => {
  assert.equal(parseAutotuneArg("auto"), "auto");
  assert.equal(parseAutotuneArg("ask"), "ask");
  assert.equal(parseAutotuneArg("off"), "off");
});

test("parseAutotuneArg is case-insensitive and trims surrounding space", () => {
  assert.equal(parseAutotuneArg("ASK"), "ask");
  assert.equal(parseAutotuneArg(" Off "), "off");
  assert.equal(parseAutotuneArg("\tAuto\n"), "auto");
});

test("parseAutotuneArg rejects junk with null", () => {
  assert.equal(parseAutotuneArg("bogus"), null);
  assert.equal(parseAutotuneArg(""), null);
  assert.equal(parseAutotuneArg("autos"), null);
});

test("formatAutotune returns a distinct non-empty label for each mode", () => {
  const auto = formatAutotune("auto");
  const ask = formatAutotune("ask");
  const off = formatAutotune("off");
  for (const label of [auto, ask, off]) {
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0);
  }
  assert.equal(new Set([auto, ask, off]).size, 3, "the three labels are distinct");
});
