// Unit tests for the scan-guard pi wiring (handler + registration).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import register, { handleToolCall } from "./scan-guard-extension.ts";

// ---------------------------------------------------------------------------
// handleToolCall — blocks only guarded shell tools running a rooted scan
// ---------------------------------------------------------------------------

test("blocks a bash root-rooted find (input.command shape)", () => {
  const r = handleToolCall({ toolName: "bash", input: { command: "find / -iname x" } });
  assert.ok(r && r.block === true && typeof r.reason === "string");
});

test("blocks via the args.command shape too", () => {
  const r = handleToolCall({ toolName: "shell", args: { command: "rg foo ~" } });
  assert.ok(r && r.block === true);
});

test("allows a bash scoped find", () => {
  assert.equal(handleToolCall({ toolName: "bash", input: { command: "find /e/zero -name x" } }), undefined);
});

test("ignores non-shell tools even with a dangerous-looking command", () => {
  assert.equal(handleToolCall({ toolName: "read_file", input: { command: "find / -iname x" } }), undefined);
  assert.equal(handleToolCall({ toolName: "edit", args: { command: "find / x" } }), undefined);
});

test("ignores malformed events without throwing", () => {
  for (const e of [undefined, null, {}, { toolName: 42 }, { toolName: "bash" }, { toolName: "bash", input: {} }]) {
    assert.doesNotThrow(() => handleToolCall(e as never));
    assert.equal(handleToolCall(e as never), undefined);
  }
});

// ---------------------------------------------------------------------------
// register — wires tool_call, never throws on bad input
// ---------------------------------------------------------------------------

test("register hooks the tool_call event", () => {
  const events: string[] = [];
  register({ on: (e: string) => events.push(e) });
  assert.deepEqual(events, ["tool_call"]);
});

test("register no-ops on an invalid pi without throwing", () => {
  for (const pi of [undefined, null, {}, { on: 42 }]) {
    assert.doesNotThrow(() => register(pi as never));
  }
});
