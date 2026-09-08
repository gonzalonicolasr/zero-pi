import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The run's round ledger — the durable count of build/veredicto rounds.
 *
 * The iteration cap is what stops a run from grinding forever, but the count
 * lived only in the orchestrator's head: an interrupted run that resumed
 * restarted its counter at 1, so a run that fell over repeatedly could spend
 * far more rounds than the cap promises. The ledger persists the count next to
 * the run's other artifacts, so resume recovers what was already spent.
 */
export interface RoundLedger {
  v: 1;
  slug: string;
  cap: number;
  /** Build/veredicto rounds already spent. Gate rounds never count. */
  rounds: number;
  /** One entry per round, in order: `corregir`, `replantear` or `pasa`. */
  verdicts: Verdict[];
  updatedAt: string;
}

export type Verdict = "corregir" | "replantear" | "pasa";

/**
 * Routing state, read the way gentle-pi's attempt ledger reads: the caller
 * launches another round only on `proceed`.
 */
export type RoundState = "proceed" | "cap-reached" | "done";

export type RoundsAction = "status" | "record" | "reset" | "invalid";

export interface RoundsArgs {
  action: RoundsAction;
  verdict: Verdict | null;
  slug: string | null;
  cap: number | null;
  json: boolean;
}

export const VERDICTS: readonly Verdict[] = ["corregir", "replantear", "pasa"];

const LEDGER_FILE = "rounds.json";

function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}

export function parseRoundsArgs(args: string): RoundsArgs {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const result: RoundsArgs = { action: "status", verdict: null, slug: null, cap: null, json: false };
  let expectCap = false;
  let seenAction = false;

  for (const part of parts) {
    if (expectCap) {
      const cap = Number.parseInt(part, 10);
      result.cap = Number.isFinite(cap) && cap > 0 ? cap : null;
      expectCap = false;
      continue;
    }
    if (part === "--json") { result.json = true; continue; }
    if (part === "--cap") { expectCap = true; continue; }
    if (!seenAction && (part === "status" || part === "record" || part === "reset")) {
      result.action = part;
      seenAction = true;
      continue;
    }
    if (result.action === "record" && result.verdict === null) {
      if (!isVerdict(part)) return { ...result, action: "invalid" };
      result.verdict = part;
      continue;
    }
    if (!result.slug) result.slug = part;
  }

  if (result.action === "record" && result.verdict === null) return { ...result, action: "invalid" };
  return result;
}

export function ledgerPath(slug: string, root = process.cwd()): string {
  return join(root, ".sdd", slug, LEDGER_FILE);
}

/** Reads the ledger. An absent, corrupt or foreign-version file reads as `null`. */
export function readLedger(slug: string, root = process.cwd()): RoundLedger | null {
  const path = ledgerPath(slug, root);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RoundLedger>;
    if (parsed?.v !== 1) return null;
    if (typeof parsed.rounds !== "number" || !Array.isArray(parsed.verdicts)) return null;
    return {
      v: 1,
      slug: typeof parsed.slug === "string" ? parsed.slug : slug,
      cap: typeof parsed.cap === "number" ? parsed.cap : 0,
      rounds: parsed.rounds,
      verdicts: parsed.verdicts.filter((entry): entry is Verdict => typeof entry === "string" && isVerdict(entry)),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeLedger(ledger: RoundLedger, root = process.cwd()): void {
  const path = ledgerPath(ledger.slug, root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

/**
 * Appends one build/veredicto round. `cap` overrides the stored one when given;
 * otherwise the ledger keeps the cap it was created with.
 */
export function recordRound(
  previous: RoundLedger | null,
  verdict: Verdict,
  options: { slug: string; cap: number | null; now?: Date },
): RoundLedger {
  if (!isVerdict(verdict)) throw new Error(`verdicto desconocido: ${verdict} (esperaba ${VERDICTS.join(", ")})`);
  const now = options.now ?? new Date();
  return {
    v: 1,
    slug: previous?.slug ?? options.slug,
    cap: options.cap ?? previous?.cap ?? 0,
    rounds: (previous?.rounds ?? 0) + 1,
    verdicts: [...(previous?.verdicts ?? []), verdict],
    updatedAt: now.toISOString(),
  };
}

/** `done` on a `pasa`, `cap-reached` once the spent rounds meet the cap, else `proceed`. */
export function stateOf(ledger: RoundLedger | null): RoundState {
  if (!ledger) return "proceed";
  if (ledger.verdicts.at(-1) === "pasa") return "done";
  if (ledger.cap > 0 && ledger.rounds >= ledger.cap) return "cap-reached";
  return "proceed";
}

export function formatRoundsReport(ledger: RoundLedger | null, slug?: string): string {
  if (!ledger) return `zero-rounds: ${slug ?? "run"} — sin rondas registradas todavía (0 gastadas)`;
  const state = stateOf(ledger);
  const label = state === "done"
    ? "cerrado con pasa"
    : state === "cap-reached"
      ? "cap alcanzado — el run se reporta no verificado"
      : `proceed — queda${ledger.cap - ledger.rounds === 1 ? "" : "n"} ${ledger.cap - ledger.rounds} ronda${ledger.cap - ledger.rounds === 1 ? "" : "s"}`;
  return [
    `zero-rounds: ${ledger.slug} — ${ledger.rounds}/${ledger.cap} rondas · ${label}`,
    `  veredictos: ${ledger.verdicts.length > 0 ? ledger.verdicts.join(", ") : "—"}`,
    `  estado: ${state}`,
  ].join("\n");
}
