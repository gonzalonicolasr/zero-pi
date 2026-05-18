// zero-pi - conversation resume on shutdown.
//
// Pi already persists the full session in ~/.pi/agent/sessions. This extension
// leaves a small project-local handoff note when the user quits pi, with the
// exact command needed to restore that session plus a concise conversation tail.
//
// It intentionally avoids model calls during shutdown: quitting should stay
// fast and reliable, even offline or without an API key.

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RESUME_DIR = ".pi";
const RESUME_FILE = "zero-resume.md";
const DEFAULT_MAX_ITEMS = 12;
const DEFAULT_MAX_CHARS = 1200;

type NotifyType = "info" | "warning" | "error";

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
  mimeType?: string;
}

interface MessageLike {
  role?: string;
  content?: unknown;
  command?: string;
  output?: string;
  summary?: string;
  timestamp?: number;
  customType?: string;
}

export interface SessionEntryLike {
  type?: string;
  id?: string;
  timestamp?: string;
  message?: MessageLike;
  summary?: string;
  tokensBefore?: number;
}

export interface ResumeMetadata {
  cwd?: string;
  generatedAt?: Date;
  maxChars?: number;
  maxItems?: number;
  reason?: string;
  sessionFile?: string;
  sessionId?: string;
}

export interface ResumeItem {
  label: string;
  text: string;
  timestamp?: string;
}

interface PiUI {
  notify?(message: string, type?: NotifyType): void;
}

interface PiSessionManager {
  getBranch?(): SessionEntryLike[];
  getSessionFile?(): string | undefined;
  getSessionId?(): string | undefined;
}

interface PiContext {
  cwd?: string;
  hasUI?: boolean;
  ui?: PiUI;
  sessionManager?: PiSessionManager;
}

interface PiCommandContext extends PiContext {}

interface PiAPI {
  on?(event: string, handler: (event: unknown, ctx: PiContext) => Promise<void> | void): void;
  registerCommand?(
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: PiCommandContext) => Promise<void> | void;
    },
  ): void;
}

/** Convert a shell argument into a single-quoted literal for PowerShell/sh. */
export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** The project-local resume path. */
export function resumePath(cwd: string): string {
  return join(cwd, RESUME_DIR, RESUME_FILE);
}

/** Extract readable text from pi message content blocks. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as ContentBlock;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
      continue;
    }
    if (block.type === "toolCall" && typeof block.name === "string") {
      parts.push(`[tool call: ${block.name}]`);
      continue;
    }
    if (block.type === "image") {
      parts.push(`[image${block.mimeType ? `: ${block.mimeType}` : ""}]`);
    }
  }
  return parts.join("\n").trim();
}

function collapseWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function truncateText(text: string, maxChars: number): string {
  const clean = collapseWhitespace(text);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 15)).trimEnd()}\n...[truncated]`;
}

function timestampFromMessage(entry: SessionEntryLike): string | undefined {
  if (entry.timestamp) return entry.timestamp;
  const ts = entry.message?.timestamp;
  return typeof ts === "number" ? new Date(ts).toISOString() : undefined;
}

function entryToResumeItem(entry: SessionEntryLike, maxChars: number): ResumeItem | null {
  if (entry.type === "compaction" && typeof entry.summary === "string") {
    return {
      label: "Compaction",
      text: truncateText(entry.summary, maxChars),
      timestamp: entry.timestamp,
    };
  }

  if (entry.type === "branch_summary" && typeof entry.summary === "string") {
    return {
      label: "Branch summary",
      text: truncateText(entry.summary, maxChars),
      timestamp: entry.timestamp,
    };
  }

  if (entry.type !== "message" || !entry.message) return null;
  const message = entry.message;
  const role = message.role ?? "message";

  if (role === "toolResult") return null;

  if (role === "bashExecution") {
    const command = typeof message.command === "string" ? message.command : "";
    const output = typeof message.output === "string" ? message.output : "";
    const text = [`$ ${command}`, output].filter(Boolean).join("\n");
    return text
      ? { label: "Shell", text: truncateText(text, maxChars), timestamp: timestampFromMessage(entry) }
      : null;
  }

  if (role === "compactionSummary" && typeof message.summary === "string") {
    return {
      label: "Compaction",
      text: truncateText(message.summary, maxChars),
      timestamp: timestampFromMessage(entry),
    };
  }

  const text = contentToText(message.content);
  if (!text) return null;

  const label =
    role === "user"
      ? "User"
      : role === "assistant"
        ? "Assistant"
        : role === "custom"
          ? `Custom${message.customType ? ` (${message.customType})` : ""}`
          : role;

  return { label, text: truncateText(text, maxChars), timestamp: timestampFromMessage(entry) };
}

/** Convert branch entries into the concise items shown in the resume note. */
export function conversationItems(
  entries: SessionEntryLike[],
  maxChars = DEFAULT_MAX_CHARS,
): ResumeItem[] {
  return entries
    .map((entry) => entryToResumeItem(entry, maxChars))
    .filter((item): item is ResumeItem => item !== null);
}

function restoreCommands(sessionFile?: string, sessionId?: string): string[] {
  const commands: string[] = [];
  if (sessionFile) commands.push(`pi --session ${quoteShellArg(sessionFile)}`);
  if (sessionId) commands.push(`pi --session ${sessionId}`);
  commands.push("pi --resume");
  return commands;
}

