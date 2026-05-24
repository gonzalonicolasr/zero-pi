// zero-pi — filesystem-wide scan guard, pure-logic module.
//
// An SDD subagent (most often `zero-veredicto`) sometimes tries to *rediscover*
// where the code lives by running an unbounded `find` from the filesystem root:
//
//     find / -maxdepth 12 -type d -iname "*admin-data-keys*"
//
// On Windows this does not merely run slow — it hangs effectively forever.
// Git Bash's `/` traversal reaches the user tree under OneDrive, and `find`
// blocks indefinitely forcing the hydration of every cloud-only placeholder it
// touches. A real run was caught wedged on exactly this command for 6+ hours
// with no output, stalling the whole pipeline. The phase prompt already tells
// the agent not to do full-tree scans, but a prompt is guidance, not
// enforcement — a model under pressure ignored it.
//
// This module is the enforcement half: a pure, dependency-free classifier that
// decides whether a shell command contains a filesystem-wide scan rooted at a
// top-level location. The pi wiring (the `tool_call` handler that reads the
// command and returns `{ block, reason }`) lives in `scan-guard-extension.ts`.
// No pi imports, no filesystem, no side effects — testable with plain strings.
//
// Design intent — block the dangerous class, never legitimate scoped work:
//   • Only `find` / `grep -r` / `rg` *rooted at a filesystem root* are blocked
//     (`/`, a bare drive mount like `/c`, `C:\`, `~`, `$HOME`, …).
//   • A scan scoped to a real subtree (`find /e/zero/.sdd -name …`,
//     `rg foo src/`) is always allowed — the root token must be the *entire*
//     search path, not a prefix of it.
//   • `.` / `./` (the cwd, i.e. the code root) is always allowed.

/**
 * The guard's decision for one shell command.
 *
 * - `block: false` — allow the command (the common case).
 * - `block: true`  — refuse it; `reason` explains why and how to scope it, and
 *   the wiring surfaces it back to the model as the blocked-tool reason.
 */
export interface ScanGuardDecision {
  block: boolean;
  reason?: string;
}

/** Shell tool names whose `command` this guard inspects. */
export const GUARDED_TOOLS: ReadonlySet<string> = new Set(["bash", "shell", "sh"]);

// ---------------------------------------------------------------------------
// Root-path detection
// ---------------------------------------------------------------------------

/**
 * Whether `token` denotes a filesystem *root* — a location so broad that a
 * recursive scan of it traverses the whole machine (and, on Windows, hangs on
 * OneDrive placeholder hydration).
 *
 * Matches, ignoring a single trailing slash:
 *   • POSIX root            `/`
 *   • Git Bash drive mount  `/c`, `/d`, … (a single letter, nothing deeper)
 *   • Windows drive root    `C:`, `C:\`, `c:/`
 *   • Home                  `~`, `$HOME`, `${HOME}`, `%USERPROFILE%`, `%HOMEPATH%`
 *
 * Crucially it does NOT match a *scoped* path that merely starts at a root,
 * e.g. `/e/zero/.sdd` or `C:\Users\gonza\proj` — those are bounded and allowed.
 */
