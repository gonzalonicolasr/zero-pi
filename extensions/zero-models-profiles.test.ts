// Unit tests for the `/zero-models profile` sub-command's pure logic.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyProfileCommand,
  formatActiveProfile,
  isProfileDirty,
  isValidProfileName,
  mirrorToActiveProfile,
  parseProfileCommand,
  readActiveProfile,
  readProfiles,
  sameProfile,
  snapshotFlat,
} from "./zero-models-profiles.ts";

/** A zero.json with the three flat maps populated and no profiles. */
function flatOnly(): Record<string, unknown> {
  return {
    models: { plan: "claude-opus-5", build: "claude-sonnet-5" },
    providers: { plan: "anthropic", build: "anthropic" },
    thinking: { plan: "xhigh", build: "high" },
    autotune: "ask",
  };
}

/** A zero.json with one saved profile, active and in sync with the flat maps. */
function withProfile(): Record<string, unknown> {
  const data = flatOnly();
  return {
    ...data,
    activeProfile: "premium",
    profiles: {
      premium: {
        models: { plan: "claude-opus-5", build: "claude-sonnet-5" },
        providers: { plan: "anthropic", build: "anthropic" },
        thinking: { plan: "xhigh", build: "high" },
      },
    },
  };
}

// --------------------------------- naming ---------------------------------

test("isValidProfileName accepts lowercase, digits, dash and underscore", () => {
  for (const name of ["barato", "qa-2", "perfil_1", "x"]) {
    assert.equal(isValidProfileName(name), true, name);
  }
});

test("isValidProfileName rejects uppercase, spaces, slashes and empty", () => {
  for (const name of ["Premium", "dos palabras", "a/b", "", "él"]) {
    assert.equal(isValidProfileName(name), false, name);
  }
});

test("isValidProfileName rejects the sub-command verbs so parsing stays unambiguous", () => {
  for (const name of ["list", "new", "save", "use", "delete", "rm", "from"]) {
    assert.equal(isValidProfileName(name), false, name);
  }
});

// --------------------------------- parsing --------------------------------

test("parseProfileCommand returns null for anything that is not a profile command", () => {
  assert.equal(parseProfileCommand("build=claude-opus-5"), null);
  assert.equal(parseProfileCommand("autotune=off"), null);
  assert.equal(parseProfileCommand(""), null);
  // A phase whose name merely starts with the same letters is not `profile`.
  assert.equal(parseProfileCommand("profiles"), null);
});

test("parseProfileCommand: bare `profile` and `profile list` both list", () => {
  assert.deepEqual(parseProfileCommand("profile"), { kind: "list" });
  assert.deepEqual(parseProfileCommand("profile list"), { kind: "list" });
  assert.deepEqual(parseProfileCommand("  PROFILE   LIST  "), { kind: "list" });
});

test("parseProfileCommand: new, with and without a clone source", () => {
  assert.deepEqual(parseProfileCommand("profile new qa"), { kind: "new", name: "qa" });
  assert.deepEqual(parseProfileCommand("profile new qa from premium"), {
    kind: "new",
    name: "qa",
    from: "premium",
  });
});

test("parseProfileCommand: save with and without a name", () => {
  assert.deepEqual(parseProfileCommand("profile save"), { kind: "save" });
  assert.deepEqual(parseProfileCommand("profile save barato"), {
    kind: "save",
    name: "barato",
  });
});

test("parseProfileCommand: use accepts both `use <n>` and `profile=<n>`", () => {
  assert.deepEqual(parseProfileCommand("profile use barato"), {
    kind: "use",
    name: "barato",
  });
  assert.deepEqual(parseProfileCommand("profile=barato"), { kind: "use", name: "barato" });
  assert.deepEqual(parseProfileCommand("profile = barato"), { kind: "use", name: "barato" });
});

test("parseProfileCommand: delete and its rm alias", () => {
  assert.deepEqual(parseProfileCommand("profile delete qa"), { kind: "delete", name: "qa" });
  assert.deepEqual(parseProfileCommand("profile rm qa"), { kind: "delete", name: "qa" });
});

test("parseProfileCommand: malformed forms are invalid, never silently accepted", () => {
  for (const arg of [
    "profile new",
    "profile new qa desde premium",
    "profile new qa from",
    "profile use",
    "profile use a b",
    "profile save a b",
    "profile bogus qa",
    "profile list extra",
  ]) {
    const parsed = parseProfileCommand(arg);
    assert.equal(parsed?.kind, "invalid", arg);
  }
});

test("parseProfileCommand: a verb used as a name is rejected with a targeted message", () => {
  const parsed = parseProfileCommand("profile new save");
  assert.equal(parsed?.kind, "invalid");
  assert.match(
    (parsed as { kind: "invalid"; message: string }).message,
    /verbo del comando/,
  );
});

