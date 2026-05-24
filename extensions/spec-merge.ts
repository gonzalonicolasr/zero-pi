// zero-pi — canonical spec store delta-merge engine, pure-logic module.

/** One named requirement: stable name + raw body text (criteria included). */
export interface RequirementBlock {
  name: string;
  body: string;
}

export interface RenameBlock {
  from: string;
  to: string;
  body: string;
}

/** A parsed delta — four buckets, any may be empty. */
export interface SpecDelta {
  added: RequirementBlock[];
  modified: RequirementBlock[];
  removed: RequirementBlock[];
  renamed: RenameBlock[];
}

/** A guardrail violation. `kind` drives the human message. */
export interface MergeError {
  kind:
    | "duplicate-in-delta"
    | "added-name-collision"
    | "modified-missing"
    | "removed-missing"
    | "renamed-missing"
    | "renamed-to-collision"
    | "renamed-duplicate"
    | "renamed-parse-error"
    | "parse-error";
  name: string;
  message: string;
}

/** What a successful merge changed — drives the sync report. */
export interface MergeSummary {
  added: string[];
  modified: string[];
  removed: string[];
  renamed: { from: string; to: string }[];
}

export type MergeResult =
  | { ok: true; store: string; summary: MergeSummary }
  | { ok: false; errors: MergeError[] };

export const STORE_TITLE = "Canonical specs";

const REQ_HEADER = /^###\s+REQ:\s*(.*)$/;
const SECTION_HEADER = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s*$/i;
const FROM_LINE = /^from:\s*(.+?)\s*$/i;

