import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readRunRecords } from "./autotune.ts";
import { readLinks, type LinksRecord } from "./sdd-links.ts";
import { buildStatus, type StatusRow } from "./zero-status.ts";

type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

function listProjectSdd(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of readdirSync(".sdd", { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === "specs" || e.name === "archive") continue;
    out[e.name] = readdirSync(join(".sdd", e.name));
  }
  return out;
}

function render(rows: StatusRow[]): string {
  if (rows.length === 0) return "zero-status: no encontré runs en .sdd/.";
  const width = Math.max(4, ...rows.map((r) => r.slug.length));
  const lines = [`zero-status: runs detectados`, `slug${" ".repeat(width - 4)}  artf  sync     verdict  github`];
  for (const row of rows) {
    const art = [row.artifacts.proposal, row.artifacts.spec, row.artifacts.design, row.artifacts.tasks].map((v) => (v ? "✓" : "·")).join("");
    lines.push(`${row.slug.padEnd(width)}  ${art}  ${row.synced ? "synced " : "pending"}  ${row.lastVerdict ?? "—"}  ${row.github ?? "—"}`);
  }
  return lines.join("\n");
}

function readLinksBySlug(slugs: readonly string[]): Record<string, LinksRecord> {
  const out: Record<string, LinksRecord> = {};
  for (const slug of slugs) out[slug] = readLinks(".sdd", slug);
  return out;
}

function runStatus(ctx: PiCommandContext): void {
  const notify = (m: string, t?: NotifyType) => { try { ctx.ui.notify(m, t); } catch {} };
  let sddDir: Record<string, string[]> = {};
  let archiveEntries: string[] = [];
  if (existsSync(".sdd")) sddDir = listProjectSdd();
  if (existsSync(join(".sdd", "archive"))) archiveEntries = readdirSync(join(".sdd", "archive"));
  const runRecords = readRunRecords(join(homedir(), ".pi", "zero-runs.jsonl"));
  const linksBySlug = readLinksBySlug(Object.keys(sddDir));
  notify(render(buildStatus({ sddDir, archiveEntries, runRecords, linksBySlug })), "info");
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-status", {
    description: "Muestra estado de artefactos, sync y último veredicto de runs .sdd/",
    handler: (_args: string, ctx: PiCommandContext): void => {
      try { if (ctx?.ui?.notify) runStatus(ctx); }
      catch (err) { try { ctx.ui.notify(`zero-status: ${err instanceof Error ? err.message : String(err)}`, "error"); } catch {} }
    },
  });
}
