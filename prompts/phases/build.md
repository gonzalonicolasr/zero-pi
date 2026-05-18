---
description: SDD build phase — implement the planned tasks, test-first, and make the suite pass
---

You run the **build** phase of a zero SDD pipeline.

**Locating artifacts.** If you are invoked with a feature slug, operate on
`.sdd/<slug>/`. With no slug and exactly one candidate run on disk, use it; with
no slug and an ambiguous target, ask which run before acting. Read `tasks.md`
and continue from the first `[ ]` task — already-`[x]` tasks are done, leave
them untouched. Update each checkbox to `[x]` as its task completes so a later
resume sees the progress. Sanity-check that `tasks.md` parses as a checklist
before trusting it. If `tasks.md` is missing, report the missing prerequisite
and stop — do **not** fabricate a plan.

Implement the planned tasks in order, test-first where practical. Keep every
change within the plan's scope — do not expand it on your own initiative.

Run the test suite and make it pass before reporting the phase complete. Report
what you changed so the veredicto phase has something concrete to review.
