// Unit tests for the /zero-models command's pure logic.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatAutotune,
  formatPhases,
  frameBox,
  framePicker,
  frameTwoBoxes,
  groupByProvider,
  isPhase,
  isThinkingLevel,
  MIN_BOX_WIDTH,
  MIN_SPLIT_WIDTH,
  parseAssignment,
  parseAutotuneArg,
  parseThinkingToken,
  PHASES,
  readModels,
  readProviders,
  readThinking,
  THINKING_LEVELS,
  validateAssignment,
  type BoxRow,
  type PhaseModels,
  type PhaseProviders,
  type PhaseThinking,
} from "./zero-models.ts";
import { visibleWidth } from "./zero-tui-layout.ts";

test("THINKING_LEVELS is exactly the six real pi effort levels, in order", () => {
  assert.deepEqual(
    [...THINKING_LEVELS],
    ["off", "minimal", "low", "medium", "high", "xhigh"],
  );
});

test("isThinkingLevel accepts each of the six real levels", () => {
  for (const level of THINKING_LEVELS) assert.ok(isThinkingLevel(level));
});

test("isThinkingLevel rejects bogus levels, empty string, and non-strings", () => {
  assert.ok(!isThinkingLevel("max"));
  assert.ok(!isThinkingLevel("ultracode"));
  assert.ok(!isThinkingLevel(""));
  assert.ok(!isThinkingLevel("HIGH"), "case-sensitive — uppercase is not a level");
  assert.ok(!isThinkingLevel(42));
  assert.ok(!isThinkingLevel(null));
  assert.ok(!isThinkingLevel(undefined));
  assert.ok(!isThinkingLevel({}));
});

test("readThinking reads a valid per-phase thinking level", () => {
  assert.deepEqual(readThinking({ thinking: { build: "high" } }), { build: "high" });
});

test("readThinking ignores an invalid thinking value", () => {
  assert.deepEqual(readThinking({ thinking: { build: "max" } }), {});
});

test("readThinking returns an empty map when no thinking is configured", () => {
  assert.deepEqual(readThinking({}), {});
});

test("readThinking ignores non-string thinking entries, never coercing them", () => {
  assert.deepEqual(readThinking({ thinking: { build: 42, plan: null } }), {});
});

test("readThinking recovers a valid trailing legacy level from the model string", () => {
  assert.deepEqual(readThinking({ models: { build: "claude-opus-4-8 high" } }), {
    build: "high",
  });
});

test("readThinking does not recover an invalid trailing legacy token", () => {
  assert.deepEqual(readThinking({ models: { build: "claude-opus-4-8 max" } }), {});
});

test("readThinking does not recover from a model with no trailing token", () => {
  assert.deepEqual(readThinking({ models: { build: "claude-opus-4-8" } }), {});
});

test("readThinking: an explicit thinking map wins over a legacy suffix", () => {
  const out = readThinking({
    thinking: { build: "low" },
    models: { build: "claude-opus-4-8 high" },
  });
  assert.deepEqual(out, { build: "low" });
});

test("isPhase recognises the six SDD phases and nothing else", () => {
  for (const phase of PHASES) assert.ok(isPhase(phase));
  assert.ok(isPhase("clarify"));
  assert.ok(isPhase("analyze"));
  assert.ok(!isPhase("bogus"));
  assert.ok(!isPhase("Explore"));
});

test("PHASES lists the six SDD phases in pipeline order", () => {
  assert.deepEqual(
    [...PHASES],
    ["clarify", "explore", "plan", "analyze", "build", "veredicto"],
  );
});

test("readModels supplies gate defaults for clarify and analyze", () => {
  const models = readModels({});
  assert.equal(models.clarify, "claude-haiku-4-5", "clarify is a cheap/fast gate");
  assert.equal(models.analyze, "claude-opus-4-8", "analyze is a strong pre-build reviewer");
});

test("readModels keeps a four-phase zero.json valid, defaulting the new gates", () => {
  // A pre-gates zero.json that lists only the original four phases stays valid.
  const models = readModels({
    models: {
      explore: "claude-haiku-4-5",
      plan: "claude-opus-4-8",
      build: "claude-sonnet-4-6",
      veredicto: "claude-opus-4-8",
    },
  });
  assert.equal(models.build, "claude-sonnet-4-6", "existing phase preserved");
  assert.equal(models.clarify, "claude-haiku-4-5", "missing clarify falls back to default");
  assert.equal(models.analyze, "claude-opus-4-8", "missing analyze falls back to default");
});

