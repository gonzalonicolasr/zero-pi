// Unit tests for the /zero-models interactive-picker pure-state module.
//
// No filesystem, no pi-tui — every test constructs a `PickerState` via
// `createPickerState` with in-memory fixtures. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createPickerState,
  decodeKey,
  navigate,
  rebuildEntries,
  enter,
  back,
  pickerTitle,
  submitText,
  type PickerState,
} from "./zero-models-picker.ts";
import type { PhaseModels, PhaseProviders, PhaseThinking } from "./zero-models.ts";
import type { AutotuneMode } from "./autotune.ts";
import type { AutotunePending } from "./autotune-extension.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A well-formed per-phase model map, the fallback defaults. */
function makeModels(over: Partial<PhaseModels> = {}): PhaseModels {
  return {
    clarify: "claude-haiku-4-5",
    explore: "claude-haiku-4-5",
    plan: "claude-opus-4-7",
    analyze: "claude-opus-4-8",
    build: "claude-sonnet-4-6",
    veredicto: "claude-opus-4-7",
    ...over,
  };
}

/** A per-phase provider map — empty providers by default. */
function makeProviders(over: Partial<PhaseProviders> = {}): PhaseProviders {
  return { clarify: "", explore: "", plan: "", analyze: "", build: "", veredicto: "", ...over };
}

/** A per-phase thinking map — empty (no levels configured) by default. */
function makeThinking(over: Partial<PhaseThinking> = {}): PhaseThinking {
  return { ...over };
}

/** Build a `PickerState` via `createPickerState`, overriding any input field. */
function makeState(over: Partial<Parameters<typeof createPickerState>[0]> = {}): PickerState {
  return createPickerState({
    models: makeModels(),
    providers: makeProviders(),
    thinking: makeThinking(),
    autotuneMode: "auto" as AutotuneMode,
    pending: [],
    groups: new Map(),
    fallbackModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
    ...over,
  });
}

