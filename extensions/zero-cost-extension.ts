import { aggregateRun, formatReport } from "./zero-cost.ts";
import { reconcileExecution, selectExecution, unreadableLedgers } from "./zero-execution.ts";

type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { cwd?: string; ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

/** Only current-project execution ledgers and their exact attached runtime paths.
 * No ancestor/session traversal; legacy task text cannot establish attribution. */
export function runZeroCost(args: string, ctx: PiCommandContext, options: { cwd?: string } = {}): void {
  const cwd = options.cwd ?? ctx.cwd ?? process.cwd();
  const ledger = selectExecution(cwd, args.trim() || undefined);
  // Ledgers enumeration could not read: reported as issues, never as zero usage.
  const unreadable = unreadableLedgers(cwd).map(u => `Ledger ilegible omitido: ${u.file}: ${u.error}`);
  if (!ledger) {
    const head = unreadable.length
      ? `zero-cost: ${args.trim() || "run"} — parcial/sin atribución. Hay ledgers de ejecución ilegibles en este cwd; su usage no se suma ni se convierte en cero. Recuperación humana requerida.`
      : `zero-cost: ${args.trim() || "run"} — unattributed / sin atribución. No hay identidad de ejecución en este cwd. Metadata legacy o manual no se suma por slug ni se convierte en cero; este lector no reconstruye sesiones históricas.`;
    ctx.ui.notify([head, ...unreadable].join("\n"), "info");
    return;
  }
  const result = reconcileExecution(cwd, ledger.runId);
  const coverage = result.attempts > 0 && result.missing === 0 ? "registrada" : "parcial";
  const lines = [
    `zero-cost: ${ledger.slug} · ${ledger.runId} · ${ledger.cwd}`,
    `Cobertura ${coverage}: ${result.metas.length}/${result.attempts} intentos registrados con usage. Solo hijos; no es el costo completo de Forge/padre.`,
    "Resume acumula nuevos hijos en la misma ejecución; reintentos incluidos una vez. Hijos no registrados no son detectables.",
  ];
  if (result.metas.length) lines.push(formatReport(aggregateRun(result.metas, ledger.slug)));
  else lines.push("Sin usage atribuible todavía: total desconocido, no cero.");
  const failed = result.receipts.filter(r => ["failed", "stopped", "paused"].includes(r.delivery)).length;
  lines.push(`Entregas fallidas/detenidas/pausadas registradas: ${failed} (su usage disponible está incluido).`);
  lines.push(...result.issues, ...unreadable);
  ctx.ui.notify(lines.join("\n"), "info");
}
export default function register(pi?: PiExtensionAPI): void {
  if (!pi?.registerCommand) return;
  pi.registerCommand("zero-cost", {
    description: "Usage de hijos por ejecución Forge del cwd: [runId|slug] (slug/default elige una sola ejecución reciente)",
    handler(args, ctx) {
      try { runZeroCost(args ?? "", ctx); }
      catch (err) { ctx.ui.notify(`zero-cost: parcial/sin atribución — ${err instanceof Error ? err.message : String(err)}`, "error"); }
    },
  });
}