test("readProviders includes clarify and analyze, empty by default", () => {
  const providers = readProviders({ providers: { analyze: "anthropic" } });
  assert.equal(providers.analyze, "anthropic");
  assert.equal(providers.clarify, "", "unset gate provider defaults to empty");
  for (const phase of PHASES) assert.equal(typeof providers[phase], "string");
});

test("parseAssignment accepts clarify and analyze phases", () => {
  assert.deepEqual(parseAssignment("clarify=claude-haiku-4-5"), {
    phase: "clarify",
    model: "claude-haiku-4-5",
  });
  assert.deepEqual(parseAssignment("analyze=anthropic/claude-opus-4-8 thinking=high"), {
    phase: "analyze",
    provider: "anthropic",
    model: "claude-opus-4-8",
    thinking: "high",
  });
});

test("parseAssignment accepts <phase>=<model> and <phase> <model>", () => {
  assert.deepEqual(parseAssignment("build=claude-opus-4-7"), {
    phase: "build",
    model: "claude-opus-4-7",
  });
  assert.deepEqual(parseAssignment("  explore  claude-haiku-4-5 "), {
    phase: "explore",
    model: "claude-haiku-4-5",
  });
  assert.deepEqual(parseAssignment("VEREDICTO=x"), { phase: "veredicto", model: "x" });
});

test("parseAssignment splits an explicit <provider>/<model>", () => {
  assert.deepEqual(parseAssignment("build=codex/gpt-5-codex"), {
    phase: "build",
    provider: "codex",
    model: "gpt-5-codex",
  });
  assert.deepEqual(parseAssignment("plan = anthropic / claude-opus-4-7"), {
    phase: "plan",
    provider: "anthropic",
    model: "claude-opus-4-7",
  });
});

test("parseAssignment rejects an unknown phase, an empty model, or no value", () => {
  assert.equal(parseAssignment("bogus=x"), null);
  assert.equal(parseAssignment("build="), null);
  assert.equal(parseAssignment("build"), null);
  assert.equal(parseAssignment(""), null);
});

test("parseAssignment parses an explicit thinking=<level> token", () => {
  assert.deepEqual(parseAssignment("build=anthropic/claude-opus-4-8 thinking=high"), {
    phase: "build",
    provider: "anthropic",
    model: "claude-opus-4-8",
    thinking: "high",
  });
});

test("parseAssignment parses a trailing bare <level> shorthand", () => {
  assert.deepEqual(parseAssignment("build=anthropic/claude-opus-4-8 high"), {
    phase: "build",
    provider: "anthropic",
    model: "claude-opus-4-8",
    thinking: "high",
  });
});

test("parseAssignment yields no thinking when no thinking token is present", () => {
  const out = parseAssignment("build=anthropic/claude-opus-4-8");
  assert.deepEqual(out, { phase: "build", provider: "anthropic", model: "claude-opus-4-8" });
  assert.ok(out && !("thinking" in out), "thinking key absent when not supplied");
});

test("parseAssignment does not treat a non-level trailing token as thinking", () => {
  assert.deepEqual(parseAssignment("build=claude-opus-4-8 codex"), {
    phase: "build",
    model: "claude-opus-4-8 codex",
  });
});

test("parseAssignment rejects an invalid explicit thinking level (null — no write)", () => {
  assert.equal(parseAssignment("build=anthropic/claude-opus-4-8 thinking=max"), null);
  assert.equal(parseAssignment("build=anthropic/claude-opus-4-8 thinking=ultracode"), null);
});

test("parseThinkingToken extracts an explicit thinking=<level> and cleans the value", () => {
  assert.deepEqual(parseThinkingToken("anthropic/claude-opus-4-8 thinking=high"), {
    value: "anthropic/claude-opus-4-8",
    thinking: "high",
  });
});

test("parseThinkingToken extracts a trailing bare <level>", () => {
  assert.deepEqual(parseThinkingToken("claude-opus-4-8 medium"), {
    value: "claude-opus-4-8",
    thinking: "medium",
  });
});

