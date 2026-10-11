import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  accountFor,
  accountsFromAuthFiles,
  CPAM_ROTATING,
  isWorkAccount,
  shortAccount,
  accountTag,
  type CpamAuthFile,
  withAccount,
} from "./cpam-accounts.ts";
import { authDirFromConfig, readAuthFiles } from "./cpam-auth-files.ts";

test("shortAccount keeps only the local part of a gmail address", () => {
  assert.equal(shortAccount("gonzalonicolas.dev@gmail.com"), "gonzalonicolas.dev");
  assert.equal(shortAccount("gonn.nicolas@googlemail.com"), "gonn.nicolas");
});

test("shortAccount drops the TLD of any other domain", () => {
  assert.equal(shortAccount("grocca@wibond.co"), "grocca@wibond");
  assert.equal(shortAccount("ana@estudio.com.ar"), "ana@estudio");
  assert.equal(shortAccount("x@mail.empresa.com"), "x@mail.empresa");
});

test("shortAccount returns malformed input untouched", () => {
  assert.equal(shortAccount("sin-arroba"), "sin-arroba");
  assert.equal(shortAccount("@gmail.com"), "@gmail.com");
});

test("isWorkAccount flags only the prefixes of non-personal mailboxes", () => {
  accountsFromAuthFiles(FILES);
  assert.equal(isWorkAccount("wibond"), true);
  assert.equal(isWorkAccount("ag3"), false);
  assert.equal(isWorkAccount("grocca@wibond"), false);
  assert.equal(isWorkAccount(CPAM_ROTATING), false);
  assert.equal(isWorkAccount(undefined), false);
});

const FILES: CpamAuthFile[] = [
  { type: "antigravity", prefix: "ag", email: "gonn.nicolas@gmail.com", disabled: false },
  { type: "antigravity", prefix: "ag3", email: "gonzalonicolas.dev@gmail.com" },
  { type: "antigravity", email: "otra@gmail.com" },
  { type: "claude", prefix: "wibond", email: "grocca@wibond.co" },
  { type: "codex", prefix: "prolite", email: "gonn.nicolas@gmail.com" },
  { type: "claude", prefix: "viejo", email: "viejo@gmail.com", disabled: true },
  { type: "opencode", prefix: "sinmail" },
];

test("accountsFromAuthFiles maps each enabled prefix to itself", () => {
  assert.deepEqual(accountsFromAuthFiles(FILES), {
    ag: "ag",
    ag3: "ag3",
    wibond: "wibond",
    prolite: "prolite",
  });
});

test("accountsFromAuthFiles keeps the first file for a repeated prefix", () => {
  assert.deepEqual(
    accountsFromAuthFiles([
      { prefix: "ag", email: "a@gmail.com" },
      { prefix: "ag", email: "b@gmail.com" },
    ]),
    { ag: "ag" },
  );
});

const ACCOUNTS = accountsFromAuthFiles(FILES);

test("accountFor resolves a prefixed cliproxy model to its account", () => {
  assert.equal(accountFor("wibond/claude-sonnet-5-5", ACCOUNTS, "cliproxy"), "wibond");
  assert.equal(accountFor("ag3/gemini-3.8-flash-high", ACCOUNTS, "cliproxy"), "ag3");
  assert.equal(accountFor("cliproxy/prolite/gpt-6-sol", ACCOUNTS), "prolite");
  assert.equal(accountFor("cliproxy/prolite/gpt-6-sol", ACCOUNTS, "cliproxy"), "prolite");
});

test("accountFor reports rotation for an unprefixed cliproxy model", () => {
  assert.equal(accountFor("claude-opus-5", ACCOUNTS, "cliproxy"), CPAM_ROTATING);
  assert.equal(accountFor("cliproxy/gpt-5.6-luna", ACCOUNTS), CPAM_ROTATING);
});

test("accountFor recognises a known CPAM prefix even without the provider", () => {
  assert.equal(accountFor("wibond/claude-sonnet-5-5", ACCOUNTS), "wibond");
  assert.equal(accountFor("prolite/gpt-6-sol", ACCOUNTS), "prolite");
  assert.equal(accountFor("ds/deepseek-flash", ACCOUNTS), undefined);
  assert.equal(accountFor("claude-opus-5", ACCOUNTS), undefined);
});

test("accountFor falls back to the prefix itself when no auth file owns it", () => {
  assert.equal(accountFor("ds/deepseek-flash", ACCOUNTS, "cliproxy"), "ds");
  assert.equal(accountFor("cliproxy/xpl/modelo", {}), "xpl");
});

test("accountFor ignores models that do not go through CPAM", () => {
  assert.equal(accountFor("claude-opus-4-7", ACCOUNTS, "anthropic"), undefined);
  assert.equal(accountFor("anthropic/claude-opus-4-7", ACCOUNTS), undefined);
  assert.equal(accountFor(undefined, ACCOUNTS, "cliproxy"), undefined);
  assert.equal(accountFor("", ACCOUNTS, "cliproxy"), undefined);
});

test("withAccount appends the account only when there is one", () => {
  assert.equal(withAccount("claude-sonnet-5-5", "wibond"), "claude-sonnet-5-5 · wibond");
  assert.equal(withAccount("wibond/claude-sonnet-5-5", "wibond"), "wibond/claude-sonnet-5-5");
  assert.equal(withAccount("cliproxy/ag3/gemini-3.8-flash-high", "ag3"), "cliproxy/ag3/gemini-3.8-flash-high");
  assert.equal(withAccount("claude-opus-4-7", undefined), "claude-opus-4-7");
});

test("authDirFromConfig reads the auth-dir key", () => {
  assert.equal(authDirFromConfig('port: 8317\nauth-dir: "/srv/cpam"\n'), "/srv/cpam");
  assert.equal(authDirFromConfig("auth-dir: /srv/x # comentario\n"), "/srv/x");
  assert.equal(authDirFromConfig("port: 8317\n"), undefined);
});

test("readAuthFiles exposes only type, prefix, email and disabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "cpam-"));
  try {
    writeFileSync(
      join(dir, "claude-a.json"),
      JSON.stringify({ type: "claude", prefix: "wibond", email: "grocca@wibond.co", access_token: "secreto" }),
    );
    writeFileSync(join(dir, "roto.json"), "{no es json");
    writeFileSync(join(dir, "notas.txt"), "x");
    assert.deepEqual(readAuthFiles(dir), [
      { type: "claude", prefix: "wibond", email: "grocca@wibond.co", disabled: undefined },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readAuthFiles returns nothing for a missing directory", () => {
  assert.deepEqual(readAuthFiles(join(tmpdir(), "cpam-no-existe-xyz")), []);
});

test("accountTag skips a personal prefix already in the text but always keeps the work one", () => {
  accountsFromAuthFiles(FILES);
  assert.equal(accountTag("build → ag3/gemini-3.8-flash-high", "ag3"), undefined);
  assert.equal(accountTag("build → claude-opus-5", "cpam"), "cpam");
  assert.equal(accountTag("build → wibond/claude-sonnet-5-5", "wibond"), "wibond");
  assert.equal(accountTag("x", undefined), undefined);
});
