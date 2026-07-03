// zero-pi — SDD sub-agent provisioning.
//
// `/forge` delegates each phase to a dedicated sub-agent — `zero-explore`,
// `zero-plan`, `zero-build`, `zero-veredicto`. pi-subagents discovers agents
// from `~/.pi/agent/agents/**/*.md`, but a `pi install` of zero-pi ships only
// the phase *prompts* (`prompts/phases/*.md`), never the agent definitions —
// so `/forge` had nothing to delegate to and stalled.
//
// This extension closes that gap: at load it generates the four agent files
// under `~/.pi/agent/agents/zero/` from the package's own phase prompts and
// the per-phase models in `~/.pi/zero.json`. The files are regenerated every
// load, so they stay in sync with the prompts and with `/zero-models`.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isThinkingLevel } from "./zero-models.ts";
import type { ThinkingLevel } from "./zero-models.ts";

/** The four SDD phases, each backed by a `prompts/phases/<phase>.md`. */
export const PHASES = ["explore", "plan", "build", "veredicto"] as const;
export type Phase = (typeof PHASES)[number];

/**
 * The Strict TDD support modules, copied verbatim from `prompts/support/` to a
 * stable directory beside the generated agents so the `zero-build` /
 * `zero-veredicto` sub-agents can `read` them at runtime. The sub-agents are
 * generated with `inheritSkills: false`, so the phase prompt body is the only
 * channel that can point them at these files — see `supportModulesDir()`.
 */
export const SUPPORT_MODULES = ["strict-tdd.md", "strict-tdd-verify.md"] as const;

/**
 * Phase-specific builtin tool allowlists for generated pi-subagents agents.
 *
 * Explore and veredicto are intentionally read-only at the mutation-tool layer:
 * they can inspect files and run scoped verification commands, but they cannot
 * edit. Plan can write only SDD artifacts; build is the only phase with the
 * full mutation set for product code. This is enforced by pi-subagents' `tools:`
 * frontmatter key, so an accidental phase prompt drift does not silently grant
 * broad editing power to every child.
 */
export const PHASE_TOOLS: Record<Phase, readonly string[]> = {
  explore: ["read", "bash"],
  plan: ["read", "bash", "write", "edit"],
  build: ["read", "bash", "write", "edit"],
  veredicto: ["read", "bash"],
};

/** Non-build phases may mention implementation terms while using `bash`; do not
 *  let pi-subagents' implementation completion guard classify them as writers. */
export const PHASE_COMPLETION_GUARD: Record<Phase, boolean> = {
  explore: false,
  plan: false,
  build: true,
  veredicto: false,
};

/** Absolute path of the runtime support dir the phase prompts reference. */
export function supportModulesDir(): string {
  return join(homedir(), ".pi", "agent", "agents", "zero", "support");
}

/**
 * Split a phase prompt into its `description` (from `---` frontmatter) and its
 * body. A prompt with no frontmatter yields an empty description and the whole
 * text as the body. Exported for tests.
 */
export function splitPhasePrompt(raw: string): { description: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { description: "", body: raw.trim() };
  const descLine = match[1].match(/^description:\s*(.+)$/m);
  return {
    description: descLine ? descLine[1].trim() : "",
    body: match[2].trim(),
  };
}

/**
 * Build the pi-subagents agent definition for one SDD phase: agent frontmatter
 * (`name: zero-<phase>`, the phase model when known, a `replace` system
 * prompt) followed by the phase prompt body. Exported for tests.
 */
export function buildAgentFile(
  phase: Phase,
  body: string,
  description: string,
  model: string | undefined,
  thinking?: ThinkingLevel,
): string {
  const front = [
    "---",
    `name: zero-${phase}`,
    `description: ${description || `zero SDD ${phase} phase`}`,
  ];
  if (model) front.push(`model: ${model}`);
  // The `thinking:` line sits after the optional `model:` and before
  // `systemPromptMode:`. It is emitted only when a level is present AND valid —
  // defensive: callers already validate, but the file builder must never write
  // a bad level into agent frontmatter.
  if (thinking && isThinkingLevel(thinking)) front.push(`thinking: ${thinking}`);
  front.push(`tools: ${PHASE_TOOLS[phase].join(", ")}`);
  if (!PHASE_COMPLETION_GUARD[phase]) front.push("completionGuard: false");
  front.push(
    "systemPromptMode: replace",
    "inheritProjectContext: true",
    "inheritSkills: false",
    "---",
  );
  return `${front.join("\n")}\n\n${body}\n`;
}