test("parseThinkingToken leaves a non-level trailing token in the value", () => {
  assert.deepEqual(parseThinkingToken("claude-opus-4-8 codex"), {
    value: "claude-opus-4-8 codex",
  });
});

test("parseThinkingToken returns the value unchanged when there is no thinking token", () => {
  assert.deepEqual(parseThinkingToken("claude-opus-4-8"), { value: "claude-opus-4-8" });
});

test("parseThinkingToken signals 'invalid' for an unknown explicit level", () => {
  assert.equal(parseThinkingToken("claude-opus-4-8 thinking=max"), "invalid");
  assert.equal(parseThinkingToken("claude-opus-4-8 thinking=ultracode"), "invalid");
});

test("readModels fills missing phases with the defaults", () => {
  const models = readModels({});
  for (const phase of PHASES) assert.equal(typeof models[phase], "string");
  assert.equal(models.explore, "claude-haiku-4-5");
});

test("readModels keeps the values present in zero.json", () => {
  const models = readModels({ models: { build: "my-model" } });
  assert.equal(models.build, "my-model");
  assert.equal(models.plan, "claude-opus-4-8", "untouched phases keep the default");
});

test("readModels ignores non-string model entries", () => {
  const models = readModels({ models: { build: 42 } });
  assert.equal(models.build, "claude-sonnet-4-6", "a non-string value falls back");
});

test("readModels strips a valid trailing thinking level for display", () => {
  const models = readModels({ models: { build: "claude-opus-4-8 high" } });
  assert.equal(models.build, "claude-opus-4-8");
});

test("readModels leaves a non-level trailing token untouched (no silent data loss)", () => {
  const models = readModels({ models: { build: "claude-opus-4-8 max" } });
  assert.equal(models.build, "claude-opus-4-8 max");
});

test("readModels leaves a plain model id (no trailing token) untouched", () => {
  const models = readModels({ models: { build: "claude-opus-4-8" } });
  assert.equal(models.build, "claude-opus-4-8");
});

test("readProviders reads stored providers and defaults the rest to empty", () => {
  const providers = readProviders({ providers: { build: "codex" } });
  assert.equal(providers.build, "codex");
  assert.equal(providers.plan, "");
  for (const phase of PHASES) assert.equal(typeof providers[phase], "string");
});

test("readProviders ignores non-string provider entries", () => {
  const providers = readProviders({ providers: { build: 7 } });
  assert.equal(providers.build, "");
});

test("groupByProvider buckets model ids by provider, sorted and de-duplicated", () => {
  const groups = groupByProvider([
    { provider: "anthropic", id: "claude-opus-4-7" },
    { provider: "anthropic", id: "claude-haiku-4-5" },
    { provider: "anthropic", id: "claude-opus-4-7" },
    { provider: "codex", id: "gpt-5-codex" },
  ]);
  assert.deepEqual(groups.get("anthropic"), ["claude-haiku-4-5", "claude-opus-4-7"]);
  assert.deepEqual(groups.get("codex"), ["gpt-5-codex"]);
});

test("groupByProvider skips malformed entries", () => {
  const groups = groupByProvider([
    { provider: "", id: "x" },
    { provider: "ok", id: "" },
    // @ts-expect-error — exercising the runtime guard
    { provider: 1, id: "y" },
    { provider: "ok", id: "good" },
  ]);
  assert.deepEqual([...groups.keys()], ["ok"]);
  assert.deepEqual(groups.get("ok"), ["good"]);
});

test("validateAssignment allows exact provider/model from the registry", () => {
  const groups = groupByProvider([
    { provider: "anthropic", id: "claude-opus-4-8" },
    { provider: "openai-codex", id: "gpt-5.5" },
  ]);
  assert.deepEqual(
    validateAssignment({ phase: "build", provider: "anthropic", model: "claude-opus-4-8" }, groups),
    { ok: true, provider: "anthropic" },
  );
});

test("validateAssignment infers provider for a unique bare model", () => {
  const groups = groupByProvider([
    { provider: "anthropic", id: "claude-opus-4-8" },
    { provider: "openai-codex", id: "gpt-5.5" },
  ]);
  assert.deepEqual(validateAssignment({ phase: "plan", model: "gpt-5.5" }, groups), {
    ok: true,
    provider: "openai-codex",
  });
});

