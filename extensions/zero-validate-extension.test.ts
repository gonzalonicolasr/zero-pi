import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import register from "./zero-validate-extension.ts";

function fixture(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "zero-validate-"));
  const old = process.cwd();
  process.chdir(dir);
  try { fn(dir); } finally { process.chdir(old); rmSync(dir, { recursive: true, force: true }); }
}
function command() { let handler: any; register({ registerCommand(_n, opts) { handler = opts.handler; } } as any); const notes: any[] = []; return { handler, notes, ctx: { ui: { notify: (m: string, t?: string) => notes.push([m, t]) } } }; }
function goodRun(slug: string) { mkdirSync(join(".sdd", slug), { recursive: true }); writeFileSync(join(".sdd", slug, "proposal.md"), "p"); writeFileSync(join(".sdd", slug, "design.md"), "d"); writeFileSync(join(".sdd", slug, "spec.md"), "## ADDED\n\n### REQ: a\n\nBody\n\nAcceptance criteria:\n- ok"); writeFileSync(join(".sdd", slug, "tasks.md"), "- [ ] **T1. A** — x\n      - files: `a.ts`\n      - review: ~1 changed lines\n\n## Review Workload\n\n| Task | Estimate |\n| ---- | -------- |\n| T1 | ~1 |\n\n**Total: ~1 changed lines**\n"); }

test("/zero-validate reports clean run", () => fixture(() => { goodRun("ok"); const c = command(); c.handler("ok", c.ctx); assert.equal(c.notes[0][1], "info"); assert.match(c.notes[0][0], /está limpio/); }));
test("/zero-validate reports optional missing proposal as warning", () => fixture(() => { goodRun("warn"); rmSync(join(".sdd", "warn", "proposal.md")); const c = command(); c.handler("warn", c.ctx); assert.equal(c.notes[0][1], "warning"); }));
test("/zero-validate reports structural defects as error", () => fixture(() => { goodRun("bad"); writeFileSync(join(".sdd", "bad", "tasks.md"), "- [ ] **T1. Bad** — x\n"); const c = command(); c.handler("bad", c.ctx); assert.equal(c.notes[0][1], "error"); assert.match(c.notes[0][0], /defectos estructurales/); }));
