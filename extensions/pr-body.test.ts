import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIssueBody, buildPrBody, extractAcceptanceCriteria, extractFirstParagraph, extractSectionByHeading, extractTasksTable } from "./pr-body.ts";

const artifacts = {
  proposalMd: "# Proposal\n\nShip GitHub links.\n\n## Alcance\n\nOnly PR and issue commands.",
  specMd: "## ADDED\n\n### REQ: github-links\n\nCreate PRs.\n\nAcceptance criteria:\n- PR body exists\n- Issue body exists\n\n### REQ: labels\n\nAcceptance criteria:\n- Missing labels are reported\n",
  tasksMd: "## [ ] T1 — Builder\n\n- files:\n  - `packages/zero-pi/extensions/pr-body.ts` (new)\n\n## [ ] T2 — No files\n\nNo file list.\n",
};

test("extract helpers tolerate normal markdown", () => {
  assert.equal(extractFirstParagraph(artifacts.proposalMd), "Ship GitHub links.");
  assert.match(extractSectionByHeading(artifacts.specMd, "ADDED"), /github-links/);
  assert.match(extractTasksTable(artifacts.tasksMd), /pr-body\.ts/);
  assert.doesNotMatch(extractTasksTable(artifacts.tasksMd), /No files|none listed/);
  assert.match(extractAcceptanceCriteria(artifacts.specMd), /Missing labels are reported/);
});

test("buildPrBody returns title and exact emoji sections in order", () => {
  const { title, body } = buildPrBody({ ...artifacts, verdictReasoning: "npm test" }, { issueNumber: 7 });
  assert.equal(title, "Ship GitHub links.");
  assert.match(body, /## 🔗 Linked Issue[\s\S]*## SDD artifacts[\s\S]*## Requirements[\s\S]*## 📝 Summary[\s\S]*## 📂 Changes[\s\S]*## 🧪 Test evidence[\s\S]*## Risks[\s\S]*## Verdict[\s\S]*## ✅ Checklist/);
  assert.doesNotMatch(body, /Requirements Delta|## Design|## Tasks|Acceptance Criteria/);
  assert.match(body, /Closes #7/);
});

test("buildPrBody emits fallback html comment without issue number", () => {
  assert.match(buildPrBody(artifacts).body, /Closes #\n<!--/);
});

test("buildIssueBody emits only Contexto, Alcance, and Criterios when present", () => {
  const { title, body } = buildIssueBody(artifacts);
  assert.equal(title, "Ship GitHub links.");
  assert.match(body, /## Contexto[\s\S]*## Alcance[\s\S]*## Criterios de aceptación/);
  assert.doesNotMatch(body, /Requirements|Design Notes|## Tasks/);
  assert.match(body, /PR body exists/);
});

test("missing sections and empty inputs produce deterministic placeholders", () => {
  assert.equal(extractSectionByHeading("# x", "MISSING"), "");
  assert.match(buildPrBody({}).body, /<!-- vacío -->/);
  assert.equal(extractTasksTable(""), "");
  assert.equal(buildIssueBody({ proposalMd: "# only heading", specMd: "not structured" }).body, "");
});
