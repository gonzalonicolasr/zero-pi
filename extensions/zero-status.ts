import type { RunRecord } from "./autotune.ts";

export interface StatusRow {
  slug: string;
  artifacts: { proposal: boolean; spec: boolean; design: boolean; tasks: boolean };
  synced: boolean;
  lastVerdict: string | null;
  github?: string;
}

export interface GithubLinks { prNumber?: number; issueNumber?: number }

export function formatGithubCell(links: GithubLinks | undefined): string {
  if (!links) return "—";
  const parts: string[] = [];
  if (typeof links.prNumber === "number") parts.push(`#${links.prNumber}`);
  if (typeof links.issueNumber === "number") parts.push(`issue #${links.issueNumber}`);
  return parts.length ? parts.join(" / ") : "—";
}

export function matchesArchiveEntry(slug: string, name: string): boolean {
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${esc}(?:-\\d+)?$`).test(name);
}

export function latestVerdictBySlug(records: readonly Pick<RunRecord, "feature" | "ts" | "verdict">[]): Map<string, string> {
  const latest = new Map<string, { ts: string; verdict: string }>();
  for (const record of records) {
    const prev = latest.get(record.feature);
    if (!prev || record.ts > prev.ts) latest.set(record.feature, { ts: record.ts, verdict: record.verdict });
  }
  return new Map([...latest].map(([slug, v]) => [slug, v.verdict]));
}

export function buildStatus({
  sddDir,
  archiveEntries,
  runRecords,
  linksBySlug = {},
}: {
  sddDir: Record<string, readonly string[]>;
  archiveEntries: readonly string[];
  runRecords: readonly Pick<RunRecord, "feature" | "ts" | "verdict">[];
  linksBySlug?: Record<string, GithubLinks | undefined>;
}): StatusRow[] {
  const verdicts = latestVerdictBySlug(runRecords);
  return Object.keys(sddDir)
    .filter((slug) => slug !== "specs" && slug !== "archive")
    .sort((a, b) => a.localeCompare(b))
    .map((slug) => {
      const files = new Set(sddDir[slug]);
      return {
        slug,
        artifacts: {
          proposal: files.has("proposal.md"),
          spec: files.has("spec.md"),
          design: files.has("design.md"),
          tasks: files.has("tasks.md"),
        },
        synced: archiveEntries.some((name) => matchesArchiveEntry(slug, name)),
        lastVerdict: verdicts.get(slug) ?? null,
        github: formatGithubCell(linksBySlug[slug]),
      };
    });
}
