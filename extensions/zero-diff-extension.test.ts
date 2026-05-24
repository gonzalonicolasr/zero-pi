import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import register from "./zero-diff-extension.ts";

function command() { let handler: any; register({ registerCommand(_n, opts) { handler = opts.handler; } } as any); const notes: any[] = []; return { handler, notes, ctx: { ui: { notify: (m: string, t?: string) => notes.push([m, t]) } } }; }
function fixture(fn: () => void) { const dir = mkdtempSync(join(tmpdir(), "zero-diff-")); const old = process.cwd(); process.chdir(dir); try { fn(); } finally { process.chdir(old); rmSync(dir, { recursive: true, force: true }); } }

test("/zero-diff reports empty delta without writes", () => fixture(() => { mkdirSync(join(".sdd", "run"), { recursive: true }); writeFileSync(join(".sdd", "run", "spec.md"), "# empty\n"); const c = command(); c.handler("run", c.ctx); assert.equal(c.notes[0][1], "info"); assert.match(c.notes[0][0], /delta vacío/); }));

test("/zero-diff reports guardrail errors", () => fixture(() => { mkdirSync(join(".sdd", "run"), { recursive: true }); writeFileSync(join(".sdd", "run", "spec.md"), "## MODIFIED\n\n### REQ: ghost\n\nx"); const c = command(); c.handler("run", c.ctx); assert.equal(c.notes[0][1], "error"); assert.match(c.notes[0][0], /guardrail/); }));

test("/zero-diff reports summary and does not create store", () => fixture(() => { mkdirSync(join(".sdd", "run"), { recursive: true }); writeFileSync(join(".sdd", "run", "spec.md"), "## ADDED\n\n### REQ: a\n\nbody"); const c = command(); c.handler("run", c.ctx); assert.equal(c.notes[0][1], "info"); assert.match(c.notes[0][0], /agregados:\s+a/); }));
