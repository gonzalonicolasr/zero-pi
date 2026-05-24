import { test } from "node:test";
import assert from "node:assert/strict";

import { buildStatus, formatGithubCell, latestVerdictBySlug, matchesArchiveEntry } from "./zero-status.ts";

test("matchesArchiveEntry: enforces dated slug shape with optional suffix", () => {
  assert.equal(matchesArchiveEntry("my-feature", "2026-05-23-my-feature"), true);
  assert.equal(matchesArchiveEntry("my-feature", "2026-05-23-my-feature-2"), true);
  assert.equal(matchesArchiveEntry("my-feature", "2026-5-23-my-feature"), false);
  assert.equal(matchesArchiveEntry("my-feature", "2026-05-23-other"), false);
});

test("latestVerdictBySlug: greatest ts wins per feature", () => {
  const map = latestVerdictBySlug([
    { feature: "a", ts: "2026-01-01T00:00:00Z", verdict: "cap-reached" },
    { feature: "a", ts: "2026-01-02T00:00:00Z", verdict: "pasa" },
    { feature: "b", ts: "2026-01-01T00:00:00Z", verdict: "pasa" },
  ] as any);
  assert.equal(map.get("a"), "pasa");
  assert.equal(map.get("b"), "pasa");
});

test("buildStatus: builds lexically ordered rows and excludes internal dirs", () => {
  const rows = buildStatus({
    sddDir: {
      zeta: ["proposal.md"],
      alpha: ["proposal.md", "spec.md", "design.md", "tasks.md"],
      specs: ["requirements.md"],
      archive: ["2026-05-23-alpha"],
    },
    archiveEntries: ["2026-05-23-alpha"],
    runRecords: [{ feature: "alpha", ts: "2026-05-23T00:00:00Z", verdict: "pasa" }] as any,
    linksBySlug: { alpha: { prNumber: 4, issueNumber: 7 } },
  });
  assert.deepEqual(rows.map((r) => r.slug), ["alpha", "zeta"]);
  assert.deepEqual(rows[0].artifacts, { proposal: true, spec: true, design: true, tasks: true });
  assert.equal(rows[0].synced, true);
  assert.equal(rows[0].lastVerdict, "pasa");
  assert.equal(rows[0].github, "#4 / issue #7");
  assert.equal(rows[1].synced, false);
  assert.equal(rows[1].lastVerdict, null);
  assert.equal(rows[1].github, "—");
});

test("formatGithubCell renders missing, PR-only, issue-only, and both", () => {
  assert.equal(formatGithubCell(undefined), "—");
  assert.equal(formatGithubCell({ prNumber: 1 }), "#1");
  assert.equal(formatGithubCell({ issueNumber: 2 }), "issue #2");
  assert.equal(formatGithubCell({ prNumber: 1, issueNumber: 2 }), "#1 / issue #2");
});