test("validateAssignment rejects unknown providers and models when registry exists", () => {
  const groups = groupByProvider([{ provider: "anthropic", id: "claude-opus-4-8" }]);
  const badProvider = validateAssignment({ phase: "build", provider: "bogus", model: "x" }, groups);
  assert.equal(badProvider.ok, false);
  assert.match(badProvider.ok ? "" : badProvider.message, /provider desconocido/);

  const badModel = validateAssignment({ phase: "build", provider: "anthropic", model: "missing" }, groups);
  assert.equal(badModel.ok, false);
  assert.match(badModel.ok ? "" : badModel.message, /modelo desconocido/);
});

test("validateAssignment rejects ambiguous bare model ids", () => {
  const groups = groupByProvider([
    { provider: "azure-openai-responses", id: "gpt-5.5" },
    { provider: "openai-codex", id: "gpt-5.5" },
  ]);
  const out = validateAssignment({ phase: "explore", model: "gpt-5.5" }, groups);
  assert.equal(out.ok, false);
  assert.match(out.ok ? "" : out.message, /modelo ambiguo/);
  assert.match(out.ok ? "" : out.message, /openai-codex\/gpt-5\.5/);
});

test("validateAssignment keeps old permissive behavior when registry is unavailable", () => {
  assert.deepEqual(
    validateAssignment({ phase: "build", provider: "custom", model: "my-model" }, new Map()),
    { ok: true, provider: "custom" },
  );
});

test("formatPhases shows provider/model when a provider is set, model alone otherwise", () => {
  const models: PhaseModels = { clarify: "m-c", explore: "m-e", plan: "m-p", analyze: "m-a", build: "m-b", veredicto: "m-v" };
  const providers: PhaseProviders = { clarify: "", explore: "anthropic", plan: "", analyze: "", build: "codex", veredicto: "" };
  const out = formatPhases(models, providers, {});
  for (const phase of PHASES) assert.ok(out.includes(phase));
  assert.ok(out.includes("anthropic/m-e"));
  assert.ok(out.includes("codex/m-b"));
  assert.ok(out.includes(" m-p"), "no provider → bare model");
});

test("formatPhases appends the thinking level beside provider/model when set", () => {
  const models: PhaseModels = { clarify: "m-c", explore: "m-e", plan: "m-p", analyze: "m-a", build: "m-b", veredicto: "m-v" };
  const providers: PhaseProviders = { clarify: "", explore: "anthropic", plan: "", analyze: "", build: "codex", veredicto: "" };
  const thinking: PhaseThinking = { build: "high" };
  const out = formatPhases(models, providers, thinking);
  assert.ok(out.includes("codex/m-b · thinking high"), "thinking shown beside the model");
});

test("formatPhases shows no thinking artifact for a phase without a level", () => {
  const models: PhaseModels = { clarify: "m-c", explore: "m-e", plan: "m-p", analyze: "m-a", build: "m-b", veredicto: "m-v" };
  const providers: PhaseProviders = { clarify: "", explore: "anthropic", plan: "", analyze: "", build: "codex", veredicto: "" };
  const out = formatPhases(models, providers, { build: "high" });
  const planLine = out.split("\n").find((l) => l.includes("plan"))!;
  assert.ok(!planLine.includes("· thinking"), "unset phase has no · thinking text");
});

test("parseAutotuneArg accepts each valid mode", () => {
  assert.equal(parseAutotuneArg("auto"), "auto");
  assert.equal(parseAutotuneArg("ask"), "ask");
  assert.equal(parseAutotuneArg("off"), "off");
});

test("parseAutotuneArg is case-insensitive and trims surrounding space", () => {
  assert.equal(parseAutotuneArg("ASK"), "ask");
  assert.equal(parseAutotuneArg(" Off "), "off");
  assert.equal(parseAutotuneArg("\tAuto\n"), "auto");
});

test("parseAutotuneArg rejects junk with null", () => {
  assert.equal(parseAutotuneArg("bogus"), null);
  assert.equal(parseAutotuneArg(""), null);
  assert.equal(parseAutotuneArg("autos"), null);
});

test("formatAutotune returns a distinct non-empty label for each mode", () => {
  const auto = formatAutotune("auto");
  const ask = formatAutotune("ask");
  const off = formatAutotune("off");
  for (const label of [auto, ask, off]) {
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0);
  }
  assert.equal(new Set([auto, ask, off]).size, 3, "the three labels are distinct");
});

