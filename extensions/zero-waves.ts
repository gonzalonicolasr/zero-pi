import { posix } from "node:path";

import { parseTasks, type TaskRecord } from "./zero-validate.ts";

export const PARALLEL_MAX = 3;
export const BATCH_TASKS = 4;
export const BATCH_LINES = 800;

export type Wave =
  | { mode: "parallel" | "sequential"; tasks: string[] }
  | { mode: "done"; tasks: [] }
  | { mode: "blocked"; tasks: []; reason: string };

function cleanRoot(raw: string): string {
  const trimmed = raw.replace(/[.,;:]+$/, "");
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

export function codeRootsFrom(...texts: string[]): string[] {
  const roots: string[] = [];
  const add = (raw: string | undefined) => { if (raw) { const root = cleanRoot(raw); if (root.startsWith("/") && !roots.includes(root)) roots.push(root); } };
  for (const text of texts) {
    if (typeof text !== "string") continue;
    for (const m of text.matchAll(/Code roots?\**\s*:\s*`?(\/[^`\s]+)`?/g)) add(m[1]);
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => /^##\s+Code roots\s*$/.test(l));
    if (start < 0) continue;
    for (const line of lines.slice(start + 1)) {
      if (/^##\s+/.test(line)) break;
      add(line.match(/`(\/[^`]+)`/)?.[1] ?? line.match(/(?:^|\s)(\/\S+)/)?.[1]);
    }
  }
  return roots;
}

export function normalizeTaskPath(raw: string, roots: readonly string[] = []): string {
  let path = raw.trim().replace(/\s*\(new\)$/i, "").trim();
  path = posix.normalize(path);
  if (path.startsWith("/")) {
    const root = [...roots].map(cleanRoot).sort((a, b) => a.length - b.length).find((r) => path.startsWith(`${r}/`));
    if (root) path = path.slice(root.length + 1);
  }
  return path.replace(/^\.\//, "");
}

function pathsOf(task: TaskRecord, roots: readonly string[]): string[] {
  return task.files.map((f) => normalizeTaskPath(f.path, roots));
}

export function samePath(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function parallelFrom(start: number, pending: TaskRecord[], roots: readonly string[], isDone: (id: string) => boolean): string[] {
  const deps = (t: TaskRecord) => t.depends ?? [];
  const first = pending[start];
  if (!first.parallel || !first.files.length || !deps(first).every(isDone)) return [first.id];
  const wave = [first.id];
  const used = pathsOf(first, roots);
  for (const t of pending.slice(start + 1)) {
    if (wave.length >= PARALLEL_MAX) break;
    if (!t.parallel || !t.files.length || !deps(t).every(isDone)) continue;
    const mine = pathsOf(t, roots);
    if (mine.some((p) => used.some((u) => samePath(p, u)))) continue;
    wave.push(t.id);
    used.push(...mine);
  }
  return wave;
}

function waveOf(tasks: TaskRecord[], roots: readonly string[], done: Set<string>): Wave {
  const isDone = (id: string) => done.has(id);
  const pending = tasks.filter((t) => !isDone(t.id));
  if (pending.length === 0) return { mode: "done", tasks: [] };
  const deps = (t: TaskRecord) => t.depends ?? [];
  const first = pending[0];
  const unmet = deps(first).filter((d) => !isDone(d));
  if (unmet.length) return { mode: "blocked", tasks: [], reason: `${first.id} depends on ${unmet.join(", ")}, which is not [x]; re-run plan` };

  const wave = parallelFrom(0, pending, roots, isDone);
  if (wave.length >= 2) return { mode: "parallel", tasks: wave };

  const batch: string[] = [];
  let lines = 0;
  for (const [index, t] of pending.entries()) {
    if (!deps(t).every((d) => isDone(d) || batch.includes(d))) break;
    const estimate = t.review ?? 0;
    if (batch.length && (batch.length >= BATCH_TASKS || lines + estimate > BATCH_LINES)) break;
    if (batch.length && t.parallel && parallelFrom(index, pending, roots, (id) => isDone(id) || batch.includes(id)).length >= 2) break;
    batch.push(t.id);
    lines += estimate;
  }
  return { mode: "sequential", tasks: batch };
}

export function nextWave(text: string, roots: readonly string[] = []): Wave {
  const tasks = parseTasks(text).tasks;
  return waveOf(tasks, roots, new Set(tasks.filter((t) => t.done).map((t) => t.id)));
}

export function waveSchedule(text: string, roots: readonly string[] = []): Wave[] {
  const tasks = parseTasks(text).tasks;
  const done = new Set(tasks.filter((t) => t.done).map((t) => t.id));
  const out: Wave[] = [];
  for (let i = 0; i <= tasks.length; i++) {
    const wave = waveOf(tasks, roots, done);
    if (wave.mode === "done") break;
    out.push(wave);
    if (wave.mode === "blocked") break;
    for (const id of wave.tasks) done.add(id);
  }
  return out;
}

export function tickTasks(text: string, ids: readonly string[]): { text: string; ticked: string[]; already: string[]; missing: string[] } {
  const wanted = new Set(ids);
  const ticked: string[] = [], already: string[] = [], seen = new Set<string>();
  const lines = text.split("\n").map((line) => {
    let m = line.match(/^(\s*- \[)([ xX])(\]\s+\*\*(T\d+)\.)/) ?? line.match(/^(#{2,3}\s+\[)([ xX])(\]\s+(T\d+)\b)/);
    if (m) {
      const id = m[4];
      if (!wanted.has(id) || seen.has(id)) return line;
      seen.add(id);
      if (m[2] !== " ") { already.push(id); return line; }
      ticked.push(id);
      return `${m[1]}x${m[3]}${line.slice(m[0].length)}`;
    }
    m = line.match(/^(###\s+(T\d+)\s+[—-]\s+)(\[([ xX])\]\s*)?(.*)$/);
    if (!m) return line;
    const id = m[2];
    if (!wanted.has(id) || seen.has(id)) return line;
    seen.add(id);
    if (m[4] && m[4] !== " ") { already.push(id); return line; }
    ticked.push(id);
    return `${m[1]}[x] ${m[5]}`;
  });
  return { text: lines.join("\n"), ticked, already, missing: ids.filter((id) => !seen.has(id)) };
}