/** A well-formed pending autotune adjustment. */
function makePending(over: Partial<AutotunePending> = {}): AutotunePending {
  return {
    phase: "build",
    from: "claude-sonnet-4-6",
    to: "claude-opus-4-7",
    reason: "prom 1.5 corregir/run en 8 runs v2",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// createPickerState
// ---------------------------------------------------------------------------

test("createPickerState starts on the main screen with cursor at 0", () => {
  const state = makeState();
  assert.equal(state.screen, "main");
  assert.equal(state.cursor, 0);
  assert.equal(state.drillPhase, null);
  assert.equal(state.drillProvider, null);
  assert.equal(state.textPrompt, null);
});

test("createPickerState main screen has the six phase rows in PHASES order", () => {
  const state = makeState();
  const phaseRows = state.entries.filter((e) => e.kind === "phase");
  assert.deepEqual(
    phaseRows.map((e) => e.value),
    ["clarify", "explore", "plan", "analyze", "build", "veredicto"],
    "phase rows appear in pipeline order, gates included",
  );
});

test("createPickerState main screen carries autotune, profiles and save rows", () => {
  const state = makeState();
  const autotune = state.entries.filter((e) => e.kind === "autotune");
  const profiles = state.entries.filter((e) => e.kind === "profiles");
  const save = state.entries.filter((e) => e.kind === "save");
  assert.equal(autotune.length, 1, "exactly one autotune row");
  assert.equal(profiles.length, 1, "exactly one profiles row");
  assert.equal(save.length, 1, "exactly one save row");
  // The save row is last, the profiles row before it, then autotune.
  assert.equal(state.entries[state.entries.length - 1].kind, "save");
  assert.equal(state.entries[state.entries.length - 2].kind, "profiles");
  assert.equal(state.entries[state.entries.length - 3].kind, "autotune");
});

test("createPickerState autotune row label reflects the current mode", () => {
  assert.ok(
    makeState({ autotuneMode: "off" as AutotuneMode }).entries.some(
      (e) => e.kind === "autotune" && e.label.includes("off"),
    ),
  );
  assert.ok(
    makeState({ autotuneMode: "ask" as AutotuneMode }).entries.some(
      (e) => e.kind === "autotune" && e.label.includes("ask"),
    ),
  );
});

test("createPickerState phase row label shows provider/model when a provider is set", () => {
  const state = makeState({
    providers: makeProviders({ build: "anthropic" }),
  });
  const build = state.entries.find((e) => e.kind === "phase" && e.value === "build");
  assert.ok(build);
  assert.ok(
    build!.label.includes("anthropic/claude-sonnet-4-6"),
    "a set provider is shown as provider/model",
  );
});

test("createPickerState phase row label omits the provider when it is empty", () => {
  const explore = makeState().entries.find(
    (e) => e.kind === "phase" && e.value === "explore",
  );
  assert.ok(explore);
  assert.ok(explore!.label.includes("claude-haiku-4-5"));
  assert.ok(!explore!.label.includes("/"), "no slash when the provider is empty");
});

test("createPickerState phase row label shows the staged thinking level when set", () => {
  const state = makeState({
    providers: makeProviders({ build: "anthropic" }),
    thinking: makeThinking({ build: "high" }),
  });
  const build = state.entries.find((e) => e.kind === "phase" && e.value === "build");
  assert.ok(build);
  assert.ok(
    build!.label.includes("anthropic/claude-sonnet-4-6"),
    "the provider/model is still shown",
  );
  assert.ok(
    build!.label.includes("· thinking high"),
    "a staged thinking level is appended to the row label",
  );
});

test("createPickerState phase row label shows no thinking text when unset", () => {
  const explore = makeState().entries.find(
    (e) => e.kind === "phase" && e.value === "explore",
  );
  assert.ok(explore);
  assert.ok(!explore!.label.includes("thinking"), "no `· thinking` artifact when unset");
});

test("createPickerState copies the models/providers maps — no caller aliasing", () => {
  const models = makeModels();
  const providers = makeProviders();
  const state = makeState({ models, providers });
  assert.notStrictEqual(state.edits.models, models, "models is a copy");
  assert.notStrictEqual(state.edits.providers, providers, "providers is a copy");
  assert.deepEqual(state.edits.models, models);
});

test("createPickerState starts with all change flags false", () => {
  const state = makeState();
  assert.equal(state.edits.changed, false);
  assert.equal(state.edits.autotuneChanged, false);
  assert.equal(state.edits.pendingApplied, false);
});

// ---------------------------------------------------------------------------
// T007 — thinking screen, drillModel, staged thinking
// ---------------------------------------------------------------------------

test("createPickerState copies the thinking map — no caller aliasing", () => {
  const thinking = makeThinking({ build: "high" });
  const state = makeState({ thinking });
  assert.notStrictEqual(state.edits.thinking, thinking, "thinking is a copy");
  assert.deepEqual(state.edits.thinking, { build: "high" });
});

test("createPickerState starts with drillModel null", () => {
  const state = makeState();
  assert.equal(state.drillModel, null, "drillModel starts null");
});

test("rebuildEntries on the thinking screen produces exactly the six level rows", () => {
  const state = makeState();
  state.screen = "thinking";
  rebuildEntries(state);
  assert.deepEqual(
    state.entries.map((e) => e.kind),
    ["thinking-level", "thinking-level", "thinking-level", "thinking-level", "thinking-level", "thinking-level"],
    "exactly six thinking-level rows",
  );
  assert.deepEqual(
    state.entries.map((e) => e.value),
    ["off", "minimal", "low", "medium", "high", "xhigh"],
    "the six real pi levels in order",
  );
});

// ---------------------------------------------------------------------------
// apply-pending row presence
// ---------------------------------------------------------------------------

test("createPickerState omits the apply-pending row when there is no pending", () => {
  const state = makeState({ pending: [] });
  assert.equal(
    state.entries.filter((e) => e.kind === "apply-pending").length,
    0,
    "no pending → no apply row",
  );
});

test("createPickerState prepends the apply-pending row when pending exists", () => {
  const state = makeState({ pending: [makePending()] });
  const apply = state.entries.filter((e) => e.kind === "apply-pending");
  assert.equal(apply.length, 1, "well-formed pending → exactly one apply row");
  assert.equal(state.entries[0].kind, "apply-pending", "the apply row is first");
});

test("createPickerState apply-pending label lists each phase → to adjustment", () => {
  const state = makeState({
    pending: [
      makePending({ phase: "build", to: "claude-opus-4-7" }),
      makePending({ phase: "plan", to: "claude-opus-4-6" }),
    ],
  });
  const apply = state.entries.find((e) => e.kind === "apply-pending");
  assert.ok(apply);
  assert.ok(apply!.label.includes("build → claude-opus-4-7"));
  assert.ok(apply!.label.includes("plan → claude-opus-4-6"));
});

// ---------------------------------------------------------------------------
// rebuildEntries
// ---------------------------------------------------------------------------

test("rebuildEntries is idempotent on the main screen", () => {
  const state = makeState();
  const before = state.entries.map((e) => `${e.kind}:${e.value}`);
  rebuildEntries(state);
  const after = state.entries.map((e) => `${e.kind}:${e.value}`);
  assert.deepEqual(after, before, "rebuilding twice yields the same rows");
});

test("rebuildEntries builds sorted provider rows plus a custom-provider escape", () => {
  const state = makeState({
    groups: new Map([
      ["openai-codex", ["gpt-5-codex"]],
      ["anthropic", ["claude-opus-4-7"]],
    ]),
  });
  state.screen = "provider";
  rebuildEntries(state);
  assert.deepEqual(
    state.entries.filter((e) => e.kind === "provider").map((e) => e.value),
    ["anthropic", "openai-codex"],
    "provider rows are sorted",
  );
  assert.equal(
    state.entries[state.entries.length - 1].kind,
    "custom-provider",
    "the custom-provider escape is last",
  );
});

test("rebuildEntries builds model rows from the drilled provider's group", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7", "claude-sonnet-4-6"]]]),
  });
  state.screen = "model";
  state.drillProvider = "anthropic";
  rebuildEntries(state);
  assert.deepEqual(
    state.entries.filter((e) => e.kind === "model").map((e) => e.value),
    ["claude-opus-4-7", "claude-sonnet-4-6"],
  );
  assert.equal(state.entries[state.entries.length - 1].kind, "custom-model");
});

test("rebuildEntries falls back to fallbackModels on the model screen with no provider", () => {
  const state = makeState({
    fallbackModels: ["claude-opus-4-7", "claude-haiku-4-5"],
  });
  state.screen = "model";
  state.drillProvider = null;
  rebuildEntries(state);
  assert.deepEqual(
    state.entries.filter((e) => e.kind === "model").map((e) => e.value),
    ["claude-opus-4-7", "claude-haiku-4-5"],
    "the fallback model list is used when no provider is drilled",
  );
});

test("rebuildEntries builds the three autotune-mode rows", () => {
  const state = makeState();
  state.screen = "autotune";
  rebuildEntries(state);
  assert.deepEqual(
    state.entries.map((e) => e.kind),
    ["autotune-mode", "autotune-mode", "autotune-mode"],
  );
  assert.deepEqual(
    state.entries.map((e) => e.value),
    ["auto", "ask", "off"],
  );
});

test("rebuildEntries clamps an out-of-range cursor into the new row list", () => {
  const state = makeState();
  state.cursor = 999;
  state.screen = "autotune";
  rebuildEntries(state);
  assert.equal(state.cursor, state.entries.length - 1, "cursor clamped to the last row");
});

// ---------------------------------------------------------------------------
// navigate — cyclic wrap
// ---------------------------------------------------------------------------

