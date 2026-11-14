// Regression tests: /zero-models never overwrites a `~/.pi/zero.json` it could
// not parse, and writes it atomically (temp file + rename).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import register, { readModels, readProviders } from "./zero-models.ts";
import { createPickerState } from "./zero-models-picker.ts";

const GOOD = {
  activeProfile: "a",
  profiles: {
    a: { models: { build: "m1" }, providers: {}, thinking: {} },
    b: { models: {}, providers: {}, thinking: {} },
  },
  autotune: "ask",
  keepMe: 1,
};
// Una coma de más al final: lo típico de editar a mano.
const TRAILING_COMMA = JSON.stringify(GOOD, null, 2).replace(/\n\}$/, ",\n}");
// Un archivo cortado a la mitad, como lo deja un crash durante la escritura.
const TRUNCATED = JSON.stringify(GOOD, null, 2).slice(0, 40);

/** Run `fn` with HOME pointing to a fresh temp dir with `~/.pi/` (and the
 *  given zero.json contents, when not undefined). */
async function withHome(zero: string | undefined, fn: (piDir: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "zero-models-zerojson-"));
  const piDir = join(home, ".pi");
  mkdirSync(piDir, { recursive: true });
  if (zero !== undefined) writeFileSync(join(piDir, "zero.json"), zero, "utf8");
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await fn(piDir);
  } finally {
    process.env.HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  }
}

function command(custom?: () => Promise<unknown>) {
  let handler: any;
  register({ registerCommand: (_n: string, o: any) => { handler = o.handler; } } as any);
  const notes: Array<[string, string | undefined]> = [];
  const ctx: any = {
    ui: {
      notify: (m: string, t?: string) => notes.push([m, t]),
      custom: custom ?? (async () => ({ type: "quit" })),
    },
  };
  return { run: (args: string) => handler(args, ctx), notes };
}

/** A picker "save" result with a real change staged. */
function pickerSave() {
  const state = createPickerState({
    models: readModels({}),
    providers: readProviders({}),
    thinking: {},
    autotuneMode: "auto",
    pending: [],
    groups: new Map(),
    fallbackModels: ["m"],
  } as any);
  state.edits.models.build = "claude-opus-4-8";
  state.edits.changed = true;
  return async () => ({ type: "save", state });
}

const WRITE_COMMANDS: Array<[string, string, (() => Promise<unknown>) | undefined]> = [
  ["asignar una fase", "build=claude-opus-4-8", undefined],
  ["asignar fase con thinking", "build=claude-opus-4-8 thinking=high", undefined],
  ["profile new", "profile new nuevo", undefined],
  ["profile use", "profile use b", undefined],
  ["profile delete", "profile delete b", undefined],
  ["autotune=", "autotune=off", undefined],
  ["guardar el picker", "", pickerSave()],
];

for (const [label, broken] of [["coma de más", TRAILING_COMMA], ["archivo truncado", TRUNCATED]] as const) {
  for (const [name, args, custom] of WRITE_COMMANDS) {
    test(`zero.json ilegible (${label}): ${name} no toca el archivo y avisa`, async () => {
      await withHome(broken, async (piDir) => {
        const file = join(piDir, "zero.json");
        const before = readFileSync(file);
        const c = command(custom);
        await c.run(args);
        assert.deepEqual(readFileSync(file), before, "zero.json cambió");
        assert.deepEqual(readdirSync(piDir), ["zero.json"], "quedó un archivo temporal");
        const err = c.notes.find(([, t]) => t === "error");
        assert.ok(err, `no hubo aviso de error: ${JSON.stringify(c.notes)}`);
        assert.ok(err[0].includes(file), "el aviso no nombra el archivo");
        assert.match(err[0], /a mano/);
      });
    });
  }
}

test("zero.json ilegible: profile list y el picker cerrado sin guardar solo avisan", async () => {
  await withHome(TRAILING_COMMA, async (piDir) => {
    const file = join(piDir, "zero.json");
    const before = readFileSync(file);
    for (const args of ["profile list", ""]) {
      const c = command();
      await c.run(args);
      assert.ok(c.notes.some(([m, t]) => t === "warning" && m.includes(file)), `sin aviso para "${args}"`);
    }
    assert.deepEqual(readFileSync(file), before);
  });
});

test("zero.json inexistente: asignar una fase lo crea y no deja temporales", async () => {
  await withHome(undefined, async (piDir) => {
    const c = command();
    await c.run("build=claude-opus-4-8");
    const after = JSON.parse(readFileSync(join(piDir, "zero.json"), "utf8"));
    assert.equal(after.models.build, "claude-opus-4-8");
    assert.deepEqual(readdirSync(piDir), ["zero.json"]);
    assert.ok(!c.notes.some(([, t]) => t === "error" || t === "warning"), JSON.stringify(c.notes));
  });
});

test("zero.json válido: asignar una fase conserva el resto de las claves", async () => {
  await withHome(JSON.stringify(GOOD, null, 2), async (piDir) => {
    const c = command();
    await c.run("build=claude-opus-4-8");
    const after = JSON.parse(readFileSync(join(piDir, "zero.json"), "utf8"));
    assert.equal(after.keepMe, 1);
    assert.equal(after.autotune, "ask");
    assert.ok(after.profiles.b);
    assert.equal(after.profiles.a.models.build, "claude-opus-4-8");
    assert.deepEqual(readdirSync(piDir), ["zero.json"]);
  });
});
