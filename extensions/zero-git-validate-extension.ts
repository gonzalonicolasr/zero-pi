import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readRunRecords } from "./autotune.ts";
import { createGhRunner, type SpawnLike as GhSpawnLike } from "./gh-runner.ts";
import { createGitRunner, type GitRunner, type SpawnLike } from "./git-runner.ts";
import { readLinks } from "./sdd-links.ts";

const SDD_DIR = ".sdd";
type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }
export interface GitCheck { name: string; ok: boolean; message: string }

function parse(args: string): { slug: string; forMode: "pr" | "archive" | "any"; json: boolean } {
  const out = { slug: "", forMode: "any" as "pr" | "archive" | "any", json: false };
  for (const p of args.trim().split(/\s+/).filter(Boolean)) {
    if (p === "--json") out.json = true;
    else if (p.startsWith("--for=")) out.forMode = ["pr", "archive", "any"].includes(p.slice(6)) ? p.slice(6) as any : "any";
    else if (!out.slug) out.slug = p;
  }
  return out;
}
function latestVerdict(slug: string): string | null {
  const path = process.env.ZERO_RUNS_PATH || join(homedir(), ".pi", "zero-runs.jsonl");
  let latest: { ts: string; verdict: string } | null = null;
  for (const r of readRunRecords(path)) if (r.feature === slug && (!latest || r.ts > latest.ts)) latest = { ts: r.ts, verdict: r.verdict };
  return latest?.verdict ?? null;
}
async function ghAvailable(spawnImpl: GhSpawnLike): Promise<boolean> { return Boolean((await createGhRunner({ spawn: spawnImpl }).detect()).data?.available); }
export async function validateGitState(slug: string, forMode: "pr" | "archive" | "any", git: GitRunner, ghSpawn: GhSpawnLike = spawn as unknown as GhSpawnLike): Promise<{ ok: boolean; checks: GitCheck[] }> {
  const links = readLinks(SDD_DIR, slug);
  const expectedBranch = typeof links.branch === "string" ? links.branch : null;
  const checks: GitCheck[] = [];
  const dirty = await git.isDirty(); checks.push({ name: "worktree", ok: !dirty, message: dirty ? "worktree has uncommitted changes" : "worktree clean" });
  const current = await git.currentBranch(); checks.push({ name: "branch", ok: !expectedBranch || current === expectedBranch, message: expectedBranch ? `current ${current || "(detached)"}, expected ${expectedBranch}` : `current ${current || "(detached)"}` });
  checks.push({ name: "remote", ok: await git.hasRemote("origin"), message: "origin remote configured" });
  if (forMode === "pr") checks.push({ name: "gh-auth", ok: await ghAvailable(ghSpawn), message: "gh CLI available/authenticated" });
  if (forMode === "pr" || forMode === "archive") { const verdict = latestVerdict(slug); checks.push({ name: "verdict", ok: verdict === "pasa", message: `latest verdict ${verdict ?? "—"}` }); }
  return { ok: checks.every((c) => c.ok), checks };
}
export async function runZeroGitValidate(args: string, ctx: PiCommandContext, git: GitRunner = createGitRunner(spawn as unknown as SpawnLike), ghSpawn: GhSpawnLike = spawn as unknown as GhSpawnLike): Promise<void> {
  const opts = parse(args);
  const notify = (m: string, t?: NotifyType) => { try { ctx.ui.notify(m, t); } catch {} };
  if (!opts.slug) { notify("zero-git-validate: usage /zero-git-validate <slug> [--for=pr|archive|any] [--json]", "warning"); return; }
  if (!existsSync(join(SDD_DIR, opts.slug))) { notify(`zero-git-validate: no existe .sdd/${opts.slug}`, "error"); return; }
  const result = await validateGitState(opts.slug, opts.forMode, git, ghSpawn);
  const text = result.checks.map((c) => `${c.ok ? "✅" : "❌"} ${c.name}: ${c.message}`).join("\n");
  notify(opts.json ? JSON.stringify(result) : `zero-git-validate: ${result.ok ? "ok" : "falló"}\n${text}`, result.ok ? "info" : "error");
}
export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-git-validate", { description: "Valida worktree, rama, remote, gh auth y veredicto antes de PR/archive", handler: (args, ctx) => runZeroGitValidate(args, ctx).catch((err) => { try { ctx.ui.notify(`zero-git-validate: ${err instanceof Error ? err.message : String(err)}`, "error"); } catch {} }) });
}
