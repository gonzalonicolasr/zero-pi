// Unit tests for the canonical spec store delta-merge engine.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkGuardrails,
  isEmptyDelta,
  mergeDelta,
  parseDelta,
  parseStore,
  renderStore,
  STORE_TITLE,
  type MergeError,
  type RequirementBlock,
  type SpecDelta,
} from "./spec-merge.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Build a requirement block. */
function block(name: string, body = `Body of ${name}.`): RequirementBlock {
  return { name, body };
}

/** Build a delta, defaulting every bucket to empty. */
function delta(over: Partial<SpecDelta> = {}): SpecDelta {
  return { added: [], modified: [], removed: [], renamed: [], ...over };
}

/** Render a single requirement block to its `### REQ:` markdown form. */
function reqMarkdown(name: string, body: string): string {
  return `### REQ: ${name}\n\n${body}\n`;
}

/** Render a store markdown document from name/body pairs. */
function storeMarkdown(...pairs: Array<[string, string]>): string {
  return `# ${STORE_TITLE}\n\n${pairs.map(([n, b]) => reqMarkdown(n, b)).join("\n")}`;
}

/** The error kinds present in a `MergeError[]`. */
function kinds(errors: MergeError[]): string[] {
  return errors.map((e) => e.kind);
}

// ---------------------------------------------------------------------------
// parseStore
// ---------------------------------------------------------------------------

test("parseStore: empty / missing text yields []", () => {
  assert.deepEqual(parseStore(""), []);
  assert.deepEqual(parseStore("   \n  \n"), []);
  assert.deepEqual(parseStore(undefined as unknown as string), []);
  assert.deepEqual(parseStore(null as unknown as string), []);
});

test("parseStore: well-formed store parses ordered blocks with trimmed bodies", () => {
  const text = storeMarkdown(
    ["auth", "Users can log in.\n\nAcceptance criteria:\n\n- WHEN valid creds THEN session"],
    ["billing", "Users can pay."],
  );
  const blocks = parseStore(text);
  assert.equal(blocks.length, 2);
  assert.deepEqual(
    blocks.map((b) => b.name),
    ["auth", "billing"],
  );
  assert.ok(blocks[0].body.startsWith("Users can log in."));
  assert.ok(blocks[0].body.includes("Acceptance criteria:"));
  assert.equal(blocks[1].body, "Users can pay.");
});

test("parseStore: title and pre-header lines are ignored", () => {
  const text = "# Canonical specs\n\nsome preamble text\n\n### REQ: only\n\nbody";
  const blocks = parseStore(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].name, "only");
  assert.equal(blocks[0].body, "body");
});

test("parseStore: header name is trimmed; whitespace inside a name is kept", () => {
  const blocks = parseStore("# T\n\n###   REQ:   multi word name   \n\nbody");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].name, "multi word name");
});

test("parseStore: malformed input does not throw — empty-name block is surfaced as a block", () => {
  const blocks = parseStore("# T\n\n### REQ:\n\nbody with no name");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].name, "");
});

test("parseStore: tolerates CRLF line endings", () => {
  const blocks = parseStore("# T\r\n\r\n### REQ: a\r\n\r\nbody a\r\n");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].name, "a");
  assert.equal(blocks[0].body, "body a");
});

// ---------------------------------------------------------------------------
// parseDelta
// ---------------------------------------------------------------------------

test("parseDelta: empty / missing text yields an empty delta", () => {
  assert.deepEqual(parseDelta(""), delta());
  assert.deepEqual(parseDelta(undefined as unknown as string), delta());
  assert.ok(isEmptyDelta(parseDelta("")));
});

test("parseDelta: absent sections yield empty buckets (ADDED-only delta)", () => {
  const d = parseDelta("# Spec delta\n\n## ADDED\n\n### REQ: new-one\n\nbody");
  assert.equal(d.added.length, 1);
  assert.equal(d.added[0].name, "new-one");
  assert.equal(d.modified.length, 0);
  assert.equal(d.removed.length, 0);
  assert.equal(d.renamed.length, 0);
});

test("parseDelta: all three sections parse into their buckets", () => {
  const text = [
    "# Spec delta",
    "",
    "## ADDED",
    "",
    "### REQ: a",
    "",
    "body a",
    "",
    "## MODIFIED",
    "",
    "### REQ: b",
    "",
    "new body b",
    "",
    "## REMOVED",
    "",
    "### REQ: c",
  ].join("\n");
  const d = parseDelta(text);
  assert.deepEqual(
    d.added.map((b) => b.name),
    ["a"],
  );
  assert.deepEqual(
    d.modified.map((b) => b.name),
    ["b"],
  );
  assert.deepEqual(
    d.removed.map((b) => b.name),
    ["c"],
  );
  assert.equal(d.modified[0].body, "new body b");
});

