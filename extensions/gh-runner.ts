export interface GhResult<T = unknown> { ok: boolean; data?: T; stderr?: string; exitCode?: number }
export interface DetectData { available: boolean; version?: string; hint?: string }
export interface SpawnLike { (command: string, args: string[], options?: Record<string, unknown>): { stdout?: NodeJS.ReadableStream; stderr?: NodeJS.ReadableStream; on(event: string, cb: (...args: any[]) => void): unknown } }

function hint(): string {
  return "no encontré el `gh` CLI. Instalalo:\n  Windows: winget install GitHub.cli\n  macOS:   brew install gh\n  Linux:   apt install gh   (o el equivalente de tu distro)\ny después corré `gh auth login` una vez.";
}

function run(spawn: SpawnLike, args: string[]): Promise<GhResult<string>> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    try {
      const child = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
      child.stdout?.on("data", (d) => { stdout += String(d); });
      child.stderr?.on("data", (d) => { stderr += String(d); });
      child.on("error", (err: Error) => {
        if (!settled) { settled = true; resolve({ ok: false, stderr: err.message, exitCode: -1 }); }
      });
      child.on("close", (code: number) => {
        if (!settled) { settled = true; resolve({ ok: code === 0, data: stdout.trim(), stderr: stderr.trim(), exitCode: code }); }
      });
    } catch (err) {
      resolve({ ok: false, stderr: err instanceof Error ? err.message : String(err), exitCode: -1 });
    }
  });
}

function parseJson<T>(result: GhResult<string>, fallback: T): GhResult<T> {
  if (!result.ok) return { ok: false, stderr: result.stderr, exitCode: result.exitCode };
  if (!result.data) return { ok: true, data: fallback, stderr: result.stderr, exitCode: result.exitCode };
  try { return { ok: true, data: JSON.parse(result.data) as T, stderr: result.stderr, exitCode: result.exitCode }; }
  catch { return { ok: false, stderr: "gh devolvió JSON inválido", exitCode: result.exitCode }; }
}

function parseVersion(stdout: string | undefined): string | undefined {
  const match = (stdout ?? "").match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match?.[1];
}

function parseCreatedUrl(stdout: string | undefined, kind: "pull" | "issues"): { number?: number; url?: string } {
  const lines = (stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const url = [...lines].reverse().find((l) => /^https:\/\/github\.com\/.+/.test(l));
  const number = url ? Number((new RegExp(`/${kind}/(\\d+)(?:$|[?#])`).exec(url) ?? /\/(?:pull|pulls|issues)\/(\d+)(?:$|[?#])/.exec(url))?.[1]) : undefined;
  return { url, number: Number.isFinite(number) ? number : undefined };
}

export function createGhRunner({ spawn }: { spawn: SpawnLike }) {
  return {
    async detect(): Promise<GhResult<DetectData>> {
      const r = await run(spawn, ["--version"]);
      return r.ok ? { ok: true, data: { available: true, version: parseVersion(r.data) } } : { ok: true, data: { available: false, hint: hint() }, stderr: r.stderr, exitCode: r.exitCode };
    },
    async listLabels(): Promise<GhResult<string[]>> {
      const r = await run(spawn, ["label", "list", "--json", "name", "--limit", "200"]);
      const parsed = parseJson<Array<{ name?: string }>>(r, []);
      if (!parsed.ok) return parsed as GhResult<string[]>;
      return { ok: true, data: (parsed.data ?? []).map((l) => l.name).filter((n): n is string => typeof n === "string") };
    },
    async createPr(input: { title: string; bodyFile: string; labels?: string[]; label?: string; base?: string; head?: string }): Promise<GhResult<{ number?: number; url?: string }>> {
      const args = ["pr", "create", "--title", input.title, "--body-file", input.bodyFile];
      if (input.base) args.push("--base", input.base);
      if (input.head) args.push("--head", input.head);
      for (const label of input.labels ?? (input.label ? [input.label] : [])) args.push("--label", label);
      const r = await run(spawn, args);
      return r.ok ? { ok: true, data: parseCreatedUrl(r.data, "pull"), stderr: r.stderr, exitCode: r.exitCode } : { ok: false, stderr: r.stderr, exitCode: r.exitCode };
    },
    async searchIssues(query: string): Promise<GhResult<Array<{ number: number; title: string; url?: string }>>> {
      return parseJson(await run(spawn, ["issue", "list", "--search", query, "--state", "open", "--json", "number,title,url", "--limit", "20"]), []);
    },
    async createIssue(input: { title: string; bodyFile: string; labels?: string[]; label?: string }): Promise<GhResult<{ number?: number; url?: string }>> {
      const args = ["issue", "create", "--title", input.title, "--body-file", input.bodyFile];
      for (const label of input.labels ?? (input.label ? [input.label] : [])) args.push("--label", label);
      const r = await run(spawn, args);
      return r.ok ? { ok: true, data: parseCreatedUrl(r.data, "issues"), stderr: r.stderr, exitCode: r.exitCode } : { ok: false, stderr: r.stderr, exitCode: r.exitCode };
    },
  };
}
