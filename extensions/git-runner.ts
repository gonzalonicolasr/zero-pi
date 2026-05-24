import { spawn } from "node:child_process";

export interface GitResult { ok: boolean; stdout: string; stderr: string; code: number }
export type SpawnLike = typeof spawn;

export interface GitRunner {
  run(args: string[]): Promise<GitResult>;
  currentBranch(): Promise<string>;
  isDirty(): Promise<boolean>;
  branchExists(branch: string, remote?: boolean): Promise<boolean>;
  createBranch(branch: string, base?: string): Promise<GitResult>;
  switchBranch(branch: string): Promise<GitResult>;
  revParse(ref: string): Promise<GitResult>;
  hasRemote(name?: string): Promise<boolean>;
}

export function createGitRunner(spawnImpl: SpawnLike = spawn): GitRunner {
  const run = (args: string[]): Promise<GitResult> => new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child: ReturnType<SpawnLike>;
    try {
      child = spawnImpl("git", args, { shell: false }) as ReturnType<SpawnLike>;
    } catch (err) {
      resolve({ ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err), code: -1 });
      return;
    }
    child.stdout?.on("data", (d: Buffer | string) => { stdout += String(d); });
    child.stderr?.on("data", (d: Buffer | string) => { stderr += String(d); });
    child.on("error", (err: Error) => resolve({ ok: false, stdout, stderr: err.message, code: -1 }));
    child.on("close", (code: number | null) => resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? -1 }));
  });

  return {
    run,
    async currentBranch() { return (await run(["branch", "--show-current"])).stdout; },
    async isDirty() { return (await run(["status", "--porcelain"])).stdout.trim() !== ""; },
    async branchExists(branch: string, remote = false) { return (await run(remote ? ["ls-remote", "--exit-code", "--heads", "origin", branch] : ["rev-parse", "--verify", branch])).ok; },
    createBranch(branch: string, base?: string) { return run(base ? ["switch", "-c", branch, base] : ["switch", "-c", branch]); },
    switchBranch(branch: string) { return run(["switch", branch]); },
    revParse(ref: string) { return run(["rev-parse", "--verify", ref]); },
    async hasRemote(name = "origin") { return (await run(["remote", "get-url", name])).ok; },
  };
}
