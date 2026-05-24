import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { readRunRecords } from "./autotune.ts";
import { buildPrBody } from "./pr-body.ts";
import { createGhRunner, type SpawnLike } from "./gh-runner.ts";
import { readLinks, writeLinks } from "./sdd-links.ts";
import { validateArtifactSet, validateSpecInputs, validateTasksFile } from "./zero-validate.ts";

const SDD_DIR = ".sdd";
type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

function readFileOrEmpty(path: string): string { try { return readFileSync(path, "utf8"); } catch { return ""; } }
function parseArgs(args: string): { slugArg: string; labels: string[] } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  let slugArg = "";
  let type: string | undefined;
  for (const p of parts) p.startsWith("--type=") ? type = p.slice(7) : slugArg ||= p;
  return { slugArg, labels: type ? [type] : ["type:feature", "status:approved"] };
}
function resolveSlug(arg: string): string | null {
  if (arg.trim()) return arg.trim();
  try {
    const candidates = readdirSync(SDD_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "specs" && e.name !== "archive").map((e) => e.name);
    return candidates.length === 1 ? candidates[0] : null;
  } catch { return null; }
}
function latestVerdict(slug: string): { verdict: string; reasoning?: string } | null {
  const path = process.env.ZERO_RUNS_PATH || join(homedir(), ".pi", "zero-runs.jsonl");
  let latest: { ts: string; verdict: string; reasoning?: string } | null = null;
  for (const r of readRunRecords(path)) if (r.feature === slug && (!latest || r.ts > latest.ts)) latest = { ts: r.ts, verdict: r.verdict, reasoning: (r as any).reasoning ?? (r as any).verdictReasoning };
  return latest;
}
async function labelIfExists(gh: ReturnType<typeof createGhRunner>, candidates: string[]): Promise<{ applied: string[]; skipped: string[] }> {
  const labels = await gh.listLabels();
  const existing = new Set(labels.ok ? (labels.data ?? []) : []);
  return { applied: candidates.filter((l) => existing.has(l)), skipped: candidates.filter((l) => !existing.has(l)) };
}
function writeTempBody(body: string): string {
  const file = join(tmpdir(), `zero-pr-body-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(file, body, "utf8");
  return file;
}
function skippedNote(skipped: string[]): string { return skipped.length ? `; skipié labels que no existen en este repo: ${skipped.join(", ")}` : ""; }
function readSpecArtifacts(dir: string): { specMd: string; specs?: Record<string, string> } {
  const flat = readFileOrEmpty(join(dir, "spec.md"));
  const specsDir = join(dir, "specs");
  const specs: Record<string, string> = {};
  try {
    for (const e of readdirSync(specsDir, { withFileTypes: true })) if (e.isDirectory()) {
      const text = readFileOrEmpty(join(specsDir, e.name, "spec.md"));
      if (text) specs[e.name] = text;
    }
  } catch {}
  return Object.keys(specs).length ? { specMd: flat, specs } : { specMd: flat };
}

export async function runZeroPr(args: string, ctx: PiCommandContext, spawnImpl: SpawnLike = spawn as unknown as SpawnLike): Promise<void> {
  const notify = (m: string, t?: NotifyType) => { try { ctx.ui.notify(m, t); } catch {} };
  const { slugArg, labels } = parseArgs(args);
  const slug = resolveSlug(slugArg);
  if (slug === null) { notify("zero-pr: no hay un único run — corré /zero-pr <slug>", "warning"); return; }
  const verdict = latestVerdict(slug);
  if (verdict?.verdict !== "pasa") { notify(`zero-pr: ${slug} no tiene veredicto pasa (último: ${verdict?.verdict ?? "—"})`, "warning"); return; }
  const dir = join(SDD_DIR, slug);
  const artifacts = { proposalMd: readFileOrEmpty(join(dir, "proposal.md")), ...readSpecArtifacts(dir), tasksMd: readFileOrEmpty(join(dir, "tasks.md")), verdictReasoning: verdict.reasoning };
  const defects = [
    ...validateArtifactSet({ proposal: artifacts.proposalMd !== "", spec: artifacts.specMd !== "" || Boolean(artifacts.specs), design: existsSync(join(dir, "design.md")), tasks: artifacts.tasksMd !== "" }),
    ...validateSpecInputs(dir),
    ...validateTasksFile(artifacts.tasksMd),
  ].filter((d) => !d.kind.startsWith("missing-proposal"));
  if (defects.length > 0) { notify(`zero-pr: validateForPr falló:\n${defects.map((d) => `  - [${d.kind}] ${d.message}`).join("\n")}`, "error"); return; }
  const links = readLinks(SDD_DIR, slug);
  const gh = createGhRunner({ spawn: spawnImpl });
  const detected = await gh.detect();
  if (!detected.data?.available) { notify(`zero-pr: ${detected.data?.hint ?? "gh CLI no disponible"}`, "error"); return; }
  const { applied, skipped } = await labelIfExists(gh, labels);
  const built = buildPrBody({ slug, links, artifacts: { ...artifacts, linkedIssueNumber: typeof links.issueNumber === "number" ? links.issueNumber : undefined } });
  const tmp = writeTempBody(built.body);
  try {
    const result = await gh.createPr({ title: built.title, bodyFile: tmp, labels: applied, base: typeof links.baseBranch === "string" ? links.baseBranch : undefined, head: typeof links.branch === "string" ? links.branch : undefined } as any);
    if (!result.ok) { notify(`zero-pr: gh pr create falló${result.stderr ? ` — ${result.stderr}` : ""}`, "error"); return; }
    const parsedNumber = result.data?.number ?? (result.data?.url ? Number(/\/(?:pull|pulls)\/(\d+)(?:$|[?#])/.exec(result.data.url)?.[1]) : undefined);
    writeLinks(SDD_DIR, slug, { prNumber: Number.isFinite(parsedNumber) ? parsedNumber : undefined, prUrl: result.data?.url, createdAt: new Date().toISOString() });
    notify(`zero-pr: PR creado${result.data?.number ? ` #${result.data.number}` : ""}${result.data?.url ? ` ${result.data.url}` : ""}${skippedNote(skipped)}`, "info");
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-pr", { description: "Crea un PR de GitHub desde .sdd/<slug>", handler: (args, ctx) => runZeroPr(args, ctx).catch((err) => { try { ctx.ui.notify(`zero-pr: ${err instanceof Error ? err.message : String(err)}`, "error"); } catch {} }) });
}
