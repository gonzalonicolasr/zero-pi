import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isEmptyDelta, mergeDelta, parseDelta, type MergeSummary } from "./spec-merge.ts";

const SDD_DIR = ".sdd";
const STORE_FILE = join(".sdd", "specs", "requirements.md");

type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

function readFileOrNull(path: string): string | null { try { return readFileSync(path, "utf8"); } catch { return null; } }
function resolveSlug(arg: string): string | null {
  const explicit = arg.trim();
  if (explicit) return explicit;
  try {
    const candidates = readdirSync(SDD_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "specs" && e.name !== "archive" && existsSync(join(SDD_DIR, e.name, "spec.md"))).map((e) => e.name);
    return candidates.length === 1 ? candidates[0] : null;
  } catch { return null; }
}

export function formatDiffReport(summary: MergeSummary): string {
  const lines = ["zero-diff: delta aplicaría estos cambios:"];
  if (summary.added.length) lines.push(`  agregados:    ${summary.added.join(", ")}`);
  if (summary.modified.length) lines.push(`  modificados:  ${summary.modified.join(", ")}`);
  if (summary.renamed.length) lines.push(`  renombrados:  ${summary.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}`);
  if (summary.removed.length) lines.push(`  eliminados:   ${summary.removed.join(", ")}`);
  return lines.join("\n");
}

function runDiff(args: string, ctx: PiCommandContext): void {
  const notify = (m: string, t?: NotifyType) => { try { ctx.ui.notify(m, t); } catch {} };
  const slug = resolveSlug(args);
  if (slug === null) { notify("zero-diff: no hay un único run — corré /zero-diff <slug>", "warning"); return; }
  const deltaPath = join(SDD_DIR, slug, "spec.md");
  const deltaText = readFileOrNull(deltaPath);
  if (deltaText === null) { notify(`zero-diff: ${deltaPath} no existe — no hay delta para comparar`, "warning"); return; }
  const storeText = readFileOrNull(STORE_FILE) ?? "";
  const result = mergeDelta(storeText, deltaText);
  if (!result.ok) {
    const detail = result.errors.map((e) => `  - [${e.kind}] ${e.message}`).join("\n");
    notify(`zero-diff: store NO se podría actualizar — el delta tiene errores de guardrail:\n${detail}`, "error");
    return;
  }
  if (isEmptyDelta(parseDelta(deltaText))) notify(`zero-diff: delta vacío en ${deltaPath} — nada cambiaría`, "info");
  else notify(formatDiffReport(result.summary), "info");
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-diff", {
    description: "Muestra el diff lógico de un spec.md delta sin escribir archivos",
    handler: (args: string, ctx: PiCommandContext): void => {
      try { if (ctx?.ui?.notify) runDiff(args, ctx); }
      catch (err) { try { ctx.ui.notify(`zero-diff: ${err instanceof Error ? err.message : String(err)}`, "error"); } catch {} }
    },
  });
}
