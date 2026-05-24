import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTasks, validateArtifactSet, validateSpecDelta, validateTasksFile } from "./zero-validate.ts";

const goodTasks = `# Tasks

- [ ] **T1. First** — do it.
      - files: \`a.ts\`,
        \`b.ts\` (new)
      - evidence: npm test -- a
      - review: ~10 changed lines

- [ ] **T2. Second** — do it.
      - files: \`c.ts\`
      - evidence: npm test -- b
      - review: ~20 changed lines

## Review Workload

| Task | Estimate |
| ---- | -------- |
| T1   | ~10      |
| T2   | ~20      |

**Total: ~30 changed lines**
`;

test("parseTasks: extracts tasks, files, new flags and workload", () => {
  const parsed = parseTasks(goodTasks);
  assert.equal(parsed.defects.length, 0);
  assert.equal(parsed.tasks.length, 2);
  assert.deepEqual(parsed.tasks[0].files, [{ path: "a.ts", isNew: false }, { path: "b.ts", isNew: true }]);
  assert.equal(parsed.tasks[0].review, 10);
  assert.equal(parsed.workload?.declaredTotal, 30);
  assert.equal(parsed.workload?.estimates.get("T2"), 20);
});

test("validateTasksFile: well-formed tasks are clean", () => {
  assert.deepEqual(validateTasksFile(goodTasks), []);
});

test("parseTasks: partially conformant task yields per-task defects", () => {
  const parsed = parseTasks("- [ ] **T1. Bad** — no metadata\n");
  assert.deepEqual(parsed.defects.map((d) => d.kind), ["missing-files", "missing-evidence", "missing-review"]);
});

test("validateTasksFile: detects non-integer review and missing workload", () => {
  const defects = validateTasksFile("- [ ] **T1. Bad** — x\n      - files: `a.ts`\n      - evidence: npm test\n      - review: many lines\n");
  assert.ok(defects.some((d) => d.kind === "non-integer-review"));
  assert.ok(defects.some((d) => d.kind === "missing-review-workload"));
});

test("validateTasksFile: total mismatch carries declared and computed totals", () => {
  const defects = validateTasksFile(goodTasks.replace("**Total: ~30 changed lines**", "**Total: ~31 changed lines**"));
  const mismatch = defects.find((d) => d.kind === "total-mismatch");
  assert.equal(mismatch?.declaredTotal, 31);
  assert.equal(mismatch?.computedTotal, 30);
});

test("validateSpecDelta: clean ADDED delta has no defects", () => {
  const text = "## ADDED\n\n### REQ: a\n\nBody.\n\nAcceptance criteria:\n- ok";
  assert.deepEqual(validateSpecDelta(text), []);
});

test("validateSpecDelta: detects empty body and missing Acceptance criteria", () => {
  const defects = validateSpecDelta("## ADDED\n\n### REQ: a\n\n");
  assert.ok(defects.some((d) => d.kind === "empty-body"));
  assert.ok(defects.some((d) => d.kind === "missing-acceptance-criteria"));
});

test("validateSpecDelta: surfaces RENAMED guardrails", () => {
  const defects = validateSpecDelta("## RENAMED\n\n### REQ: b\n\nfrom: a\n\nAcceptance criteria:\n- ok");
  assert.ok(defects.some((d) => d.kind === "renamed-missing"));
});

test("validateArtifactSet: reports all missing artifacts", () => {
  const defects = validateArtifactSet({ proposal: false, spec: true, design: false, tasks: true });
  assert.deepEqual(defects.map((d) => d.kind), ["missing-proposal", "missing-design"]);
});
