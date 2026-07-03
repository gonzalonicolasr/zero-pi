import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  groupByProvider,
  PHASES,
  readModels,
  readProviders,
  validateAssignment,
  type PiModel,
} from "./zero-models.ts";

export type DoctorLevel = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  level: DoctorLevel;
  message: string;
  hint?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface DoctorHost {
  cwd: string;
  home: string;
  nodeVersion: string;
  models?: readonly PiModel[];
  exists(path: string): boolean;
  readText(path: string): string | null;
  listDir(path: string): string[];
  run(command: string, args: readonly string[], cwd: string): CommandResult;
}

function currentPackageDir(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function defaultRun(command: string, args: readonly string[], cwd: string): CommandResult {
  try {
    const out = spawnSync(command, [...args], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      status: out.status,
      stdout: typeof out.stdout === "string" ? out.stdout : "",
      stderr: typeof out.stderr === "string" ? out.stderr : "",
      error: out.error?.message,
    };
  } catch (err) {
    return { status: null, stdout: "", stderr: "", error: err instanceof Error ? err.message : String(err) };
  }
}

export function createDefaultDoctorHost(models?: readonly PiModel[]): DoctorHost {
  return {
    cwd: process.cwd(),
    home: homedir(),
    nodeVersion: process.version,
    models,
    exists: existsSync,
    readText,
    listDir(path: string): string[] {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    run: defaultRun,
  };
}

function check(name: string, level: DoctorLevel, message: string, hint?: string): DoctorCheck {
  return hint ? { name, level, message, hint } : { name, level, message };
}

function parseVersion(version: string): number[] {
  return version.replace(/^v/, "").split(".").map((p) => Number.parseInt(p, 10)).map((n) => (Number.isFinite(n) ? n : 0));
}

export function versionAtLeast(version: string, minimum: string): boolean {
  const a = parseVersion(version);
  const b = parseVersion(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

function parseJson(text: string | null): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? { ok: true, value: value as Record<string, unknown> }
      : { ok: false, error: "JSON root is not an object" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function settingsPackages(settings: Record<string, unknown>): string[] {
  const raw = settings.packages;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") out.push(entry);
    else if (entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string") out.push((entry as { source: string }).source);
  }
  return out;
}

function packageSourceName(source: string): string {
  return source.replace(/^npm:/, "").replace(/@[^/@]+$/, "");
}

function hasPackageSource(packages: readonly string[], name: string): boolean {
  return packages.some((p) => packageSourceName(p) === name || packageSourceName(p).endsWith(`/${name}`));
}

function checkNode(host: DoctorHost): DoctorCheck {
  return versionAtLeast(host.nodeVersion, "20.6.0")
    ? check("node", "ok", `${host.nodeVersion} (>=20.6.0)`)
    : check("node", "fail", `${host.nodeVersion} es viejo`, "zero-pi requiere Node >=20.6.0");
}

function checkPiSubagents(host: DoctorHost, settings: Record<string, unknown> | null): DoctorCheck {
  const installed = host.exists(join(host.home, ".pi", "agent", "npm", "node_modules", "pi-subagents", "package.json"));
  const configured = settings ? hasPackageSource(settingsPackages(settings), "pi-subagents") : false;
  if (installed || configured) return check("pi-subagents", "ok", installed ? "package instalado" : "declarado en settings");
  return check(
    "pi-subagents",
    "fail",
    "no lo encontré instalado ni declarado",
    "corré: pi install npm:pi-subagents",
  );
}

function checkZeroJson(host: DoctorHost): { check: DoctorCheck; data: Record<string, unknown> | null } {
  const path = join(host.home, ".pi", "zero.json");
  const parsed = parseJson(host.readText(path));
  if (parsed === null) return { check: check("zero.json", "warn", "~/.pi/zero.json no existe", "se crea al usar /zero-models"), data: null };
  if (!parsed.ok) return { check: check("zero.json", "fail", `JSON inválido: ${parsed.error}`), data: null };

  const groups = groupByProvider(host.models ?? []);
  const models = readModels(parsed.value);
  const providers = readProviders(parsed.value);
  const failures: string[] = [];
  if (groups.size > 0) {
    for (const phase of PHASES) {
      const assignment = { phase, model: models[phase], provider: providers[phase] || undefined };
      const validation = validateAssignment(assignment, groups);
      if (!validation.ok) failures.push(`${phase}: ${validation.message}`);
    }
  }
  if (failures.length > 0) return { check: check("zero.json", "fail", failures.join(" · ")), data: parsed.value };
  return { check: check("zero.json", "ok", groups.size > 0 ? "parseable y modelos válidos" : "parseable (sin registry para validar modelos)"), data: parsed.value };
}

function checkSettings(host: DoctorHost): { check: DoctorCheck; data: Record<string, unknown> | null } {
  const path = join(host.home, ".pi", "agent", "settings.json");
  const parsed = parseJson(host.readText(path));
  if (parsed === null) return { check: check("settings", "warn", "~/.pi/agent/settings.json no existe"), data: null };
  if (!parsed.ok) return { check: check("settings", "fail", `JSON inválido: ${parsed.error}`), data: null };
  return { check: check("settings", "ok", "parseable"), data: parsed.value };
}

function checkGeneratedAgents(host: DoctorHost): DoctorCheck {
  const dir = join(host.home, ".pi", "agent", "agents", "zero");
  const missing = PHASES.map((p) => `zero-${p}.md`).filter((file) => !host.exists(join(dir, file)));
  if (missing.length === 0) return check("agents", "ok", "sub-agentes zero generados");
  return check("agents", "warn", `faltan ${missing.join(", ")}`, "reiniciá pi para que zero-pi regenere ~/.pi/agent/agents/zero/");
}

function checkSupportModules(host: DoctorHost): DoctorCheck {
  const dir = join(host.home, ".pi", "agent", "agents", "zero", "support");
  const required = ["strict-tdd.md", "strict-tdd-verify.md"];
  const missing = required.filter((file) => !host.exists(join(dir, file)));
  if (missing.length === 0) return check("support", "ok", "Strict TDD support modules presentes");
  return check("support", "warn", `faltan ${missing.join(", ")}`, "reiniciá pi o reinstalá zero-pi");
}

function checkSddConfig(host: DoctorHost): DoctorCheck {
  const path = join(host.cwd, ".sdd", "config.json");
  const parsed = parseJson(host.readText(path));
  if (parsed === null) return check(".sdd/config", "ok", "no existe (opcional)");
  if (!parsed.ok) return check(".sdd/config", "fail", `JSON inválido: ${parsed.error}`);
  return check(".sdd/config", "ok", "parseable");
}

function checkZeroRuns(host: DoctorHost): DoctorCheck {
  const path = join(host.home, ".pi", "zero-runs.jsonl");
  const text = host.readText(path);
  if (text === null) return check("zero-runs", "warn", "~/.pi/zero-runs.jsonl no existe todavía", "se crea después de runs /forge");
  let lines = 0;
  let bad = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lines += 1;
    try { JSON.parse(line); } catch { bad += 1; }
  }
  if (bad > 0) return check("zero-runs", "warn", `${bad}/${lines} líneas no parsean como JSONL`);
  return check("zero-runs", "ok", `${lines} records parseables`);
}

function checkGit(host: DoctorHost): DoctorCheck {
  const root = host.run("git", ["rev-parse", "--show-toplevel"], host.cwd);
  if (root.status !== 0) return check("git", "warn", "este cwd no parece estar dentro de un repo git", root.stderr.trim() || root.error);
  const repoRoot = root.stdout.trim() || host.cwd;
  const remote = host.run("git", ["remote", "get-url", "origin"], repoRoot);
  if (remote.status === 0) return check("git", "ok", `origin: ${remote.stdout.trim()}`);
  return check("git", "warn", "repo git sin remote origin", remote.stderr.trim() || remote.error);
}

function checkGh(host: DoctorHost): DoctorCheck {
  const gh = host.run("gh", ["auth", "status"], host.cwd);
  if (gh.status === 0) return check("gh", "ok", "GitHub CLI autenticado");
  const reason = (gh.stderr || gh.stdout || gh.error || "gh auth status falló").trim().split("\n")[0];
  return check("gh", "warn", reason || "gh auth status falló", "necesario para /zero-pr y /zero-issue");
}

function checkPackageManifest(host: DoctorHost): DoctorCheck {
  const pkg = parseJson(host.readText(join(currentPackageDir(), "package.json")));
  if (!pkg || !pkg.ok) return check("zero-pi package", "warn", "no pude leer package.json del paquete");
  const version = typeof pkg.value.version === "string" ? pkg.value.version : "unknown";
  return check("zero-pi package", "ok", `@gonrocca/zero-pi v${version}`);
}

export function runDoctor(host: DoctorHost = createDefaultDoctorHost()): DoctorReport {
  const checks: DoctorCheck[] = [];
  checks.push(checkPackageManifest(host));
  checks.push(checkNode(host));
  const settings = checkSettings(host);
  checks.push(settings.check);
  checks.push(checkPiSubagents(host, settings.data));
  const zero = checkZeroJson(host);
  checks.push(zero.check);
  checks.push(checkGeneratedAgents(host));
  checks.push(checkSupportModules(host));
  checks.push(checkSddConfig(host));
  checks.push(checkZeroRuns(host));
  checks.push(checkGit(host));
  checks.push(checkGh(host));
  return { ok: checks.every((c) => c.level !== "fail"), checks };
}

function icon(level: DoctorLevel): string {
  if (level === "ok") return "✅";
  if (level === "warn") return "⚠️";
  return "❌";
}

export function formatDoctorReport(report: DoctorReport): string {
  const ok = report.checks.filter((c) => c.level === "ok").length;
  const warn = report.checks.filter((c) => c.level === "warn").length;
  const fail = report.checks.filter((c) => c.level === "fail").length;
  const lines = [`zero-doctor: ${report.ok ? "ok" : "falló"} · ${ok} ok · ${warn} warn · ${fail} fail`];
  for (const c of report.checks) {
    lines.push(`${icon(c.level)} ${c.name}: ${c.message}`);
    if (c.hint) lines.push(`   ↳ ${c.hint}`);
  }
  return lines.join("\n");
}
