import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { validateArtifactSet, validateSpecDelta, validateTasksFile, type ValidationDefect } from "./zero-validate.ts";

const SDD_DIR = ".sdd";
const ARTIFACTS = ["proposal", "spec", "design", "tasks"] as const;

type NotifyType = "info" | "warning" | "error";
interface PiCommandContext { ui: { notify(message: string, type?: NotifyType): void } }
interface PiExtensionAPI { registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: PiCommandContext) => void | Promise<void> }): void }

function readFileOrNull(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function resolveSlug(arg: string): string | null {
  const explicit = arg.trim();
  if (explicit !== "") return explicit;
  try {
    const candidates = readdirSync(SDD_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "specs" && e.name !== "archive" && existsSync(join(SDD_DIR, e.name, "spec.md")))
      .map((e) => e.name);
    return candidates.length === 1 ? candidates[0] : null;
  } catch { return null; }
}

function formatDefects(defects: ValidationDefect[]): string {
  return defects.map((d) => `  - [${d.kind}] ${d.task ? `${d.task}: ` : ""}${d.message}`).join("\n");
}

function runValidate(args: string, ctx: PiCommandContext): void {
  const notify = (m: string, t?: NotifyType) => { try { ctx.ui.notify(m, t); } catch {} };
  const slug = resolveSlug(args);
  if (slug === null) {
    notify("zero-validate: no hay un único run para validar — corré /zero-validate <slug>", "warning");
    return;
  }
  const dir = join(SDD_DIR, slug);
  const texts = Object.fromEntries(ARTIFACTS.map((a) => [a, readFileOrNull(join(dir, `${a}.md`))])) as Record<(typeof ARTIFACTS)[number], string | null>;
  const presence = Object.fromEntries(ARTIFACTS.map((a) => [a, texts[a] !== null])) as Record<(typeof ARTIFACTS)[number], boolean>;
  const defects = validateArtifactSet(presence);
  if (texts.spec !== null) defects.push(...validateSpecDelta(texts.spec));
  if (texts.tasks !== null) defects.push(...validateTasksFile(texts.tasks));

  const structural = defects.filter((d) => !d.kind.startsWith("missing-proposal"));
  if (structural.length > 0) {
    notify(`zero-validate: encontré defectos estructurales en ${slug}; revisalos antes de sync:\n${formatDefects(defects)}`, "error");
  } else if (defects.length > 0) {
    notify(`zero-validate: ${slug} está usable, pero te falta un artefacto opcional:\n${formatDefects(defects)}`, "warning");
  } else {
    notify(`zero-validate: ${slug} está limpio — tenés propuesta, spec, diseño y tareas coherentes.`, "info");
  }
}

export default function register(pi?: PiExtensionAPI): void {
  if (!pi || typeof pi.registerCommand !== "function") return;
  pi.registerCommand("zero-validate", {
    description: "Valida artefactos .sdd/<slug>/ antes de sincronizar el spec store",
    handler: (args: string, ctx: PiCommandContext): void => {
      try { if (ctx?.ui?.notify) runValidate(args, ctx); }
      catch (err) { try { ctx.ui.notify(`zero-validate: ${err instanceof Error ? err.message : String(err)}`, "error"); } catch {} }
    },
  });
}
