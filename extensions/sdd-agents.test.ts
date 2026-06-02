// Unit tests for zero-pi's SDD sub-agent provisioning.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { homedir } from "node:os";
import { join } from "node:path";

import { buildAgentFile, phaseModel, PHASES, splitPhasePrompt, SUPPORT_MODULES, supportModulesDir } from "./sdd-agents.ts";

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

test("buildAgentFile falls back to a default description", () => {
  const file = buildAgentFile("veredicto", "body", "", undefined);
  assert.ok(file.includes("description: zero SDD veredicto phase"));
});

test("PHASES are the four SDD phases", () => {
  assert.deepEqual([...PHASES], ["explore", "plan", "build", "veredicto"]);
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
