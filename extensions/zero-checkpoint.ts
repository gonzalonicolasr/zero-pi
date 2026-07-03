import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CheckpointRunner {
  run(command: string, args: readonly string[]): { status: number; stdout: string; stderr: string; error?: string };
}

export interface CheckpointResult {
  ok: boolean;
  slug: string;
  id: string;
  dir: string;
  head: string;
  dirty: boolean;
  untracked: string[];
  message?: string;
}

export function checkpointId(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function parseCheckpointArgs(args: string): { slug: string | null; json: boolean } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  let slug: string | null = null;
  let json = false;
  for (const part of parts) {
    if (part === "--json") json = true;
    else if (!slug) slug = part;
  }
  return { slug, json };
}

export function untrackedFromStatus(status: string): string[] {
  return status
    .split(/\r?\n/)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

export function formatCheckpointReport(result: CheckpointResult): string {
  if (!result.ok) return `zero-checkpoint: ${result.message ?? "falló"}`;
  const lines = [
    `zero-checkpoint: ${result.slug} @ ${result.id}`,
    `  dir: ${result.dir}`,
    `  head: ${result.head}`,
    result.dirty ? "  estado: cambios capturados en diff.patch" : "  estado: worktree limpio (checkpoint base)",
  ];
  if (result.untracked.length > 0) {
    lines.push(`  aviso: ${result.untracked.length} untracked no se incluyen en diff.patch (${result.untracked.slice(0, 5).join(", ")}${result.untracked.length > 5 ? ", …" : ""})`);
  }
  lines.push("  restore: revisá restore.sh antes de ejecutarlo");
  return lines.join("\n");
}

export function createCheckpoint(
  slug: string,
  cwd: string,
  runner: CheckpointRunner,
  now = new Date(),
): CheckpointResult {
  const root = runner.run("git", ["rev-parse", "--show-toplevel"]);
  if (root.status !== 0) return { ok: false, slug, id: "", dir: "", head: "", dirty: false, untracked: [], message: "este cwd no parece estar dentro de un repo git" };
  const repoRoot = root.stdout.trim() || cwd;

  const head = runner.run("git", ["rev-parse", "--short", "HEAD"]);
  if (head.status !== 0) return { ok: false, slug, id: "", dir: "", head: "", dirty: false, untracked: [], message: "no pude resolver HEAD" };

  const status = runner.run("git", ["status", "--short"]);
  const diff = runner.run("git", ["diff", "--binary", "HEAD"]);
  if (status.status !== 0 || diff.status !== 0) return { ok: false, slug, id: "", dir: "", head: head.stdout.trim(), dirty: false, untracked: [], message: "no pude leer el estado git" };

  const id = checkpointId(now);
  const dir = join(repoRoot, ".sdd", slug, "checkpoints", id);
  mkdirSync(dir, { recursive: true });
  const untracked = untrackedFromStatus(status.stdout);
  const dirty = status.stdout.trim() !== "";

  writeFileSync(join(dir, "head.txt"), `${head.stdout.trim()}\n`, "utf8");
  writeFileSync(join(dir, "status.txt"), status.stdout, "utf8");
  writeFileSync(join(dir, "diff.patch"), diff.stdout, "utf8");
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify({ slug, id, head: head.stdout.trim(), dirty, untracked, createdAt: now.toISOString() }, null, 2)}\n`, "utf8");
  writeFileSync(
    join(dir, "restore.sh"),
    `#!/usr/bin/env bash\nset -euo pipefail\n# Review before running. This restores tracked files to checkpoint ${id}.\ngit reset --hard ${head.stdout.trim()}\ngit apply --3way ${JSON.stringify(join(dir, "diff.patch"))}\n`,
    "utf8",
  );

  return { ok: true, slug, id, dir, head: head.stdout.trim(), dirty, untracked };
}
