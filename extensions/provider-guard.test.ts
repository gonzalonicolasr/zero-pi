// Unit tests for the metered-provider guard pure-logic module.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyModelSwitch,
  CONFIRM_TITLE,
  confirmMessage,
  METERED_TO_SUBSCRIPTION,
  redirectMessage,
  warnMessage,
  type GuardAction,
  type ModelLike,
  type RegistryLookup,
} from "./provider-guard.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** The metered provider and its subscription equivalent, taken from the
 *  module's own mapping so the test never hardcodes provider literals. */
const METERED = "anthropic";
const SUBSCRIPTION = METERED_TO_SUBSCRIPTION[METERED];

/** A representative model id used across the cases. */
const MODEL_ID = "claude-opus-4-7";

/** A plain `ModelLike` under the metered provider. */
function meteredModel(id: string = MODEL_ID): ModelLike {
  return { provider: METERED, id };
}

/** A lookup that always resolves the equivalent: the same id under the
 *  subscription provider. Mirrors a registry that has the equivalent. */
function lookupWithEquivalent(provider: string, id: string): ModelLike {
  return { provider, id };
}

/** A lookup that never resolves an equivalent. */
function lookupWithoutEquivalent(): undefined {
  return undefined;
}

// ---------------------------------------------------------------------------
// offer-redirect — deliberate switch to a metered provider with an equivalent
// ---------------------------------------------------------------------------

test("classifyModelSwitch offers a redirect for set + anthropic + equivalent", () => {
  const action = classifyModelSwitch(meteredModel(), "set", lookupWithEquivalent);
  assert.equal(action.kind, "offer-redirect");
  assert.equal(action.kind === "offer-redirect" && action.kind, "offer-redirect");

  const redirect = action as Extract<GuardAction, { kind: "offer-redirect" }>;
  assert.deepEqual(redirect.safeModel, { provider: SUBSCRIPTION, id: MODEL_ID });
  assert.equal(redirect.confirmTitle, CONFIRM_TITLE);
  assert.equal(redirect.confirmMessage, confirmMessage(MODEL_ID, METERED, SUBSCRIPTION));
  assert.equal(redirect.redirectMessage, redirectMessage(MODEL_ID, SUBSCRIPTION));
});

test("classifyModelSwitch offers a redirect for cycle + anthropic + equivalent", () => {
  const action = classifyModelSwitch(meteredModel(), "cycle", lookupWithEquivalent);
  assert.equal(action.kind, "offer-redirect");

  const redirect = action as Extract<GuardAction, { kind: "offer-redirect" }>;
  assert.deepEqual(redirect.safeModel, { provider: SUBSCRIPTION, id: MODEL_ID });
  assert.equal(redirect.confirmTitle, CONFIRM_TITLE);
  assert.equal(redirect.confirmMessage, confirmMessage(MODEL_ID, METERED, SUBSCRIPTION));
  assert.equal(redirect.redirectMessage, redirectMessage(MODEL_ID, SUBSCRIPTION));
});

test("classifyModelSwitch passes the lookup's exact model through as safeModel", () => {
  // The lookup may return a model that differs in id from the request; the
  // pure module forwards whatever the lookup resolved.
  const resolved: ModelLike = { provider: SUBSCRIPTION, id: "claude-opus-4-7-cli" };
  const action = classifyModelSwitch(meteredModel(), "set", () => resolved);
  assert.equal(action.kind, "offer-redirect");
  const redirect = action as Extract<GuardAction, { kind: "offer-redirect" }>;
  assert.equal(redirect.safeModel, resolved, "safeModel is exactly the lookup result");
});

// ---------------------------------------------------------------------------
// warn — deliberate switch with no equivalent
// ---------------------------------------------------------------------------

test("classifyModelSwitch warns for set + anthropic when lookup returns undefined", () => {
  const action = classifyModelSwitch(meteredModel(), "set", lookupWithoutEquivalent);
  assert.equal(action.kind, "warn");
  assert.equal(
    action.kind === "warn" && action.message,
    warnMessage(MODEL_ID, METERED),
  );
});

test("classifyModelSwitch warns for cycle + anthropic when lookup returns undefined", () => {
  const action = classifyModelSwitch(meteredModel(), "cycle", lookupWithoutEquivalent);
  assert.equal(action.kind, "warn");
  assert.equal(
    action.kind === "warn" && action.message,
    warnMessage(MODEL_ID, METERED),
  );
});

// ---------------------------------------------------------------------------
// warn — restore is never a modal, regardless of an equivalent
// ---------------------------------------------------------------------------

test("classifyModelSwitch warns for restore + anthropic WITH an equivalent", () => {
  const action = classifyModelSwitch(meteredModel(), "restore", lookupWithEquivalent);
  assert.equal(action.kind, "warn", "restore never offers a redirect");
  assert.equal(
    action.kind === "warn" && action.message,
    warnMessage(MODEL_ID, METERED),
  );
});

test("classifyModelSwitch warns for restore + anthropic WITHOUT an equivalent", () => {
  const action = classifyModelSwitch(meteredModel(), "restore", lookupWithoutEquivalent);
  assert.equal(action.kind, "warn");
  assert.equal(
    action.kind === "warn" && action.message,
    warnMessage(MODEL_ID, METERED),
  );
});

