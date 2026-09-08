import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { loadSddConfig } from "./sdd-config.ts";
import { formatRoundsReport, ledgerPath, parseRoundsArgs, readLedger, recordRound, stateOf, VERDICTS, writeLedger } from "./zero-rounds.ts";

const SDD_DIR = ".sdd";

type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

function resolveSlug(explicit: string | null, cwd: string): string | null {
  if (explicit) return explicit;
  try {
    const candidates = readdirSync(join(cwd, SDD_DIR), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "specs" && e.name !== "archive")
      .map((e) => e.name);
    return candidates.length === 1 ? candidates[0] : null;
  } catch {
    return null;
  }
}

export function runRounds(args: string, ctx: PiCommandContext, cwd = process.cwd()): void {
  const notify = (m: string, t?: NotifyType) => { try { ctx.ui.notify(m, t); } catch {} };
  const parsed = parseRoundsArgs(args ?? "");

  if (parsed.action === "invalid") {
    notify(`zero-rounds: uso — /zero-rounds [status|record <${VERDICTS.join("|")}>|reset] [<slug>] [--cap N] [--json]`, "warning");
    return;
  }

  const slug = resolveSlug(parsed.slug, cwd);
  if (!slug) { notify("zero-rounds: no hay un único run — corré /zero-rounds <acción> <slug>", "warning"); return; }

  if (parsed.action === "reset") {
    const path = ledgerPath(slug, cwd);
    if (!existsSync(path)) { notify(`zero-rounds: ${slug} no tenía rondas registradas`, "info"); return; }
    rmSync(path, { force: true });
    notify(`zero-rounds: ${slug} — contador reiniciado`, "info");
    return;
  }

  const previous = readLedger(slug, cwd);

  if (parsed.action === "status") {
    if (parsed.json) notify(JSON.stringify({ slug, ...(previous ?? { rounds: 0, verdicts: [] }), state: stateOf(previous) }, null, 2), "info");
    else notify(formatRoundsReport(previous, slug), "info");
    return;
  }

  let cap = parsed.cap ?? previous?.cap ?? 0;
  if (cap <= 0) {
    try { cap = loadSddConfig(cwd).rounds.cap; }
    catch (err) { notify(`zero-rounds: ${err instanceof Error ? err.message : String(err)}`, "error"); return; }
  }

  const next = recordRound(previous, parsed.verdict!, { slug, cap: parsed.cap ?? previous?.cap ?? cap });
  writeLedger(next, cwd);
  if (parsed.json) notify(JSON.stringify({ ...next, state: stateOf(next) }, null, 2), "info");
  else notify(formatRoundsReport(next), "info");
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-rounds", {
    description: "Lleva el contador durable de rondas build/veredicto en .sdd/<slug>/rounds.json",
    handler: (args: string, ctx: PiCommandContext): void => {
      try { if (ctx?.ui?.notify) runRounds(args ?? "", ctx); }
      catch (err) { try { ctx.ui.notify(`zero-rounds: ${err instanceof Error ? err.message : String(err)}`, "error"); } catch {} }
    },
  });
}