export function isRootPath(token: string): boolean {
  // Strip surrounding quotes a shell would remove, and one trailing slash.
  let t = token.trim().replace(/^['"]|['"]$/g, "");
  if (t.length > 1) t = t.replace(/[/\\]$/, "");

  if (t === "/" || t === "\\") return true;
  if (t === "~") return true;

  // Git Bash single-letter drive mount: /c, /d, … but not /c/foo.
  if (/^\/[a-zA-Z]$/.test(t)) return true;

  // Windows drive root: C:, C:\, c:/ — but not C:\Users.
  if (/^[a-zA-Z]:[\\/]?$/.test(t)) return true;

  // Home-directory environment variables, with or without braces.
  const home = t.replace(/[/\\]$/, "");
  if (home === "$HOME" || home === "${HOME}") return true;
  if (/^%(USERPROFILE|HOMEPATH|HOMEDRIVE|HOME)%$/i.test(home)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Per-segment classification
// ---------------------------------------------------------------------------

/** Split a shell line into segments on `;`, `&&`, `||`, `|`, and newlines. */
export function splitSegments(command: string): string[] {
  return command
    .split(/\n|;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Tokenize one segment on whitespace (quotes kept; good enough for path ops). */
function tokenize(segment: string): string[] {
  return segment.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Whether a single command segment is a root-rooted `find`.
 *
 * `find`'s path operands are the tokens after `find` and before the first
 * expression primary (a token starting with `-`, `(`, `!`). If any path operand
 * is a root path, the scan is unbounded.
 */
function isRootedFind(tokens: string[]): boolean {
  // Locate the `find` argv0, allowing an env-prefix like `command` is overkill;
  // a leading path such as `/usr/bin/find` still ends in `find`.
  const idx = tokens.findIndex((t) => t === "find" || /[/\\]find$/.test(t));
  if (idx === -1) return false;

  for (let i = idx + 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith("-") || tok === "(" || tok === "!" || tok === ")") break; // expression begins
    if (isRootPath(tok)) return true;
  }
  return false;
}

/** Whether `tokens` invoke `grep` recursively (`-r`/`-R`/`--recursive`, incl. combined flags like `-rn`). */
function isRecursiveGrep(tokens: string[]): boolean {
  const idx = tokens.findIndex((t) => t === "grep" || /[/\\]grep$/.test(t));
  if (idx === -1) return false;
  return tokens
    .slice(idx + 1)
    .some((t) => t === "--recursive" || /^-[a-zA-Z]*[rR]/.test(t));
}

/**
 * Whether a `grep -r` / `rg` segment targets a root path.
 *
 * ripgrep recurses by default, so any root target is dangerous; plain `grep`
 * is only dangerous with a recursive flag. The path target of either is taken
 * to be any non-flag operand that is a root path.
 */
function isRootedRecursiveSearch(tokens: string[]): boolean {
  const isRg = tokens.some((t) => t === "rg" || /[/\\]rg$/.test(t));
  const isGrep = tokens.some((t) => t === "grep" || /[/\\]grep$/.test(t));
  if (!isRg && !isGrep) return false;
  if (isGrep && !isRg && !isRecursiveGrep(tokens)) return false;

  // Any bare (non-flag) operand that is a root path is a whole-machine scan.
  return tokens.some((t) => !t.startsWith("-") && isRootPath(t));
}

// ---------------------------------------------------------------------------
// Public classifier
// ---------------------------------------------------------------------------

/** The reason returned to the model when a root-rooted scan is blocked. */
export function blockReason(command: string): string {
  const offending = splitSegments(command).find((seg) => {
    const tokens = tokenize(seg);
    return isRootedFind(tokens) || isRootedRecursiveSearch(tokens);
  });
  return (
    `zero scan-guard: blocked a filesystem-wide scan` +
    (offending ? ` (\`${offending}\`)` : "") +
    `. On Windows a \`find\`/\`grep -r\`/\`rg\` rooted at \`/\`, a drive root, or \`~\` ` +
    `hangs indefinitely hydrating OneDrive placeholders — it does not just run slow. ` +
    `Do not rediscover code with a full-tree scan: read the code root from the plan ` +
    `(\`## Code roots\` in design.md, or the \`Code root:\` line in tasks.md / your task input) ` +
    `and scope the search to that absolute path (e.g. \`find <code-root> -name …\`).`
  );
}

/**
 * Classify a shell command into an allow/block decision.
 *
 * Pure and total — never throws. Blocks when any `;`/`&&`/`|`-separated segment
 * is a `find`, recursive `grep`, or `rg` whose search path is a filesystem root
 * (see {@link isRootPath}). A non-string or empty command is allowed (the guard
 * never invents a reason to block).
 */
export function classifyShellCommand(command: unknown): ScanGuardDecision {
  if (typeof command !== "string" || command.trim() === "") {
    return { block: false };
  }

  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    if (isRootedFind(tokens) || isRootedRecursiveSearch(tokens)) {
      return { block: true, reason: blockReason(command) };
    }
  }
  return { block: false };
}
