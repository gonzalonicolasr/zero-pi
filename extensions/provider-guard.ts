// zero-pi — metered-provider guard, pure-logic module.
//
// pi can reach the same Claude models through two providers: `pi-claude-cli`
// (routes via the locally installed Claude CLI, billed against the user's
// subscription PLAN — no per-token charge) and `anthropic` (the direct
// Anthropic API provider, which consumes a metered "extra usage" pool and
// bills per token). `/model` lists the same models under both, so it is easy
// to slide into metered billing unnoticed.
//
// This module holds every *decision* of the guard — classifying a model switch
// into the action the wiring must run — in plain, dependency-free TypeScript so
// it is testable with plain objects via `node --test`. The pi wiring (the
// `model_select` handler that performs `confirm`/`notify`/`setModel`) lives in
// `provider-guard-extension.ts`.
//
// This file has no pi imports, no filesystem access, and no side-effecting
// top-level code; it is pure data plus an injected lookup function.

/**
 * Mapping metered-provider → equivalent subscription-provider.
 *
 * A provider that appears as a *key* here is "metered" — switching to it
 * triggers the guard. The mapped *value* is the subscription provider the
 * guard offers to redirect to. v1 has exactly one pair; adding another
 * metered↔subscription pair is a single extra line.
 *
 * Invariant the no-redirect-loop guarantee depends on: a redirection target
 * (a *value*) must never itself be a *key*. `pi-claude-cli` is a value, not a
 * key, so the `setModel`-triggered second `model_select` event classifies as
 * `ignore` and the chain terminates.
 */
export const METERED_TO_SUBSCRIPTION: Readonly<Record<string, string>> = {
  anthropic: "pi-claude-cli",
};

/**
 * Origin of a model change, as pi reports it on `ModelSelectEvent.source`.
 * `set`/`cycle` are deliberate user actions; `restore` is a non-deliberate
 * session restore that must never raise a modal.
 */
export type GuardSource = "set" | "cycle" | "restore";

/** The deliberate sources that may raise a redirect modal. Any other source
 *  (including `restore` and unknown strings) is treated as non-deliberate. */
const DELIBERATE_SOURCES: readonly string[] = ["set", "cycle"];

/** The minimum a `Model` of pi must expose for the guard to classify it. */
export interface ModelLike {
  provider: string;
  id: string;
}

/**
 * Injected registry-lookup function. The wiring builds this over
 * `ctx.modelRegistry.find`; the pure module never knows `modelRegistry` or any
 * pi type. Returns `undefined` when no equivalent model exists. The wiring is
 * responsible for wrapping `find` so this lookup is total — `classifyModelSwitch`
 * assumes a `lookup` that never throws.
 */
export type RegistryLookup = (provider: string, id: string) => ModelLike | undefined;

/**
 * The action the wiring must execute, as a discriminated union keyed on `kind`.
 *
 * - `ignore` — no-op: non-metered provider, or a malformed event.
 * - `warn` — emit only `ctx.ui.notify(message, "warning")`; no modal, no
 *   `setModel`. Used for `restore`, for a metered provider with no equivalent,
 *   and for any non-deliberate source.
 * - `offer-redirect` — show `ctx.ui.confirm(confirmTitle, confirmMessage)`; on
 *   a truthy answer `setModel(safeModel)` and, if applied, notify with
 *   `redirectMessage`.
 */
export type GuardAction =
  | { kind: "ignore" }
  | { kind: "warn"; message: string }
  | {
      kind: "offer-redirect";
      safeModel: ModelLike;
      confirmTitle: string;
      confirmMessage: string;
      redirectMessage: string;
    };

// ---------------------------------------------------------------------------
// User-facing Spanish strings
// ---------------------------------------------------------------------------
//
// Exported as constants/functions so the test can assert them verbatim. `id`
// is the model id (e.g. `claude-opus-4-7`); `metered`/`subscription` are the
// provider names from `METERED_TO_SUBSCRIPTION`.

