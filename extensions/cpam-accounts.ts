export const CPAM_PROVIDER = "cliproxy";
export const CPAM_ROTATING = "cpam";

export type CpamAccounts = Record<string, string>;

export interface CpamAuthFile {
  type?: unknown;
  prefix?: unknown;
  email?: unknown;
  disabled?: unknown;
}

const PERSONAL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const SECOND_LEVEL = new Set(["com", "co", "net", "org", "gov", "gob", "edu", "ac"]);

export function shortAccount(email: string): string {
  const value = email.trim();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return value;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();
  if (PERSONAL_DOMAINS.has(domain)) return local;
  const labels = domain.split(".").filter(Boolean);
  if (labels.length > 1) labels.pop();
  if (labels.length > 1 && SECOND_LEVEL.has(labels[labels.length - 1]!)) labels.pop();
  return `${local}@${labels.join(".")}`;
}

const workPrefixes = new Set<string>();

export function isWorkAccount(account: string | undefined): boolean {
  return typeof account === "string" && workPrefixes.has(account);
}

export function accountsFromAuthFiles(files: readonly CpamAuthFile[]): CpamAccounts {
  const out: CpamAccounts = {};
  workPrefixes.clear();
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    if (file.disabled === true) continue;
    const prefix = typeof file.prefix === "string" ? file.prefix.trim() : "";
    const email = typeof file.email === "string" ? file.email.trim() : "";
    if (!prefix || !email || prefix in out) continue;
    out[prefix] = prefix;
    if (shortAccount(email).includes("@")) workPrefixes.add(prefix);
  }
  return out;
}

export function accountFor(
  modelId: string | undefined,
  accounts: CpamAccounts,
  provider?: string,
): string | undefined {
  if (typeof modelId !== "string") return undefined;
  let id = modelId.trim();
  let owner = typeof provider === "string" ? provider.trim() : "";
  if (!owner && id.startsWith(`${CPAM_PROVIDER}/`)) {
    owner = CPAM_PROVIDER;
    id = id.slice(CPAM_PROVIDER.length + 1);
  } else if (!owner) {
    const slash = id.indexOf("/");
    const prefix = slash > 0 ? id.slice(0, slash) : "";
    return prefix && Object.prototype.hasOwnProperty.call(accounts, prefix) ? accounts[prefix] : undefined;
  } else if (owner === CPAM_PROVIDER && id.startsWith(`${CPAM_PROVIDER}/`)) {
    id = id.slice(CPAM_PROVIDER.length + 1);
  }
  if (owner !== CPAM_PROVIDER || !id) return undefined;
  const slash = id.indexOf("/");
  if (slash < 0) return CPAM_ROTATING;
  const prefix = id.slice(0, slash);
  if (!prefix) return CPAM_ROTATING;
  return Object.prototype.hasOwnProperty.call(accounts, prefix) ? accounts[prefix] : prefix;
}

export function namesAccount(text: string, account: string): boolean {
  return text === account || text.startsWith(`${account}/`) || text.includes(`/${account}/`) || text.includes(` ${account}/`);
}

export function accountTag(text: string, account: string | undefined): string | undefined {
  if (!account) return undefined;
  return isWorkAccount(account) || !namesAccount(text, account) ? account : undefined;
}

export function withAccount(label: string, account: string | undefined): string {
  if (!account || namesAccount(label, account)) return label;
  return `${label} · ${account}`;
}
