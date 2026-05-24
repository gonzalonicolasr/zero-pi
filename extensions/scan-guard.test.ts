// Unit tests for the filesystem-wide scan guard pure-logic module.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyShellCommand,
  isRootPath,
  splitSegments,
  blockReason,
  GUARDED_TOOLS,
} from "./scan-guard.ts";

// ---------------------------------------------------------------------------
// block — the real-world failure and its variants
// ---------------------------------------------------------------------------

test("blocks the exact command that wedged a pipeline for 6+ hours", () => {
  const cmd =
    'find / -maxdepth 12 -type d -iname "*admin-data-keys*" 2>/dev/null | head; ' +
    'echo "---"; find / -maxdepth 12 -type d -iname "*keys-audit*" 2>/dev/null | head';
  const d = classifyShellCommand(cmd);
  assert.equal(d.block, true);
  assert.ok(d.reason && d.reason.includes("scan-guard"));
});

test("blocks find rooted at common filesystem roots", () => {
  for (const root of ["/", "/c", "/e", "C:\\", "c:/", "~", "$HOME", "${HOME}", "%USERPROFILE%"]) {
    const d = classifyShellCommand(`find ${root} -name "*.ts"`);
    assert.equal(d.block, true, `find ${root} should block`);
  }
});

test("blocks find with a root path even when not the first operand", () => {
  assert.equal(classifyShellCommand("find /tmp / -name x").block, true);
});

test("blocks recursive grep and rg rooted at a filesystem root", () => {
  assert.equal(classifyShellCommand("grep -r needle /").block, true);
  assert.equal(classifyShellCommand("grep -rn needle ~").block, true);
  assert.equal(classifyShellCommand("grep --recursive needle /c").block, true);
  assert.equal(classifyShellCommand("rg foo /").block, true, "rg recurses by default");
  assert.equal(classifyShellCommand("rg foo C:\\").block, true);
});

test("blocks when the dangerous scan is one segment of a chain", () => {
  assert.equal(classifyShellCommand("cd /e/zero && find / -iname x").block, true);
  assert.equal(classifyShellCommand("ls; rg foo ~ ; echo done").block, true);
});

// ---------------------------------------------------------------------------
// allow — legitimate scoped work must never be blocked
// ---------------------------------------------------------------------------

test("allows scans scoped to a real subtree", () => {
  const allowed = [
    'find /e/zero/.sdd -name "*.md"',
    "find C:\\Users\\gonza\\proj -type f",
    "find /c/Users/gonza -name x",
    "rg foo src/",
    "grep -r needle ./lib",
    "find . -maxdepth 3 -name '*.ts'",
    "find ./ -name x",
  ];
  for (const cmd of allowed) {
    assert.equal(classifyShellCommand(cmd).block, false, `should allow: ${cmd}`);
  }
});

test("allows non-recursive grep even when a root appears as an argument", () => {
  // Plain grep over a file/stdin is bounded; only -r/-R/rg recurse.
  assert.equal(classifyShellCommand("grep needle /etc/hosts").block, false);
  assert.equal(classifyShellCommand("ls / | grep bin").block, false);
});

test("allows unrelated commands", () => {
  for (const cmd of ["npm test", "tsc --noEmit", "git status", "cat tasks.md", "ls -la /"]) {
    assert.equal(classifyShellCommand(cmd).block, false, `should allow: ${cmd}`);
  }
});

test("allows empty, whitespace, or non-string commands", () => {
  assert.equal(classifyShellCommand("").block, false);
  assert.equal(classifyShellCommand("   ").block, false);
  assert.equal(classifyShellCommand(undefined).block, false);
  assert.equal(classifyShellCommand(null).block, false);
  assert.equal(classifyShellCommand(42).block, false);
});

// ---------------------------------------------------------------------------
// isRootPath
// ---------------------------------------------------------------------------

test("isRootPath recognizes filesystem roots", () => {
  for (const t of ["/", "/c", "/E", "C:", "C:\\", "c:/", "~", "~/", "$HOME", "${HOME}", "%USERPROFILE%", "%HOMEPATH%"]) {
    assert.equal(isRootPath(t), true, `${t} is a root`);
  }
});

test("isRootPath rejects scoped paths", () => {
  for (const t of ["/e/zero", "/c/Users", "C:\\Users", "./src", ".", "src", "~/proj", "$HOME/x", "/usr/bin"]) {
    assert.equal(isRootPath(t), false, `${t} is not a root`);
  }
});

test("isRootPath tolerates surrounding quotes", () => {
  assert.equal(isRootPath('"/"'), true);
  assert.equal(isRootPath("'~'"), true);
});

// ---------------------------------------------------------------------------
// splitSegments
// ---------------------------------------------------------------------------

test("splitSegments breaks on ; && || | and newlines", () => {
  assert.deepEqual(splitSegments("a; b && c || d | e\nf"), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(splitSegments("  solo  "), ["solo"]);
  assert.deepEqual(splitSegments(""), []);
});

// ---------------------------------------------------------------------------
// blockReason
// ---------------------------------------------------------------------------

test("blockReason names the offending segment and points at the code root", () => {
  const r = blockReason("ls; find / -iname x");
  assert.ok(r.includes("find / -iname x"), "quotes the offending segment");
  assert.ok(r.includes("Code root") || r.includes("code root"), "points at the code root");
  assert.ok(r.includes("OneDrive"), "explains the Windows hang");
});

// ---------------------------------------------------------------------------
// GUARDED_TOOLS / total-ness
// ---------------------------------------------------------------------------

test("GUARDED_TOOLS covers the shell tool names", () => {
  assert.equal(GUARDED_TOOLS.has("bash"), true);
  assert.equal(GUARDED_TOOLS.has("shell"), true);
});

test("classifyShellCommand never throws across a fuzz matrix", () => {
  const cmds: unknown[] = ["find /", "", null, undefined, 0, {}, [], "find", "find -name x", "; ; ;", "find //"];
  for (const c of cmds) {
    assert.doesNotThrow(() => classifyShellCommand(c));
  }
});