// ---------------------------------------------------------------------------
// Box and Split-view Frame Rendering
// ---------------------------------------------------------------------------

const dummyTheme = {
  fg: (_color: string, text: string) => text,
};

test("frameBox renders 4-sided Unicode box matching exact width", () => {
  const rows: BoxRow[] = [
    { text: "Title" },
    { text: "Option A" },
    { text: "Option B" },
  ];
  const width = 40;
  const lines = frameBox(rows, width, dummyTheme);
  assert.equal(lines.length, 5, "top + 3 rows + bottom = 5 lines");
  for (const line of lines) {
    assert.equal(line.length, width, `each line matches width ${width}`);
  }
  assert.ok(lines[0].startsWith("┌") && lines[0].endsWith("┐"));
  assert.ok(lines[4].startsWith("└") && lines[4].endsWith("┘"));
});

test("frameTwoBoxes renders two side-by-side boxes matching total width", () => {
  const leftRows: BoxRow[] = [
    { text: "Left Title" },
    { text: "Item 1" },
    { text: "Item 2" },
  ];
  const rightRows: BoxRow[] = [
    { text: "Right Preview" },
    { text: "Step clarify" },
    { text: "Step build" },
    { text: "Step veredicto" },
  ];
  const totalWidth = 100;
  const lines = frameTwoBoxes(leftRows, rightRows, totalWidth, dummyTheme);
  assert.ok(lines.length >= 6);
  for (const line of lines) {
    assert.equal(line.length, totalWidth, `each combined line matches totalWidth ${totalWidth}`);
  }
  // Check that left and right borders are present
  assert.ok(lines[0].includes("┌") && lines[0].includes("┐"));
  assert.ok(lines[lines.length - 1].includes("└") && lines[lines.length - 1].includes("┘"));
});

test("frameTwoBoxes falls back to single frameBox when width is below MIN_SPLIT_WIDTH", () => {
  const leftRows: BoxRow[] = [{ text: "Left Only" }];
  const rightRows: BoxRow[] = [{ text: "Right Preview" }];
  const narrowWidth = 50;
  const lines = frameTwoBoxes(leftRows, rightRows, narrowWidth, dummyTheme);
  for (const line of lines) {
    assert.equal(line.length, narrowWidth);
  }
  assert.ok(lines[1].includes("Left Only"));
  assert.ok(!lines[1].includes("Right Preview"));
});


// ---------------------------------------------------------------------------
// Responsive layout — the picker must fit the viewport by itself
// ---------------------------------------------------------------------------

/** Build `n` menu rows whose labels are long enough to need truncating. */
function longList(n: number): BoxRow[] {
  return Array.from({ length: n }, (_v, i) => ({
    text: `  perfil-numero-${String(i).padStart(3, "0")}-con-nombre-largo   (cliproxy, openai-codex)`,
  }));
}

const HEADER: BoxRow[] = [{ text: "zero · perfiles de modelos SDD" }, { text: "" }];
const FOOTER: BoxRow[] = [{ text: "" }, { text: "↑↓ navegar · enter elegir · esc volver" }];
const PREVIEW: BoxRow[] = [
  { text: "vista previa · mixto-wibond" },
  { text: "" },
  { text: "clarify   → cliproxy/plus/gpt-5.6-luna · medium" },
  { text: "veredicto → cliproxy/plus/gpt-5.6-sol · xhigh" },
];

test("framePicker never returns more lines than the terminal can show", () => {
  const lines = framePicker(
    { header: HEADER, list: longList(52), cursor: 0, footer: FOOTER, preview: PREVIEW, width: 120, maxRows: 30 },
    dummyTheme,
  );
  assert.ok(lines.length <= 30, `devolvió ${lines.length} líneas para maxRows=30`);
});

test("framePicker draws every line at exactly the given width", () => {
  for (const width of [80, 100, 120, 200]) {
    const lines = framePicker(
      { header: HEADER, list: longList(52), cursor: 10, footer: FOOTER, preview: PREVIEW, width, maxRows: 24 },
      dummyTheme,
    );
    for (const line of lines) {
      assert.equal(visibleWidth(line), width, `ancho ${visibleWidth(line)} != ${width}`);
    }
  }
});

