import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SddConfig {
  git: {
    branchPrefix: string;
    numbering: boolean;
    autoCommit: boolean;
    commitStyle: "conventional" | "plain";
    baseBranch: string;
  };
  /**
   * Strict TDD discipline for the build/veredicto phases.
   *
   * `mode`:
   * - `"strict"` (default) — the build phase follows RED → GREEN →
   *   TRIANGULATE → REFACTOR and emits a TDD Cycle Evidence table; veredicto
   *   audits it. The discipline is **runtime-gated**: the phase prompts only
   *   engage it when a test runner is actually available and the change touches
   *   code — a docs/config-only change or a project with no test runner
   *   degrades gracefully instead of failing.
   * - `"off"` — no TDD ceremony; the build phase tests where practical only.
   *
   * `testCommand` is an optional explicit override of the test runner the TDD
   * cycle invokes; empty means the phase auto-detects it from the project.
   */
  tdd: {
    mode: "strict" | "off";
    testCommand: string;
  };
}

export const DEFAULT_SDD_CONFIG: SddConfig = {
  git: { branchPrefix: "sdd/", numbering: false, autoCommit: false, commitStyle: "conventional", baseBranch: "main" },
  tdd: { mode: "strict", testCommand: "" },
};

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function loadSddConfig(root = process.cwd()): SddConfig {
  const path = join(root, ".sdd", "config.json");
  if (!existsSync(path)) return structuredClone(DEFAULT_SDD_CONFIG);
  let parsed: Record<string, unknown>;
  try { parsed = asObject(JSON.parse(readFileSync(path, "utf8"))); }
  catch (err) { throw new Error(`invalid .sdd/config.json: ${err instanceof Error ? err.message : String(err)}`); }
  const git = asObject(parsed.git);
  const tdd = asObject(parsed.tdd);
  return {
    git: {
      branchPrefix: typeof git.branchPrefix === "string" ? git.branchPrefix : DEFAULT_SDD_CONFIG.git.branchPrefix,
      numbering: typeof git.numbering === "boolean" ? git.numbering : DEFAULT_SDD_CONFIG.git.numbering,
      autoCommit: typeof git.autoCommit === "boolean" ? git.autoCommit : DEFAULT_SDD_CONFIG.git.autoCommit,
      commitStyle: git.commitStyle === "plain" ? "plain" : DEFAULT_SDD_CONFIG.git.commitStyle,
      baseBranch: typeof git.baseBranch === "string" ? git.baseBranch : DEFAULT_SDD_CONFIG.git.baseBranch,
    },
    tdd: {
      mode: tdd.mode === "off" ? "off" : DEFAULT_SDD_CONFIG.tdd.mode,
      testCommand: typeof tdd.testCommand === "string" ? tdd.testCommand : DEFAULT_SDD_CONFIG.tdd.testCommand,
    },
  };
}
