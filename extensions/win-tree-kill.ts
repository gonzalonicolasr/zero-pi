// zero-pi — Windows process-tree kill for aborts.
//
// On Windows, `ChildProcess.kill()` terminates only the target process, not
// its descendants. A provider like pi-claude-cli spawns `claude` through a
// `cmd.exe` batch wrapper (`claude` resolves to `claude.cmd`), so when pi
// aborts a turn the wrapper is killed but the real `claude` process is
// orphaned and keeps streaming — pressing Esc appears to do nothing.
//
// This extension patches `child_process.spawn` once, at load, so every
// subprocess spawned afterwards gets a `kill()` that terminates the whole
// process tree via `taskkill /T /F`. It is a no-op on non-Windows platforms.
//
// Patching the shared `child_process` module reaches code in other packages
// (pi-claude-cli, and the `cross-spawn` it depends on, both call into the same
// builtin) without modifying them — so the fix survives `pi update`.

import { createRequire } from "node:module";

/** Build the Windows command that kills a process and its whole tree. */
export function treeKillCommand(pid: number): string {
  return `taskkill /pid ${pid} /t /f`;
}

/** The slice of a child process this extension touches. */
export interface KillableChild {
  pid?: number;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** Marker so a `kill` is wrapped at most once. */
const WRAPPED = Symbol.for("zero-pi.win-tree-kill.wrapped");

/**
 * Replace `child.kill` with one that terminates the whole process tree by
 * running `exec(treeKillCommand(pid))`. Falls back to the original `kill` when
 * there is no pid or the tree-kill throws. Idempotent — wrapping an already
 * wrapped child is a no-op. Exported for tests.
 */
export function wrapKill(
  child: KillableChild,
  exec: (command: string) => void,
): KillableChild {
  const original = child.kill;
  if (typeof original !== "function") return child;

  const tagged = original as typeof original & { [WRAPPED]?: boolean };
  if (tagged[WRAPPED]) return child;

  const wrapped = function (signal?: NodeJS.Signals | number): boolean {
    const pid = child.pid;
    if (typeof pid === "number") {
      try {
        exec(treeKillCommand(pid));
        return true;
      } catch {
        // Process already gone, or taskkill unavailable — fall through.
      }
    }
    return original.call(child, signal);
  } as KillableChild["kill"] & { [WRAPPED]?: boolean };
  wrapped[WRAPPED] = true;

  child.kill = wrapped;
  return child;
}

/** Whether the running platform needs the tree-kill patch. */
export function shouldPatch(platform: string): boolean {
  return platform === "win32";
}

/** Module-level guard so the global patch is installed at most once. */
let patched = false;

/**
 * The pi extension entry point. Patches `child_process.spawn` so every later
 * subprocess tree-kills on `kill()`. Defensive: a failure here must never
 * break a pi session, so it is swallowed.
 */
export default function register(): void {
  if (patched || !shouldPatch(process.platform)) return;
  try {
    const require = createRequire(import.meta.url);
    const cp = require("node:child_process") as {
      spawn: (...args: unknown[]) => KillableChild;
      exec: (command: string, callback: (error: unknown) => void) => unknown;
    };

    const originalSpawn = cp.spawn as typeof cp.spawn & { [WRAPPED]?: boolean };
    if (originalSpawn[WRAPPED]) {
      patched = true;
      return;
    }

    // Fire-and-forget, ASYNC. A blocking execSync here would freeze pi's whole
    // event loop on every subprocess kill — and pi kills a subprocess on most
    // turns (pi-claude-cli's break-early). taskkill can take seconds or hang,
    // so it must never run on the event loop.
    const exec = (command: string): void => {
      cp.exec(command, () => {});
    };

    const patchedSpawn = function (this: unknown, ...args: unknown[]): KillableChild {
      const child = originalSpawn.apply(this, args);
      try {
        return wrapKill(child, exec);
      } catch {
        return child;
      }
    } as typeof cp.spawn & { [WRAPPED]?: boolean };
    patchedSpawn[WRAPPED] = true;

    cp.spawn = patchedSpawn;
    patched = true;
  } catch {
    // Hardening must never break a session.
  }
}
