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
}

export const DEFAULT_SDD_CONFIG: SddConfig = {
  git: { branchPrefix: "sdd/", numbering: false, autoCommit: false, commitStyle: "conventional", baseBranch: "main" },
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
  return {
    git: {
      branchPrefix: typeof git.branchPrefix === "string" ? git.branchPrefix : DEFAULT_SDD_CONFIG.git.branchPrefix,
      numbering: typeof git.numbering === "boolean" ? git.numbering : DEFAULT_SDD_CONFIG.git.numbering,
      autoCommit: typeof git.autoCommit === "boolean" ? git.autoCommit : DEFAULT_SDD_CONFIG.git.autoCommit,
      commitStyle: git.commitStyle === "plain" ? "plain" : DEFAULT_SDD_CONFIG.git.commitStyle,
      baseBranch: typeof git.baseBranch === "string" ? git.baseBranch : DEFAULT_SDD_CONFIG.git.baseBranch,
    },
  };
}