test("navigate wraps Up at index 0 to the last row", () => {
  const state = makeState();
  state.cursor = 0;
  navigate(state, -1);
  assert.equal(
    state.cursor,
    state.entries.length - 1,
    "Up at the first row lands on the last row",
  );
});

test("navigate wraps Down at the last row to row 0", () => {
  const state = makeState();
  state.cursor = state.entries.length - 1;
  navigate(state, 1);
  assert.equal(state.cursor, 0, "Down at the last row lands on row 0");
});

test("navigate moves by one in the middle of the list", () => {
  const state = makeState();
  assert.ok(state.entries.length >= 3, "fixture has a mid-list row to move within");
  state.cursor = 1;
  navigate(state, 1);
  assert.equal(state.cursor, 2, "Down moves the highlight by one");
  navigate(state, -1);
  assert.equal(state.cursor, 1, "Up moves the highlight back by one");
});

test("navigate on a single-entry list is a fixed point", () => {
  const state = makeState();
  state.entries = [{ kind: "save", label: "— guardar y salir —", value: "save" }];
  state.cursor = 0;
  navigate(state, 1);
  assert.equal(state.cursor, 0, "Down on a one-row list stays on row 0");
  navigate(state, -1);
  assert.equal(state.cursor, 0, "Up on a one-row list stays on row 0");
});

test("navigate returns the same state object — mutate-and-return", () => {
  const state = makeState();
  assert.strictEqual(navigate(state, 1), state);
});

// ---------------------------------------------------------------------------
// enter — dispatch
// ---------------------------------------------------------------------------

/** Move the cursor onto the first row of the given `kind` on the current
 *  screen. Returns the matched entry's value for convenience. */
function cursorTo(state: PickerState, kind: string): string {
  const idx = state.entries.findIndex((e) => e.kind === kind);
  assert.notEqual(idx, -1, `expected a ${kind} row on the current screen`);
  state.cursor = idx;
  return state.entries[idx].value;
}

test("enter on a phase row drills into the provider screen with drillPhase set", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7"]]]),
  });
  cursorTo(state, "phase"); // first phase row → clarify (the pre-explore gate)
  const result = enter(state);
  assert.equal(result.type, "state");
  assert.equal(state.screen, "provider");
  assert.equal(state.drillPhase, "clarify");
  assert.equal(state.cursor, 0);
  assert.ok(
    state.entries.some((e) => e.kind === "provider"),
    "provider rows are built after drilling in",
  );
});

test("enter on a phase row with empty groups skips to the model screen with fallbackModels", () => {
  const state = makeState({
    groups: new Map(),
    fallbackModels: ["claude-opus-4-7", "claude-haiku-4-5"],
  });
  cursorTo(state, "phase");
  const result = enter(state);
  assert.equal(result.type, "state");
  assert.equal(state.screen, "model", "empty registry skips the provider screen");
  assert.equal(state.drillProvider, null, "no provider is drilled");
  assert.deepEqual(
    state.entries.filter((e) => e.kind === "model").map((e) => e.value),
    ["claude-opus-4-7", "claude-haiku-4-5"],
    "fallbackModels populate the model screen",
  );
});

test("enter on a provider row drills into the model screen with drillProvider set", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7", "claude-sonnet-4-6"]]]),
  });
  cursorTo(state, "phase");
  enter(state); // → provider screen
  cursorTo(state, "provider");
  const result = enter(state);
  assert.equal(result.type, "state");
  assert.equal(state.screen, "model");
  assert.equal(state.drillProvider, "anthropic");
  assert.deepEqual(
    state.entries.filter((e) => e.kind === "model").map((e) => e.value),
    ["claude-opus-4-7", "claude-sonnet-4-6"],
  );
});

test("enter on the autotune row drills into the autotune screen", () => {
  const state = makeState();
  cursorTo(state, "autotune");
  const result = enter(state);
  assert.equal(result.type, "state");
  assert.equal(state.screen, "autotune");
  assert.deepEqual(
    state.entries.map((e) => e.value),
    ["auto", "ask", "off"],
  );
});

test("enter on the save row returns a save result", () => {
  const state = makeState();
  cursorTo(state, "save");
  const result = enter(state);
  assert.equal(result.type, "save");
});

test("enter on a custom-provider row opens a provider text prompt", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7"]]]),
  });
  cursorTo(state, "phase");
  enter(state); // → provider screen
  cursorTo(state, "custom-provider");
  const result = enter(state);
  assert.equal(result.type, "state");
  assert.ok(state.textPrompt);
  assert.equal(state.textPrompt!.for, "provider");
  assert.equal(state.screen, "provider", "stays on the provider screen");
});

test("enter on a custom-model row opens a model text prompt", () => {
  const state = makeState();
  cursorTo(state, "phase"); // empty groups → model screen
  enter(state);
  cursorTo(state, "custom-model");
  const result = enter(state);
  assert.equal(result.type, "state");
  assert.ok(state.textPrompt);
  assert.equal(state.textPrompt!.for, "model");
});

// ---------------------------------------------------------------------------
// enter — apply-pending
// ---------------------------------------------------------------------------

test("enter on apply-pending mutates models, sets pendingApplied, drops the row", () => {
  const state = makeState({
    pending: [makePending({ phase: "build", to: "claude-opus-4-7" })],
  });
  cursorTo(state, "apply-pending");
  const result = enter(state);
  assert.equal(result.type, "state");
  assert.equal(state.edits.models.build, "claude-opus-4-7", "pending `to` applied");
  assert.equal(state.edits.changed, true);
  assert.equal(state.edits.pendingApplied, true);
  assert.equal(state.pending.length, 0, "pending cleared");
  assert.equal(
    state.entries.filter((e) => e.kind === "apply-pending").length,
    0,
    "the apply row is gone after rebuildEntries",
  );
});

