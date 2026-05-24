import { spawn } from "node:child_process";

import { createGitRunner, type GitRunner, type SpawnLike } from "./git-runner.ts";
import { loadSddConfig } from "./sdd-config.ts";
import { writeLinks } from "./sdd-links.ts";

const SDD_DIR = ".sdd";
type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

export interface BranchOptions { slug: string; dryRun: boolean; json: boolean; allowDirty: boolean; base?: string }

export function sanitizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-") || "feature";
}

export function parseBranchArgs(args: string): BranchOptions {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const out: BranchOptions = { slug: "", dryRun: false, json: false, allowDirty: false };
  for (const p of parts) {
    if (p === "--dry-run") out.dryRun = true;
    else if (p === "--json") out.json = true;
    else if (p === "--allow-dirty") out.allowDirty = true;
    else if (p.startsWith("--base=")) out.base = p.slice(7);
    else if (!out.slug) out.slug = p;
  }
  return out;
}

function notify(ctx: PiCommandContext, message: string, type?: NotifyType) { try { ctx.ui.notify(message, type); } catch {} }
function emit(ctx: PiCommandContext, opts: BranchOptions, payload: unknown, text: string, type: NotifyType = "info") { notify(ctx, opts.json ? JSON.stringify(payload) : text, type); }

export async function runZeroBranch(args: string, ctx: PiCommandContext, runner?: GitRunner): Promise<void> {
  const opts = parseBranchArgs(args);
  if (!opts.slug) { notify(ctx, "zero-branch: usage /zero-branch <slug> [--dry-run] [--json] [--allow-dirty] [--base=<branch>]", "warning"); return; }
  const config = loadSddConfig(process.cwd());
  const branch = `${config.git.branchPrefix}${sanitizeSlug(opts.slug)}`;
  const base = opts.base ?? config.git.baseBranch;
  const git = runner ?? createGitRunner(spawn as unknown as SpawnLike);
  if (!opts.allowDirty && await git.isDirty()) { emit(ctx, opts, { ok: false, branch, reason: "dirty-worktree" }, `zero-branch: worktree sucio; usá --allow-dirty si querés continuar`, "error"); return; }
  if (opts.dryRun) { emit(ctx, opts, { ok: true, dryRun: true, branch, baseBranch: base }, `zero-branch: dry-run crearía/cambiaría a ${branch} desde ${base}`); return; }

  let action = "create";
  if (await git.branchExists(branch)) {
    action = "reuse-local";
    const switched = await git.switchBranch(branch);
    if (!switched.ok) { emit(ctx, opts, { ok: false, branch, action, stderr: switched.stderr }, `zero-branch: no pude cambiar a ${branch}: ${switched.stderr}`, "error"); return; }
  } else if (await git.branchExists(branch, true)) {
    action = "track-remote";
    const switched = await git.run(["switch", "--track", `origin/${branch}`]);
    if (!switched.ok) { emit(ctx, opts, { ok: false, branch, action, stderr: switched.stderr }, `zero-branch: no pude trackear origin/${branch}: ${switched.stderr}`, "error"); return; }
  } else {
    const created = await git.createBranch(branch, base);
    if (!created.ok) { emit(ctx, opts, { ok: false, branch, action, stderr: created.stderr }, `zero-branch: no pude crear ${branch}: ${created.stderr}`, "error"); return; }
  }
  writeLinks(SDD_DIR, opts.slug, { branch, baseBranch: base });
  emit(ctx, opts, { ok: true, branch, baseBranch: base, action }, `zero-branch: ${action} ${branch} (base ${base})`);
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-branch", { description: "Crea o cambia a la rama Git sdd/<slug> y la registra en links.json", handler: (args, ctx) => runZeroBranch(args, ctx).catch((err) => notify(ctx, `zero-branch: ${err instanceof Error ? err.message : String(err)}`, "error")) });
}
