// zero-pi — the /zero-sync command.
//
// A real pi command — a code handler, not an LLM prompt — that folds a
// `/forge` run's delta `spec.md` into the project's canonical spec store and
// archives the change. It is deterministic: every parsing, guardrail, and
// merge decision lives in the pure-logic `spec-merge.ts`; this file only reads
// and writes the filesystem and reports the result.
//
//   /zero-sync canonical-specs   sync the named run's delta into the store
//   /zero-sync                   resolve the single candidate run, or ask
//
// The SDD orchestrator invokes `/zero-sync <slug>` after a `pasa` verdict. On a
// guardrail failure the command writes NOTHING and reports the failing
// requirement name(s); on success it writes the store atomically (`.tmp` +
// `rename`) and appends an entry to `.sdd/archive/`.
//
// All decisions live in `spec-merge.ts`; the package stays dependency-free:
// `node:fs`/`node:os`/`node:path` only, plus minimal local interfaces for the
// pi API. The whole handler is wrapped in a swallowing `try/catch`, exactly
// like `autotune-extension.ts` — a failure must never break a pi session.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { isEmptyDelta, mergeDelta, parseDelta, type MergeSummary } from "./spec-merge.ts";

/** The canonical store path, relative to the project root. */
const STORE_DIR = join(".sdd", "specs");
const STORE_FILE = join(STORE_DIR, "requirements.md");

/** The per-run artifacts directory root. */
const SDD_DIR = ".sdd";

/** The audit-trail archive root. */
const ARCHIVE_DIR = join(".sdd", "archive");

/** Read a UTF-8 file, returning `null` when it is absent or unreadable. */
function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Today's date as `YYYY-MM-DD`, for the archive directory name. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolve the run slug to sync.
 *
 * The orchestrator always passes an explicit slug, so this is a convenience
 * path. With an explicit arg it is used verbatim. With no arg it lists the
 * `.sdd/` subdirectories that carry a `spec.md` (sync candidates) and, when
 * exactly one exists, returns it; otherwise it returns `null` so the caller
 * can ask or report.
 */
function resolveSlug(arg: string): string | null {
  const explicit = arg.trim();
  if (explicit !== "") return explicit;

  let entries: string[];
  try {
    entries = readdirSync(SDD_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "specs" && e.name !== "archive")
      .map((e) => e.name);
  } catch {
    return null;
  }

  const candidates = entries.filter((name) => existsSync(join(SDD_DIR, name, "spec.md")));
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Pick a unique archive directory for `<date>-<slug>`.
 *
 * The archive is append-only: a new entry never rewrites a prior one. When a
 * slug syncs twice on the same date the bare `<date>-<slug>` is already taken,
 * so a numeric `-2`, `-3` … suffix is appended until the name is free.
 */
function uniqueArchiveDir(date: string, slug: string): string {
  const base = `${date}-${slug}`;
  let dir = join(ARCHIVE_DIR, base);
  let n = 2;
  while (existsSync(dir)) {
    dir = join(ARCHIVE_DIR, `${base}-${n}`);
    n += 1;
  }
  return dir;
}

/** Render a `MergeSummary` as the archive `sync.md` audit report. */
function renderSyncReport(slug: string, date: string, summary: MergeSummary): string {
  const section = (title: string, names: string[]): string =>
    names.length === 0
      ? `## ${title}\n\n(none)\n`
      : `## ${title}\n\n${names.map((n) => `- ${n}`).join("\n")}\n`;

  return [
    `# Spec sync — ${slug}`,
    "",
    `Date: ${date}`,
    "",
    section("Added", summary.added),
    section("Modified", summary.modified),
    section("Renamed", summary.renamed.map((r) => `${r.from} -> ${r.to}`)),
    section("Removed", summary.removed),
  ].join("\n");
}

/** Render the human-facing one-shot report of a `MergeSummary`. */
function describeSummary(summary: MergeSummary): string {
  const lines: string[] = [];
  if (summary.added.length > 0) lines.push(`  agregados:    ${summary.added.join(", ")}`);
  if (summary.modified.length > 0) {
    lines.push(`  modificados:  ${summary.modified.join(", ")}  (reemplaza el texto de spec existente)`);
  }
  if (summary.renamed.length > 0) {
    lines.push(`  renombrados:  ${summary.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}  (mantiene la posición en el store)`);
  }
  if (summary.removed.length > 0) {
    lines.push(`  eliminados:   ${summary.removed.join(", ")}  (borra del store)`);
  }
  return lines.join("\n");
}

/** The slice of pi's extension API this command uses. */
interface PiUI {
  notify(message: string, type?: "info" | "warning" | "error"): void;
}
interface PiCommandContext {
  ui: PiUI;
}
interface PiExtensionAPI {
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: PiCommandContext) => Promise<void> | void;
    },
  ): void;
}

