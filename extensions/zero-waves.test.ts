import { test } from "node:test";
import assert from "node:assert/strict";

import { PARALLEL_MAX, codeRootsFrom, nextWave, normalizeTaskPath, samePath, tickTasks, waveSchedule } from "./zero-waves.ts";
import { parseTasks } from "./zero-validate.ts";

type Spec = { id: string; p?: boolean; done?: boolean; files: string[]; depends?: string[]; review?: number; shape?: "h3" | "bullet" | "h2" };

function tasksMd(specs: Spec[], preamble = ""): string {
  const blocks = specs.map((t) => {
    const shape = t.shape ?? "h3";
    const p = t.p ? " [P]" : "";
    const head = shape === "bullet" ? `- [${t.done ? "x" : " "}] **${t.id}. Title ${t.id}**${p}`
      : shape === "h2" ? `## [${t.done ? "x" : " "}] ${t.id} — Title ${t.id}${p}`
      : `### ${t.id} — ${t.done ? "[x] " : ""}Title ${t.id}${p}`;
    return [head, "", "- files:", ...t.files.map((f) => `  - \`${f}\``), `- depends: ${t.depends?.length ? t.depends.join(", ") : "[]"}`, "- evidence: `npm test`", `- review: ~${t.review ?? 50} changed lines`, ""].join("\n");
  });
  return `# Tasks\n\n${preamble}${blocks.join("\n")}`;
}

test("parseTasks reports [P] and done without leaking either marker into the title", () => {
  const parsed = parseTasks(tasksMd([
    { id: "T001", done: true, files: ["a.ts"] },
    { id: "T002", p: true, files: ["b.ts"], depends: ["T001"] },
    { id: "T003", p: true, shape: "bullet", files: ["c.ts"] },
    { id: "T004", done: true, shape: "h2", files: ["d.ts"] },
  ]));
  assert.deepEqual(parsed.tasks.map((t) => [t.id, t.done, t.parallel, t.title]), [
    ["T001", true, false, "Title T001"],
    ["T002", false, true, "Title T002"],
    ["T003", false, true, "Title T003"],
    ["T004", true, false, "Title T004"],
  ]);
  assert.deepEqual(parsed.defects, []);
});

test("no [P] anywhere keeps the sequential batching: 4 tasks or 800 lines", () => {
  const text = tasksMd(Array.from({ length: 6 }, (_, i) => ({ id: `T00${i + 1}`, files: [`f${i}.ts`] })));
  assert.deepEqual(nextWave(text), { mode: "sequential", tasks: ["T001", "T002", "T003", "T004"] });
  assert.deepEqual(waveSchedule(text).map((w) => w.tasks), [["T001", "T002", "T003", "T004"], ["T005", "T006"]]);
  const heavy = tasksMd([{ id: "T001", files: ["a"], review: 500 }, { id: "T002", files: ["b"], review: 400 }, { id: "T003", files: ["c"], review: 900 }]);
  assert.deepEqual(waveSchedule(heavy).map((w) => w.tasks), [["T001"], ["T002"], ["T003"]]);
});

test("three disjoint [P] tasks form one parallel wave", () => {
  const text = tasksMd([
    { id: "T001", done: true, files: ["base.ts"] },
    { id: "T002", p: true, files: ["a.ts", "a.test.ts"], depends: ["T001"] },
    { id: "T003", p: true, files: ["b.ts"], depends: ["T001"] },
    { id: "T004", p: true, files: ["c.ts"] },
    { id: "T005", files: ["d.ts"], depends: ["T002", "T003", "T004"] },
  ]);
  assert.deepEqual(nextWave(text), { mode: "parallel", tasks: ["T002", "T003", "T004"] });
  assert.deepEqual(waveSchedule(text), [{ mode: "parallel", tasks: ["T002", "T003", "T004"] }, { mode: "sequential", tasks: ["T005"] }]);
});