/** Render the project-local markdown resume. */
export function buildConversationResume(
  entries: SessionEntryLike[],
  metadata: ResumeMetadata = {},
): string {
  const generatedAt = metadata.generatedAt ?? new Date();
  const maxItems = metadata.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxChars = metadata.maxChars ?? DEFAULT_MAX_CHARS;
  const items = conversationItems(entries, maxChars).slice(-maxItems);
  const commands = restoreCommands(metadata.sessionFile, metadata.sessionId);

  const lines: string[] = [
    "# ZERO Pi Resume",
    "",
    "> Local handoff note. It may contain conversation context; keep `.pi/` out of commits.",
    "",
    "## Restore",
    "",
    "Exact command:",
    "",
    "```powershell",
    commands[0],
    "```",
    "",
  ];

  if (metadata.sessionId) {
    lines.push("Same session by id:", "", "```powershell", `pi --session ${metadata.sessionId}`, "```", "");
  }

  lines.push(
    "Open the interactive picker:",
    "",
    "```powershell",
    "pi --resume",
    "```",
    "",
    "## Session",
    "",
    `- Updated: ${generatedAt.toISOString()}`,
  );

  if (metadata.reason) lines.push(`- Shutdown reason: ${metadata.reason}`);
  if (metadata.cwd) lines.push(`- CWD: ${metadata.cwd}`);
  if (metadata.sessionFile) lines.push(`- Session file: ${metadata.sessionFile}`);
  if (metadata.sessionId) lines.push(`- Session id: ${metadata.sessionId}`);

  lines.push("", "## Conversation Tail", "");

  if (items.length === 0) {
    lines.push("_No conversation messages were available yet._", "");
  } else {
    for (const item of items) {
      const suffix = item.timestamp ? ` - ${item.timestamp}` : "";
      lines.push(`### ${item.label}${suffix}`, "", item.text, "");
    }
  }

  lines.push(
    "## Continue Prompt",
    "",
    "Continue from this ZERO Pi resume. If you need the full context, run the restore command above first.",
    "",
  );

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function ensureResumeDir(cwd: string): string {
  const dir = join(cwd, RESUME_DIR);
  mkdirSync(dir, { recursive: true });

  const ignorePath = join(dir, ".gitignore");
  if (!existsSync(ignorePath)) {
    writeFileSync(ignorePath, "*\n!.gitignore\n", "utf8");
  }

  return dir;
}

/** Write the resume atomically and return the path written. */
export function writeConversationResume(
  cwd: string,
  entries: SessionEntryLike[],
  metadata: ResumeMetadata = {},
): string {
  const dir = ensureResumeDir(cwd);
  const target = join(dir, RESUME_FILE);
  const tmp = join(dir, `${RESUME_FILE}.tmp`);
  const text = buildConversationResume(entries, metadata);
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, target);
  return target;
}

function notify(ctx: PiContext, message: string, type: NotifyType): void {
  try {
    ctx.ui?.notify?.(message, type);
  } catch {
    // UI notifications are best-effort only.
  }
}

function readBranch(ctx: PiContext): SessionEntryLike[] {
  try {
    return ctx.sessionManager?.getBranch?.() ?? [];
  } catch {
    return [];
  }
}

function sessionFile(ctx: PiContext): string | undefined {
  try {
    return ctx.sessionManager?.getSessionFile?.();
  } catch {
    return undefined;
  }
}

function sessionId(ctx: PiContext): string | undefined {
  try {
    return ctx.sessionManager?.getSessionId?.();
  } catch {
    return undefined;
  }
}

function writeFromContext(ctx: PiContext, reason: string): string | null {
  const cwd = ctx.cwd;
  if (!cwd) return null;

  const branch = readBranch(ctx);
  if (branch.length === 0 && !sessionFile(ctx) && !sessionId(ctx)) return null;

  return writeConversationResume(cwd, branch, {
    cwd,
    reason,
    sessionFile: sessionFile(ctx),
    sessionId: sessionId(ctx),
  });
}

export default function register(pi?: PiAPI): void {
  if (!pi) return;

  if (typeof pi.on === "function") {
    pi.on("session_shutdown", async (event, ctx) => {
      const reason = (event as { reason?: string } | undefined)?.reason ?? "unknown";
      if (reason !== "quit") return;
      if (process.env.ZERO_RESUME === "off" || process.env.ZERO_RESUME === "0") return;

      try {
        const path = writeFromContext(ctx, reason);
        if (path) notify(ctx, `zero resume written: ${path}`, "info");
      } catch (err) {
        notify(ctx, `zero resume failed: ${err instanceof Error ? err.message : String(err)}`, "warning");
      }
    });
  }

  if (typeof pi.registerCommand === "function") {
    pi.registerCommand("zero-resume", {
      description: "Write .pi/zero-resume.md with restore command and conversation tail",
      handler: async (_args, ctx) => {
        try {
          const path = writeFromContext(ctx, "manual");
          if (!path) {
            notify(ctx, "zero-resume: no persisted session context found", "warning");
            return;
          }
          const command = sessionFile(ctx)
            ? `pi --session ${quoteShellArg(sessionFile(ctx)!)}`
            : sessionId(ctx)
              ? `pi --session ${sessionId(ctx)}`
              : "pi --resume";
          notify(ctx, `zero-resume: wrote ${path}\nrestore: ${command}`, "info");
        } catch (err) {
          notify(ctx, `zero-resume: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
      },
    });
  }
}
