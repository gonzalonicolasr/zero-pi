---
description: Route a natural-language request into the zero SDD pipeline when the user signals SDD intent
---

# zero — Natural-language SDD routing

zero's spec-driven development pipeline is normally started with the explicit
`/forge <feature>` command. This skill adds one purely additive convenience:
when the user **describes work** and **explicitly signals** that they want it
run through the disciplined SDD pipeline, route the request into the `/forge`
workflow instead of handling it ad-hoc.

`/forge` stays the primary, deliberate entry point. This skill never replaces
it — it only catches the case where the user expressed SDD intent in plain
language rather than typing the command.

## When to route

Route to `/forge` only when **both** of these hold:

1. The message describes **non-trivial work** — a feature, a refactor, a
   multi-step change worth a spec.
2. The message contains a **clear SDD intent signal** — an explicit phrase
   asking for the pipeline. Recognised signals (Spanish or English), and close
   equivalents:
   - "hacelo con sdd" / "do it with sdd"
   - "usá el pipeline" / "use the pipeline"
   - "con sdd" / "with sdd"
   - "andá con forge" / "run forge" / "go with forge"
   - "spec-driven" / "spec driven development"

When both hold, invoke the `/forge` workflow with the user's described work as
the feature request. Pass that described work **verbatim** — do not rephrase,
summarize, translate, or interpret it. The existing `/forge` workflow does the
rest: an ordinary SDD run with all four phases (explore, plan, build,
veredicto), the round cap, and the veredicto verdict, exactly as an explicit
`/forge` invocation behaves.

## When NOT to route — be conservative

This skill must **not** hijack ordinary interaction. Do nothing (handle the
request normally) when:

- The message has **no clear SDD intent signal** — description of work alone is
  never enough.
- The user asks a **question**, requests a **small or one-off fix**, or makes
  any routine request without an SDD signal.
- The SDD intent is **ambiguous or uncertain** in any way.

When in doubt, do nothing. Default to normal handling and leave the user to
invoke `/forge` explicitly. A missed natural-language route is harmless — the
user can still type `/forge`. A wrong route forces routine work through the
heavy pipeline, which is not. Triggering only on a clear signal phrase is the
rule; `/forge` remains the explicit primary entry point.
