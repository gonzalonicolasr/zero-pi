// Unit tests for the Anthropic metered-billing guard pure-logic module.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyModelSwitch,
  METERED_PROVIDER,
  warnMessage,
  type ModelLike,
} from "./provider-guard.ts";

/** A representative model id used across the cases. */
const MODEL_ID = "claude-opus-4-7";

/** A model on the metered-capable `anthropic` provider. */
function anthropicModel(id: string = MODEL_ID): ModelLike {
  return { provider: METERED_PROVIDER, id };
}

// ---------------------------------------------------------------------------
// warn — anthropic on an API key (no OAuth)
// ---------------------------------------------------------------------------

test("classifyModelSwitch warns for anthropic without OAuth", () => {
  const action = classifyModelSwitch(anthropicModel(), false);
  assert.equal(action.kind, "warn");
  assert.equal(action.kind === "warn" && action.message, warnMessage(MODEL_ID));
});

test("warnMessage names the model and points at /login", () => {
  const msg = warnMessage(MODEL_ID);
  assert.ok(msg.includes(MODEL_ID), "names the model id");
  assert.ok(msg.includes("/login"), "points at /login");
  assert.ok(msg.includes("extra usage"), "names the metered billing");
});

// ---------------------------------------------------------------------------
// ignore — anthropic on OAuth (subscription)
// ---------------------------------------------------------------------------

test("classifyModelSwitch ignores anthropic with OAuth", () => {
  assert.equal(classifyModelSwitch(anthropicModel(), true).kind, "ignore");
});

// ---------------------------------------------------------------------------
// ignore — any other provider, regardless of auth mode
// ---------------------------------------------------------------------------

test("classifyModelSwitch ignores a non-anthropic provider regardless of auth mode", () => {
  for (const isOAuth of [true, false]) {
    assert.equal(
      classifyModelSwitch({ provider: "openai-codex", id: "gpt-5.5" }, isOAuth).kind,
      "ignore",
      `openai-codex isOAuth=${isOAuth}`,
    );
  }
});

// ---------------------------------------------------------------------------
// ignore — malformed events
// ---------------------------------------------------------------------------

test("classifyModelSwitch ignores a null or undefined model", () => {
  assert.equal(classifyModelSwitch(null, false).kind, "ignore");
  assert.equal(classifyModelSwitch(undefined, false).kind, "ignore");
});

test("classifyModelSwitch ignores a model missing provider or id", () => {
  assert.equal(
    classifyModelSwitch({ id: MODEL_ID } as unknown as ModelLike, false).kind,
    "ignore",
    "missing provider",
  );
  assert.equal(
    classifyModelSwitch({ provider: METERED_PROVIDER } as unknown as ModelLike, false).kind,
    "ignore",
    "missing id",
  );
});

test("classifyModelSwitch ignores a model with empty-string provider or id", () => {
  assert.equal(
    classifyModelSwitch({ provider: "", id: MODEL_ID }, false).kind,
    "ignore",
    "empty provider",
  );
  assert.equal(
    classifyModelSwitch({ provider: METERED_PROVIDER, id: "" }, false).kind,
    "ignore",
    "empty id",
  );
});

test("classifyModelSwitch ignores a model with non-string provider or id", () => {
  assert.equal(
    classifyModelSwitch({ provider: 42, id: MODEL_ID } as unknown as ModelLike, false).kind,
    "ignore",
    "non-string provider",
  );
  assert.equal(
    classifyModelSwitch({ provider: METERED_PROVIDER, id: 7 } as unknown as ModelLike, false).kind,
    "ignore",
    "non-string id",
  );
});

// ---------------------------------------------------------------------------
// classifyModelSwitch never throws
// ---------------------------------------------------------------------------

test("classifyModelSwitch never throws across the branch matrix", () => {
  const models: (ModelLike | null | undefined)[] = [
    anthropicModel(),
    { provider: "openai-codex", id: "gpt-5.5" },
    { provider: "", id: "" },
    null,
    undefined,
  ];
  for (const model of models) {
    for (const isOAuth of [true, false]) {
      assert.doesNotThrow(() => classifyModelSwitch(model, isOAuth));
    }
  }
});

// ---------------------------------------------------------------------------
// METERED_PROVIDER
// ---------------------------------------------------------------------------

test("METERED_PROVIDER is the anthropic provider", () => {
  assert.equal(METERED_PROVIDER, "anthropic");
});
