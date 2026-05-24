// zero-pi — filesystem-wide scan guard, pi wiring.
//
// A thin pi extension that wires the pure decision logic in `scan-guard.ts` to
// the `tool_call` hook. Before any shell tool runs, it reads the command and,
// when the command contains a `find`/`grep -r`/`rg` rooted at a filesystem root
// (`/`, a bare drive mount, `~`, …), blocks the call and returns a reason that
// tells the model to scope the search to the plan's code root instead.
//
// Why a hard block and not just the phase-prompt guidance: the veredicto prompt
// already says "do not run a filesystem-wide find/grep", yet a model ignored it
// and wedged the pipeline for 6+ hours on `find / -maxdepth 12 …` (OneDrive
// placeholder hydration never returns on Windows). A `tool_call` block is the
// enforcement the prompt cannot be.
//
// All decisions live in `scan-guard.ts`; this file declares the minimal pi-API
// surface it uses, hooks `tool_call`, and returns the block verdict. Both
// `register` and the handler are wrapped in a swallowing `try/catch` — a failure
// must never break a pi session, and (critically) must never block a tool by
// accident. Dependency-free: only `scan-guard.ts` is imported.

import { classifyShellCommand, GUARDED_TOOLS } from "./scan-guard.ts";

// ---------------------------------------------------------------------------
// Minimal local pi-API interfaces
// ---------------------------------------------------------------------------

/**
 * The `tool_call` event pi emits before a tool runs. The shell command lives at
 * `input.command`; older/other shapes may carry it at `args.command`, so the
 * handler reads both defensively.
 */
interface PiToolCallEvent {
  toolName?: string;
  input?: { command?: unknown };
  args?: { command?: unknown };
}

/** What a `tool_call` handler may return to stop a tool from running. */
interface PiToolCallResult {
  block: true;
  reason: string;
}

/** The slice of pi's extension API the guard uses. */
interface PiExtensionAPI {
  on(
    event: string,
    handler: (event: PiToolCallEvent, ctx: unknown) => PiToolCallResult | undefined,
  ): void;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Pull the shell command string out of either event shape. */
function readCommand(event: PiToolCallEvent): unknown {
  return event?.input?.command ?? event?.args?.command;
}

/**
 * The `tool_call` guard handler.
 *
 * Returns `{ block, reason }` only for a guarded shell tool whose command is a
 * root-rooted scan; otherwise returns `undefined` (allow). Wrapped so any
 * failure degrades to "allow" — the guard must never wedge a session by
 * throwing, nor block a tool because of its own bug.
 */
export function handleToolCall(event: PiToolCallEvent): PiToolCallResult | undefined {
  try {
    if (!event || typeof event.toolName !== "string") return undefined;
    if (!GUARDED_TOOLS.has(event.toolName)) return undefined;

    const decision = classifyShellCommand(readCommand(event));
    if (decision.block && decision.reason) {
      return { block: true, reason: decision.reason };
    }
    return undefined;
  } catch {
    // A guard failure degrades to "allow" — never block a tool by accident.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * The pi extension entry point.
 *
 * pi calls this once when the extension loads. It wires the guard handler to
 * the `tool_call` event. The body is wrapped in a swallowing `try/catch`, and
 * the handler is wrapped again, so neither registration nor a later failure can
 * break a pi session. Called with no or an invalid `pi`, it no-ops cleanly.
 */
export default function register(pi?: unknown): void {
  try {
    if (!pi || typeof (pi as PiExtensionAPI).on !== "function") return;
    (pi as PiExtensionAPI).on("tool_call", handleToolCall);
  } catch {
    // Registration itself must never break a pi session.
  }
}
