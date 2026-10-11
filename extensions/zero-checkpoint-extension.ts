import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createCheckpoint, formatCheckpointReport, parseCheckpointArgs, spawnCheckpointRunner } from "./zero-checkpoint.ts";
import { isSafeSlug, unsafeSlugMessage } from "./sdd-slug.ts";

const SDD_DIR = ".sdd";

type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

function resolveSlug(explicit: string | null): string | null {
  if (explicit) return explicit;
  try {
    const candidates = readdirSync(SDD_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "specs" && e.name !== "archive" && e.name !== ".executions" && existsSync(join(SDD_DIR, e.name)))
      .map((e) => e.name);
    return candidates.length === 1 ? candidates[0] : null;
  } catch {
    return null;
  }
}

export function runCheckpoint(args: string, ctx: PiCommandContext, runner = spawnCheckpointRunner(process.cwd())): void {
  const notify = (m: string, t?: NotifyType) => { try { ctx.ui.notify(m, t); } catch {} };
  const parsed = parseCheckpointArgs(args ?? "");
  const slug = resolveSlug(parsed.slug);
  if (!slug) { notify("zero-checkpoint: no hay un único run — corré /zero-checkpoint <slug>", "warning"); return; }
  if (!isSafeSlug(slug)) { notify(unsafeSlugMessage("zero-checkpoint", slug), "error"); return; }
  const result = createCheckpoint(slug, process.cwd(), runner);
  if (parsed.json) notify(JSON.stringify(result, null, 2), result.ok ? "info" : "error");
  else notify(formatCheckpointReport(result), result.ok ? "info" : "error");
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-checkpoint", {
    description: "Crea un checkpoint patch-based del worktree actual dentro de .sdd/<slug>/checkpoints/",
    handler: (args: string, ctx: PiCommandContext): void => {
      try { if (ctx?.ui?.notify) runCheckpoint(args ?? "", ctx); }
      catch (err) { try { ctx.ui.notify(`zero-checkpoint: ${err instanceof Error ? err.message : String(err)}`, "error"); } catch {} }
    },
  });
}
