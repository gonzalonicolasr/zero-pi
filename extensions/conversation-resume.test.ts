// Unit tests for the zero-pi conversation resume extension.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import register, {
  buildConversationResume,
  contentToText,
  quoteShellArg,
  resumePath,
  writeConversationResume,
  type SessionEntryLike,
} from "./conversation-resume.ts";

const entries: SessionEntryLike[] = [
  {
    type: "message",
    timestamp: "2026-05-18T10:00:00.000Z",
    message: { role: "user", content: "hagamos el resume al cerrar pi" },
  },
  {
    type: "message",
    timestamp: "2026-05-18T10:01:00.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Voy a revisar la API de session_shutdown." },
        { type: "toolCall", name: "read", arguments: { path: "docs/extensions.md" } },
      ],
    },
  },
];

test("contentToText extracts text, tool calls, and image markers", () => {
  assert.equal(contentToText("hello"), "hello");
  assert.equal(
    contentToText([
      { type: "text", text: "A" },
      { type: "toolCall", name: "bash" },
      { type: "image", mimeType: "image/png" },
      { type: "thinking", thinking: "hidden" },
    ]),
    "A\n[tool call: bash]\n[image: image/png]",
  );
});

test("quoteShellArg produces a single-quoted restore argument", () => {
  assert.equal(quoteShellArg("C:\\Users\\me\\session.jsonl"), "'C:\\Users\\me\\session.jsonl'");
  assert.equal(quoteShellArg("C:\\it isn't\\session.jsonl"), "'C:\\it isn''t\\session.jsonl'");
});

test("buildConversationResume includes restore commands and conversation tail", () => {
  const text = buildConversationResume(entries, {
    cwd: "E:\\zero",
    generatedAt: new Date("2026-05-18T11:00:00.000Z"),
    sessionFile: "C:\\Users\\gonza\\.pi\\agent\\sessions\\session.jsonl",
    sessionId: "12345678-90ab-cdef-1234-567890abcdef",
    reason: "quit",
  });

  assert.ok(text.includes("pi --session 'C:\\Users\\gonza\\.pi\\agent\\sessions\\session.jsonl'"));
  assert.ok(text.includes("pi --session 12345678-90ab-cdef-1234-567890abcdef"));
  assert.ok(text.includes("pi --resume"));
  assert.ok(text.includes("hagamos el resume al cerrar pi"));
  assert.ok(text.includes("[tool call: read]"));
  assert.ok(text.includes("Shutdown reason: quit"));
});

test("writeConversationResume writes .pi/zero-resume.md and protects it with gitignore", () => {
  const cwd = mkdtempSync(join(tmpdir(), "zero-pi-resume-"));
  try {
    const written = writeConversationResume(cwd, entries, {
      cwd,
      generatedAt: new Date("2026-05-18T11:00:00.000Z"),
      sessionId: "abcdef",
    });

    assert.equal(written, resumePath(cwd));
    assert.ok(existsSync(written));
    assert.equal(readFileSync(join(cwd, ".pi", ".gitignore"), "utf8"), "*\n!.gitignore\n");
    assert.ok(readFileSync(written, "utf8").includes("pi --session abcdef"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("register writes on quit and exposes /zero-resume", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "zero-pi-resume-register-"));
  try {
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void> | void>();
    let command:
      | {
          handler: (args: string, ctx: unknown) => Promise<void> | void;
        }
      | undefined;

    register({
      on(event, handler) {
        handlers.set(event, handler as (event: unknown, ctx: unknown) => Promise<void> | void);
      },
      registerCommand(name, options) {
        if (name === "zero-resume") command = options;
      },
    });

    const notifications: string[] = [];
    const ctx = {
      cwd,
      ui: { notify: (message: string) => notifications.push(message) },
      sessionManager: {
        getBranch: () => entries,
        getSessionFile: () => join(cwd, "session.jsonl"),
        getSessionId: () => "feedface",
      },
    };

    await handlers.get("session_shutdown")?.({ reason: "reload" }, ctx);
    assert.equal(existsSync(resumePath(cwd)), false);

    await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
    assert.ok(readFileSync(resumePath(cwd), "utf8").includes("pi --session feedface"));

    assert.ok(command);
    await command?.handler("", ctx);
    assert.ok(notifications.some((n) => n.includes("restore: pi --session")));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
