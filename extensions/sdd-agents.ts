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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The four SDD phases, each backed by a `prompts/phases/<phase>.md`. */
export const PHASES = ["explore", "plan", "build", "veredicto"] as const;
export type Phase = (typeof PHASES)[number];

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
): string {
  const front = [
    "---",
    `name: zero-${phase}`,
    `description: ${description || `zero SDD ${phase} phase`}`,
  ];
  if (model) front.push(`model: ${model}`);
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
    const agentsDir = join(homedir(), ".pi", "agent", "agents", "zero");
    mkdirSync(agentsDir, { recursive: true });

    for (const phase of PHASES) {
      try {
        const raw = readFileSync(join(phasesDir, `${phase}.md`), "utf8");
        const { description, body } = splitPhasePrompt(raw);
        const file = buildAgentFile(phase, body, description, readPhaseModel(phase));
        writeFileSync(join(agentsDir, `zero-${phase}.md`), file, "utf8");
      } catch {
        // A single phase failing must not block the other three.
      }
    }
  } catch {
    // Sub-agent provisioning must never break a pi session.
  }
}
