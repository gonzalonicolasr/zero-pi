import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runZeroCost } from "./zero-cost-extension.ts";

function ctx() {
  const notes: Array<[string, string | undefined]> = [];
  return { notes, ctx: { ui: { notify: (m: string, t?: string) => notes.push([m, t]) } } };
}

function fixture(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "zero-cost-ext-"));
  try { fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

function writeMeta(dir: string, over: Record<string, unknown> = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${over.runId ?? "abc"}_zero-build_0_meta.json`), JSON.stringify({
    runId: over.runId ?? "abc",
    agent: over.agent ?? "zero-build",
    task: over.task ?? "Feature\nSlug: local-feature\nProject root: /tmp/project",
    usage: over.usage ?? { input: 1000, output: 200, cacheRead: 3000, cacheWrite: 0, cost: 0.12, turns: 2 },
    model: over.model ?? "anthropic/claude-sonnet-5:high",
    durationMs: over.durationMs ?? 12000,
    toolCount: over.toolCount ?? 3,
    timestamp: over.timestamp ?? 123,
  }), "utf8");
}

test("/zero-cost reads project-local .pi-subagents artifacts from cwd ancestors", () => fixture((dir) => {
  const project = join(dir, "project");
  const nested = join(project, "packages", "app");
  mkdirSync(nested, { recursive: true });
  writeMeta(join(project, ".pi-subagents", "artifacts"), { task: "Slug: local-feature" });

  const c = ctx();
  runZeroCost("local-feature", c.ctx as any, { sessionsRoot: join(dir, "missing-sessions"), cwd: nested });

  assert.equal(c.notes[0]?.[1], "info");
  assert.match(c.notes[0]?.[0] ?? "", /zero-cost: local-feature/);
  assert.match(c.notes[0]?.[0] ?? "", /TOTAL/);
  assert.match(c.notes[0]?.[0] ?? "", /\$0\.12/);
}));

test("/zero-cost explains empty metadata instead of a dead-end message", () => fixture((dir) => {
  const c = ctx();
  runZeroCost("", c.ctx as any, { sessionsRoot: join(dir, "missing-sessions"), cwd: dir });

  assert.equal(c.notes[0]?.[1], "info");
  const out = c.notes[0]?.[0] ?? "";
  assert.match(out, /no encontré runs/);
  assert.match(out, /\.pi-subagents\/artifacts/);
  assert.match(out, /\/forge nativo/);
}));

test("/zero-cost explains slug misses when other metadata exists", () => fixture((dir) => {
  writeMeta(join(dir, ".pi-subagents", "artifacts"), { task: "Slug: other-feature" });

  const c = ctx();
  runZeroCost("missing-feature", c.ctx as any, { sessionsRoot: join(dir, "missing-sessions"), cwd: dir });

  const out = c.notes[0]?.[0] ?? "";
  assert.match(out, /missing-feature/);
  assert.match(out, /metadata de otros runs/);
  assert.match(out, /slug exacto/);
}));
