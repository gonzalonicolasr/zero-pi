// zero-pi — metered-provider guard, pi wiring.
//
// A thin pi extension that wires the pure decision logic in `provider-guard.ts`
// to the `model_select` hook. Whenever pi reports a model switch, this handler
// classifies it (in the pure module) and executes the resulting `GuardAction`:
// a silent no-op for subscription providers, a non-blocking `warning` for a
// metered provider with no equivalent (or a session `restore`), or — for a
// deliberate switch to a metered provider that has an equivalent — a `confirm`
// dialog offering to redirect to the subscription provider.
//
// All decisions live in `provider-guard.ts`; this file only declares the
// minimal pi-API surface it uses, hooks `model_select`, and performs the I/O
// (`confirm`/`notify`/`setModel`). Both `register` and the handler are wrapped
// in a swallowing `try/catch` — exactly like `autotune-extension.ts`, a failure
// must never break a pi session. The package stays dependency-free: only
// `provider-guard.ts` is imported (no `node:*` is needed here, no third party).

import {
  classifyModelSwitch,
  redirectFailedMessage,
  type ModelLike,
} from "./provider-guard.ts";

// ---------------------------------------------------------------------------
// Minimal local pi-API interfaces
// ---------------------------------------------------------------------------
//
// `provider-guard-extension.ts` declares only the slice of pi's API it uses,
// exactly like `autotune-extension.ts` and `zero-models.ts`. The guard never
// depends on pi's full type surface — just the shapes below.

/** The minimum a `Model` of pi must expose for the guard. Mirrors `ModelLike`
 *  of the pure module — `setModel`/the registry both speak this shape. */
interface PiModel {
  provider: string;
  id: string;
}

/** The model registry slice the guard uses: a `find` that resolves a model by
 *  `(provider, id)` or returns `undefined` when no such model exists. */
interface PiModelRegistry {
  find(provider: string, modelId: string): PiModel | undefined;
}

/** The slice of pi's UI surface the guard uses. `confirm` may be sync or async
 *  (pi versions differ); both are handled uniformly with `await`. */
interface PiUI {
  confirm(title: string, message: string): Promise<boolean> | boolean;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

/** The context pi passes to a `model_select` handler. `modelRegistry` is
 *  optional — if absent the guard degrades to warn-only (it can no longer
 *  resolve equivalents) rather than breaking. */
interface PiModelSelectContext {
  ui: PiUI;
  modelRegistry?: PiModelRegistry;
}

/** The `model_select` event pi emits on a model change. The guard only reads
 *  `model` and `source`; `source` is `set`/`cycle`/`restore` or, defensively,
 *  any other string a future pi version might report. */
interface PiModelSelectEvent {
  type: "model_select";
  model?: PiModel;
  source?: "set" | "cycle" | "restore" | string;
}

/** The slice of pi's extension API the guard uses: `on` to hook events and
 *  `setModel` to apply a redirection. */
interface PiExtensionAPI {
  on(
    event: string,
    handler: (event: PiModelSelectEvent, ctx: PiModelSelectContext) => void | Promise<void>,
  ): void;
  setModel(model: PiModel): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * The `model_select` guard handler.
 *
 * Runs entirely inside `register`'s swallowing `try/catch`, but is also wrapped
 * again here so no failure of `find`/`confirm`/`notify`/`setModel` can ever
 * propagate out of a pi session. The flow:
 *
 *   1. Validate `event`/`event.model` — a malformed event returns cleanly.
 *   2. Build the injected `lookup` over `ctx.modelRegistry.find`, wrapped in a
 *      `try/catch` that returns `undefined`. If `modelRegistry` is absent,
 *      degrade to an always-`undefined` lookup (warn-only).
 *   3. `classifyModelSwitch(model, source, lookup)` → a `GuardAction`.
 *   4. Execute the action: `ignore` → no-op; `warn` → `notify(..., "warning")`;
 *      `offer-redirect` → `confirm`, and on a truthy answer `setModel` +
 *      `notify(..., "info")` (or the failure notice if `setModel` returns
 *      `false`). A falsy `confirm` leaves the user on the metered provider.
 */
async function handleModelSelect(
  event: PiModelSelectEvent,
  ctx: PiModelSelectContext,
  pi: PiExtensionAPI,
): Promise<void> {
  try {
    // 1. Malformed event — no event, no model, or no UI to talk to: bail out.
    if (!event || !event.model || !ctx || !ctx.ui || typeof ctx.ui.notify !== "function") {
      return;
    }

    // 2. Build the injected lookup. `classifyModelSwitch` assumes a total
    //    lookup, so `find` is wrapped in a `try/catch` returning `undefined`.
    //    If `modelRegistry` is absent the guard cannot resolve equivalents —
    //    degrade to an always-`undefined` lookup so a metered provider still
    //    produces a warning rather than breaking.
    const registry = ctx.modelRegistry;
    const lookup = (provider: string, id: string): ModelLike | undefined => {
      if (!registry || typeof registry.find !== "function") return undefined;
      try {
        return registry.find(provider, id);
      } catch {
        // A registry lookup failure degrades to "no equivalent", never throws.
        return undefined;
      }
    };

    // 3. Classify the switch in the pure module.
    const action = classifyModelSwitch(event.model, event.source, lookup);

    // 4. Execute the action.
    if (action.kind === "ignore") {
      // Non-metered provider or malformed event — nothing to do.
      return;
    }

    if (action.kind === "warn") {
      // Metered provider with no equivalent, or a session `restore` — a single
      // non-blocking warning, no modal, no `setModel`.
      ctx.ui.notify(action.message, "warning");
      return;
    }

    // action.kind === "offer-redirect" — deliberate switch to a metered
    // provider that has a subscription equivalent. Offer the redirect; the
    // `confirm` dialog itself is the user's escape (AC 1.5).
    const accepted = await ctx.ui.confirm(action.confirmTitle, action.confirmMessage);
    if (!accepted) {
      // User declined or cancelled — leave them on the metered provider, no
      // second warning, no `setModel`.
      return;
    }

    const applied = await pi.setModel(action.safeModel);
    if (applied) {
      // Redirection took effect — confirm it with an `info` notification.
      ctx.ui.notify(action.redirectMessage, "info");
    } else {
      // `setModel` returned `false`: the switch did not apply. Do not claim
      // "redirected" — emit the optional failure notice instead.
      ctx.ui.notify(
        redirectFailedMessage(action.safeModel.id, action.safeModel.provider),
        "warning",
      );
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
 * the `model_select` event. The whole body is wrapped in a swallowing
 * `try/catch`, and the handler is wrapped again, so neither registration nor a
 * later failure can ever break a pi session. Called with no or an invalid
 * `pi` (missing, or no `.on` function), it no-ops cleanly.
 */
export default function register(pi?: unknown): void {
  try {
    if (!pi || typeof (pi as PiExtensionAPI).on !== "function") {
      return;
    }
    const api = pi as PiExtensionAPI;
    api.on("model_select", (event: PiModelSelectEvent, ctx: PiModelSelectContext): Promise<void> => {
      return handleModelSelect(event, ctx, api);
    });
  } catch {
    // Registration itself must never break a pi session.
  }
}
