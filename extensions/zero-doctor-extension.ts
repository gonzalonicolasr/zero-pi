import { createDefaultDoctorHost, formatDoctorReport, runDoctor } from "./zero-doctor.ts";
import type { PiModel } from "./zero-models.ts";

type NotifyType = "info" | "warning" | "error";

interface PiCommandContext {
  ui: { notify(message: string, type?: NotifyType): void };
  modelRegistry?: { getAll(): PiModel[] };
}

interface PiExtensionAPI {
  registerCommand(
    name: string,
    options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> },
  ): void;
}

function registryModels(ctx: PiCommandContext): PiModel[] | undefined {
  try {
    const models = ctx.modelRegistry?.getAll?.();
    return Array.isArray(models) ? models : undefined;
  } catch {
    return undefined;
  }
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-doctor", {
    description: "Diagnostica instalación, modelos, sub-agentes, git/gh y estado SDD de zero-pi",
    handler: (_args: string, ctx: PiCommandContext): void => {
      try {
        const report = runDoctor(createDefaultDoctorHost(registryModels(ctx)));
        ctx.ui.notify(formatDoctorReport(report), report.ok ? "info" : "error");
      } catch (err) {
        try {
          ctx.ui.notify(`zero-doctor: ${err instanceof Error ? err.message : String(err)}`, "error");
        } catch {}
      }
    },
  });
}
