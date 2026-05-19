// Unit tests for the zero-pi Windows tree-kill extension.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldPatch, treeKillCommand, wrapKill, type KillableChild } from "./win-tree-kill.ts";

test("treeKillCommand targets the pid and its whole tree", () => {
  assert.equal(treeKillCommand(1234), "taskkill /pid 1234 /t /f");
});

test("shouldPatch is true only on win32", () => {
  assert.equal(shouldPatch("win32"), true);
  assert.equal(shouldPatch("darwin"), false);
  assert.equal(shouldPatch("linux"), false);
});

test("wrapKill replaces kill with a tree-kill that runs taskkill", () => {
  const commands: string[] = [];
  let originalCalled = false;
  const child: KillableChild = {
    pid: 4321,
    kill: () => {
      originalCalled = true;
      return true;
    },
  };
  wrapKill(child, (cmd) => commands.push(cmd));

  assert.equal(child.kill("SIGKILL"), true);
  assert.deepEqual(commands, ["taskkill /pid 4321 /t /f"]);
  assert.equal(originalCalled, false, "the tree-kill path does not call the original kill");
});

test("wrapKill falls back to the original kill when there is no pid", () => {
  let originalCalled = false;
  const child: KillableChild = {
    pid: undefined,
    kill: () => {
      originalCalled = true;
      return true;
    },
  };
  wrapKill(child, () => {
    throw new Error("exec must not run without a pid");
  });

  child.kill();
  assert.equal(originalCalled, true);
});

test("wrapKill falls back to the original kill when taskkill throws", () => {
  let originalCalled = false;
  const child: KillableChild = {
    pid: 99,
    kill: () => {
      originalCalled = true;
      return false;
    },
  };
  wrapKill(child, () => {
    throw new Error("taskkill unavailable");
  });

  child.kill();
  assert.equal(originalCalled, true, "a taskkill failure must not lose the kill");
});

test("wrapKill is idempotent — wrapping twice does not double the taskkill", () => {
  const commands: string[] = [];
  const child: KillableChild = { pid: 7, kill: () => true };
  wrapKill(child, (cmd) => commands.push(cmd));
  wrapKill(child, (cmd) => commands.push(cmd));

  child.kill();
  assert.deepEqual(commands, ["taskkill /pid 7 /t /f"], "kill runs taskkill exactly once");
});
