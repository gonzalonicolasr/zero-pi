import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkpointId, createCheckpoint, formatCheckpointReport, parseCheckpointArgs, untrackedFromStatus, type CheckpointRunner } from "./zero-checkpoint.ts";

function runner(over: Record<string, { status?: number; stdout?: string; stderr?: string }> = {}): CheckpointRunner {
  return {
    run(command, args) {
      const key = `${command} ${args.join(" ")}`;
      const r = over[key] ?? { stdout: "" };
      return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}

test("checkpointId is stable and filesystem-friendly", () => {
  assert.equal(checkpointId(new Date(2026, 6, 3, 14, 20, 5)), "20260703-142005");
});

test("parseCheckpointArgs reads slug and --json", () => {
  assert.deepEqual(parseCheckpointArgs("alpha --json"), { slug: "alpha", json: true });
  assert.deepEqual(parseCheckpointArgs("--json"), { slug: null, json: true });
});

test("untrackedFromStatus extracts ?? entries", () => {
  assert.deepEqual(untrackedFromStatus(" M a.ts\n?? new.ts\n?? docs/x.md\n"), ["new.ts", "docs/x.md"]);
});

test("createCheckpoint writes patch, status, head, meta and restore script", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "zero-checkpoint-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = runner({
    "git rev-parse --show-toplevel": { stdout: `${dir}\n` },
    "git rev-parse --short HEAD": { stdout: "abc123\n" },
    "git status --short": { stdout: " M a.ts\n?? new.ts\n" },
    "git diff --binary HEAD": { stdout: "diff --git a/a.ts b/a.ts\n" },
  });

  const result = createCheckpoint("alpha", dir, r, new Date(2026, 6, 3, 14, 20, 5));
  assert.equal(result.ok, true);
  assert.equal(result.id, "20260703-142005");
  assert.deepEqual(result.untracked, ["new.ts"]);
  assert.equal(existsSync(join(result.dir, "diff.patch")), true);
  assert.equal(readFileSync(join(result.dir, "head.txt"), "utf8"), "abc123\n");
  assert.match(readFileSync(join(result.dir, "restore.sh"), "utf8"), /git reset --hard abc123/);
  assert.match(formatCheckpointReport(result), /untracked no se incluyen/);
});

test("createCheckpoint reports a non-git cwd without writing", () => {
  const result = createCheckpoint("alpha", "/tmp/nope", runner({ "git rev-parse --show-toplevel": { status: 128, stderr: "bad" } }));
  assert.equal(result.ok, false);
  assert.match(formatCheckpointReport(result), /no parece/);
});
