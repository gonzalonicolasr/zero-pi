import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LinksRecord {
  prNumber?: number;
  prUrl?: string;
  issueNumber?: number;
  issueUrl?: string;
  [key: string]: unknown;
}

function linksPath(sddDir: string, slug: string): string {
  return join(sddDir, slug, "links.json");
}

function validRecord(value: unknown): LinksRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as LinksRecord : {};
}

export function readLinks(sddDir: string, slug: string): LinksRecord {
  const path = linksPath(sddDir, slug);
  if (!existsSync(path)) return {};
  try {
    return validRecord(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}

export function writeLinks(sddDir: string, slug: string, partial: LinksRecord): LinksRecord {
  const path = linksPath(sddDir, slug);
  const next = { ...readLinks(sddDir, slug), ...partial };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
  return next;
}