// ---------------------------------------------------------------------------
// ignore — non-metered providers (no-recursion guarantee included)
// ---------------------------------------------------------------------------

test("classifyModelSwitch ignores the pi-claude-cli provider (no-recursion)", () => {
  // The redirect target classifies as ignore — the second model_select event
  // raised by setModel terminates the chain.
  for (const source of ["set", "cycle", "restore"]) {
    const action = classifyModelSwitch(
      { provider: SUBSCRIPTION, id: MODEL_ID },
      source,
      lookupWithEquivalent,
    );
    assert.equal(action.kind, "ignore", `source ${source} on ${SUBSCRIPTION} is ignore`);
  }
});

test("classifyModelSwitch ignores an arbitrary provider outside the map", () => {
  const action = classifyModelSwitch(
    { provider: "openai", id: "gpt-4o" },
    "set",
    lookupWithEquivalent,
  );
  assert.equal(action.kind, "ignore");
});

// ---------------------------------------------------------------------------
// ignore — malformed events
// ---------------------------------------------------------------------------

test("classifyModelSwitch ignores a null or undefined model", () => {
  assert.equal(classifyModelSwitch(null, "set", lookupWithEquivalent).kind, "ignore");
  assert.equal(classifyModelSwitch(undefined, "set", lookupWithEquivalent).kind, "ignore");
});

test("classifyModelSwitch ignores a model missing provider or id", () => {
  assert.equal(
    classifyModelSwitch({ id: MODEL_ID } as unknown as ModelLike, "set", lookupWithEquivalent)
      .kind,
    "ignore",
    "missing provider",
  );
  assert.equal(
    classifyModelSwitch({ provider: METERED } as unknown as ModelLike, "set", lookupWithEquivalent)
      .kind,
    "ignore",
    "missing id",
  );
});

test("classifyModelSwitch ignores a model with empty-string provider or id", () => {
  assert.equal(
    classifyModelSwitch({ provider: "", id: MODEL_ID }, "set", lookupWithEquivalent).kind,
    "ignore",
    "empty provider",
  );
  assert.equal(
    classifyModelSwitch({ provider: METERED, id: "" }, "set", lookupWithEquivalent).kind,
    "ignore",
    "empty id",
  );
});

test("classifyModelSwitch ignores a model with non-string provider or id", () => {
  assert.equal(
    classifyModelSwitch(
      { provider: 42, id: MODEL_ID } as unknown as ModelLike,
      "set",
      lookupWithEquivalent,
    ).kind,
    "ignore",
    "non-string provider",
  );
  assert.equal(
    classifyModelSwitch(
      { provider: METERED, id: 7 } as unknown as ModelLike,
      "set",
      lookupWithEquivalent,
    ).kind,
    "ignore",
    "non-string id",
  );
});

// ---------------------------------------------------------------------------
// warn — unknown source on a metered provider
// ---------------------------------------------------------------------------

test("classifyModelSwitch warns for an empty-string source on anthropic", () => {
  const action = classifyModelSwitch(meteredModel(), "", lookupWithEquivalent);
  assert.equal(action.kind, "warn", "unknown source never offers a modal");
  assert.equal(
    action.kind === "warn" && action.message,
    warnMessage(MODEL_ID, METERED),
  );
});

test("classifyModelSwitch warns for an arbitrary unknown source on anthropic", () => {
  const action = classifyModelSwitch(meteredModel(), "weird", lookupWithEquivalent);
  assert.equal(action.kind, "warn");
  assert.equal(
    action.kind === "warn" && action.message,
    warnMessage(MODEL_ID, METERED),
  );
});

test("classifyModelSwitch warns for a null or undefined source on anthropic", () => {
  // A non-deliberate (here: absent) source on a metered provider still warns.
  for (const source of [null, undefined]) {
    const action = classifyModelSwitch(meteredModel(), source, lookupWithEquivalent);
    assert.equal(action.kind, "warn", `source ${String(source)} warns`);
    assert.equal(
      action.kind === "warn" && action.message,
      warnMessage(MODEL_ID, METERED),
    );
  }
});

// ---------------------------------------------------------------------------
// classifyModelSwitch never throws
// ---------------------------------------------------------------------------

test("classifyModelSwitch never throws across the branch matrix", () => {
  const lookups: RegistryLookup[] = [lookupWithEquivalent, () => undefined];
  const sources = ["set", "cycle", "restore", "", "weird", null, undefined];
  const models: (ModelLike | null | undefined)[] = [
    meteredModel(),
    { provider: SUBSCRIPTION, id: MODEL_ID },
    { provider: "openai", id: "gpt-4o" },
    null,
    undefined,
  ];
  for (const lookup of lookups) {
    for (const source of sources) {
      for (const model of models) {
        assert.doesNotThrow(() => classifyModelSwitch(model, source, lookup));
      }
    }
  }
});

// ---------------------------------------------------------------------------
// METERED_TO_SUBSCRIPTION
// ---------------------------------------------------------------------------

test("METERED_TO_SUBSCRIPTION maps exactly anthropic to pi-claude-cli", () => {
  assert.deepEqual(METERED_TO_SUBSCRIPTION, { anthropic: "pi-claude-cli" });
});
