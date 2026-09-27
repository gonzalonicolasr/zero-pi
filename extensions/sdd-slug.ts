// The one rule for a user-supplied SDD slug. It names a directory directly under
// `.sdd/`, and commands join it onto that directory — `/zero-archive` then
// renames the result. A separator or a leading dot could climb out of `.sdd/`
// or land on `.executions`/`archive` internals, so those are refused, never
// silently rewritten: a cleaned-up slug would quietly act on a different run.

const SLUG = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function isSafeSlug(slug: string): boolean {
  return SLUG.test(slug) && !slug.split(".").includes("");
}

export function unsafeSlugMessage(command: string, slug: string): string {
  return `${command}: slug inválido "${slug}" — sólo letras, números, "-", "_" y ".", sin "/", "\\" ni ".." (nombra una carpeta dentro de .sdd/)`;
}
