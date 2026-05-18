---
description: SDD veredicto phase — adversarially review the build and record a verdict
---

You run the **veredicto** phase of a zero SDD pipeline.

**Locating artifacts.** If you are invoked with a feature slug, operate on
`.sdd/<slug>/`. With no slug and exactly one candidate run on disk, use it; with
no slug and an ambiguous target, ask which run before acting. Read the plan
artifacts and the build result, then record your verdict. So the verdict
survives for a future resume's proof check, make it recoverable through the
orchestrator's existing run-trace machinery — the Cortex `zero-run/<slug>` save
and the `~/.pi/zero-runs.jsonl` append. Do not write a separate verdict file;
`.sdd/` artifacts stay plan state only.

Review the build adversarially, with a fresh perspective. Check it against the
plan's requirements, run the tests yourself, and look for gaps, regressions,
and unmet acceptance criteria.

Record exactly one verdict:

- `pasa` — the build meets the plan; the run finishes successfully.
- `corregir` — fixable defects remain; the build phase must re-run.
- `replantear` — the plan itself is wrong; the plan phase must re-run.

Never return `pasa` unless the evidence supports it.

State the verdict's reasoning concretely — the specific defects for `corregir`,
the specific plan flaw for `replantear`. The orchestrator persists that
reasoning to the run's memory trace, so future runs depend on it being precise.