test("parseDelta: section headers are case-insensitive", () => {
  const d = parseDelta("## added\n\n### REQ: x\n\nbody");
  assert.equal(d.added.length, 1);
  assert.equal(d.added[0].name, "x");
});

test("parseDelta: a REMOVED block needs only the name line", () => {
  const d = parseDelta("## REMOVED\n\n### REQ: gone");
  assert.equal(d.removed.length, 1);
  assert.equal(d.removed[0].name, "gone");
  assert.equal(d.removed[0].body, "");
});

test("parseDelta: a block before any section header is dropped", () => {
  const d = parseDelta("# Spec delta\n\n### REQ: orphan\n\nbody");
  assert.ok(isEmptyDelta(d));
});

test("parseDelta: malformed delta does not throw — empty-name block surfaces", () => {
  const d = parseDelta("## ADDED\n\n### REQ:\n\nbody");
  assert.equal(d.added.length, 1);
  assert.equal(d.added[0].name, "");
});

// ---------------------------------------------------------------------------
// RENAMED
// ---------------------------------------------------------------------------

test("parseDelta: RENAMED recognises from line and is case-insensitive", () => {
  const d = parseDelta("## renamed\n\n### REQ: new-name\n\nfrom: old-name\n\nNew body");
  assert.equal(d.renamed.length, 1);
  assert.deepEqual(d.renamed[0], { from: "old-name", to: "new-name", body: "New body" });
});

test("checkGuardrails: RENAMED guardrail kinds surface", () => {
  assert.deepEqual(kinds(checkGuardrails([block("a")], delta({ renamed: [{ from: "ghost", to: "b", body: "body" }] }))), ["renamed-missing"]);
  assert.deepEqual(kinds(checkGuardrails([block("a"), block("b")], delta({ renamed: [{ from: "a", to: "b", body: "body" }] }))), ["renamed-to-collision"]);
  assert.deepEqual(kinds(checkGuardrails([block("a")], delta({ added: [block("b")], renamed: [{ from: "a", to: "b", body: "body" }] }))), ["renamed-duplicate"]);
  assert.deepEqual(kinds(checkGuardrails([block("a")], delta({ renamed: [{ from: "", to: "b", body: "body" }] }))), ["renamed-parse-error"]);
});

test("mergeDelta: RENAMED preserves store position and summary", () => {
  const store = storeMarkdown(["a", "body a"], ["c", "body c"]);
  const result = mergeDelta(store, "## RENAMED\n\n### REQ: b\n\nfrom: a\n\nbody b");
  assert.equal(result.ok, true);
  if (result.ok) {
    const blocks = parseStore(result.store);
    assert.deepEqual(blocks.map((b) => b.name), ["b", "c"]);
    assert.equal(blocks[0].body, "body b");
    assert.deepEqual(result.summary.renamed, [{ from: "a", to: "b" }]);
  }
});

test("mergeDelta: RENAMED without body preserves original body", () => {
  const store = storeMarkdown(["foo", "original body"], ["next", "next body"]);
  const result = mergeDelta(store, "## RENAMED\n\n### REQ: bar\n\nfrom: foo");
  assert.equal(result.ok, true);
  if (result.ok) {
    const blocks = parseStore(result.store);
    assert.deepEqual(blocks.map((b) => b.name), ["bar", "next"]);
    assert.equal(blocks[0].body, "original body");
  }
});

test("mergeDelta: RENAMED then MODIFIED target succeeds", () => {
  const store = storeMarkdown(["foo", "old"], ["next", "next body"]);
  const deltaText = "## RENAMED\n\n### REQ: bar\n\nfrom: foo\n\nrename body\n\n## MODIFIED\n\n### REQ: bar\n\nmodified body";
  const result = mergeDelta(store, deltaText);
  assert.equal(result.ok, true);
  if (result.ok) {
    const blocks = parseStore(result.store);
    assert.deepEqual(blocks.map((b) => b.name), ["bar", "next"]);
    assert.equal(blocks[0].body, "modified body");
  }
});

test("isEmptyDelta: RENAMED-only delta is not empty", () => {
  assert.equal(isEmptyDelta(parseDelta("## RENAMED\n\n### REQ: b\n\nfrom: a\n\nbody")), false);
  assert.equal(isEmptyDelta(delta()), true);
});

test("renderStore: round-trips after a merged rename", () => {
  const result = mergeDelta(storeMarkdown(["old", "old body"]), "## RENAMED\n\n### REQ: new\n\nfrom: old\n\nnew body");
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(parseStore(renderStore(parseStore(result.store))), parseStore(result.store));
});

