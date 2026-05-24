import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { readRunRecords } from "./autotune.ts";
import { createGitRunner, type GitRunner, type SpawnLike } from "./git-runner.ts";
import { mergeDelta } from "./spec-merge.ts";
import { writeLinks } from "./sdd-links.ts";
import { validateSpecInputs, validateTasksFile } from "./zero-validate.ts";

const SDD_DIR = ".sdd";
type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

function parse(args: string): { slug: string; dryRun: boolean; json: boolean; allowDirty: boolean } { const out = { slug: "", dryRun: false, json: false, allowDirty: false }; for (const p of args.trim().split(/\s+/).filter(Boolean)) { if (p === "--dry-run") out.dryRun = true; else if (p === "--json") out.json = true; else if (p === "--allow-dirty") out.allowDirty = true; else if (!out.slug) out.slug = p; } return out; }
function notify(ctx: PiCommandContext, message: string, type?: NotifyType) { try { ctx.ui.notify(message, type); } catch {} }
function latestVerdict(slug: string): string | null { const path = process.env.ZERO_RUNS_PATH || join(homedir(), ".pi", "zero-runs.jsonl"); let latest: { ts: string; verdict: string } | null = null; for (const r of readRunRecords(path)) if (r.feature === slug && (!latest || r.ts > latest.ts)) latest = { ts: r.ts, verdict: r.verdict }; return latest?.verdict ?? null; }
function today(): string { return new Date().toISOString().slice(0, 10); }
function read(path: string): string { try { return readFileSync(path, "utf8"); } catch { return ""; } }
function atomicWrite(path: string, content: string): void { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.${process.pid}.${Date.now()}.tmp`; writeFileSync(tmp, content, "utf8"); renameSync(tmp, path); }
function specPairs(runDir: string): Array<{ domain: string; deltaPath: string; canonicalPath: string }> { const out: Array<{ domain: string; deltaPath: string; canonicalPath: string }> = []; if (existsSync(join(runDir, "spec.md"))) out.push({ domain: "default", deltaPath: join(runDir, "spec.md"), canonicalPath: join(SDD_DIR, "specs", "requirements.md") }); try { const base = join(runDir, "specs"); for (const e of readdirSync(base, { withFileTypes: true })) if (e.isDirectory() && existsSync(join(base, e.name, "spec.md"))) out.push({ domain: e.name, deltaPath: join(base, e.name, "spec.md"), canonicalPath: join(SDD_DIR, "specs", e.name, "requirements.md") }); } catch {} return out; }

export async function runZeroArchive(args: string, ctx: PiCommandContext, git: GitRunner = createGitRunner(spawn as unknown as SpawnLike)): Promise<void> {
  const opts = parse(args);
  if (!opts.slug) { notify(ctx, "zero-archive: usage /zero-archive <slug> [--dry-run] [--json] [--allow-dirty]", "warning"); return; }
  const runDir = join(SDD_DIR, opts.slug);
  const emit = (payload: unknown, text: string, type: NotifyType = "info") => notify(ctx, opts.json ? JSON.stringify(payload) : text, type);
  if (!existsSync(runDir)) { emit({ ok: false, reason: "missing-run" }, `zero-archive: no existe ${runDir}`, "error"); return; }
  const verdict = latestVerdict(opts.slug); if (verdict !== "pasa") { emit({ ok: false, reason: "verdict", verdict }, `zero-archive: ${opts.slug} no tiene veredicto pasa (último: ${verdict ?? "—"})`, "error"); return; }
  if (!opts.allowDirty && await git.isDirty()) { emit({ ok: false, reason: "dirty-worktree" }, "zero-archive: worktree sucio; usá --allow-dirty si corresponde", "error"); return; }
  const defects = [...validateSpecInputs(runDir), ...validateTasksFile(read(join(runDir, "tasks.md")))]; if (defects.length) { emit({ ok: false, reason: "validate", defects }, `zero-archive: validación falló\n${defects.map((d) => `  - [${d.kind}] ${d.message}`).join("\n")}`, "error"); return; }
  const pairs = specPairs(runDir); if (!pairs.length) { emit({ ok: false, reason: "missing-spec" }, "zero-archive: no hay spec.md para archivar", "error"); return; }
  const writes: Array<{ path: string; next: string; before: string | null }> = [];
  for (const pair of pairs) { const before = existsSync(pair.canonicalPath) ? read(pair.canonicalPath) : ""; const merged = mergeDelta(before, read(pair.deltaPath)); if (!merged.ok) { emit({ ok: false, reason: "merge", errors: merged.errors }, `zero-archive: merge falló en ${pair.domain}: ${merged.errors.map((e) => e.message).join("; ")}`, "error"); return; } writes.push({ path: pair.canonicalPath, next: merged.store, before: existsSync(pair.canonicalPath) ? before : null }); }
  const archivePath = join(SDD_DIR, "archive", `${today()}-${opts.slug}`);
  if (opts.dryRun) { emit({ ok: true, dryRun: true, archivePath, writes: writes.map((w) => w.path) }, `zero-archive: dry-run archivaría ${opts.slug} en ${archivePath}`); return; }
  const written: typeof writes = [];
  try { for (const w of writes) { atomicWrite(w.path, w.next); written.push(w); } writeLinks(SDD_DIR, opts.slug, { archivePath }); mkdirSync(dirname(archivePath), { recursive: true }); renameSync(runDir, archivePath); emit({ ok: true, archivePath, writes: writes.map((w) => w.path) }, `zero-archive: archivado en ${archivePath}`); }
  catch (err) { for (const w of written.reverse()) { if (w.before === null) rmSync(w.path, { force: true }); else atomicWrite(w.path, w.before); } emit({ ok: false, reason: "rollback", error: err instanceof Error ? err.message : String(err) }, `zero-archive: falló y revertí cambios canónicos: ${err instanceof Error ? err.message : String(err)}`, "error"); }
}

export default function register(pi?: PiExtensionAPI): void { if (!pi || typeof pi.registerCommand !== "function") return; pi.registerCommand("zero-archive", { description: "Mergea el delta aprobado a .sdd/specs y mueve el run a .sdd/archive", handler: (args, ctx) => runZeroArchive(args, ctx).catch((err) => notify(ctx, `zero-archive: ${err instanceof Error ? err.message : String(err)}`, "error")) }); }
