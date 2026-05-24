import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIssueBody } from "./pr-body.ts";
import { createGhRunner, type SpawnLike } from "./gh-runner.ts";
import { writeLinks } from "./sdd-links.ts";

const SDD_DIR = ".sdd";
type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }
function readFileOrEmpty(path: string): string { try { return readFileSync(path, "utf8"); } catch { return ""; } }
function resolveSlug(arg: string): string | null { if (arg.trim()) return arg.trim(); try { const c = readdirSync(SDD_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "specs" && e.name !== "archive").map((e) => e.name); return c.length === 1 ? c[0] : null; } catch { return null; } }
function parseArgs(args: string): { slugArg: string; labels: string[] } { const parts = args.trim().split(/\s+/).filter(Boolean); let slugArg = ""; let type: string | undefined; for (const p of parts) p.startsWith("--type=") ? type = p.slice(7) : slugArg ||= p; return { slugArg, labels: type ? [type] : ["type:feature"] }; }
function normalizeTitle(s: string): string { return s.toLowerCase().replace(/\s+/g, " ").trim(); }
async function labelIfExists(gh: ReturnType<typeof createGhRunner>, candidates: string[]): Promise<{ applied: string[]; skipped: string[] }> { const labels = await gh.listLabels(); const existing = new Set(labels.ok ? (labels.data ?? []) : []); return { applied: candidates.filter((l) => existing.has(l)), skipped: candidates.filter((l) => !existing.has(l)) }; }
function writeTempBody(body: string): string { const file = join(tmpdir(), `zero-issue-body-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`); writeFileSync(file, body, "utf8"); return file; }
function skippedNote(skipped: string[]): string { return skipped.length ? `; skipié labels que no existen en este repo: ${skipped.join(", ")}` : ""; }

export async function runZeroIssue(args: string, ctx: PiCommandContext, spawnImpl: SpawnLike = spawn as unknown as SpawnLike): Promise<void> {
  const notify = (m: string, t?: NotifyType) => { try { ctx.ui.notify(m, t); } catch {} };
  const { slugArg, labels } = parseArgs(args);
  const slug = resolveSlug(slugArg);
  if (slug === null) { notify("zero-issue: no hay un único run — corré /zero-issue <slug>", "warning"); return; }
  const dir = join(SDD_DIR, slug);
  const built = buildIssueBody({ proposalMd: readFileOrEmpty(join(dir, "proposal.md")), specMd: readFileOrEmpty(join(dir, "spec.md")) });
  const gh = createGhRunner({ spawn: spawnImpl });
  const detected = await gh.detect();
  if (!detected.data?.available) { notify(`zero-issue: ${detected.data?.hint ?? "gh CLI no disponible"}`, "error"); return; }
  const dup = await gh.searchIssues(built.title);
  if (!dup.ok) { notify(`zero-issue: gh issue list falló${dup.stderr ? ` — ${dup.stderr}` : ""}`, "error"); return; }
  const existing = dup.data?.find((i) => normalizeTitle(i.title) === normalizeTitle(built.title));
  if (existing) { writeLinks(SDD_DIR, slug, { issueNumber: existing.number, issueUrl: existing.url, createdAt: new Date().toISOString() }); notify(`zero-issue: ya existe el issue #${existing.number}`, "info"); return; }
  const { applied, skipped } = await labelIfExists(gh, labels);
  const tmp = writeTempBody(built.body);
  try {
    const created = await gh.createIssue({ title: built.title, bodyFile: tmp, labels: applied });
    if (!created.ok) { notify(`zero-issue: gh issue create falló${created.stderr ? ` — ${created.stderr}` : ""}`, "error"); return; }
    writeLinks(SDD_DIR, slug, { issueNumber: created.data?.number, issueUrl: created.data?.url, createdAt: new Date().toISOString() });
    notify(`zero-issue: issue creado${created.data?.number ? ` #${created.data.number}` : ""}${created.data?.url ? ` ${created.data.url}` : ""}${skippedNote(skipped)}`, "info");
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-issue", { description: "Crea o enlaza un issue de GitHub desde .sdd/<slug>", handler: (args, ctx) => runZeroIssue(args, ctx).catch((err) => { try { ctx.ui.notify(`zero-issue: ${err instanceof Error ? err.message : String(err)}`, "error"); } catch {} }) });
}