// ---------------------------------- reads ---------------------------------

test("readProfiles skips malformed entries instead of throwing", () => {
  const profiles = readProfiles({
    profiles: {
      ok: { models: { plan: "m" }, providers: {}, thinking: {} },
      "BAD NAME": { models: { plan: "m" } },
      broken: "not an object",
      partial: { models: { plan: "m", nofase: "x" } },
    },
  });
  assert.deepEqual(Object.keys(profiles).sort(), ["ok", "partial"]);
  // A key that is not a phase never makes it into the profile.
  assert.deepEqual(profiles.partial.models, { plan: "m" });
});

test("readProfiles tolerates a missing or non-object profiles key", () => {
  assert.deepEqual(readProfiles({}), {});
  assert.deepEqual(readProfiles({ profiles: [] }), {});
  assert.deepEqual(readProfiles({ profiles: null }), {});
});

test("readActiveProfile returns null when the pointer dangles", () => {
  assert.equal(readActiveProfile({}), null);
  assert.equal(readActiveProfile({ activeProfile: "ghost", profiles: {} }), null);
  assert.equal(readActiveProfile(withProfile()), "premium");
});

// ---------------------------------- dirty ---------------------------------

test("a profile in sync with the flat maps is not dirty", () => {
  const data = withProfile();
  assert.equal(isProfileDirty(data), false);
  assert.equal(formatActiveProfile(data), "premium");
});

test("an out-of-band write to the flat maps marks the profile dirty", () => {
  // This is exactly what autotune-extension.ts does: it writes `models`
  // straight into zero.json without going through the profile.
  const data = withProfile();
  const tuned = {
    ...data,
    models: { plan: "claude-opus-5", build: "claude-haiku-4-5" },
  };
  assert.equal(isProfileDirty(tuned), true);
  assert.equal(formatActiveProfile(tuned), "premium*");
});

test("with no active profile there is never a dirty marker", () => {
  assert.equal(isProfileDirty(flatOnly()), false);
  assert.equal(formatActiveProfile(flatOnly()), "");
});

test("sameProfile compares per phase, not by key order or absent-vs-empty", () => {
  const a = { models: { plan: "m" }, providers: {}, thinking: {} };
  const b = { models: { plan: "m" }, providers: { plan: "" }, thinking: {} };
  assert.equal(sameProfile(a, b), true);
  assert.equal(sameProfile(a, { ...a, models: { plan: "otro" } }), false);
});

// --------------------------------- mirroring ------------------------------

test("mirrorToActiveProfile folds the flat maps into the active profile", () => {
  const edited = { ...withProfile(), models: { plan: "claude-opus-5", build: "nuevo" } };
  const mirrored = mirrorToActiveProfile(edited);
  const profiles = readProfiles(mirrored);
  assert.equal(profiles.premium.models.build, "nuevo");
  assert.equal(isProfileDirty(mirrored), false);
});

test("mirrorToActiveProfile is a no-op without an active profile", () => {
  const data = flatOnly();
  assert.equal(mirrorToActiveProfile(data), data);
});

// ----------------------------------- new ----------------------------------