test("framePicker keeps the cursor row on screen for every cursor position", () => {
  const list = longList(52);
  for (let cursor = 0; cursor < list.length; cursor++) {
    const marker = `perfil-numero-${String(cursor).padStart(3, "0")}`;
    const lines = framePicker(
      { header: HEADER, list, cursor, footer: FOOTER, preview: PREVIEW, width: 120, maxRows: 24 },
      dummyTheme,
    );
    assert.ok(lines.some((l) => l.includes(marker)), `el cursor ${cursor} quedó fuera de pantalla`);
  }
});

test("framePicker reports how many rows it hid above and below", () => {
  const lines = framePicker(
    { header: HEADER, list: longList(52), cursor: 26, footer: FOOTER, preview: PREVIEW, width: 120, maxRows: 24 },
    dummyTheme,
  );
  const body = lines.join("\n");
  assert.match(body, /↑ \d+ más/, "falta el indicador de filas ocultas arriba");
  assert.match(body, /↓ \d+ más/, "falta el indicador de filas ocultas abajo");
});

test("framePicker shows no scroll indicator when the whole list fits", () => {
  const lines = framePicker(
    { header: HEADER, list: longList(4), cursor: 0, footer: FOOTER, preview: PREVIEW, width: 120, maxRows: 40 },
    dummyTheme,
  );
  const body = lines.join("\n");
  assert.ok(!body.includes("más"), "mostró indicador de scroll con la lista entera visible");
});

test("framePicker always keeps the title and the help line", () => {
  const lines = framePicker(
    { header: HEADER, list: longList(52), cursor: 40, footer: FOOTER, preview: PREVIEW, width: 120, maxRows: 14 },
    dummyTheme,
  );
  const body = lines.join("\n");
  assert.ok(body.includes("zero · perfiles"), "se perdió el título");
  assert.ok(body.includes("navegar"), "se perdió la línea de ayuda");
});

test("framePicker drops the preview pane on a narrow terminal", () => {
  const lines = framePicker(
    { header: HEADER, list: longList(8), cursor: 0, footer: FOOTER, preview: PREVIEW, width: 60, maxRows: 30 },
    dummyTheme,
  );
  assert.ok(!lines.join("\n").includes("vista previa"), "dibujó el panel de preview sin lugar");
  for (const line of lines) assert.equal(visibleWidth(line), 60);
});

test("framePicker survives a degenerate viewport without throwing", () => {
  for (const [width, maxRows] of [[8, 3], [1, 1], [0, 0], [200, 2]] as const) {
    assert.doesNotThrow(() =>
      framePicker(
        { header: HEADER, list: longList(52), cursor: 3, footer: FOOTER, preview: PREVIEW, width, maxRows },
        dummyTheme,
      ),
    );
  }
});

test("frameBox marks a truncated row with an ellipsis instead of cutting it dead", () => {
  const lines = frameBox([{ text: "una-etiqueta-demasiado-larga-para-la-caja" }], 20, dummyTheme);
  assert.ok(lines[1].includes("…"), "cortó sin marcar el corte");
  assert.equal(visibleWidth(lines[1]), 20);
});

test("frameBox measures rows by display width, not by UTF-16 length", () => {
  const lines = frameBox([{ text: "漢字漢字漢字漢字漢字" }], 16, dummyTheme);
  for (const line of lines) assert.equal(visibleWidth(line), 16);
});

test("frameTwoBoxes sizes the menu pane from its content instead of a fixed cap", () => {
  const wide: BoxRow[] = [{ text: "x".repeat(70) }];
  const lines = frameTwoBoxes(wide, PREVIEW, 160, dummyTheme);
  // 70 cells of content + 4 of frame must survive when the terminal is 160 wide.
  assert.ok(lines[1].includes("x".repeat(70)), "recortó el menú teniendo lugar de sobra");
  for (const line of lines) assert.equal(visibleWidth(line), 160);
});

test("frameTwoBoxes falls back to one pane below MIN_SPLIT_WIDTH", () => {
  const lines = frameTwoBoxes([{ text: "Left Only" }], [{ text: "Right Preview" }], MIN_SPLIT_WIDTH - 1, dummyTheme);
  assert.ok(!lines.join("\n").includes("Right Preview"));
});
