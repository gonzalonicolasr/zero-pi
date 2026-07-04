import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parseMeta, selectRunMetas, aggregateRun, formatReport, type PhaseMeta } from "./zero-cost.ts";

type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

export interface ReadAllPhaseMetasOptions {
  /** Override for tests; defaults to ~/.pi/agent/sessions. */
  sessionsRoot?: string;
  /** Project cwd used to discover local .pi-subagents/artifacts; defaults to process.cwd(). */
  cwd?: string;
  /** Disable project-local .pi-subagents scanning when needed. */
  includeProjectArtifacts?: boolean;
}

function addMeta(out: PhaseMeta[], seen: Set<string>, meta: PhaseMeta): void {
  const key = `${meta.runId}\0${meta.phase}\0${meta.slug ?? ""}\0${meta.timestamp}\0${meta.model}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(meta);
}

function readArtifactDir(artifacts: string, out: PhaseMeta[], seen: Set<string>): void {
  if (!existsSync(artifacts)) return;
  let files: string[];
  try { files = readdirSync(artifacts); }
  catch { return; }
  for (const f of files) {
    if (!f.endsWith("_meta.json")) continue;
    try {
      const meta = parseMeta(JSON.parse(readFileSync(join(artifacts, f), "utf8")));
      if (meta) addMeta(out, seen, meta);
    } catch { /* skip unreadable / malformed meta */ }
  }
}

function localArtifactDirs(startCwd: string): string[] {
  const out: string[] = [];
  const home = resolve(homedir());
  let dir = resolve(startCwd);
  let hops = 0;
  for (;;) {
    out.push(join(dir, ".pi-subagents", "artifacts"));
    const parent = dirname(dir);
    if (dir === parent || dir === home || hops >= 8) break;
    dir = parent;
    hops += 1;
  }
  return out;
}

/** Read every sub-agent `meta.json` that zero-cost knows about:
 *  - pi-native `/forge` artifacts under `~/.pi/agent/sessions/<session>/subagent-artifacts/`.
 *  - project-local pi-subagents artifacts under `.pi-subagents/artifacts/` from
 *    the current cwd and its parents. This covers manually delegated zero phase
 *    runs without making `/zero-cost` scan unrelated projects. */
export function readAllPhaseMetas(options: ReadAllPhaseMetasOptions = {}): PhaseMeta[] {
  const root = options.sessionsRoot ?? join(homedir(), ".pi", "agent", "sessions");
  const out: PhaseMeta[] = [];
  const seen = new Set<string>();

  if (existsSync(root)) {
    try {
      for (const session of readdirSync(root, { withFileTypes: true })) {
        if (!session.isDirectory()) continue;
        readArtifactDir(join(root, session.name, "subagent-artifacts"), out, seen);
      }
    } catch { /* ignore inaccessible session root */ }
  }

  if (options.includeProjectArtifacts !== false) {
    for (const artifacts of localArtifactDirs(options.cwd ?? process.cwd())) {
      readArtifactDir(artifacts, out, seen);
    }
  }

  return out;
}

export function formatNoCostMessage(slug: string | null, metaCount: number): string {
  const searched = "Busqué en ~/.pi/agent/sessions/*/subagent-artifacts/ y en .pi-subagents/artifacts/ del proyecto actual (y padres).";
  if (slug) {
    const hint = metaCount > 0
      ? "Encontré metadata de otros runs, pero ningún meta matchea ese slug; probá /zero-cost sin argumento o revisá el slug exacto."
      : "No encontré ningún *_meta.json de zero-* todavía.";
    return [
      `zero-cost: no encontré datos de costo para "${slug}".`,
      searched,
      hint,
      "Si el run fue manual con subagent(...) en otro proyecto, corré /zero-cost desde ese cwd; si no hay *_meta.json, no hay costo recuperable.",
    ].join("\n");
  }
  return [
    "zero-cost: no encontré runs con datos de costo todavía.",
    searched,
    "/zero-cost solo suma metadata real (*_meta.json). Ejecutá /forge nativo y volvé a probar; si el run fue manual, corré el comando desde el proyecto donde quedó .pi-subagents/.",
  ].join("\n");
}

export function runZeroCost(args: string, ctx: PiCommandContext, options: ReadAllPhaseMetasOptions = {}): void {
  const notify = (m: string, t?: NotifyType) => { try { ctx.ui.notify(m, t); } catch {} };
  const slug = args.trim() || null;
  const metas = readAllPhaseMetas(options);
  const selected = selectRunMetas(metas, slug);
  if (selected.length === 0) {
    notify(formatNoCostMessage(slug, metas.length), "info");
    return;
  }
  notify(formatReport(aggregateRun(selected, slug ?? selected[0]?.slug ?? null)), "info");
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-cost", {
    description: "Reporta tokens, costo y duración por fase de un run SDD (slug opcional; sin slug = el más reciente)",
    handler: (args: string, ctx: PiCommandContext): void => {
      try { if (ctx?.ui?.notify) runZeroCost(args ?? "", ctx); }
      catch (err) { try { ctx.ui.notify(`zero-cost: ${err instanceof Error ? err.message : String(err)}`, "error"); } catch {} }
    },
  });
}
