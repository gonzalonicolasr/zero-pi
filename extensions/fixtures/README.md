# Forge runtime fixture provenance

`forge-runtime.json` is a sanitized local capture inspected on 2026-09-13 from
installed **pi-subagents 0.55.0**: workflow-receipt v1, workflow status projection,
and one corresponding `_0_meta.json`. The source workflow had two `zero-build`
children. Tests derive a single-child receipt explicitly; this is not a fabricated
foreground result or a claim that async completions carry metadataPath.

Opaque workflow/child IDs, project/session paths and the status-file path inside
a resumability reason were replaced. Usage, timestamp, agent/model, context,
lineage, state and field types are retained. Task was already `[prompt redacted]`.
No source task text, transcript, credentials or unrelated project content is kept.

Installed contracts checked:

- `src/workflows/workflow-receipt.ts`: version 1, `workflowRunId`, keyed entries,
  `latestRunId`, `continuation.runIds`, requested/resolved context.
- `src/runs/foreground/subagent-executor.ts`: async launch details.runId/asyncDir,
  status.cwd/sessionId, workflow result children carry runId, not necessarily
  metadataPath (artifactPaths may point only at saved output/session).
  `status.steps` identity/outcome projection added during review from the observed
  completed audit status and source lines 4535–4590: workflowKey,
  parentWorkflowRunId, agent, runId, status. IDs/agents are mapped to the existing
  sanitized fixture. Failed/stopped variants are explicitly synthetic regression
  cases; a complete workflow alone does not prove a successful child.
- `src/shared/artifacts.ts`: session artifact root derives from dirname of the
  parent session file; project root is `.pi/subagents/artifacts`; exact child
  metadata/debug filenames use `<runId>_<agent>_0_meta.json` / `_output.md`.
- `src/runs/shared/single-output.ts`: `output:false` resolves no outputPath and
  injects no write instruction. `read,bash` otherwise counts as mutation-capable.
- `src/runs/foreground/execution.ts`: debug output persistence is controlled by
  artifact config, independently from a configured outputPath.

Portable fixture tests and optional installed-runtime tests are separate. The
latter invoke pure runtime helpers/validators, never launch a child. Successful
helpers and prompt contracts are not a live Forge or quality-equivalence test.
