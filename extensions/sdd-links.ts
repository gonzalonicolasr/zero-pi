import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SddLinks {
  prNumber?: number;
  prUrl?: string;
  issueNumber?: number;
  issueUrl?: string;
  branch?: string;
  baseBranch?: string;
  archivePath?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export type LinksRecord = SddLinks;

function linksPath(sddDir: string, slug: string): string {
  return join(sddDir, slug, "links.json");
}

function validRecord(value: unknown): SddLinks {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as SddLinks : {};
}

export function readLinks(sddDir: string, slug: string): SddLinks {
  const path = linksPath(sddDir, slug);
  if (!existsSync(path)) return {};
  try {
    return validRecord(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

export function mergeLinks(current: SddLinks, partial: SddLinks): SddLinks {
  return { ...validRecord(current), ...validRecord(partial) };
}

export function writeLinks(sddDir: string, slug: string, partial: SddLinks): SddLinks {
  const path = linksPath(sddDir, slug);
  const next = mergeLinks(readLinks(sddDir, slug), partial);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
  return next;
}