test("enter on apply-pending applies every pending adjustment", () => {
  const state = makeState({
    pending: [
      makePending({ phase: "build", to: "claude-opus-4-7" }),
      makePending({ phase: "plan", to: "claude-opus-4-6" }),
    ],
  });
  cursorTo(state, "apply-pending");
  enter(state);
  assert.equal(state.edits.models.build, "claude-opus-4-7");
  assert.equal(state.edits.models.plan, "claude-opus-4-6");
});

// ---------------------------------------------------------------------------
// provider/model commit
// ---------------------------------------------------------------------------

/** Move the cursor onto the row whose `kind` and `value` both match. */
function cursorToValue(state: PickerState, kind: string, value: string): void {
  const idx = state.entries.findIndex((e) => e.kind === kind && e.value === value);
  assert.notEqual(idx, -1, `expected a ${kind}=${value} row on the current screen`);
  state.cursor = idx;
}

test("selecting a provider then a model moves to the thinking screen WITHOUT committing", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7", "claude-sonnet-4-6"]]]),
  });
  cursorToValue(state, "phase", "build");
  enter(state); // → provider screen
  cursorTo(state, "provider"); // anthropic
  enter(state); // → model screen
  // Pick a model that differs from the fixture default build model so the
  // "not committed" check is unambiguous.
  cursorToValue(state, "model", "claude-opus-4-7");
  const result = enter(state);
  assert.equal(result.type, "state");
  assert.equal(state.screen, "thinking", "model selection advances to the thinking screen");
  assert.equal(state.drillModel, "claude-opus-4-7", "the picked model is held in drillModel");
  assert.equal(state.drillProvider, "anthropic", "the picked provider is still held");
  assert.equal(state.edits.models.build, "claude-sonnet-4-6", "edits.models still holds the default, not the pick");
  assert.equal(state.edits.changed, false, "no edit is committed before a level is chosen");
});

test("choosing a thinking level commits model + provider + thinking atomically", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7", "claude-sonnet-4-6"]]]),
  });
  cursorToValue(state, "phase", "build");
  enter(state); // → provider
  cursorTo(state, "provider"); // anthropic
  enter(state); // → model
  cursorToValue(state, "model", "claude-sonnet-4-6");
  enter(state); // → thinking
  cursorToValue(state, "thinking-level", "high");
  const result = enter(state); // commit
  assert.equal(result.type, "state");
  assert.equal(state.screen, "main", "returns to the main screen after committing");
  assert.equal(state.edits.models.build, "claude-sonnet-4-6", "model committed");
  assert.equal(state.edits.providers.build, "anthropic", "provider committed");
  assert.equal(state.edits.thinking.build, "high", "thinking level committed");
  assert.equal(state.edits.changed, true);
  assert.equal(state.drillPhase, null, "drill context is cleared");
  assert.equal(state.drillProvider, null);
  assert.equal(state.drillModel, null, "drillModel is cleared after the commit");
});

test("the committed provider is exactly the one picked, with the chosen level", () => {
  const state = makeState({
    groups: new Map([["openai-codex", ["gpt-5-codex", "gpt-5-mini"]]]),
  });
  cursorToValue(state, "phase", "explore");
  enter(state); // → provider
  cursorTo(state, "provider"); // openai-codex
  enter(state); // → model, drillProvider = "openai-codex"
  cursorToValue(state, "model", "gpt-5-mini");
  enter(state); // → thinking
  cursorToValue(state, "thinking-level", "low");
  enter(state); // commit
  assert.equal(state.edits.models.explore, "gpt-5-mini", "picked model committed");
  assert.equal(state.edits.providers.explore, "openai-codex", "the picked provider committed");
  assert.equal(state.edits.thinking.explore, "low", "the chosen level committed");
  assert.equal(state.edits.changed, true);
});

test("model commit via the empty-registry skip records an empty provider", () => {
  // Real flow: empty registry → enter on a phase row skips the provider
  // screen, landing on the model screen with `drillProvider` left null.
  const state = makeState({
    groups: new Map(),
    fallbackModels: ["claude-opus-4-7", "claude-haiku-4-5"],
  });
  cursorToValue(state, "phase", "explore");
  enter(state); // empty registry → skip to model screen, drillProvider null
  assert.equal(state.screen, "model");
  assert.equal(state.drillProvider, null, "the skip leaves drillProvider null");
  cursorTo(state, "model"); // first fallback model
  const model = state.entries[state.cursor].value;
  enter(state); // → thinking
  assert.equal(state.screen, "thinking", "model selection still advances to thinking");
  cursorToValue(state, "thinking-level", "medium");
  enter(state); // commit
  assert.equal(state.edits.models.explore, model, "fallback model committed");
  assert.equal(
    state.edits.providers.explore,
    "",
    "the empty-registry skip commits an empty provider",
  );
  assert.equal(state.edits.thinking.explore, "medium");
  assert.equal(state.edits.changed, true);
});

test("model commit leaves provider empty when no group owns the model", () => {
  const state = makeState({ groups: new Map() });
  cursorToValue(state, "phase", "plan");
  enter(state); // empty groups → model screen, drillProvider null
  cursorTo(state, "model"); // first fallback model
  const model = state.entries[state.cursor].value;
  enter(state); // → thinking
  cursorToValue(state, "thinking-level", "off");
  enter(state); // commit
  assert.equal(state.edits.models.plan, model);
  assert.equal(state.edits.providers.plan, "", "no owner → empty provider");
  assert.equal(state.edits.thinking.plan, "off");
});