test("new snapshots the current config, activates it and keeps other keys", () => {
  const result = applyProfileCommand(flatOnly(), { kind: "new", name: "qa" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.activeProfile, "qa");
  assert.equal(readProfiles(result.data).qa.models.plan, "claude-opus-5");
  // Unrelated keys survive.
  assert.equal(result.data.autotune, "ask");
  // Creating from the current config leaves it in sync, not dirty.
  assert.equal(isProfileDirty(result.data), false);
});

test("new refuses to overwrite an existing profile", () => {
  const result = applyProfileCommand(withProfile(), { kind: "new", name: "premium" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /ya existe/);
});

test("new … from clones the source profile and makes it the live config", () => {
  const base = withProfile();
  const seeded = {
    ...base,
    profiles: {
      ...(base.profiles as Record<string, unknown>),
      barato: {
        models: { plan: "gpt-5.6-luna" },
        providers: { plan: "openai-codex" },
        thinking: { plan: "low" },
      },
    },
  };
  const result = applyProfileCommand(seeded, { kind: "new", name: "qa", from: "barato" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.models, { plan: "gpt-5.6-luna" });
  assert.equal(result.data.activeProfile, "qa");
  // The clone source is untouched.
  assert.equal(readProfiles(result.data).barato.models.plan, "gpt-5.6-luna");
});

test("new … from an unknown source fails without writing", () => {
  const result = applyProfileCommand(flatOnly(), {
    kind: "new",
    name: "qa",
    from: "fantasma",
  });
  assert.equal(result.ok, false);
});

// ----------------------------------- save ---------------------------------

test("save with a name snapshots the current config under it and activates it", () => {
  const result = applyProfileCommand(flatOnly(), { kind: "save", name: "barato" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.activeProfile, "barato");
  assert.deepEqual(readProfiles(result.data).barato, snapshotFlat(flatOnly()));
});

test("save without a name consolidates a dirty active profile", () => {
  const tuned = {
    ...withProfile(),
    models: { plan: "claude-opus-5", build: "modelo-que-puso-autotune" },
  };
  assert.equal(isProfileDirty(tuned), true);
  const result = applyProfileCommand(tuned, { kind: "save" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(isProfileDirty(result.data), false);
  assert.equal(readProfiles(result.data).premium.models.build, "modelo-que-puso-autotune");
});

test("save without a name and without an active profile asks for one", () => {
  const result = applyProfileCommand(flatOnly(), { kind: "save" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /dale un nombre/);
});

// ------------------------------------ use ---------------------------------

test("use flattens the profile onto the maps every consumer reads", () => {
  const base = withProfile();
  const seeded = {
    ...base,
    profiles: {
      ...(base.profiles as Record<string, unknown>),
      barato: {
        models: { plan: "gpt-5.6-luna" },
        providers: { plan: "openai-codex" },
        thinking: { plan: "low" },
      },
    },
  };
  const result = applyProfileCommand(seeded, { kind: "use", name: "barato" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.models, { plan: "gpt-5.6-luna" });
  assert.deepEqual(result.data.providers, { plan: "openai-codex" });
  assert.deepEqual(result.data.thinking, { plan: "low" });
  assert.equal(result.data.activeProfile, "barato");
  // Switching away does not lose the profile you came from.
  assert.equal(readProfiles(result.data).premium.models.plan, "claude-opus-5");
});

test("use drops the thinking key entirely when the profile has no levels", () => {
  const data = {
    ...flatOnly(),
    profiles: { plano: { models: { plan: "m" }, providers: {}, thinking: {} } },
  };
  const result = applyProfileCommand(data, { kind: "use", name: "plano" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("thinking" in result.data, false);
});

test("use of an unknown profile fails and points at the listing", () => {
  const result = applyProfileCommand(withProfile(), { kind: "use", name: "fantasma" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.message, /profile list/);
});

// ---------------------------------- delete --------------------------------

test("delete removes the profile but never changes the models in use", () => {
  const data = withProfile();
  const result = applyProfileCommand(data, { kind: "delete", name: "premium" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(readProfiles(result.data), {});
  assert.equal("activeProfile" in result.data, false);
  // The live configuration is untouched.
  assert.deepEqual(result.data.models, data.models);
});

test("delete of an unknown profile fails", () => {
  assert.equal(applyProfileCommand(withProfile(), { kind: "delete", name: "x" }).ok, false);
});

// ----------------------------------- list ---------------------------------

test("list marks the active profile and flags it when dirty", () => {
  const clean = applyProfileCommand(withProfile(), { kind: "list" });
  assert.equal(clean.ok, true);
  if (!clean.ok) return;
  assert.match(clean.message, /\* premium {2}\(activo\)/);

  const tuned = { ...withProfile(), models: { plan: "otro" } };
  const dirty = applyProfileCommand(tuned, { kind: "list" });
  assert.equal(dirty.ok, true);
  if (!dirty.ok) return;
  assert.match(dirty.message, /sin guardar/);
});

test("list with no profiles explains how to create the first one", () => {
  const result = applyProfileCommand(flatOnly(), { kind: "list" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.message, /profile new <nombre>/);
});

test("list never modifies the store", () => {
  const data = withProfile();
  const result = applyProfileCommand(data, { kind: "list" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data, data);
});

// --------------------------------- round-trip -----------------------------

test("round-trip: new, edit, switch away and back restores the edited profile", () => {
  // 1. Create `barato` from the current config.
  const created = applyProfileCommand(flatOnly(), { kind: "new", name: "barato" });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  // 2. Edit a phase the way the direct command does, then mirror.
  const edited = mirrorToActiveProfile({
    ...created.data,
    models: { ...(created.data.models as object), build: "gpt-5.6-luna" },
  });

  // 3. Save the original config under another name, switch to it.
  const saved = applyProfileCommand(edited, { kind: "save", name: "premium" });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  // 4. Come back to `barato`.
  const back = applyProfileCommand(saved.data, { kind: "use", name: "barato" });
  assert.equal(back.ok, true);
  if (!back.ok) return;
  assert.equal((back.data.models as Record<string, string>).build, "gpt-5.6-luna");
});
