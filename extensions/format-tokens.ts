// Pure helper: compact token count to a short human string.
// 1234 → "1.2k", 4_695_040 → "4.7M", 999 → "999".
//
// Intentionally separate from `formatTokenCount` in zero-statusline.ts,
// which uses a different contract; this helper requires lowercase `k`,
// uppercase `M`, and uppercase `B` suffixes.

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return `${Math.floor(n)}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}