test("Esc from the thinking screen commits no partial edit and clears drillModel", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7", "claude-sonnet-4-6"]]]),
  });
  cursorToValue(state, "phase", "build");
  enter(state); // → provider
  cursorTo(state, "provider"); // anthropic
  enter(state); // → model
  cursorToValue(state, "model", "claude-opus-4-7"); // differs from default build model
  enter(state); // → thinking, drillModel set
  assert.equal(state.drillModel, "claude-opus-4-7", "model is staged in drillModel");
  const result = back(state); // Esc
  assert.equal(result.type, "state");
  assert.equal(state.screen, "main", "Esc returns to main");
  assert.equal(state.edits.changed, false, "no model/provider/thinking change is committed");
  assert.equal(state.edits.models.build, "claude-sonnet-4-6", "model is NOT half-committed (default intact)");
  assert.equal(state.edits.thinking.build, undefined, "no thinking is committed");
  assert.equal(state.drillModel, null, "drillModel is cleared on Esc");
  assert.equal(state.drillPhase, null, "drillPhase is cleared on Esc");
  assert.equal(state.drillProvider, null, "drillProvider is cleared on Esc");
});

// ---------------------------------------------------------------------------
// back
// ---------------------------------------------------------------------------

test("back from the provider screen returns to main with the drill context cleared", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7"]]]),
  });
  cursorTo(state, "phase");
  enter(state); // → provider screen
  const result = back(state);
  assert.equal(result.type, "state");
  assert.equal(state.screen, "main");
  assert.equal(state.drillPhase, null);
  assert.equal(state.drillProvider, null);
});

test("back from the model screen returns to main and commits no edit", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7"]]]),
  });
  cursorTo(state, "phase");
  enter(state); // → provider screen
  cursorTo(state, "provider");
  enter(state); // → model screen
  back(state);
  assert.equal(state.screen, "main");
  assert.equal(state.edits.changed, false, "Esc mid-drill stages no edit");
  assert.equal(state.drillPhase, null);
  assert.equal(state.drillProvider, null);
});

test("back from the autotune screen returns to main with autotune unchanged", () => {
  const state = makeState();
  cursorTo(state, "autotune");
  enter(state); // → autotune screen
  back(state);
  assert.equal(state.screen, "main");
  assert.equal(state.edits.autotuneChanged, false);
});

test("back at the main screen returns a quit result", () => {
  const state = makeState();
  const result = back(state);
  assert.equal(result.type, "quit");
});

// ---------------------------------------------------------------------------
// changed / unchanged save decision
// ---------------------------------------------------------------------------

test("a fresh state has all change flags false", () => {
  const state = makeState();
  assert.equal(state.edits.changed, false);
  assert.equal(state.edits.autotuneChanged, false);
  assert.equal(state.edits.pendingApplied, false);
});

test("a single phase model edit sets edits.changed", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7"]]]),
  });
  cursorTo(state, "phase");
  enter(state); // → provider
  cursorTo(state, "provider");
  enter(state); // → model
  cursorTo(state, "model");
  enter(state); // → thinking
  cursorTo(state, "thinking-level"); // pick a level → commit
  enter(state); // commit
  assert.equal(state.edits.changed, true);
  assert.equal(state.edits.autotuneChanged, false, "autotune untouched");
});

test("selecting a different autotune mode sets autotuneChanged", () => {
  const state = makeState({ autotuneMode: "auto" as AutotuneMode });
  cursorTo(state, "autotune");
  enter(state); // → autotune screen
  const offIdx = state.entries.findIndex((e) => e.value === "off");
  state.cursor = offIdx;
  enter(state);
  assert.equal(state.edits.autotuneMode, "off");
  assert.equal(state.edits.autotuneChanged, true);
});

test("selecting the same autotune mode leaves autotuneChanged false", () => {
  const state = makeState({ autotuneMode: "auto" as AutotuneMode });
  cursorTo(state, "autotune");
  enter(state); // → autotune screen
  const autoIdx = state.entries.findIndex((e) => e.value === "auto");
  state.cursor = autoIdx;
  enter(state);
  assert.equal(state.edits.autotuneMode, "auto");
  assert.equal(state.edits.autotuneChanged, false, "same mode is not a change");
});

// ---------------------------------------------------------------------------
// submitText — typed custom provider / model values
// ---------------------------------------------------------------------------

test("submitText: custom provider then custom model commits the typed strings to the right phase", () => {
  // Empty registry → drilling a phase lands straight on the model screen, but
  // we still want to type a custom provider, so use a non-empty registry to
  // reach the provider screen and pick the custom-provider escape.
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7"]]]),
  });
  // Drill into the `build` phase.
  const buildIdx = state.entries.findIndex(
    (e) => e.kind === "phase" && e.value === "build",
  );
  state.cursor = buildIdx;
  enter(state); // → provider screen

  // Pick the custom-provider escape and type a provider id.
  cursorTo(state, "custom-provider");
  enter(state); // opens the provider text prompt
  assert.ok(state.textPrompt);
  assert.equal(state.textPrompt!.for, "provider");

  const afterProvider = submitText(state, "  my-provider  ");
  assert.strictEqual(afterProvider, state, "mutate-and-return");
  assert.equal(state.textPrompt, null, "the prompt is cleared");
  assert.equal(state.screen, "model", "advances to the model screen");
  assert.equal(state.drillProvider, "my-provider", "typed provider is trimmed");

  // Pick the custom-model escape and type a model id.
  cursorTo(state, "custom-model");
  enter(state); // opens the model text prompt
  assert.ok(state.textPrompt);
  assert.equal(state.textPrompt!.for, "model");

  submitText(state, "  my-model  ");
  // The typed model now advances to the thinking screen rather than committing.
  assert.equal(state.textPrompt, null, "the prompt is cleared");
  assert.equal(state.screen, "thinking", "a typed model advances to the thinking screen");
  assert.equal(state.drillModel, "my-model", "the typed model is staged in drillModel, trimmed");
  // Choose a level to commit model + provider + thinking atomically.
  cursorToValue(state, "thinking-level", "high");
  enter(state); // commit
  assert.equal(state.screen, "main", "returns to the main screen after committing");
  assert.equal(state.edits.models.build, "my-model", "typed model committed, trimmed");
  assert.equal(
    state.edits.providers.build,
    "my-provider",
    "the typed provider is committed for the phase",
  );
  assert.equal(state.edits.thinking.build, "high", "the chosen level is committed");
  assert.equal(state.edits.changed, true);
  assert.equal(state.drillPhase, null, "drill context is cleared");
  assert.equal(state.drillProvider, null);
  assert.equal(state.drillModel, null, "drillModel is cleared after the commit");
});

