// zero-pi — canonical spec store delta-merge engine, pure-logic module.
//
// zero keeps a project-wide canonical spec store under `.sdd/specs/`. Every
// `/forge` run produces a *delta* (`.sdd/<slug>/spec.md`) and, once the run
// reaches a `pasa` verdict, the delta is folded into the store. The merge
// *must* be deterministic and reproducible (the same delta against the same
// store always yields the same result) — so every parsing, guardrail, and
// merge decision lives here in plain, dependency-free TypeScript, exactly like
// `autotune.ts`. The pi wiring lives in `spec-merge-extension.ts`.
//
// This file has no pi imports, no filesystem access, and no side-effecting
// top-level code: parsing and merging are pure string work. It never throws on
// malformed input — a bad emission degrades to a surfaced `MergeError`, never
// a corrupted store.

/** One named requirement: stable name + raw body text (criteria included). */
export interface RequirementBlock {
  name: string;
  /** Verbatim block body, trimmed; `""` allowed for a REMOVED entry. */
  body: string;
}

/** A parsed delta — three buckets, any may be empty. */
export interface SpecDelta {
  added: RequirementBlock[];
  modified: RequirementBlock[];
  removed: RequirementBlock[];
}

/** A guardrail violation. `kind` drives the human message. */
export interface MergeError {
  kind:
    | "duplicate-in-delta" // same name twice across/within delta sections
    | "added-name-collision" // ADDED name already in the store
    | "modified-missing" // MODIFIED names a block absent from the store
    | "removed-missing" // REMOVED names a block absent from the store
    | "parse-error"; // malformed store or delta input
  /** Offending requirement name (`""` for a `parse-error`). */
  name: string;
  /** Ready-to-surface explanation. */
  message: string;
}

/** What a successful merge changed — drives the sync report. */
export interface MergeSummary {
  added: string[]; // names appended
  modified: string[]; // names replaced
  removed: string[]; // names deleted
}

/** Result of a merge attempt: either the new store text, or the errors. */
export type MergeResult =
  | { ok: true; store: string; summary: MergeSummary }
  | { ok: false; errors: MergeError[] };

/** The pinned `# ` title line of `.sdd/specs/requirements.md`. A stable title
 *  keeps `renderStore` ↔ `parseStore` a clean round-trip. */
export const STORE_TITLE = "Canonical specs";

/** Matches a requirement-block header: `### REQ: <name>`. The name is
 *  everything after `REQ:`, captured for trimming by the caller. */
const REQ_HEADER = /^###\s+REQ:\s*(.*)$/;

/** Matches a delta section header: `## ADDED` / `## MODIFIED` / `## REMOVED`
 *  (case-insensitive on the keyword). */
const SECTION_HEADER = /^##\s+(ADDED|MODIFIED|REMOVED)\s*$/i;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Split a run of text lines into `### REQ:` blocks.
 *
 * Each block starts at a `### REQ:` header and runs up to (but not including)
 * the next `### REQ:` header or the end of the input. The name is everything
 * after `REQ:`, trimmed; the body is every following line up to the next
 * header, joined and trimmed. Lines before the first header are ignored — they
 * are a title or a section heading the caller already consumed. A header with
 * an empty name still produces a block (with `name === ""`); the caller's
 * guardrails decide whether that is acceptable.
 */
function parseBlocks(lines: readonly string[]): RequirementBlock[] {
  const blocks: RequirementBlock[] = [];
  let current: { name: string; body: string[] } | null = null;

  const flush = (): void => {
    if (current !== null) {
      blocks.push({ name: current.name, body: current.body.join("\n").trim() });
    }
  };

  for (const line of lines) {
    const header = line.match(REQ_HEADER);
    if (header !== null) {
      flush();
      current = { name: header[1].trim(), body: [] };
    } else if (current !== null) {
      current.body.push(line);
    }
  }
  flush();

  return blocks;
}

/**
 * Parse a canonical store file into ordered blocks.
 *
 * The store is a `# ` title line followed by a sequence of `### REQ:` blocks —
 * there are no `## ADDED` etc. headings in the *store*. Any line before the
 * first `### REQ:` header (the title, blank lines) is ignored. Never throws:
 * malformed input simply yields whatever blocks could be recognized — the
 * caller's `parse-error` guardrail decides whether the result is usable.
 * Empty or whitespace-only text yields `[]`.
 */
