import { executionOperation, type ExecutionInput } from "./zero-execution.ts";

// JSON Schema is accepted by Pi's tool validator; no runtime dependency is
// needed for this small, string/number-only interface. See hello.ts example's
// registerTool/execute contract (Pi 26.2.0 installation).
export const executionParameters = {
  type: "object", additionalProperties: false, required: ["action"],
  properties: {
    action: { type: "string", enum: ["start", "resume", "status", "attempt", "attach", "analyze", "findings"] },
    slug: { type: "string" }, request: { type: "string" }, runId: { type: "string" },
    phase: { type: "string", enum: ["clarify", "explore", "plan", "analyze", "build", "veredicto"] },
    round: { type: "integer", minimum: 1 }, batch: { type: "integer", minimum: 1 },
    attemptId: { type: "string" }, workflowRunId: { type: "string" }, asyncDir: { type: "string" },
    decision: { type: "string", enum: ["continue", "replan"] },
  },
};
export default function register(pi?: { registerTool(tool: any): void }): void {
  if (!pi?.registerTool) return;
  pi.registerTool({
    name: "zero_execution", label: "Forge execution",
    description: "Durable Forge identity and readiness cap. start(slug,request verbatim), resume(slug), status(runId), attempt(runId,phase,round,batch), attach(runId,attemptId,workflowRunId,asyncDir from runtime receipt), analyze(runId,attemptId,decision), findings(runId,attemptId) copies confirmed explore debug output to findings.md. Does not launch children. Second replan blocks; never reset on resume.",
    parameters: executionParameters,
    execute(_toolCallId: string, params: ExecutionInput, _signal: unknown, _onUpdate: unknown, ctx: { cwd: string }) {
      // Pi marks tool failures only when execute throws, not via isError in a return value.
      const details = executionOperation(ctx.cwd, params);
      // Status returns counts/issues, not the full cached usage ledger to the LLM.
      const { metas: _metas, ...summary } = details;
      return { content: [{ type: "text", text: JSON.stringify(summary) }], details: summary };
    },
  });
}
