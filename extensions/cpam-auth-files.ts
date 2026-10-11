import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { accountsFromAuthFiles, type CpamAccounts, type CpamAuthFile } from "./cpam-accounts.ts";

export function authDirFromConfig(yaml: string): string | undefined {
  const match = /^auth-dir:\s*["']?([^"'#\n]+?)["']?\s*(?:#.*)?$/m.exec(yaml);
  const dir = match?.[1]?.trim();
  if (!dir) return undefined;
  return dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir;
}

function resolveAuthDir(): string {
  try {
    const yaml = readFileSync(join(homedir(), ".config", "cli-proxy-api", "config.yaml"), "utf8");
    const dir = authDirFromConfig(yaml);
    if (dir) return dir;
  } catch {
  }
  return join(homedir(), ".cli-proxy-api");
}

export function readAuthFiles(dir: string): CpamAuthFile[] {
  const out: CpamAuthFile[] = [];
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
      if (!raw || typeof raw !== "object") continue;
      out.push({ type: raw.type, prefix: raw.prefix, email: raw.email, disabled: raw.disabled });
    } catch {
    }
  }
  return out;
}

const CACHE_TTL_MS = 30_000;
let cache: { at: number; accounts: CpamAccounts } | undefined;

export function loadCpamAccounts(now: number = Date.now()): CpamAccounts {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.accounts;
  let accounts: CpamAccounts = {};
  try {
    accounts = accountsFromAuthFiles(readAuthFiles(resolveAuthDir()));
  } catch {
    accounts = {};
  }
  cache = { at: now, accounts };
  return accounts;
}