/**
 * The `/zero-sync` handler — folds a run's delta into the canonical store.
 *
 * Wrapped in a swallowing `try/catch` so a failure can never break a pi
 * session. On a guardrail error or any read failure it writes nothing and
 * reports the problem; only a clean `mergeDelta` result reaches the atomic
 * store write and the archive step.
 */
function runSync(args: string, ctx: PiCommandContext): void {
  const notify = (message: string, type?: "info" | "warning" | "error"): void => {
    try {
      ctx.ui.notify(message, type);
    } catch {
      // A notification failure must not break the session.
    }
  };

  const slug = resolveSlug(args);
  if (slug === null) {
    notify(
      "zero-sync: no se dio slug de run y no hay un único candidato — " +
        "corré /zero-sync <slug> (el slug del directorio .sdd/<slug>/ del run)",
      "warning",
    );
    return;
  }

  const deltaPath = join(SDD_DIR, slug, "spec.md");
  const deltaText = readFileOrNull(deltaPath);
  if (deltaText === null) {
    // A legacy run produced no delta `spec.md` — nothing to sync. This is not
    // an error: legacy runs finish in legacy mode (additive design).
    notify(
      `zero-sync: ${deltaPath} no existe — este run no produjo un spec.md delta, nada para sincronizar`,
      "warning",
    );
    return;
  }

  // An empty delta (no blocks in any section) is valid — report and stop
  // before touching the store.
  if (isEmptyDelta(parseDelta(deltaText))) {
    notify(`zero-sync: delta vacío en ${deltaPath} — nada para sincronizar, store sin cambios`, "info");
    return;
  }

  // The store is absent on a fresh project — `mergeDelta` treats "" as the
  // empty store, so an all-ADDED delta bootstraps it.
  const storeText = readFileOrNull(STORE_FILE) ?? "";

  const result = mergeDelta(storeText, deltaText);
  if (!result.ok) {
    // Guardrail failure — write NOTHING. The `pasa` verdict still stands, but
    // the store is flagged out of sync for a manual fix.
    const detail = result.errors.map((e) => `  - [${e.kind}] ${e.message}`).join("\n");
    notify(
      `zero-sync: store NO actualizado — el delta tiene errores de guardrail:\n${detail}`,
      "error",
    );
    return;
  }

  // Success — write the store atomically: `.tmp` then `rename`. `mkdir -p`
  // `.sdd/specs/` so a fresh project gets its first store file.
  try {
    mkdirSync(STORE_DIR, { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    writeFileSync(tmp, result.store, "utf8");
    renameSync(tmp, STORE_FILE);
  } catch (err) {
    notify(
      `zero-sync: no se pudo escribir el store en ${STORE_FILE}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "error",
    );
    return;
  }

  // Archive step. The store is already the source of truth; an archive failure
  // here does NOT revert the merge — it is reported so the gap is visible.
  const date = todayStamp();
  let archiveNote = "";
  try {
    const archiveDir = uniqueArchiveDir(date, slug);
    mkdirSync(archiveDir, { recursive: true });

    for (const name of ["proposal.md", "spec.md"]) {
      const src = join(SDD_DIR, slug, name);
      if (existsSync(src)) copyFileSync(src, join(archiveDir, name));
    }
    writeFileSync(join(archiveDir, "sync.md"), renderSyncReport(slug, date, result.summary), "utf8");
    archiveNote = `archivado en ${archiveDir}`;
  } catch (err) {
    archiveNote = `ATENCIÓN: store actualizado pero falló el archivado: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }

  const detail = describeSummary(result.summary);
  notify(
    `zero-sync: store canónico actualizado (${STORE_FILE})\n${detail}\n${archiveNote}`,
    "info",
  );
}

/**
 * The pi extension entry point — registers the `/zero-sync` command.
 *
 * Called with no or an invalid `pi`, it no-ops cleanly. The handler body is
 * wrapped again in a swallowing `try/catch` so neither registration nor a
 * later failure can break a pi session.
 */
export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;

  pi.registerCommand("zero-sync", {
    description:
      "Integra el spec.md delta de un run /forge al store canónico .sdd/specs/ — /zero-sync <slug>",
    handler: (args: string, ctx: PiCommandContext): void => {
      try {
        if (!ctx || !ctx.ui || typeof ctx.ui.notify !== "function") return;
        runSync(args, ctx);
      } catch (err) {
        try {
          ctx.ui.notify(
            `zero-sync: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
        } catch {
          // A notification failure must never break a pi session.
        }
      }
    },
  });
}