// ---------------------------------------------------------------------------
// renderStore / round-trip
// ---------------------------------------------------------------------------

test("renderStore: empty store is just the pinned title", () => {
  assert.equal(renderStore([]), `# ${STORE_TITLE}\n`);
});

test("renderStore: pins a stable `# ` title and ends with one newline", () => {
  const out = renderStore([block("a", "body a")]);
  assert.ok(out.startsWith(`# ${STORE_TITLE}\n`));
  assert.ok(out.endsWith("\n"));
  assert.ok(!out.endsWith("\n\n"));
});

test("renderStore: a custom title is honored", () => {
  assert.ok(renderStore([], "My specs").startsWith("# My specs\n"));
});

test("renderStore ↔ parseStore round-trip preserves names and trimmed bodies", () => {
  const blocks = [
    block("auth", "Users log in.\n\nAcceptance criteria:\n\n- crit one"),
    block("billing", "Users pay."),
    block("empty-body", ""),
  ];
  const reparsed = parseStore(renderStore(blocks));
  assert.deepEqual(
    reparsed.map((b) => b.name),
    blocks.map((b) => b.name),
  );
  assert.deepEqual(
    reparsed.map((b) => b.body),
    blocks.map((b) => b.body.trim()),
  );
});

// ---------------------------------------------------------------------------
// checkGuardrails
// ---------------------------------------------------------------------------

test("checkGuardrails: clean store + delta yields []", () => {
  const store = [block("a"), block("b")];
  const d = delta({ added: [block("c")], modified: [block("a", "new a")], removed: [block("b")] });
  assert.deepEqual(checkGuardrails(store, d), []);
});

test("checkGuardrails: clean empty store + ADDED-only delta yields []", () => {
  assert.deepEqual(checkGuardrails([], delta({ added: [block("x")] })), []);
});

test("checkGuardrails: duplicate-in-delta — same name across sections", () => {
  const d = delta({ added: [block("dup")], removed: [block("dup")] });
  const errors = checkGuardrails([block("dup")], d);
  // Note: this fixture also collides ADDED with the store; assert the dup is flagged.
  assert.ok(kinds(errors).includes("duplicate-in-delta"));
  const dupErr = errors.find((e) => e.kind === "duplicate-in-delta");
  assert.equal(dupErr?.name, "dup");
  assert.ok(dupErr && dupErr.message.includes("dup"));
});

test("checkGuardrails: duplicate-in-delta — same name twice within ADDED, reported once", () => {
  const d = delta({ added: [block("twice"), block("twice")] });
  const errors = checkGuardrails([], d);
  const dups = errors.filter((e) => e.kind === "duplicate-in-delta");
  assert.equal(dups.length, 1);
  assert.equal(dups[0].name, "twice");
});

test("checkGuardrails: added-name-collision — ADDED name already in store", () => {
  const errors = checkGuardrails([block("exists")], delta({ added: [block("exists")] }));
  assert.deepEqual(kinds(errors), ["added-name-collision"]);
  assert.equal(errors[0].name, "exists");
});

test("checkGuardrails: modified-missing — MODIFIED names an absent block", () => {
  const errors = checkGuardrails([block("a")], delta({ modified: [block("ghost", "x")] }));
  assert.deepEqual(kinds(errors), ["modified-missing"]);
  assert.equal(errors[0].name, "ghost");
});

test("checkGuardrails: removed-missing — REMOVED names an absent block", () => {
  const errors = checkGuardrails([block("a")], delta({ removed: [block("ghost")] }));
  assert.deepEqual(kinds(errors), ["removed-missing"]);
  assert.equal(errors[0].name, "ghost");
});

test("checkGuardrails: parse-error — empty-name block in the store", () => {
  const errors = checkGuardrails([block("")], delta());
  assert.deepEqual(kinds(errors), ["parse-error"]);
  assert.equal(errors[0].name, "");
});

test("checkGuardrails: parse-error — empty-name block in the delta", () => {
  const errors = checkGuardrails([], delta({ added: [block("")] }));
  assert.ok(kinds(errors).includes("parse-error"));
});

test("checkGuardrails: every error carries a non-empty, surfaceable message", () => {
  const errors = checkGuardrails(
    [block("a")],
    delta({ added: [block("a")], modified: [block("ghost")], removed: [block("nope")] }),
  );
  assert.ok(errors.length >= 3);
  for (const e of errors) assert.ok(typeof e.message === "string" && e.message.length > 0);
});

// ---------------------------------------------------------------------------
// mergeDelta
// ---------------------------------------------------------------------------

