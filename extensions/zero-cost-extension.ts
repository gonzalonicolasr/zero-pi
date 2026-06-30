import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parseMeta, selectRunMetas, aggregateRun, formatReport, type PhaseMeta } from "./zero-cost.ts";

type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

/** Read every sub-agent `meta.json` across all pi session dirs and parse the
 *  zero-<phase> ones. Scanning every session keeps us decoupled from pi's
 *  cwd-encoding scheme; selection by slug/timestamp narrows to one run. */
function readAllPhaseMetas(): PhaseMeta[] {
  const root = join(homedir(), ".pi", "agent", "sessions");
  if (!existsSync(root)) return [];
  const out: PhaseMeta[] = [];
  for (const session of readdirSync(root, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const artifacts = join(root, session.name, "subagent-artifacts");
    if (!existsSync(artifacts)) continue;
    for (const f of readdirSync(artifacts)) {
      if (!f.endsWith("_meta.json")) continue;
      try {
        const meta = parseMeta(JSON.parse(readFileSync(join(artifacts, f), "utf8")));
        if (meta) out.push(meta);
      } catch { /* skip unreadable / malformed meta */ }
    }
  }
  return out;
}

function runCost(args: string, ctx: PiCommandContext): void {
  const notify = (m: string, t?: NotifyType) => { try { ctx.ui.notify(m, t); } catch {} };
  const slug = args.trim() || null;
  const metas = readAllPhaseMetas();
  const selected = selectRunMetas(metas, slug);
  if (selected.length === 0) {
    notify(
      slug
        ? `zero-cost: no encontré datos de costo para "${slug}".`
        : "zero-cost: no encontré runs con datos de costo todavía.",
      "info",
    );
    return;
  }
  notify(formatReport(aggregateRun(selected, slug ?? selected[0]?.slug ?? null)), "info");
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-cost", {
    description: "Reporta tokens, costo y duración por fase de un run SDD (slug opcional; sin slug = el más reciente)",
    handler: (args: string, ctx: PiCommandContext): void => {
      try { if (ctx?.ui?.notify) runCost(args ?? "", ctx); }
      catch (err) { try { ctx.ui.notify(`zero-cost: ${err instanceof Error ? err.message : String(err)}`, "error"); } catch {} }
    },
  });
}
