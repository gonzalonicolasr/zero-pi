// Optional spec-fidelity checks against the installed runtime. Portable fixture
// tests run everywhere; these never launch agents or alter runtime configuration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { executionParameters } from "./zero-execution-extension.ts";
const runtime = "/home/gon/.pi/agent/npm/node_modules/pi-subagents";
const pi = "/home/gon/.local/share/mise/installs/node/26.2.0/lib/node_modules/@earendil-works/pi-coding-agent";
const installed = existsSync(join(runtime, "src/workflows/workflow-receipt.ts"));
const load = (p: string) => import(pathToFileURL(p).href);
test("installed 0.55.0 reads captured receipt, resolves fresh over global fork, supports readonly output", { skip: !installed }, async () => {
  assert.equal(JSON.parse(readFileSync(join(runtime, "package.json"), "utf8")).version, "0.55.0");
  const { createJiti } = await load("/home/gon/.pi/agent/npm/node_modules/jiti/lib/jiti.mjs");
  const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false, alias: { "@earendil-works/pi-coding-agent": join(pi, "dist/index.js"), "@earendil-works/pi-ai": join(pi, "node_modules/@earendil-works/pi-ai/dist/index.js") } });
  const { readWorkflowReceipt } = await jiti.import(join(runtime, "src/workflows/workflow-receipt.ts"));
  const { resolveSubagentLaunchContext } = await jiti.import(join(runtime, "src/shared/fork-context.ts"));
  const { injectSingleOutputInstruction, resolveSingleOutputPath } = await jiti.import(join(runtime, "src/runs/shared/single-output.ts"));
  const capture = JSON.parse(readFileSync(new URL("./fixtures/forge-runtime.json", import.meta.url), "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "zero-runtime-"));
  try {
    mkdirSync(join(dir, capture.receipt.workflowRunId));
    writeFileSync(join(dir, capture.receipt.workflowRunId, "workflow-receipt.json"), JSON.stringify(capture.receipt));
    assert.equal(readWorkflowReceipt(dir, capture.receipt.workflowRunId).entries["connect-0"].latestRunId, "child-captured");
    assert.equal(resolveSubagentLaunchContext({ explicitContext: "fresh", defaultSubagentContext: "fork", agentDefaultContext: "fresh", canUseImplicitFork: true }), "fresh");
    // bash is mutation-capable to the injector: preserve it, but disable the
    // configured output path for explore and use debug artifact persistence.
    assert.match(injectSingleOutputInstruction("investigate", "/fixture/findings.md", { tools: ["read", "bash"] }), /Write your findings/);
    assert.equal(resolveSingleOutputPath(false, dir), undefined);
    assert.equal(injectSingleOutputInstruction("investigate", undefined, { tools: ["read", "bash"] }), "investigate");
    const { getArtifactPaths, writeArtifact } = await jiti.import(join(runtime, "src/shared/artifacts.ts"));
    const artifact = getArtifactPaths(dir, "child-captured", "zero-explore", 0).outputPath;
    writeArtifact(artifact, "## Code roots\n/code\n");
    assert.equal(readFileSync(artifact, "utf8"), "## Code roots\n/code\n");
    const source = readFileSync(join(runtime, "src/runs/foreground/execution.ts"), "utf8");
    assert.match(source, /artifactConfig\?\.includeOutput !== false/);
    assert.match(source, /writeArtifact\(artifactPathsResult.outputPath/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("installed Pi tool validator accepts zero_execution schema and rejects invalid operation", { skip: !existsSync(pi) }, async () => {
  const { validateToolArguments } = await load(join(pi, "node_modules/@earendil-works/pi-ai/dist/utils/validation.js"));
  const tool = { name: "zero_execution", parameters: executionParameters };
  const args = { action: "start", slug: "feature", request: "verbatim\n" };
  assert.deepEqual(validateToolArguments(tool, { name: tool.name, arguments: args }), args);
  const adopt = { action: "adopt", slug: "feature" };
  assert.deepEqual(validateToolArguments(tool, { name: tool.name, arguments: adopt }), adopt);
  assert.throws(() => validateToolArguments(tool, { name: tool.name, arguments: { action: "reset" } }), /Validation failed/);
});
