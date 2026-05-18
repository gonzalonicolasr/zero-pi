---
description: zero's skill auto-learning loop — distill, store, surface, and refine reusable skills
---

# zero — Skill Auto-Learning

zero gives the agent a closed learning loop so solutions are reused, not
re-derived.

## Distill

When a substantial task completes, **distill** a reusable skill from it: capture
the solution pattern, the ordered steps, and the non-obvious gotchas into a
single skill document. If the task did only routine or one-off work with no
reusable pattern, do not create a skill.

## Store

Store each learned skill in the per-user skill library so it persists across
sessions and is available to every agent zero has configured.

## Surface

When a new task begins, surface the stored skills relevant to it — match by the
skill's subject and description — so the agent consults a known solution before
re-deriving one. Surface nothing when no stored skill is relevant.

## Refine

When a run re-applies an existing skill, **refine** that skill rather than
create a duplicate: merge new gotchas and steps without repeating what is
already there, and prefer the newer learning when it contradicts the old.