test("submitText: a typed model with no drilled provider commits an empty provider", () => {
  // Empty registry → entering a phase skips straight to the model screen with
  // drillProvider left null; a typed model then records an empty provider.
  const state = makeState({ groups: new Map() });
  const planIdx = state.entries.findIndex(
    (e) => e.kind === "phase" && e.value === "plan",
  );
  state.cursor = planIdx;
  enter(state); // empty registry → model screen, drillProvider null
  cursorTo(state, "custom-model");
  enter(state); // opens the model text prompt

  submitText(state, "typed-model");
  // The typed model advances to the thinking screen; commit on a level.
  assert.equal(state.screen, "thinking", "a typed model advances to the thinking screen");
  assert.equal(state.drillModel, "typed-model", "the typed model is staged");
  cursorToValue(state, "thinking-level", "medium");
  enter(state); // commit
  assert.equal(state.edits.models.plan, "typed-model");
  assert.equal(state.edits.providers.plan, "", "null drillProvider → empty provider");
  assert.equal(state.edits.thinking.plan, "medium");
  assert.equal(state.edits.changed, true);
  assert.equal(state.screen, "main");
});

test("submitText: an empty typed value is a no-op that returns to the provider list", () => {
  const state = makeState({
    groups: new Map([["anthropic", ["claude-opus-4-7"]]]),
  });
  cursorTo(state, "phase");
  enter(state); // → provider screen
  cursorTo(state, "custom-provider");
  enter(state); // opens the provider text prompt

  submitText(state, "");
  assert.equal(state.textPrompt, null, "the prompt is cleared");
  assert.equal(state.screen, "provider", "stays on the provider list, unchanged");
  assert.equal(state.drillProvider, null, "no provider is recorded");
  assert.equal(state.edits.changed, false, "an empty value commits nothing");
  assert.ok(
    state.entries.some((e) => e.kind === "provider"),
    "the provider list is shown again",
  );
});

test("submitText: a whitespace-only typed model is a no-op that returns to the model list", () => {
  const state = makeState({ groups: new Map() });
  cursorTo(state, "phase"); // empty groups → model screen
  enter(state);
  cursorTo(state, "custom-model");
  enter(state); // opens the model text prompt

  const before = state.edits.models.explore;
  submitText(state, "   ");
  assert.equal(state.textPrompt, null, "the prompt is cleared");
  assert.equal(state.screen, "model", "stays on the model list, unchanged");
  assert.equal(state.edits.models.explore, before, "no model is committed");
  assert.equal(state.edits.changed, false, "a whitespace value commits nothing");
  assert.ok(
    state.entries.some((e) => e.kind === "model"),
    "the model list is shown again",
  );
});

// ---------------------------------------------------------------------------
// decodeKey — legacy + kitty-keyboard-protocol sequences
// ---------------------------------------------------------------------------
//
// pi-tui negotiates kitty keyboard protocol flags 7 with the terminal; Ghostty
// grants them and then encodes arrows as `CSI 1;1:1 A/B` (press), `:2`
// (repeat), `:3` (release) and Esc as `CSI 27 u` — never the legacy `\x1b[A`
// forms. The kitty sequences below were captured live from Ghostty. The picker
// must navigate on press AND repeat (holding the arrow scrolls) and must
// ignore releases.

test("decodeKey: legacy CSI arrows decode to up/down", () => {
  assert.equal(decodeKey("\x1b[A"), "up");
  assert.equal(decodeKey("\x1b[B"), "down");
});

test("decodeKey: SS3 application-cursor-mode arrows decode to up/down", () => {
  assert.equal(decodeKey("\x1bOA"), "up");
  assert.equal(decodeKey("\x1bOB"), "down");
});

test("decodeKey: kitty-protocol arrow presses (Ghostty, flags 7) decode to up/down", () => {
  assert.equal(decodeKey("\x1b[1;1:1A"), "up");
  assert.equal(decodeKey("\x1b[1;1:1B"), "down");
  // Terminals may omit the event sub-field on press.
  assert.equal(decodeKey("\x1b[1;1A"), "up");
  assert.equal(decodeKey("\x1b[1;1B"), "down");
});

test("decodeKey: kitty-protocol arrow repeats navigate — holding the key scrolls", () => {
  assert.equal(decodeKey("\x1b[1;1:2A"), "up");
  assert.equal(decodeKey("\x1b[1;1:2B"), "down");
});

test("decodeKey: kitty-protocol releases are ignored", () => {
  assert.equal(decodeKey("\x1b[1;1:3A"), null);
  assert.equal(decodeKey("\x1b[1;1:3B"), null);
  assert.equal(decodeKey("\x1b[27;1:3u"), null);
  assert.equal(decodeKey("\x1b[13;1:3u"), null);
});

test("decodeKey: modified arrows do not navigate", () => {
  assert.equal(decodeKey("\x1b[1;2B"), null); // shift+down
  assert.equal(decodeKey("\x1b[1;5A"), null); // ctrl+up
});

test("decodeKey: Esc decodes from the bare byte and the kitty CSI-u forms", () => {
  assert.equal(decodeKey("\x1b"), "esc");
  assert.equal(decodeKey("\x1b[27u"), "esc");
  assert.equal(decodeKey("\x1b[27;1:1u"), "esc");
});

test("decodeKey: Enter decodes from CR/LF and the kitty CSI-u form", () => {
  assert.equal(decodeKey("\r"), "enter");
  assert.equal(decodeKey("\n"), "enter");
  assert.equal(decodeKey("\r\n"), "enter");
  assert.equal(decodeKey("\x1b[13u"), "enter");
});