test("mergeDelta: empty-store bootstrap — all-ADDED delta merges cleanly", () => {
  const deltaText = "## ADDED\n\n### REQ: first\n\nThe first requirement.";
  const result = mergeDelta("", deltaText);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.summary, { added: ["first"], modified: [], removed: [], renamed: [] });
    const reparsed = parseStore(result.store);
    assert.equal(reparsed.length, 1);
    assert.equal(reparsed[0].name, "first");
  }
});

test("mergeDelta: ADDED appends to the end of the store, in delta order", () => {
  const store = storeMarkdown(["existing", "kept body"]);
  const deltaText = "## ADDED\n\n### REQ: one\n\nbody one\n\n### REQ: two\n\nbody two";
  const result = mergeDelta(store, deltaText);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      parseStore(result.store).map((b) => b.name),
      ["existing", "one", "two"],
    );
  }
});

test("mergeDelta: MODIFIED replaces the matching block in place by name", () => {
  const store = storeMarkdown(["a", "old a"], ["b", "kept b"]);
  const deltaText = "## MODIFIED\n\n### REQ: a\n\nnew a body";
  const result = mergeDelta(store, deltaText);
  assert.equal(result.ok, true);
  if (result.ok) {
    const blocks = parseStore(result.store);
    assert.deepEqual(
      blocks.map((b) => b.name),
      ["a", "b"],
    );
    assert.equal(blocks[0].body, "new a body");
    assert.equal(blocks[1].body, "kept b");
    assert.deepEqual(result.summary.modified, ["a"]);
  }
});

test("mergeDelta: REMOVED deletes the matching block", () => {
  const store = storeMarkdown(["a", "body a"], ["b", "body b"]);
  const deltaText = "## REMOVED\n\n### REQ: a";
  const result = mergeDelta(store, deltaText);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      parseStore(result.store).map((b) => b.name),
      ["b"],
    );
    assert.deepEqual(result.summary.removed, ["a"]);
  }
});

test("mergeDelta: empty delta is ok with the store left structurally unchanged", () => {
  const store = storeMarkdown(["a", "body a"]);
  const result = mergeDelta(store, "# Spec delta\n\n## ADDED\n");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.summary, { added: [], modified: [], removed: [], renamed: [] });
    assert.deepEqual(
      parseStore(result.store).map((b) => b.name),
      ["a"],
    );
  }
});

test("mergeDelta: a guardrail error returns ok:false with NO store text", () => {
  const store = storeMarkdown(["a", "body a"]);
  const result = mergeDelta(store, "## MODIFIED\n\n### REQ: ghost\n\nx");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(kinds(result.errors), ["modified-missing"]);
    assert.ok(!("store" in result));
  }
});

test("mergeDelta: added-name-collision rejects the whole delta", () => {
  const store = storeMarkdown(["a", "body a"]);
  const result = mergeDelta(store, "## ADDED\n\n### REQ: a\n\nduplicate");
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(kinds(result.errors), ["added-name-collision"]);
});

test("mergeDelta: duplicate-name conflict rejects the whole delta", () => {
  const result = mergeDelta("", "## ADDED\n\n### REQ: dup\n\none\n\n### REQ: dup\n\ntwo");
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(kinds(result.errors), ["duplicate-in-delta"]);
});

test("mergeDelta: combined ADDED + MODIFIED + REMOVED applies all three", () => {
  const store = storeMarkdown(["keep", "keep body"], ["change", "old"], ["drop", "drop body"]);
  const deltaText = [
    "## ADDED",
    "",
    "### REQ: fresh",
    "",
    "fresh body",
    "",
    "## MODIFIED",
    "",
    "### REQ: change",
    "",
    "updated body",
    "",
    "## REMOVED",
    "",
    "### REQ: drop",
  ].join("\n");
  const result = mergeDelta(store, deltaText);
  assert.equal(result.ok, true);
  if (result.ok) {
    const blocks = parseStore(result.store);
    assert.deepEqual(
      blocks.map((b) => b.name),
      ["keep", "change", "fresh"],
    );
    assert.equal(blocks[1].body, "updated body");
    assert.deepEqual(result.summary, {
      added: ["fresh"],
      modified: ["change"],
      removed: ["drop"],
      renamed: [],
    });
  }
});

test("mergeDelta: a malformed store surfaces a parse-error and writes nothing", () => {
  const result = mergeDelta("# T\n\n### REQ:\n\nno name", "## ADDED\n\n### REQ: x\n\nbody");
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(kinds(result.errors).includes("parse-error"));
});

test("mergeDelta is deterministic — same inputs yield byte-identical store", () => {
  const store = storeMarkdown(["a", "body a"]);
  const deltaText = "## ADDED\n\n### REQ: b\n\nbody b";
  const first = mergeDelta(store, deltaText);
  const second = mergeDelta(store, deltaText);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) assert.equal(first.store, second.store);
});
