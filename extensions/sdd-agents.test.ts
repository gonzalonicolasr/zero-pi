// Unit tests for zero-pi's SDD sub-agent provisioning.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { homedir } from "node:os";
import { join } from "node:path";

import {
  buildAgentFile,
  phaseModel,
  phaseThinking,
  PHASE_COMPLETION_GUARD,
  PHASE_TOOLS,
  PHASES,
  splitPhasePrompt,
  SUPPORT_MODULES,
  supportModulesDir,
} from "./sdd-agents.ts";

test("splitPhasePrompt separates frontmatter description from the body", () => {
  const raw = "---\ndescription: SDD explore phase — investigate read-only\n---\n\nYou run the explore phase.\n";
  const { description, body } = splitPhasePrompt(raw);
  assert.equal(description, "SDD explore phase — investigate read-only");
  assert.equal(body, "You run the explore phase.");
});

test("splitPhasePrompt handles a prompt with no frontmatter", () => {
  const { description, body } = splitPhasePrompt("Just a body, no frontmatter.");
  assert.equal(description, "");
  assert.equal(body, "Just a body, no frontmatter.");
});

test("buildAgentFile produces a valid agent definition with the phase model", () => {
  const file = buildAgentFile("explore", "You run the explore phase.", "Explore desc", "claude-sonnet-4-6");
  assert.ok(file.startsWith("---\n"));
  assert.ok(file.includes("name: zero-explore"));
  assert.ok(file.includes("description: Explore desc"));
  assert.ok(file.includes("model: claude-sonnet-4-6"));
  assert.ok(file.includes("systemPromptMode: replace"));
  assert.ok(file.includes("inheritProjectContext: true"));
  assert.ok(file.trimEnd().endsWith("You run the explore phase."));
});

test("buildAgentFile omits the model line when no model is configured", () => {
  const file = buildAgentFile("build", "body", "Build desc", undefined);
  assert.ok(!file.includes("model:"));
  assert.ok(file.includes("name: zero-build"));
});

test("buildAgentFile injects thinking and tools before systemPromptMode:", () => {
  const file = buildAgentFile("build", "body", "Build desc", "claude-opus-4-8", "high");
  assert.ok(file.includes("thinking: high"), "the thinking line is present");
  assert.ok(file.includes("tools: read, bash, write, edit"), "the build tool allowlist is present");
  const modelIdx = file.indexOf("model: claude-opus-4-8");
  const thinkingIdx = file.indexOf("thinking: high");
  const toolsIdx = file.indexOf("tools: read, bash, write, edit");
  const sysIdx = file.indexOf("systemPromptMode: replace");
  assert.ok(modelIdx >= 0 && thinkingIdx >= 0 && toolsIdx >= 0 && sysIdx >= 0, "all four lines present");
  assert.ok(modelIdx < thinkingIdx, "thinking: sits after model:");
  assert.ok(thinkingIdx < toolsIdx, "tools: sits after thinking:");
  assert.ok(toolsIdx < sysIdx, "tools: sits before systemPromptMode:");
});

test("buildAgentFile omits the thinking line when no level is given", () => {
  const file = buildAgentFile("build", "body", "Build desc", "claude-opus-4-8", undefined);
  assert.ok(!file.includes("thinking:"), "no thinking line when the level is absent");
  assert.ok(file.includes("model: claude-opus-4-8"));
});

test("buildAgentFile emits thinking even when the model is absent", () => {
  const file = buildAgentFile("explore", "body", "Explore desc", undefined, "low");
  assert.ok(!file.includes("model:"), "no model line");
  assert.ok(file.includes("thinking: low"), "thinking is independent of model presence");
  const thinkingIdx = file.indexOf("thinking: low");
  const sysIdx = file.indexOf("systemPromptMode: replace");
  assert.ok(thinkingIdx < sysIdx, "thinking: still sits before systemPromptMode:");
});

test("buildAgentFile omits an invalid thinking level defensively", () => {
  // `max` is not one of the six real levels — the file builder must never emit it.
  const file = buildAgentFile("build", "body", "Build desc", "claude-opus-4-8", "max" as never);
  assert.ok(!file.includes("thinking:"), "an invalid level is never written");
});

test("buildAgentFile falls back to a default description", () => {
  const file = buildAgentFile("veredicto", "body", "", undefined);
  assert.ok(file.includes("description: zero SDD veredicto phase"));
});

test("buildAgentFile makes non-build phases read-only and disables completion guard", () => {
  const explore = buildAgentFile("explore", "body", "Explore desc", undefined);
  assert.ok(explore.includes("tools: read, bash"));
  assert.ok(!explore.includes("write"));
  assert.ok(!explore.includes("edit"));
  assert.ok(explore.includes("completionGuard: false"));

  const build = buildAgentFile("build", "body", "Build desc", undefined);
  assert.ok(build.includes("tools: read, bash, write, edit"));
  assert.ok(!build.includes("completionGuard: false"));
});

