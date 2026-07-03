// Unit tests for the zero-pi working-phrases extension.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeSdd,
  pickThinking,
  sddPhase,
  spinnerFrames,
  toolPhrase,
} from "./working-phrases.ts";

test("toolPhrase maps known tool families to a phrase", () => {
  assert.equal(toolPhrase("Read"), "Leyendo archivos");
  assert.equal(toolPhrase("multi_edit"), "Aplicando cambios");
  assert.equal(toolPhrase("write_file"), "Escribiendo archivos");
  assert.equal(toolPhrase("bash"), "Ejecutando comandos");
  assert.equal(toolPhrase("grep"), "Buscando en el código");
  assert.equal(toolPhrase("glob"), "Rastreando archivos");
  assert.equal(toolPhrase("web_fetch"), "Navegando la web");
});

test("toolPhrase names the MCP server for namespaced tools", () => {
  assert.equal(toolPhrase("mcp__cortex__memoria_save"), "Consultando un MCP");
  assert.equal(toolPhrase("mcp-foo"), "Consultando un MCP");
});

test("toolPhrase falls back to the raw tool name", () => {
  assert.equal(toolPhrase("frobnicate"), "Usando frobnicate");
  assert.equal(toolPhrase(""), "Trabajando");
});

test("sddPhase recognises a single zero sub-agent invocation", () => {
  assert.equal(sddPhase({ agent: "zero-explore" }), "Explorando el código");
  assert.equal(sddPhase({ agent: "zero-build", task: "do it" }), "Construyendo la implementación");
});

test("sddPhase labels the clarify and analyze gate sub-agents in Spanish", () => {
  const clarify = sddPhase({ agent: "zero-clarify" });
  const analyze = sddPhase({ agent: "zero-analyze" });
  assert.equal(typeof clarify, "string");
  assert.equal(typeof analyze, "string");
  assert.ok(clarify && clarify.length > 0, "clarify has a non-empty label");
  assert.ok(analyze && analyze.length > 0, "analyze has a non-empty label");
  assert.notEqual(clarify, analyze, "the two gates get distinct labels");
});

test("sddPhase recognises packaged (dotted) and chain/parallel shapes", () => {
  assert.equal(sddPhase({ agent: "zero-pi.zero-plan" }), "Planeando la solución");
  assert.equal(
    sddPhase({ chain: [{ agent: "zero-veredicto" }] }),
    "Revisando el veredicto",
  );
  assert.equal(
    sddPhase({ tasks: [{ parallel: [{ agent: "zero-explore" }] }] }),
    "Explorando el código",
  );
});

test("sddPhase returns null for non-SDD agents and bad input", () => {
  assert.equal(sddPhase({ agent: "code-reviewer" }), null);
  assert.equal(sddPhase(undefined), null);
  assert.equal(sddPhase("nonsense"), null);
});

test("looksLikeSdd triggers on forge and sdd signals only", () => {
  assert.equal(looksLikeSdd("/forge add a login page"), true);
  assert.equal(looksLikeSdd("hacelo con sdd"), true);
  assert.equal(looksLikeSdd("zero sdd"), true);
  assert.equal(looksLikeSdd("fix the typo"), false);
});

test("pickThinking never repeats the previous phrase", () => {
  for (let i = 0; i < 50; i++) {
    const prev = pickThinking(undefined, false);
    assert.notEqual(pickThinking(prev, false), prev);
    const prevSdd = pickThinking(undefined, true);
    assert.notEqual(pickThinking(prevSdd, true), prevSdd);
  }
});

test("spinnerFrames produces one coloured frame per glyph", () => {
  const theme = { fg: (color: string, text: string) => `<${color}>${text}` };
  const frames = spinnerFrames(theme);
  assert.equal(frames.length, 10);
  assert.ok(frames.every((f) => f.startsWith("<")));
});

test("spinnerFrames degrades gracefully when the theme throws", () => {
  const theme = {
    fg: () => {
      throw new Error("no such colour");
    },
  };
  const frames = spinnerFrames(theme);
  assert.equal(frames.length, 10);
  assert.deepEqual(frames, ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
});