export function parseStore(text: string): RequirementBlock[] {
  if (typeof text !== "string") return [];
  return parseBlocks(text.split(/\r?\n/));
}

/**
 * Parse a delta `spec.md` into a `SpecDelta`.
 *
 * Walks the file line by line, switching the active bucket on each
 * `## ADDED` / `## MODIFIED` / `## REMOVED` header and collecting the
 * `### REQ:` blocks that follow into that bucket. Lines outside any section
 * (the `# ` title, blank lines) are ignored. An absent or empty section simply
 * yields an empty bucket. Never throws — missing/non-string text yields an
 * empty delta. A `### REQ:` block that appears before any section header is
 * dropped (it belongs to no bucket); the caller treats a delta with zero
 * blocks as "empty delta — nothing to sync", not an error.
 */
export function parseDelta(text: string): SpecDelta {
  const delta: SpecDelta = { added: [], modified: [], removed: [] };
  if (typeof text !== "string") return delta;

  let section: keyof SpecDelta | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (section !== null && buffer.length > 0) {
      delta[section].push(...parseBlocks(buffer));
    }
    buffer = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const sectionHeader = line.match(SECTION_HEADER);
    if (sectionHeader !== null) {
      flush();
      const keyword = sectionHeader[1].toUpperCase();
      section =
        keyword === "ADDED" ? "added" : keyword === "MODIFIED" ? "modified" : "removed";
      continue;
    }
    if (section !== null) buffer.push(line);
  }
  flush();

  return delta;
}

