// zero-pi — Anthropic metered-billing guard, pure-logic module.
//
// pi reaches Claude models through the `anthropic` provider with one of two
// auth modes:
//
//   • OAuth — a Claude Pro/Max subscription login (`/login`). The
//     `pi-claude-oauth-adapter` package smooths this path. This is the mode
//     to prefer: it authenticates against the Claude subscription.
//   • API key — `ANTHROPIC_API_KEY`. This bills per token from the metered
//     "extra usage" pool.
//
// Same provider id (`anthropic`), different billing. pi reports the auth mode
// via `modelRegistry.isUsingOAuth(model)`, so the guard keys off that — not off
// the provider name. (The earlier guard redirected `anthropic` → `pi-claude-cli`;
// that provider is no longer used, so the redirect is gone.)
//
// This module holds the guard's decision in plain, dependency-free TypeScript
// so it is testable with plain objects via `node --test`. The pi wiring (the
// `model_select` handler that reads `isUsingOAuth` and calls `notify`) lives in
// `provider-guard-extension.ts`. No pi imports, no filesystem, no side effects.

/** The pi provider whose billing depends on the auth mode. */
export const METERED_PROVIDER = "anthropic";

/** The minimum a `Model` of pi must expose for the guard to classify it. */
export interface ModelLike {
  provider: string;
  id: string;
}

/**
 * The action the wiring must execute, a discriminated union keyed on `kind`.
 *
 * - `ignore` — no-op: not the `anthropic` provider, `anthropic` on OAuth
 *   (subscription), or a malformed event.
 * - `warn` — emit `ctx.ui.notify(message, "warning")`: `anthropic` on an API
 *   key, which bills metered extra usage.
 */
export type GuardAction =
  | { kind: "ignore" }
  | { kind: "warn"; message: string };

// ---------------------------------------------------------------------------
// User-facing Spanish string
// ---------------------------------------------------------------------------

/** `warning` notification — the model runs on the metered `anthropic` API key. */
export function warnMessage(id: string): string {
  return `zero: «${id}» usa el provider «anthropic» con API key — factura por token (extra usage). Logueá con Claude Pro/Max vía /login para usar tu suscripción.`;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Whether a value is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Classify a model switch into the `GuardAction` the wiring must execute.
 *
 * Pure and total — never throws. The branches, in order:
 *
 *   1. `model` falsy, or `provider`/`id` not non-empty strings → `ignore`
 *      (malformed event).
 *   2. `model.provider` is not `anthropic` → `ignore` (other providers carry
 *      no OAuth-vs-API-key billing split this guard reasons about).
 *   3. The provider is `anthropic`:
 *        - `isOAuth` truthy → `ignore` (subscription auth — the intended path).
 *        - `isOAuth` falsy → `warn` (API key — metered extra usage).
 *
 * `isOAuth` is supplied by the wiring from `modelRegistry.isUsingOAuth`. When
 * the wiring cannot determine the auth mode it passes `true`, so an unknown
 * state never produces a false warning.
 */
export function classifyModelSwitch(
  model: ModelLike | null | undefined,
  isOAuth: boolean,
): GuardAction {
  // 1. Malformed event — no model, or missing/empty provider/id.
  if (!model || !isNonEmptyString(model.provider) || !isNonEmptyString(model.id)) {
    return { kind: "ignore" };
  }

  // 2. Any provider other than `anthropic` — out of scope, silent no-op.
  if (model.provider !== METERED_PROVIDER) {
    return { kind: "ignore" };
  }

  // 3. `anthropic`: OAuth is the subscription path (fine); an API key is the
  //    metered path (warn).
  if (isOAuth) {
    return { kind: "ignore" };
  }
  return { kind: "warn", message: warnMessage(model.id) };
}