test("a file overlap keeps the later task out of the wave", () => {
  const text = tasksMd([
    { id: "T001", p: true, files: ["a.ts", "shared.ts"] },
    { id: "T002", p: true, files: ["shared.ts"] },
    { id: "T003", p: true, files: ["c.ts"] },
  ]);
  assert.deepEqual(nextWave(text), { mode: "parallel", tasks: ["T001", "T003"] });
  assert.deepEqual(waveSchedule(text).map((w) => w.tasks), [["T001", "T003"], ["T002"]]);
});

test("a [P] task whose dependency is not [x] yet waits, even if the dependency is in the same wave", () => {
  const text = tasksMd([
    { id: "T001", p: true, files: ["a.ts"] },
    { id: "T002", p: true, files: ["b.ts"], depends: ["T001"] },
    { id: "T003", p: true, files: ["c.ts"] },
  ]);
  assert.deepEqual(nextWave(text), { mode: "parallel", tasks: ["T001", "T003"] });
  assert.deepEqual(waveSchedule(text).map((w) => w.tasks), [["T001", "T003"], ["T002"]]);
});

test("a sequential batch stops before a [P] task that can open a wave of two or more", () => {
  const text = tasksMd([
    { id: "T001", files: ["a.ts"] },
    { id: "T002", p: true, files: ["b.ts"] },
    { id: "T003", p: true, files: ["c.ts"] },
  ]);
  assert.deepEqual(nextWave(text), { mode: "sequential", tasks: ["T001"] });
  assert.deepEqual(waveSchedule(text), [{ mode: "sequential", tasks: ["T001"] }, { mode: "parallel", tasks: ["T002", "T003"] }]);
  const gated = tasksMd([
    { id: "T001", files: ["a.ts"] },
    { id: "T002", p: true, files: ["b.ts"], depends: ["T001"] },
    { id: "T003", p: true, files: ["c.ts"], depends: ["T001"] },
    { id: "T004", files: ["d.ts"], depends: ["T002", "T003"] },
  ]);
  assert.deepEqual(waveSchedule(gated).map((w) => [w.mode, w.tasks]), [["sequential", ["T001"]], ["parallel", ["T002", "T003"]], ["sequential", ["T004"]]]);
});

test("a [P] task that cannot pair with any later task stays in the sequential batch", () => {
  const text = tasksMd([
    { id: "T001", files: ["a.ts"] },
    { id: "T002", p: true, files: ["shared.ts"] },
    { id: "T003", p: true, files: ["shared.ts"] },
    { id: "T004", files: ["d.ts"] },
  ]);
  assert.deepEqual(waveSchedule(text).map((w) => [w.mode, w.tasks]), [["sequential", ["T001", "T002", "T003", "T004"]]]);
  const lone = tasksMd([{ id: "T001", files: ["a.ts"] }, { id: "T002", p: true, files: ["b.ts"] }, { id: "T003", files: ["c.ts"] }]);
  assert.deepEqual(nextWave(lone), { mode: "sequential", tasks: ["T001", "T002", "T003"] });
});

test("a batch cut by the line budget still lets the next step open the wave", () => {
  const text = tasksMd([
    { id: "T001", files: ["a.ts"], review: 700 },
    { id: "T002", p: true, files: ["b.ts"], review: 200 },
    { id: "T003", p: true, files: ["c.ts"], review: 200 },
  ]);
  assert.deepEqual(waveSchedule(text), [{ mode: "sequential", tasks: ["T001"] }, { mode: "parallel", tasks: ["T002", "T003"] }]);
});

test("a wave never exceeds PARALLEL_MAX tasks", () => {
  assert.equal(PARALLEL_MAX, 3);
  const text = tasksMd(Array.from({ length: 5 }, (_, i) => ({ id: `T00${i + 1}`, p: true, files: [`f${i}.ts`] })));
  assert.deepEqual(waveSchedule(text).map((w) => [w.mode, w.tasks]), [["parallel", ["T001", "T002", "T003"]], ["parallel", ["T004", "T005"]]]);
});

