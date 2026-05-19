// zero-pi — Anthropic metered-billing guard, pi wiring.
//
// A thin pi extension that wires the pure decision logic in `provider-guard.ts`
// to the `model_select` hook. On every model switch it reads the auth mode from
// `ctx.modelRegistry.isUsingOAuth` and, when the `anthropic` provider runs on an
// API key (metered extra usage) rather than a Claude Pro/Max subscription OAuth
// login, emits a single non-blocking `warning`.
//
// All decisions live in `provider-guard.ts`; this file declares the minimal
// pi-API surface it uses, hooks `model_select`, and performs the I/O (`notify`).
// Both `register` and the handler are wrapped in a swallowing `try/catch` — a
// failure must never break a pi session. Dependency-free: only
// `provider-guard.ts` is imported (no `node:*`, no third party).

import { classifyModelSwitch } from "./provider-guard.ts";

// ---------------------------------------------------------------------------
// Minimal local pi-API interfaces
// ---------------------------------------------------------------------------

/** The minimum a `Model` of pi must expose for the guard. */
interface PiModel {
  provider: string;
  id: string;
}

/**
 * The model-registry slice the guard uses. `isUsingOAuth` reports whether a
 * model authenticates through a Claude subscription OAuth login rather than an
 * API key. It is optional — older pi builds may not expose it (see
 * `resolveOAuth`).
 */
interface PiModelRegistry {
  isUsingOAuth?(model: PiModel): boolean;
}

/** The slice of pi's UI surface the guard uses. */
interface PiUI {
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

/** The context pi passes to a `model_select` handler. */
interface PiModelSelectContext {
  ui: PiUI;
  modelRegistry?: PiModelRegistry;
}

/** The `model_select` event pi emits on a model change. */
interface PiModelSelectEvent {
  type: "model_select";
  model?: PiModel;
}

/** The slice of pi's extension API the guard uses. */
interface PiExtensionAPI {
  on(
    event: string,
    handler: (event: PiModelSelectEvent, ctx: PiModelSelectContext) => void,
  ): void;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Resolve whether `model` authenticates through subscription OAuth.
 *
 * Calls `modelRegistry.isUsingOAuth` when available. When the method is absent
 * (older pi) or throws, it returns `true` — an unknown auth mode must never
 * produce a false metered warning.
 */
function resolveOAuth(registry: PiModelRegistry | undefined, model: PiModel): boolean {
  if (!registry || typeof registry.isUsingOAuth !== "function") return true;
  try {
    return registry.isUsingOAuth(model) !== false;
  } catch {
    // A registry failure degrades to "assume OAuth" — never a false warning.
    return true;
  }
}

/**
 * The `model_select` guard handler.
 *
 * Wrapped in a swallowing `try/catch` so no failure can propagate out of a pi
 * session. The flow:
 *
 *   1. Validate `event`/`event.model`/`ctx.ui` — a malformed event bails out.
 *   2. Resolve the auth mode via `resolveOAuth`.
 *   3. `classifyModelSwitch(model, isOAuth)` → a `GuardAction`.
 *   4. `warn` → `notify(..., "warning")`; `ignore` → no-op.
 */
function handleModelSelect(event: PiModelSelectEvent, ctx: PiModelSelectContext): void {
  try {
    if (!event || !event.model || !ctx || !ctx.ui || typeof ctx.ui.notify !== "function") {
      return;
    }
    const isOAuth = resolveOAuth(ctx.modelRegistry, event.model);
    const action = classifyModelSwitch(event.model, isOAuth);
    if (action.kind === "warn") {
      ctx.ui.notify(action.message, "warning");
    }
  } catch {
    // Any failure of the guard must never break a pi session.
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * The pi extension entry point.
 *
 * pi calls this once when the extension loads. It wires the guard handler to
 * the `model_select` event. The body is wrapped in a swallowing `try/catch`,
 * and the handler is wrapped again, so neither registration nor a later failure
 * can break a pi session. Called with no or an invalid `pi`, it no-ops cleanly.
 */
export default function register(pi?: unknown): void {
  try {
    if (!pi || typeof (pi as PiExtensionAPI).on !== "function") {
      return;
    }
    (pi as PiExtensionAPI).on("model_select", handleModelSelect);
  } catch {
    // Registration itself must never break a pi session.
  }
}