/** Total block count across the three delta buckets. */
function deltaBlockCount(delta: SpecDelta): number {
  return delta.added.length + delta.modified.length + delta.removed.length;
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

/**
 * Run every guardrail check against a parsed store + delta.
 *
 * Returns a `MergeError[]` — empty when the merge is safe to apply. Each error
 * carries the offending `name` and a ready-to-surface `message`. The checks,
 * in order:
 *
 *   - `parse-error`     — a block (store or delta) carries an empty name; the
 *                         input could not be structurally understood.
 *   - `duplicate-in-delta` — the same name appears more than once across (or
 *                         within) the ADDED/MODIFIED/REMOVED sections.
 *   - `added-name-collision` — an ADDED name already exists in the store (to
 *                         *change* a block the run must use MODIFIED).
 *   - `modified-missing` — a MODIFIED block names a requirement absent from
 *                         the store.
 *   - `removed-missing` — a REMOVED block names a requirement absent from the
 *                         store.
 *
 * Pure, never throws. `mergeDelta` runs this before applying *any* change, so
 * a non-empty result means the whole delta is rejected and the store is left
 * untouched.
 */
export function checkGuardrails(
  store: readonly RequirementBlock[],
  delta: SpecDelta,
): MergeError[] {
  const errors: MergeError[] = [];

  // parse-error — any block (store or delta) with an empty name is malformed.
  for (const block of store) {
    if (block.name === "") {
      errors.push({
        kind: "parse-error",
        name: "",
        message:
          "malformed store: a `### REQ:` block has an empty name — the store could not be parsed",
      });
      break;
    }
  }
  for (const block of [...delta.added, ...delta.modified, ...delta.removed]) {
    if (block.name === "") {
      errors.push({
        kind: "parse-error",
        name: "",
        message:
          "malformed delta: a `### REQ:` block has an empty name — the delta could not be parsed",
      });
      break;
    }
  }

  // duplicate-in-delta — the same name twice across all three delta sections.
  const seen = new Set<string>();
  const flagged = new Set<string>();
  for (const block of [...delta.added, ...delta.modified, ...delta.removed]) {
    if (block.name === "") continue; // already reported as a parse-error
    if (seen.has(block.name)) {
      if (!flagged.has(block.name)) {
        flagged.add(block.name);
        errors.push({
          kind: "duplicate-in-delta",
          name: block.name,
          message: `duplicate requirement "${block.name}": it appears more than once in the delta — each requirement may appear at most once across ADDED/MODIFIED/REMOVED`,
        });
      }
    } else {
      seen.add(block.name);
    }
  }

  const storeNames = new Set(store.map((b) => b.name));

  // added-name-collision — an ADDED name already exists in the store.
  for (const block of delta.added) {
    if (block.name === "") continue;
    if (storeNames.has(block.name)) {
      errors.push({
        kind: "added-name-collision",
        name: block.name,
        message: `ADDED requirement "${block.name}" already exists in the store — use MODIFIED to change an existing requirement`,
      });
    }
  }

  // modified-missing — a MODIFIED name is absent from the store.
  for (const block of delta.modified) {
    if (block.name === "") continue;
    if (!storeNames.has(block.name)) {
      errors.push({
        kind: "modified-missing",
        name: block.name,
        message: `MODIFIED requirement "${block.name}" is not in the store — only an existing requirement can be modified`,
      });
    }
  }

  // removed-missing — a REMOVED name is absent from the store.
  for (const block of delta.removed) {
    if (block.name === "") continue;
    if (!storeNames.has(block.name)) {
      errors.push({
        kind: "removed-missing",
        name: block.name,
        message: `REMOVED requirement "${block.name}" is not in the store — only an existing requirement can be removed`,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render an ordered block list back to canonical store markdown.
 *
 * The output is a `# ` title line, a blank line, then every block as a
 * `### REQ: <name>` header followed by its body. Blocks are separated by a
 * blank line. Round-trips with `parseStore`: `parseStore(renderStore(blocks))`
 * yields the same names and (trimmed) bodies. `title` defaults to the pinned
 * `STORE_TITLE`. The result always ends with a single trailing newline.
 */
export function renderStore(blocks: readonly RequirementBlock[], title: string = STORE_TITLE): string {
  const parts: string[] = [`# ${title}`];
  for (const block of blocks) {
    const body = block.body.trim();
    parts.push(body === "" ? `### REQ: ${block.name}` : `### REQ: ${block.name}\n\n${body}`);
  }
  return `${parts.join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Merge entry point
// ---------------------------------------------------------------------------

/**
 * The whole pipeline: parse both inputs, run every guardrail, and — only when
 * there are zero errors — apply the delta and render the new store.
 *
 * This is the single entry point the `/zero-sync` wiring calls. It is pure: no
 * filesystem, no pi, never throws.
 *
 * On any guardrail error it returns `{ ok: false, errors }` and **no store
 * text is produced** — a partially-applied store is structurally impossible,
 * because the merge runs after *all* guardrails pass. On success it returns
 * `{ ok: true, store, summary }` where the delta has been applied as:
 *
 *   - ADDED    → appended to the end of the store, in delta order;
 *   - MODIFIED → the matching store block's body is replaced in place;
 *   - REMOVED  → the matching store block is deleted.
 *
 * An empty delta (zero blocks in every section) is *not* an error: it returns
 * `ok: true` with the store unchanged and an empty `summary`, so the caller
 * can report "empty delta — nothing to sync".
 */
export function mergeDelta(storeText: string, deltaText: string): MergeResult {
  const store = parseStore(storeText);
  const delta = parseDelta(deltaText);

  const errors = checkGuardrails(store, delta);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Apply the delta. Guardrails have proven every name resolves, so the
  // mutations below cannot fail or leave the store half-applied.
  const removedNames = new Set(delta.removed.map((b) => b.name));
  const modifiedByName = new Map(delta.modified.map((b) => [b.name, b]));

  const merged: RequirementBlock[] = [];
  for (const block of store) {
    if (removedNames.has(block.name)) continue; // REMOVED — drop it
    const replacement = modifiedByName.get(block.name);
    merged.push(replacement ?? block); // MODIFIED — replace; else keep
  }
  for (const block of delta.added) {
    merged.push(block); // ADDED — append in delta order
  }

  const summary: MergeSummary = {
    added: delta.added.map((b) => b.name),
    modified: delta.modified.map((b) => b.name),
    removed: delta.removed.map((b) => b.name),
  };

  return { ok: true, store: renderStore(merged), summary };
}

/**
 * Whether a parsed delta carries no blocks at all.
 *
 * The `/zero-sync` command uses this to report "empty delta — nothing to sync"
 * before touching the store: a zero-block delta is valid (not a `MergeError`),
 * it simply has nothing to apply.
 */
export function isEmptyDelta(delta: SpecDelta): boolean {
  return deltaBlockCount(delta) === 0;
}