test("decodeKey: Backspace decodes from DEL/BS and the kitty CSI-u form", () => {
  assert.equal(decodeKey("\x7f"), "backspace");
  assert.equal(decodeKey("\x08"), "backspace");
  assert.equal(decodeKey("\x1b[127u"), "backspace");
});

test("decodeKey: printable characters and unknown sequences decode to null", () => {
  assert.equal(decodeKey("q"), null);
  assert.equal(decodeKey("\x1b[C"), null); // right arrow — not a picker key
  assert.equal(decodeKey(""), null);
});

// ---------------------------------------------------------------------------
// Profiles: the `profiles` / `profile-actions` screens
// ---------------------------------------------------------------------------

/** Two saved profiles, `premium` active, as read from zero.json. */
function makeProfiles() {
  return {
    premium: {
      models: { plan: "claude-opus-5", build: "claude-opus-5" },
      providers: { plan: "anthropic", build: "anthropic" },
      thinking: { plan: "xhigh" as const, build: "high" as const },
    },
    barato: {
      models: { plan: "gpt-5.6-luna", build: "gpt-5.6-luna" },
      providers: { plan: "openai-codex", build: "openai-codex" },
      thinking: { plan: "low" as const, build: "low" as const },
    },
  };
}

/** A picker opened with saved profiles and `premium` active. */
function withProfiles(): PickerState {
  return makeState({ profiles: makeProfiles(), activeProfile: "premium" });
}

/** Move the cursor onto the first row matching `kind`, then enter. */
function enterRow(state: PickerState, kind: string): PickerState {
  const index = state.entries.findIndex((e) => e.kind === kind);
  assert.notEqual(index, -1, `no row of kind ${kind}`);
  state.cursor = index;
  const result = enter(state);
  assert.equal(result.type, "state", `entering ${kind} should not close`);
  return (result as { type: "state"; state: PickerState }).state;
}

/** Move the cursor onto the row whose value is `value`, then enter. */
function enterValue(state: PickerState, value: string): PickerState {
  const index = state.entries.findIndex((e) => e.value === value);
  assert.notEqual(index, -1, `no row with value ${value}`);
  state.cursor = index;
  const result = enter(state);
  assert.equal(result.type, "state");
  return (result as { type: "state"; state: PickerState }).state;
}

test("the picker works exactly as before when no profiles exist", () => {
  const state = makeState();
  assert.deepEqual(state.edits.profiles, {});
  assert.equal(state.edits.activeProfile, null);
  assert.equal(state.edits.editingProfile, null);
  assert.equal(state.edits.profilesChanged, false);
  // The profiles row is present but says there are none yet.
  const row = state.entries.find((e) => e.kind === "profiles");
  assert.match(row!.label, /ninguno todavía/);
});

test("the profiles row names the active profile", () => {
  const row = withProfiles().entries.find((e) => e.kind === "profiles");
  assert.match(row!.label, /premium/);
});

test("the profiles screen lists every profile plus a create row", () => {
  const screen = enterRow(withProfiles(), "profiles");
  assert.equal(screen.screen, "profiles");
  const names = screen.entries.filter((e) => e.kind === "profile").map((e) => e.value);
  assert.deepEqual(names, ["barato", "premium"], "sorted");
  assert.equal(screen.entries[screen.entries.length - 1].kind, "new-profile");
});

test("the active profile is marked in the listing", () => {
  const screen = enterRow(withProfiles(), "profiles");
  const active = screen.entries.find((e) => e.value === "premium");
  assert.match(active!.label, /activo/);
});

test("opening a profile shows edit / activate / duplicate / delete", () => {
  const actions = enterValue(enterRow(withProfiles(), "profiles"), "barato");
  assert.equal(actions.screen, "profile-actions");
  assert.deepEqual(actions.entries.map((e) => e.kind), [
    "profile-edit",
    "profile-use",
    "profile-duplicate",
    "profile-delete",
  ]);
});

test("the active profile is not offered an activate row", () => {
  const actions = enterValue(enterRow(withProfiles(), "profiles"), "premium");
  assert.equal(actions.entries.some((e) => e.kind === "profile-use"), false);
});

test("editing a profile loads its models into the phase screen without activating it", () => {
  const actions = enterValue(enterRow(withProfiles(), "profiles"), "barato");
  const editing = enterRow(actions, "profile-edit");
  assert.equal(editing.screen, "main", "lands on the usual phase screen");
  assert.equal(editing.edits.editingProfile, "barato");
  assert.equal(editing.edits.activeProfile, "premium", "still active");
  assert.equal(editing.edits.models.plan, "gpt-5.6-luna");
  assert.equal(editing.edits.thinking.plan, "low");
});

test("the title says which profile is being edited and whether it is active", () => {
  const state = withProfiles();
  assert.match(pickerTitle(state), /«premium»/);
  const editing = enterRow(
    enterValue(enterRow(state, "profiles"), "barato"),
    "profile-edit",
  );
  assert.match(pickerTitle(editing), /«barato».*no activo/);
});

test("a phase edit lands in the profile being edited, not the active one", () => {
  let state = enterRow(
    enterValue(enterRow(withProfiles(), "profiles"), "barato"),
    "profile-edit",
  );
  // Drill: phase → (no registry, so straight to model) → thinking level.
  state = enterValue(state, "plan");
  state = enterValue(state, "claude-opus-4-7");
  state = enterValue(state, "xhigh");

  const result = enter({ ...state, cursor: state.entries.findIndex((e) => e.kind === "save") });
  assert.equal(result.type, "save");
  const edits = (result as { type: "save"; state: PickerState }).state.edits;
  assert.equal(edits.profiles.barato.models.plan, "claude-opus-4-7", "edited profile changed");
  assert.equal(edits.profiles.premium.models.plan, "claude-opus-5", "active untouched");
});

