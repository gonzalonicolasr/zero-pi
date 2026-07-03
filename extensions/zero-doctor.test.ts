import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatDoctorReport,
  runDoctor,
  versionAtLeast,
  type CommandResult,
  type DoctorHost,
} from "./zero-doctor.ts";

function host(over: Partial<DoctorHost> = {}): DoctorHost {
  const files = new Map<string, string>();
  const exists = new Set<string>();
  const h: DoctorHost = {
    cwd: "/repo",
    home: "/home/gon",
    nodeVersion: "v26.3.1",
    models: [
      { provider: "anthropic", id: "claude-haiku-4-5" },
      { provider: "anthropic", id: "claude-opus-4-8" },
      { provider: "anthropic", id: "claude-sonnet-4-6" },
      { provider: "openai-codex", id: "gpt-5.5" },
    ],
    exists(path: string): boolean {
      return exists.has(path) || files.has(path);
    },
    readText(path: string): string | null {
      return files.get(path) ?? null;
    },
    listDir(): string[] {
      return [];
    },
    run(command: string, args: readonly string[]): CommandResult {
      if (command === "git" && args[0] === "rev-parse") return { status: 0, stdout: "/repo\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { status: 0, stdout: "git@github.com:gonzalonicolasr/zero.git\n", stderr: "" };
      if (command === "gh") return { status: 0, stdout: "", stderr: "" };
      return { status: 1, stdout: "", stderr: "missing" };
    },
  };
  const withMaps = Object.assign(h, { files, existsSet: exists });
  return Object.assign(withMaps, over);
}

function seedHealthy(h: DoctorHost & { files?: Map<string, string>; existsSet?: Set<string> }): DoctorHost {
  h.files?.set("/home/gon/.pi/agent/settings.json", JSON.stringify({ packages: ["npm:@gonrocca/zero-pi", "npm:pi-subagents"] }));
  h.files?.set("/home/gon/.pi/zero.json", JSON.stringify({
    models: { explore: "claude-haiku-4-5", plan: "claude-opus-4-8", build: "claude-sonnet-4-6", veredicto: "claude-opus-4-8" },
    providers: { explore: "anthropic", plan: "anthropic", build: "anthropic", veredicto: "anthropic" },
  }));
  h.files?.set("/repo/.sdd/config.json", "{}");
  h.files?.set("/home/gon/.pi/zero-runs.jsonl", '{"feature":"x","verdict":"pasa"}\n');
  h.existsSet?.add("/home/gon/.pi/agent/npm/node_modules/pi-subagents/package.json");
  h.existsSet?.add("/repo/.git");
  for (const phase of ["explore", "plan", "build", "veredicto"]) h.existsSet?.add(`/home/gon/.pi/agent/agents/zero/zero-${phase}.md`);
  h.existsSet?.add("/home/gon/.pi/agent/agents/zero/support/strict-tdd.md");
  h.existsSet?.add("/home/gon/.pi/agent/agents/zero/support/strict-tdd-verify.md");
  return h;
}

test("versionAtLeast compares semver-ish node versions", () => {
  assert.equal(versionAtLeast("v26.3.1", "20.6.0"), true);
  assert.equal(versionAtLeast("v20.6.0", "20.6.0"), true);
  assert.equal(versionAtLeast("v20.5.9", "20.6.0"), false);
});

test("runDoctor returns all-ok/warn-only healthy report", () => {
  const report = runDoctor(seedHealthy(host()) as DoctorHost);
  assert.equal(report.ok, true);
  assert.equal(report.checks.some((c) => c.level === "fail"), false);
  assert.ok(report.checks.find((c) => c.name === "zero.json" && c.level === "ok"));
});

test("runDoctor fails when pi-subagents is missing", () => {
  const h = seedHealthy(host()) as DoctorHost & { files?: Map<string, string>; existsSet?: Set<string> };
  h.existsSet?.delete("/home/gon/.pi/agent/npm/node_modules/pi-subagents/package.json");
  h.files?.set("/home/gon/.pi/agent/settings.json", JSON.stringify({ packages: ["npm:@gonrocca/zero-pi"] }));
  const report = runDoctor(h);
  const c = report.checks.find((x) => x.name === "pi-subagents");
  assert.equal(report.ok, false);
  assert.equal(c?.level, "fail");
  assert.match(c?.hint ?? "", /pi install npm:pi-subagents/);
});

test("runDoctor fails on invalid configured model when registry is present", () => {
  const h = seedHealthy(host()) as DoctorHost & { files?: Map<string, string> };
  h.files?.set("/home/gon/.pi/zero.json", JSON.stringify({
    models: { build: "made-up-model" },
    providers: { build: "anthropic" },
  }));
  const report = runDoctor(h);
  const c = report.checks.find((x) => x.name === "zero.json");
  assert.equal(report.ok, false);
  assert.equal(c?.level, "fail");
  assert.match(c?.message ?? "", /modelo desconocido/);
});

test("runDoctor warns when generated agents are missing", () => {
  const h = seedHealthy(host()) as DoctorHost & { existsSet?: Set<string> };
  h.existsSet?.delete("/home/gon/.pi/agent/agents/zero/zero-build.md");
  const report = runDoctor(h);
  const c = report.checks.find((x) => x.name === "agents");
  assert.equal(report.ok, true);
  assert.equal(c?.level, "warn");
  assert.match(c?.hint ?? "", /reiniciá pi/);
});

test("formatDoctorReport summarizes counts and renders hints", () => {
  const text = formatDoctorReport({
    ok: false,
    checks: [
      { name: "a", level: "ok", message: "bien" },
      { name: "b", level: "warn", message: "ojo", hint: "hacer x" },
      { name: "c", level: "fail", message: "mal" },
    ],
  });
  assert.match(text, /1 ok · 1 warn · 1 fail/);
  assert.match(text, /↳ hacer x/);
});