test("paths are compared after stripping (new) and the code root", () => {
  assert.equal(normalizeTaskPath("/repo/pkg/src/a.ts", ["/repo/pkg"]), "src/a.ts");
  assert.equal(normalizeTaskPath("./src/a.ts (new)", ["/repo/pkg"]), "src/a.ts");
  assert.equal(normalizeTaskPath("/elsewhere/a.ts", ["/repo/pkg"]), "/elsewhere/a.ts");
  const text = tasksMd([
    { id: "T001", p: true, files: ["/repo/pkg/src/a.ts"] },
    { id: "T002", p: true, files: ["src/a.ts (new)"] },
    { id: "T003", p: true, files: ["./src/b.ts"] },
  ], "Code root: `/repo/pkg`\n\n");
  assert.deepEqual(codeRootsFrom(text), ["/repo/pkg"]);
  assert.deepEqual(nextWave(text, codeRootsFrom(text)), { mode: "parallel", tasks: ["T001", "T003"] });
});

test("an absolute path outside every known root still collides with its relative spelling", () => {
  assert.equal(samePath("/unknown/root/src/a.ts", "src/a.ts"), true);
  assert.equal(samePath("src/a.ts", "lib/src/a.ts"), true);
  assert.equal(samePath("a/index.ts", "b/index.ts"), false);
  assert.equal(normalizeTaskPath("/repo/pkg/ext/a.ts", ["/repo/pkg/ext", "/repo/pkg"]), "ext/a.ts");
  const text = tasksMd([
    { id: "T001", p: true, files: ["/unknown/root/src/a.ts"] },
    { id: "T002", p: true, files: ["src/a.ts"] },
  ]);
  assert.deepEqual(nextWave(text), { mode: "sequential", tasks: ["T001", "T002"] });
});

test("code roots come from a Code root line and a design ## Code roots section", () => {
  const design = "# Design\n\n## Code roots\n\n- `/repo/a` — app\n- /repo/b\n\n## Other\n- `/not/a/root`\n";
  assert.deepEqual(codeRootsFrom("Code root: /repo/pkg\n", design), ["/repo/pkg", "/repo/a", "/repo/b"]);
});

test("done and blocked states", () => {
  assert.deepEqual(nextWave(tasksMd([{ id: "T001", done: true, files: ["a"] }])), { mode: "done", tasks: [] });
  const blocked = nextWave(tasksMd([{ id: "T001", files: ["a"], depends: ["T009"] }]));
  assert.equal(blocked.mode, "blocked");
  assert.match(blocked.mode === "blocked" ? blocked.reason : "", /T009/);
});

test("tickTasks marks the three real header shapes and leaves the rest alone", () => {
  const text = tasksMd([
    { id: "T001", p: true, files: ["a"] },
    { id: "T002", shape: "bullet", files: ["b"] },
    { id: "T003", shape: "h2", files: ["c"] },
    { id: "T004", done: true, files: ["d"] },
    { id: "T005", files: ["e"] },
  ]);
  const out = tickTasks(text, ["T001", "T002", "T003", "T004", "T042"]);
  assert.deepEqual(out.ticked, ["T001", "T002", "T003"]);
  assert.deepEqual(out.already, ["T004"]);
  assert.deepEqual(out.missing, ["T042"]);
  assert.match(out.text, /^### T001 — \[x\] Title T001 \[P\]$/m);
  assert.match(out.text, /^- \[x\] \*\*T002\. Title T002\*\*$/m);
  assert.match(out.text, /^## \[x\] T003 — Title T003$/m);
  assert.match(out.text, /^### T005 — Title T005$/m);
  assert.deepEqual(parseTasks(out.text).tasks.map((t) => t.done), [true, true, true, true, false]);
  assert.equal(tickTasks(out.text, ["T001"]).text, out.text);
});