test("activating a profile switches the live maps and flags the change", () => {
  const activated = enterRow(
    enterValue(enterRow(withProfiles(), "profiles"), "barato"),
    "profile-use",
  );
  assert.equal(activated.edits.activeProfile, "barato");
  assert.equal(activated.edits.editingProfile, null);
  assert.equal(activated.edits.profilesChanged, true);
  assert.equal(activated.edits.models.plan, "gpt-5.6-luna");
  assert.equal(activated.screen, "profiles", "stays in the listing");
  assert.match(activated.notice!, /barato/);
});

test("creating a profile prompts for a name, then opens it for editing", () => {
  const prompted = enterRow(enterRow(withProfiles(), "profiles"), "new-profile");
  assert.equal(prompted.textPrompt?.for, "new-profile");

  const created = submitText(prompted, "qa");
  assert.equal(created.screen, "main", "goes straight to picking models");
  assert.equal(created.edits.editingProfile, "qa");
  assert.equal(created.edits.activeProfile, "premium", "creating does not activate");
  assert.equal(created.edits.profilesChanged, true);
  assert.ok("qa" in created.edits.profiles);
});

test("a new profile starts from what was on screen", () => {
  const state = withProfiles();
  // The live maps are the fixture's, deliberately not equal to `premium` —
  // which is the shape autotune leaves behind. What is on screen is what the
  // new profile must capture.
  assert.equal(state.edits.models.plan, "claude-opus-4-7");

  const created = submitText(enterRow(enterRow(state, "profiles"), "new-profile"), "qa");
  assert.equal(created.edits.profiles.qa.models.plan, "claude-opus-4-7");
  // And capturing it must not have rewritten the active profile.
  assert.equal(created.edits.profiles.premium.models.plan, "claude-opus-5");
});

test("profile names are lowercased and validated, never silently overwriting", () => {
  const prompted = enterRow(enterRow(withProfiles(), "profiles"), "new-profile");

  const upper = submitText({ ...prompted }, "QA");
  assert.ok("qa" in upper.edits.profiles, "uppercase is folded down");

  const dupe = submitText({ ...prompted }, "premium");
  assert.match(dupe.notice!, /ya existe/);
  assert.equal(dupe.edits.profiles.premium.models.plan, "claude-opus-5", "untouched");

  const bad = submitText({ ...prompted }, "dos palabras");
  assert.match(bad.notice!, /inválido/);
  assert.equal("dos palabras" in bad.edits.profiles, false);
});

test("an empty name aborts profile creation", () => {
  const prompted = enterRow(enterRow(withProfiles(), "profiles"), "new-profile");
  const aborted = submitText(prompted, "   ");
  assert.equal(aborted.textPrompt, null);
  assert.deepEqual(Object.keys(aborted.edits.profiles).sort(), ["barato", "premium"]);
});

test("duplicating clones the chosen profile under a new name", () => {
  const prompted = enterRow(
    enterValue(enterRow(withProfiles(), "profiles"), "barato"),
    "profile-duplicate",
  );
  assert.equal(prompted.textPrompt?.for, "duplicate-profile");

  const done = submitText(prompted, "barato2");
  assert.equal(done.screen, "profiles");
  assert.equal(done.edits.profiles.barato2.models.plan, "gpt-5.6-luna", "clone of barato");
  assert.equal(done.edits.editingProfile, null, "duplicating does not open it");
  assert.equal(done.edits.activeProfile, "premium");
});

test("deleting a profile removes it and never touches the models in use", () => {
  const deleted = enterRow(
    enterValue(enterRow(withProfiles(), "profiles"), "barato"),
    "profile-delete",
  );
  assert.deepEqual(Object.keys(deleted.edits.profiles), ["premium"]);
  assert.equal(deleted.edits.activeProfile, "premium");
  assert.equal(deleted.edits.models.plan, "claude-opus-4-7", "live maps untouched");
  assert.equal(deleted.screen, "profiles");
});

test("deleting the active profile leaves the run with no active profile", () => {
  const deleted = enterRow(
    enterValue(enterRow(withProfiles(), "profiles"), "premium"),
    "profile-delete",
  );
  assert.equal(deleted.edits.activeProfile, null);
  assert.deepEqual(Object.keys(deleted.edits.profiles), ["barato"]);
});

test("esc from the actions screen goes back to the listing, not to main", () => {
  const actions = enterValue(enterRow(withProfiles(), "profiles"), "barato");
  const result = back(actions);
  assert.equal(result.type, "state");
  const state = (result as { type: "state"; state: PickerState }).state;
  assert.equal(state.screen, "profiles");
  assert.equal(state.drillProfile, null);
});

test("esc from the listing returns to the phase screen", () => {
  const listing = enterRow(withProfiles(), "profiles");
  const result = back(listing);
  assert.equal(result.type, "state");
  assert.equal((result as { type: "state"; state: PickerState }).state.screen, "main");
});

test("saving stages the profile map so the caller can persist it", () => {
  const state = enterRow(
    enterValue(enterRow(withProfiles(), "profiles"), "barato"),
    "profile-use",
  );
  const result = enter({ ...state, screen: "main", entries: rebuildEntries({ ...state, screen: "main" }).entries, cursor: rebuildEntries({ ...state, screen: "main" }).entries.findIndex((e) => e.kind === "save") });
  assert.equal(result.type, "save");
  const edits = (result as { type: "save"; state: PickerState }).state.edits;
  assert.equal(edits.activeProfile, "barato");
  assert.deepEqual(Object.keys(edits.profiles).sort(), ["barato", "premium"]);
});

test("the staged profile map never aliases the caller's objects", () => {
  const original = makeProfiles();
  const state = makeState({ profiles: original, activeProfile: "premium" });
  state.edits.profiles.premium.models.plan = "mutado";
  assert.equal(original.premium.models.plan, "claude-opus-5", "caller object intact");
});
