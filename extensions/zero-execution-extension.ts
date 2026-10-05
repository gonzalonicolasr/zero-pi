import { executionOperation, type ExecutionInput } from "./zero-execution.ts";

// JSON Schema is accepted by Pi's tool validator; no runtime dependency is
// needed for this small interface. See hello.ts example's
// registerTool/execute contract (Pi 26.2.0 installation).
export const executionParameters = {
  type: "object", additionalProperties: false, required: ["action"],
  properties: {
    action: { type: "string", enum: ["start", "resume", "adopt", "status", "attempt", "attach", "analyze", "findings", "round", "finish", "wave", "wave-close", "batch-close"] },
    slug: { type: "string" }, request: { type: "string" }, runId: { type: "string" },
    phase: { type: "string", enum: ["clarify", "explore", "plan", "analyze", "build", "veredicto"] },
    round: { type: "integer", minimum: 1 }, batch: { type: "integer", minimum: 1 },
    attemptId: { type: "string" }, workflowRunId: { type: "string" }, asyncDir: { type: "string" },
    decision: { type: "string", enum: ["continue", "replan"] },
    verdict: { type: "string", enum: ["corregir", "replantear", "pasa"] },
    cap: { type: "integer", minimum: 1 }, total: { type: "integer", minimum: 1 },
    tasks: { type: "array", items: { type: "string" } },
    members: { type: "array", items: { type: "object", additionalProperties: false, required: ["attemptId", "task"], properties: { attemptId: { type: "string" }, task: { type: "string" }, ok: { type: "boolean" } } } },
  },
};
export default function register(pi?: { registerTool(tool: any): void }): void {
  if (!pi?.registerTool) return;
  pi.registerTool({
    name: "zero_execution", label: "Forge execution",
    description: "Durable Forge identity and readiness cap. start(slug,request verbatim), resume(slug), adopt(slug) opens a run on a NODD /nodd-promote handoff (requirements.md with 'Promoted from the NODD run', no execution.json/run.json/design.md/tasks.md/request.md): request.md = requirements.md byte for byte, returns adopted:true and resumeAt:'explore' (skip clarify); anything else is refused and nothing is written. status(runId), attempt(runId,phase,round,batch), attach(runId,attemptId,workflowRunId,asyncDir from runtime receipt), analyze(runId,attemptId,decision), findings(runId,attemptId) copies confirmed explore debug output to findings.md. round(runId,attemptId of the veredicto,verdict,cap on the first) writes .sdd/<slug>/veredicto-r<N>.md from the confirmed veredicto output, records the verdict in rounds.json and returns routing proceed|done|cap-reached. wave(runId) returns the next build step from tasks.md: mode parallel|sequential|done|blocked, its task ids and how many steps remain. wave-close(runId,batch=step index,total,members[{attemptId,task,ok?}]) ticks [x] the delivered wave tasks, folds tdd-evidence/<T###>.md into tdd-evidence.md, logs the wave in build-r<N>.md and returns failed tasks to retry alone. batch-close(runId,attemptId,batch,total,tasks) logs a sequential batch in build-r<N>.md. finish(runId) appends the one RunRecord to ~/.pi/zero-runs.jsonl from the start-time models and rounds.json — never write that line yourself. Does not launch children. Second replan blocks; never reset on resume.",
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
