import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import register from "./zero-status-extension.ts";

function command() { let handler: any; register({ registerCommand(_n, opts) { handler = opts.handler; } } as any); const notes: any[] = []; return { handler, notes, ctx: { ui: { notify: (m: string, t?: string) => notes.push([m, t]) } } }; }
function fixture(fn: () => void) { const dir = mkdtempSync(join(tmpdir(), "zero-status-")); const old = process.cwd(); process.chdir(dir); try { fn(); } finally { process.chdir(old); rmSync(dir, { recursive: true, force: true }); } }

test("/zero-status reports empty project", () => fixture(() => { mkdirSync(".sdd"); const c = command(); c.handler("", c.ctx); assert.equal(c.notes[0][1], "info"); assert.match(c.notes[0][0], /no encontré runs/); }));

test("/zero-status renders populated table with github links", () => fixture(() => { mkdirSync(join(".sdd", "alpha"), { recursive: true }); for (const f of ["proposal.md", "spec.md", "design.md", "tasks.md"]) writeFileSync(join(".sdd", "alpha", f), "x"); writeFileSync(join(".sdd", "alpha", "links.json"), JSON.stringify({ prNumber: 4, issueNumber: 7 })); mkdirSync(join(".sdd", "beta")); writeFileSync(join(".sdd", "beta", "proposal.md"), "x"); mkdirSync(join(".sdd", "archive")); writeFileSync(join(".sdd", "archive", "2026-05-23-alpha"), ""); const c = command(); c.handler("", c.ctx); assert.match(c.notes[0][0], /verdict\s+github/); assert.match(c.notes[0][0], /alpha\s+✓✓✓✓\s+synced\s+—\s+#4 \/ issue #7/); assert.match(c.notes[0][0], /beta\s+✓···\s+pending\s+—\s+—/); }));