function parseBlocks(lines: readonly string[]): RequirementBlock[] {
  const blocks: RequirementBlock[] = [];
  let current: { name: string; body: string[] } | null = null;
  const flush = (): void => {
    if (current !== null) blocks.push({ name: current.name, body: current.body.join("\n").trim() });
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

function parseRenameBlocks(lines: readonly string[]): RenameBlock[] {
  return parseBlocks(lines).map((block) => {
    const bodyLines = block.body.split(/\r?\n/);
    let from = "";
    const kept: string[] = [];
    let lifted = false;
    for (const line of bodyLines) {
      const match = line.match(FROM_LINE);
      if (!lifted && match !== null) {
        from = match[1].trim();
        lifted = true;
      } else {
        kept.push(line);
      }
    }
    return { from, to: block.name, body: kept.join("\n").trim() };
  });
}

export function parseStore(text: string): RequirementBlock[] {
  if (typeof text !== "string") return [];
  return parseBlocks(text.split(/\r?\n/));
}

export function loadCanonical(text: string | undefined | null): { blocks: RequirementBlock[]; errors: MergeError[] } {
  const source = text ?? "";
  const blocks = parseStore(source);
  const errors = blocks.some((b) => b.name === "")
    ? [{ kind: "parse-error" as const, name: "", message: "malformed canonical store: empty REQ name" }]
    : [];
  return { blocks, errors };
}

export function parseDelta(text: string): SpecDelta {
  const delta: SpecDelta = { added: [], modified: [], removed: [], renamed: [] };
  if (typeof text !== "string") return delta;

  let section: keyof SpecDelta | null = null;
  let buffer: string[] = [];
  const flush = (): void => {
    if (section !== null && buffer.length > 0) {
      if (section === "renamed") delta.renamed.push(...parseRenameBlocks(buffer));
      else delta[section].push(...parseBlocks(buffer));
    }
    buffer = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const sectionHeader = line.match(SECTION_HEADER);
    if (sectionHeader !== null) {
      flush();
      const keyword = sectionHeader[1].toUpperCase();
      section =
        keyword === "ADDED"
          ? "added"
          : keyword === "MODIFIED"
            ? "modified"
            : keyword === "REMOVED"
              ? "removed"
              : "renamed";
      continue;
    }
    if (section !== null) buffer.push(line);
  }
  flush();
  return delta;
}

function deltaBlockCount(delta: SpecDelta): number {
  return delta.added.length + delta.modified.length + delta.removed.length + delta.renamed.length;
}

export function checkGuardrails(
  store: readonly RequirementBlock[],
  delta: SpecDelta,
): MergeError[] {
  const errors: MergeError[] = [];

  for (const block of store) {
    if (block.name === "") {
      errors.push({ kind: "parse-error", name: "", message: "malformed store: a `### REQ:` block has an empty name — the store could not be parsed" });
      break;
    }
  }
  for (const block of [...delta.added, ...delta.modified, ...delta.removed]) {
    if (block.name === "") {
      errors.push({ kind: "parse-error", name: "", message: "malformed delta: a `### REQ:` block has an empty name — the delta could not be parsed" });
      break;
    }
  }
  for (const block of delta.renamed) {
    if (block.to === "" || block.from === "") {
      errors.push({ kind: "renamed-parse-error", name: block.to || block.from, message: `RENAMED requirement "${block.to || block.from || "(empty)"}" must include both a target name and a \`from: <name>\` line` });
      break;
    }
  }

  const seen = new Set<string>();
  const flagged = new Set<string>();
  for (const block of [...delta.added, ...delta.modified, ...delta.removed]) {
    if (block.name === "") continue;
    if (seen.has(block.name)) {
      if (!flagged.has(block.name)) {
        flagged.add(block.name);
        errors.push({ kind: "duplicate-in-delta", name: block.name, message: `duplicate requirement "${block.name}": it appears more than once in the delta — each requirement may appear at most once across ADDED/MODIFIED/REMOVED` });
      }
    } else seen.add(block.name);
  }

  const renameSeen = new Set<string>();
  const modifiedNames = new Set(delta.modified.map((b) => b.name));
  for (const block of delta.renamed) {
    if (block.from === "" || block.to === "") continue;
    for (const name of [block.from, block.to]) {
      const allowedRenameThenModify = name === block.to && modifiedNames.has(name);
      if (renameSeen.has(name) || (seen.has(name) && !allowedRenameThenModify)) {
        if (!flagged.has(name)) {
          flagged.add(name);
          errors.push({ kind: "renamed-duplicate", name, message: `RENAMED requirement "${name}" conflicts with another delta entry — rename source and target names must be unique` });
        }
      } else renameSeen.add(name);
    }
  }

  const storeNames = new Set(store.map((b) => b.name));
  const removedNames = new Set(delta.removed.map((b) => b.name));
  const renameFrom = new Set(delta.renamed.map((b) => b.from).filter(Boolean));

  for (const block of delta.added) {
    if (block.name !== "" && storeNames.has(block.name) && !removedNames.has(block.name) && !renameFrom.has(block.name)) {
      errors.push({ kind: "added-name-collision", name: block.name, message: `ADDED requirement "${block.name}" already exists in the store — use MODIFIED to change an existing requirement` });
    }
  }
  for (const block of delta.modified) {
    if (block.name !== "" && !storeNames.has(block.name) && !delta.renamed.some((r) => r.to === block.name)) {
      errors.push({ kind: "modified-missing", name: block.name, message: `MODIFIED requirement "${block.name}" is not in the store — only an existing requirement can be modified` });
    }
  }
  for (const block of delta.removed) {
    if (block.name !== "" && !storeNames.has(block.name)) {
      errors.push({ kind: "removed-missing", name: block.name, message: `REMOVED requirement "${block.name}" is not in the store — only an existing requirement can be removed` });
    }
  }
  for (const block of delta.renamed) {
    if (block.from === "" || block.to === "") continue;
    if (!storeNames.has(block.from)) {
      errors.push({ kind: "renamed-missing", name: block.from, message: `RENAMED requirement "${block.from}" is not in the store — only an existing requirement can be renamed` });
    }
    if (storeNames.has(block.to) && block.to !== block.from && !removedNames.has(block.to) && !renameFrom.has(block.to)) {
      errors.push({ kind: "renamed-to-collision", name: block.to, message: `RENAMED target "${block.to}" already exists in the store — choose a new requirement name` });
    }
  }

  return errors;
}

export function serializeCanonical(blocks: readonly RequirementBlock[], title: string = STORE_TITLE): string {
  return renderStore([...blocks].sort((a, b) => a.name.localeCompare(b.name)), title);
}

export function renderStore(blocks: readonly RequirementBlock[], title: string = STORE_TITLE): string {
  const parts: string[] = [`# ${title}`];
  for (const block of blocks) {
    const body = block.body.trim();
    parts.push(body === "" ? `### REQ: ${block.name}` : `### REQ: ${block.name}\n\n${body}`);
  }
  return `${parts.join("\n\n")}\n`;
}

export function mergeDelta(storeTextOrBlocks: string | readonly RequirementBlock[], deltaTextOrDelta: string | SpecDelta): MergeResult {
  const store = typeof storeTextOrBlocks === "string" ? parseStore(storeTextOrBlocks) : [...storeTextOrBlocks];
  const delta = typeof deltaTextOrDelta === "string" ? parseDelta(deltaTextOrDelta) : deltaTextOrDelta;
  const errors = checkGuardrails(store, delta);
  if (errors.length > 0) return { ok: false, errors };

  const removedNames = new Set(delta.removed.map((b) => b.name));
  const renamedByFrom = new Map(delta.renamed.map((b) => [b.from, b]));
  const modifiedByName = new Map(delta.modified.map((b) => [b.name, b]));

  const merged: RequirementBlock[] = [];
  for (const block of store) {
    if (removedNames.has(block.name)) continue;
    const rename = renamedByFrom.get(block.name);
    const afterRename = rename ? { name: rename.to, body: rename.body === "" ? block.body : rename.body } : block;
    const replacement = modifiedByName.get(afterRename.name);
    merged.push(replacement ?? afterRename);
  }
  for (const block of delta.added) merged.push(block);

  const summary: MergeSummary = {
    added: delta.added.map((b) => b.name),
    modified: delta.modified.map((b) => b.name),
    removed: delta.removed.map((b) => b.name),
    renamed: delta.renamed.map((b) => ({ from: b.from, to: b.to })),
  };
  return { ok: true, store: renderStore(merged), summary };
}

export function isEmptyDelta(delta: SpecDelta): boolean {
  return deltaBlockCount(delta) === 0;
}
