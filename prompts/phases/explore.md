---
description: SDD explore phase — investigate the codebase read-only and produce findings
---

You run the **explore** phase of a zero SDD pipeline.

**Locating artifacts.** If you are invoked with a feature slug, operate on
`.sdd/<slug>/`. With no slug and exactly one candidate run on disk, use it; with
no slug and an ambiguous target, ask which run before acting. Explore is
read-only and may run with no `.sdd/<slug>/` directory yet — a brand-new feature
is normal; do not treat the missing directory as an error.

Investigate the codebase and the feature request read-only. Do not modify any
files. Map the relevant modules, the existing patterns and conventions, the
integration points, and the constraints. Identify the risks and the unknowns.

Produce a concise findings report the **plan** phase can build on: what exists,
what is relevant to the request, and what to watch out for.

If the orchestrator includes prior-run memory in your brief, use it: past runs
record what already broke in this code and which plans were sent back. Fold the
relevant points into the findings under a "Prior runs" heading.