test("PHASE_TOOLS and completion guard profiles are complete", () => {
  assert.deepEqual(PHASE_TOOLS.clarify, ["read", "bash", "write", "edit"]);
  assert.deepEqual(PHASE_TOOLS.explore, ["read", "bash"]);
  assert.deepEqual(PHASE_TOOLS.plan, ["read", "bash", "write", "edit"]);
  assert.deepEqual(PHASE_TOOLS.analyze, ["read", "bash", "write", "edit"]);
  assert.deepEqual(PHASE_TOOLS.build, ["read", "bash", "write", "edit"]);
  assert.deepEqual(PHASE_TOOLS.veredicto, ["read", "bash"]);
  // Only build carries the implementation completion guard; every gate/read
  // phase disables it.
  assert.equal(PHASE_COMPLETION_GUARD.clarify, false);
  assert.equal(PHASE_COMPLETION_GUARD.explore, false);
  assert.equal(PHASE_COMPLETION_GUARD.plan, false);
  assert.equal(PHASE_COMPLETION_GUARD.analyze, false);
  assert.equal(PHASE_COMPLETION_GUARD.build, true);
  assert.equal(PHASE_COMPLETION_GUARD.veredicto, false);
});

test("PHASES are the six SDD phases in pipeline order", () => {
  assert.deepEqual(
    [...PHASES],
    ["clarify", "explore", "plan", "analyze", "build", "veredicto"],
  );
});

test("buildAgentFile generates the clarify gate as a .sdd-artifact writer, no completion guard", () => {
  const file = buildAgentFile("clarify", "body", "Clarify desc", undefined);
  assert.ok(file.includes("name: zero-clarify"));
  assert.ok(file.includes("tools: read, bash, write, edit"), "clarify can write its .sdd artifact");
  assert.ok(file.includes("completionGuard: false"), "clarify is not an implementation phase");
});

test("buildAgentFile generates the analyze gate as a .sdd-artifact writer, no completion guard", () => {
  const file = buildAgentFile("analyze", "body", "Analyze desc", "claude-opus-4-8");
  assert.ok(file.includes("name: zero-analyze"));
  assert.ok(file.includes("model: claude-opus-4-8"));
  assert.ok(file.includes("tools: read, bash, write, edit"), "analyze can write its .sdd artifact");
  assert.ok(file.includes("completionGuard: false"), "analyze is not an implementation phase");
});

test("SUPPORT_MODULES names the two Strict TDD modules", () => {
  assert.deepEqual([...SUPPORT_MODULES], ["strict-tdd.md", "strict-tdd-verify.md"]);
});

test("supportModulesDir resolves under the generated agents tree", () => {
  assert.equal(
    supportModulesDir(),
    join(homedir(), ".pi", "agent", "agents", "zero", "support"),
  );
});

test("phaseModel reads a plain model id", () => {
  assert.equal(phaseModel({ models: { build: "claude-sonnet-4-6" } }, "build"), "claude-sonnet-4-6");
});

test("phaseModel strips the installer's effort suffix", () => {
  assert.equal(
    phaseModel({ models: { explore: "openai/gpt-5.5-pro medium" } }, "explore"),
    "openai/gpt-5.5-pro",
  );
});

test("phaseModel folds in a separate provider when the id is not qualified", () => {
  assert.equal(
    phaseModel({ models: { build: "gpt-5-codex" }, providers: { build: "codex" } }, "build"),
    "codex/gpt-5-codex",
  );
});

test("phaseModel returns undefined when no model is configured", () => {
  assert.equal(phaseModel({ models: {} }, "plan"), undefined);
  assert.equal(phaseModel({}, "plan"), undefined);
  assert.equal(phaseModel(null, "plan"), undefined);
});

// ---------------------------------------------------------------------------
// T010 — phaseThinking resolver
// ---------------------------------------------------------------------------

test("phaseThinking reads an explicit valid level from the thinking map", () => {
  assert.equal(phaseThinking({ thinking: { build: "high" } }, "build"), "high");
});

test("phaseThinking returns undefined for an invalid level", () => {
  assert.equal(phaseThinking({ thinking: { build: "max" } }, "build"), undefined);
  assert.equal(phaseThinking({ thinking: { build: "ultracode" } }, "build"), undefined);
});

test("phaseThinking returns undefined when no thinking is configured", () => {
  assert.equal(phaseThinking({}, "build"), undefined);
  assert.equal(phaseThinking({ thinking: {} }, "plan"), undefined);
  assert.equal(phaseThinking(null, "plan"), undefined);
});

test("phaseThinking recovers a valid trailing legacy suffix from the model string", () => {
  assert.equal(
    phaseThinking({ models: { build: "claude-opus-4-8 high" } }, "build"),
    "high",
  );
});

test("phaseThinking does not recover an invalid trailing legacy token", () => {
  assert.equal(phaseThinking({ models: { build: "claude-opus-4-8 max" } }, "build"), undefined);
  assert.equal(phaseThinking({ models: { build: "claude-opus-4-8" } }, "build"), undefined);
});

test("phaseThinking: an explicit map level wins over a legacy suffix", () => {
  assert.equal(
    phaseThinking(
      { thinking: { build: "low" }, models: { build: "claude-opus-4-8 high" } },
      "build",
    ),
    "low",
  );
});