/** Title of the redirect `confirm` dialog. */
export const CONFIRM_TITLE = "zero · proveedor con cobro por token";

/** Body of the redirect `confirm` dialog — explains the metered billing and
 *  asks whether to switch to the subscription equivalent. */
export function confirmMessage(id: string, metered: string, subscription: string): string {
  return `Estás cambiando a «${id}» vía el proveedor «${metered}», que factura por token y consume tu pool medido de extra usage. ¿Querés cambiar al equivalente «${id}» en «${subscription}», que usa los límites de tu suscripción?`;
}

/** `info` notification emitted after `setModel` succeeds. */
export function redirectMessage(id: string, subscription: string): string {
  return `zero: redirigido a «${id}» en ${subscription} — usando los límites de tu suscripción.`;
}

/** `warning` notification — no equivalent available, or `restore`. */
export function warnMessage(id: string, metered: string): string {
  return `zero: «${id}» está activo vía el proveedor «${metered}», que factura por token y consume tu pool medido de extra usage.`;
}

/** `warning` notification — `setModel` returned `false` (redirection did not
 *  apply). Optional; emitted by the wiring as a defensive courtesy. */
export function redirectFailedMessage(id: string, subscription: string): string {
  return `zero: no se pudo cambiar a «${id}» en ${subscription} — seguís en el proveedor medido.`;
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
 * Pure and total — never throws (assuming `lookup` is total, which is the
 * wiring's contract). The branches, in order:
 *
 *   1. `model` falsy, or `model.provider`/`model.id` not non-empty strings →
 *      `ignore` (malformed event, AC 6.3).
 *   2. `model.provider` is not a key of `METERED_TO_SUBSCRIPTION` → `ignore`
 *      (non-metered provider, AC 4.1/4.2 — this also classifies `pi-claude-cli`,
 *      which is the structural no-redirect-loop guarantee, Story 5).
 *   3. The provider is metered. Resolve the subscription provider and call
 *      `lookup(subProvider, model.id)`:
 *        - `source === "restore"` → always `warn`, never a modal, regardless of
 *          whether an equivalent exists (AC 3.x).
 *        - `source` deliberate (`set`/`cycle`):
 *            - `lookup` found a model → `offer-redirect` (AC 1).
 *            - `lookup` returned `undefined` → `warn` (AC 2).
 *        - any other (unknown) `source` → treated as non-deliberate → `warn`
 *          (defensive: no modal unless the switch is known to be deliberate).
 */
export function classifyModelSwitch(
  model: ModelLike | null | undefined,
  source: GuardSource | string | null | undefined,
  lookup: RegistryLookup,
): GuardAction {
  // 1. Malformed event — no model, or missing/empty provider/id.
  if (!model || !isNonEmptyString(model.provider) || !isNonEmptyString(model.id)) {
    return { kind: "ignore" };
  }

  // 2. Non-metered provider — silent no-op (covers `pi-claude-cli`).
  const subscriptionProvider = METERED_TO_SUBSCRIPTION[model.provider];
  if (subscriptionProvider === undefined) {
    return { kind: "ignore" };
  }

  // 3. Metered provider. A deliberate switch with an equivalent gets a modal;
  //    everything else (restore, no equivalent, unknown source) gets a warn.
  const meteredProvider = model.provider;
  const id = model.id;
  const isDeliberate = typeof source === "string" && DELIBERATE_SOURCES.includes(source);

  if (isDeliberate) {
    const safeModel = lookup(subscriptionProvider, id);
    if (safeModel) {
      return {
        kind: "offer-redirect",
        safeModel,
        confirmTitle: CONFIRM_TITLE,
        confirmMessage: confirmMessage(id, meteredProvider, subscriptionProvider),
        redirectMessage: redirectMessage(id, subscriptionProvider),
      };
    }
  }

  return { kind: "warn", message: warnMessage(id, meteredProvider) };
}