/**
 * Resolve the agent `model:` value for a phase from a parsed `zero.json`.
 *
 * zero.json stores a per-phase model as `"<model>"` or, in the installer's
 * spec format, `"<model> <effort>"` — the agent `model:` field takes no effort
 * suffix, so only the model token is kept. When `/zero-models` recorded the
 * provider separately, it is folded back into a `provider/model` path. Returns
 * `undefined` when no model is configured. Exported for tests.
 */
export function phaseModel(data: unknown, phase: Phase): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as {
    models?: Record<string, unknown>;
    providers?: Record<string, unknown>;
  };
  const raw = d.models?.[phase];
  if (typeof raw !== "string" || raw.trim() === "") return undefined;

  let model = raw.trim().split(/\s+/)[0];
  const provider = d.providers?.[phase];
  if (typeof provider === "string" && provider !== "" && !model.includes("/")) {
    model = `${provider}/${model}`;
  }
  return model;
}

/**
 * Resolve the agent `thinking:` level for a phase from a parsed `zero.json`.
 *
 * The explicit `thinking[phase]` value wins when it is one of the six real pi
 * effort levels. Otherwise a legacy model string of the form `"<model> <level>"`
 * is mined: its trailing whitespace-separated token supplies the level, but
 * only when that token is a valid level. `max`/`ultracode` and any other token
 * resolve to `undefined`, so no `thinking:` line is emitted. Exported for tests.
 */
export function phaseThinking(data: unknown, phase: Phase): ThinkingLevel | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as {
    thinking?: Record<string, unknown>;
    models?: Record<string, unknown>;
  };
  const direct = d.thinking?.[phase];
  if (isThinkingLevel(direct)) return direct;
  // Legacy recovery: a valid trailing level on "<model> <level>".
  const model = d.models?.[phase];
  if (typeof model === "string" && model.trim().includes(" ")) {
    const tail = model.trim().split(/\s+/).slice(-1)[0];
    if (isThinkingLevel(tail)) return tail;
  }
  return undefined;
}

/** Read the per-phase model from `~/.pi/zero.json`; `undefined` when absent. */
function readPhaseModel(phase: Phase): string | undefined {
  try {
    return phaseModel(
      JSON.parse(readFileSync(join(homedir(), ".pi", "zero.json"), "utf8")),
      phase,
    );
  } catch {
    return undefined;
  }
}

/** Read the per-phase thinking level from `~/.pi/zero.json`; `undefined` when
 *  absent, invalid, or unrecoverable. Mirrors {@link readPhaseModel}. */
function readPhaseThinking(phase: Phase): ThinkingLevel | undefined {
  try {
    return phaseThinking(
      JSON.parse(readFileSync(join(homedir(), ".pi", "zero.json"), "utf8")),
      phase,
    );
  } catch {
    return undefined;
  }
}

/**
 * The pi extension entry point. Generates the four `zero-<phase>` agent files
 * so `/forge` has real sub-agents to delegate to. Every failure is swallowed —
 * provisioning must never break a pi session — and one phase failing does not
 * block the others.
 */
export default function register(_pi?: unknown): void {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // <pkg>/extensions
    const phasesDir = join(here, "..", "prompts", "phases");
    const supportSrcDir = join(here, "..", "prompts", "support");
    const agentsDir = join(homedir(), ".pi", "agent", "agents", "zero");
    mkdirSync(agentsDir, { recursive: true });

    for (const phase of PHASES) {
      try {
        const raw = readFileSync(join(phasesDir, `${phase}.md`), "utf8");
        const { description, body } = splitPhasePrompt(raw);
        const file = buildAgentFile(
          phase,
          body,
          description,
          readPhaseModel(phase),
          readPhaseThinking(phase),
        );
        writeFileSync(join(agentsDir, `zero-${phase}.md`), file, "utf8");
      } catch {
        // A single phase failing must not block the other three.
      }
    }

    // Stage the Strict TDD support modules next to the agents so `zero-build`
    // and `zero-veredicto` can read them at runtime. A copy failure is
    // non-fatal: the build/veredicto prompts carry an inline fallback contract.
    try {
      const supportDir = supportModulesDir();
      mkdirSync(supportDir, { recursive: true });
      for (const mod of SUPPORT_MODULES) {
        try {
          copyFileSync(join(supportSrcDir, mod), join(supportDir, mod));
        } catch {
          // One module failing must not block the other.
        }
      }
    } catch {
      // Support staging is best-effort; the inline fallback covers absence.
    }
  } catch {
    // Sub-agent provisioning must never break a pi session.
  }
}
