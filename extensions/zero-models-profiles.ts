// zero-pi — perfiles de modelos SDD para `/zero-models`.
//
// Un perfil es un paquete nombrado de los tres mapas por fase (`models`,
// `providers`, `thinking`). Viven en `~/.pi/zero.json` bajo `profiles`, y
// `activeProfile` apunta al que está en uso:
//
//   {
//     "activeProfile": "premium",
//     "profiles": { "premium": { "models": {…}, "providers": {…}, "thinking": {…} } },
//     "models": {…}, "providers": {…}, "thinking": {…}
//   }
//
// Los tres mapas planos siguen siendo la fuente de verdad para el resto del
// paquete: `sdd-agents.ts` genera los `zero-<fase>.md` desde ahí y
// `autotune-extension.ts` escribe ahí. Activar un perfil es copiar sus mapas a
// los planos — así ningún consumidor necesita saber que los perfiles existen.
//
// Este módulo es puro: recibe y devuelve objetos, nunca toca el filesystem.
// Todo el I/O vive en `zero-models.ts`.

import { PHASES, type Phase } from "./zero-models.ts";
import type { PhaseModels, PhaseProviders, PhaseThinking } from "./zero-models.ts";

/** Los tres mapas por fase que componen un perfil. Parciales a propósito: una
 *  fase ausente hereda el default del paquete, igual que hoy. */
export interface Profile {
  models: Partial<Record<Phase, string>>;
  providers: Partial<Record<Phase, string>>;
  thinking: PhaseThinking;
}

/** El sub-comando `profile` ya parseado. */
export type ProfileCommand =
  | { kind: "list" }
  | { kind: "new"; name: string; from?: string }
  | { kind: "save"; name?: string }
  | { kind: "use"; name: string }
  | { kind: "delete"; name: string }
  | { kind: "invalid"; message: string };

/** Verbos del sub-comando: no pueden usarse como nombre de perfil, si no
 *  `profile save` sería ambiguo con "activá el perfil llamado save". */
export const RESERVED_PROFILE_NAMES = [
  "list",
  "new",
  "save",
  "use",
  "delete",
  "rm",
  "from",
] as const;

/** Texto de ayuda del sub-comando, mostrado ante cualquier forma inválida. */
export const PROFILE_USAGE =
  "uso: /zero-models profile [list] · profile new <nombre> [from <otro>] · " +
  "profile save [<nombre>] · profile use <nombre> · profile delete <nombre>";

/** Un nombre de perfil válido: minúsculas, números, guiones y guiones bajos,
 *  y que no pise un verbo del sub-comando. */
export function isValidProfileName(name: string): boolean {
  if (!/^[a-z0-9_-]+$/.test(name)) return false;
  return !(RESERVED_PROFILE_NAMES as readonly string[]).includes(name);
}

/**
 * Parsear el argumento de `/zero-models` como sub-comando `profile`.
 *
 * Devuelve `null` cuando el argumento no empieza con `profile` — el handler
 * sigue con el parseo de asignaciones `<fase>=<modelo>`. Devuelve `invalid`
 * (con mensaje) cuando sí es un `profile` pero está mal escrito, para que el
 * handler muestre la ayuda y no escriba nada.
 */
export function parseProfileCommand(arg: string): ProfileCommand | null {
  const trimmed = arg.trim();
  // Forma `profile=<nombre>`, en línea con `autotune=<modo>`.
  const eq = trimmed.match(/^profile\s*=\s*(.*)$/i);
  if (eq) {
    const name = eq[1].trim();
    if (!isValidProfileName(name)) {
      return { kind: "invalid", message: invalidNameMessage(name) };
    }
    return { kind: "use", name };
  }

  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0 || tokens[0].toLowerCase() !== "profile") return null;

  const [, verb, ...rest] = tokens;
  if (verb === undefined || verb.toLowerCase() === "list") {
    return rest.length === 0 ? { kind: "list" } : { kind: "invalid", message: PROFILE_USAGE };
  }

  switch (verb.toLowerCase()) {
    case "new": {
      const name = rest[0];
      if (!name) return { kind: "invalid", message: PROFILE_USAGE };
      if (!isValidProfileName(name)) {
        return { kind: "invalid", message: invalidNameMessage(name) };
      }
      // `new <nombre>` o `new <nombre> from <otro>`; nada más.
      if (rest.length === 1) return { kind: "new", name };
      if (rest.length === 3 && rest[1].toLowerCase() === "from") {
        const from = rest[2];
        if (!isValidProfileName(from)) {
          return { kind: "invalid", message: invalidNameMessage(from) };
        }
        return { kind: "new", name, from };
      }
      return { kind: "invalid", message: PROFILE_USAGE };
    }
    case "save": {
      if (rest.length === 0) return { kind: "save" };
      if (rest.length > 1) return { kind: "invalid", message: PROFILE_USAGE };
      if (!isValidProfileName(rest[0])) {
        return { kind: "invalid", message: invalidNameMessage(rest[0]) };
      }
      return { kind: "save", name: rest[0] };
    }
    case "use": {
      if (rest.length !== 1) return { kind: "invalid", message: PROFILE_USAGE };
      if (!isValidProfileName(rest[0])) {
        return { kind: "invalid", message: invalidNameMessage(rest[0]) };
      }
      return { kind: "use", name: rest[0] };
    }
    case "delete":
    case "rm": {
      if (rest.length !== 1) return { kind: "invalid", message: PROFILE_USAGE };
      if (!isValidProfileName(rest[0])) {
        return { kind: "invalid", message: invalidNameMessage(rest[0]) };
      }
      return { kind: "delete", name: rest[0] };
    }
    default:
      return { kind: "invalid", message: PROFILE_USAGE };
  }
}

/** Mensaje de nombre inválido, distinguiendo el caso "usaste un verbo". */
function invalidNameMessage(name: string): string {
  if (name === "") return PROFILE_USAGE;
  if ((RESERVED_PROFILE_NAMES as readonly string[]).includes(name)) {
    return `'${name}' es un verbo del comando y no puede ser nombre de perfil`;
  }
  return `nombre de perfil inválido: '${name}' (usá minúsculas, números, - y _)`;
}

/** ¿Es un objeto plano (no null, no array)? */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Quedarse sólo con las claves que son fases y cuyo valor es string. */
function pickPhaseStrings(value: unknown): Partial<Record<Phase, string>> {
  const out: Partial<Record<Phase, string>> = {};
  if (!isObject(value)) return out;
  for (const phase of PHASES) {
    const entry = value[phase];
    if (typeof entry === "string" && entry !== "") out[phase] = entry;
  }
  return out;
}

/**
 * Leer los perfiles de un zero.json. Descarta silenciosamente cualquier entrada
 * malformada — un `profiles` roto a mano nunca debe romper el comando.
 */
export function readProfiles(data: Record<string, unknown>): Record<string, Profile> {
  const raw = data.profiles;
  const out: Record<string, Profile> = {};
  if (!isObject(raw)) return out;
  for (const [name, value] of Object.entries(raw)) {
    if (!isValidProfileName(name) || !isObject(value)) continue;
    out[name] = {
      models: pickPhaseStrings(value.models),
      providers: pickPhaseStrings(value.providers),
      thinking: pickPhaseStrings(value.thinking) as PhaseThinking,
    };
  }
  return out;
}

/** El nombre del perfil activo, o `null` si no hay ninguno o no existe. */
export function readActiveProfile(data: Record<string, unknown>): string | null {
  const name = data.activeProfile;
  if (typeof name !== "string" || !isValidProfileName(name)) return null;
  return name in readProfiles(data) ? name : null;
}

/** Snapshot de los tres mapas planos como perfil. */
export function snapshotFlat(data: Record<string, unknown>): Profile {
  return {
    models: pickPhaseStrings(data.models),
    providers: pickPhaseStrings(data.providers),
    thinking: pickPhaseStrings(data.thinking) as PhaseThinking,
  };
}

/** ¿Dos perfiles tienen el mismo contenido? Comparación por fase, no textual. */
export function sameProfile(a: Profile, b: Profile): boolean {
  for (const phase of PHASES) {
    if ((a.models[phase] ?? "") !== (b.models[phase] ?? "")) return false;
    if ((a.providers[phase] ?? "") !== (b.providers[phase] ?? "")) return false;
    if ((a.thinking[phase] ?? "") !== (b.thinking[phase] ?? "")) return false;
  }
  return true;
}

/**
 * ¿La config plana se desvió del perfil activo?
 *
 * Pasa cuando autotune escribe los mapas planos por su cuenta: el aprendizaje
 * se aplica igual, pero el perfil guardado queda intacto hasta que el usuario
 * consolide con `profile save`. Sin perfil activo, nunca hay desvío.
 */
export function isProfileDirty(data: Record<string, unknown>): boolean {
  const active = readActiveProfile(data);
  if (active === null) return false;
  return !sameProfile(readProfiles(data)[active], snapshotFlat(data));
}

/** Etiqueta del perfil activo para las notificaciones: `premium` o `premium*`
 *  cuando la config plana se desvió. Cadena vacía si no hay perfil activo. */
export function formatActiveProfile(data: Record<string, unknown>): string {
  const active = readActiveProfile(data);
  if (active === null) return "";
  return isProfileDirty(data) ? `${active}*` : active;
}

/** Volcar un perfil sobre los tres mapas planos, que es lo que leen
 *  `sdd-agents.ts` y `autotune-extension.ts`. */
function flatten(data: Record<string, unknown>, profile: Profile): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...data,
    models: { ...profile.models },
    providers: { ...profile.providers },
  };
  if (Object.keys(profile.thinking).length > 0) next.thinking = { ...profile.thinking };
  else delete next.thinking;
  return next;
}

/**
 * Espejar los mapas planos dentro del perfil activo.
 *
 * El handler la llama después de cada escritura propia (forma directa y
 * "guardar" del picker) para que editar una fase con un perfil activo edite ese
 * perfil, sin pasos extra. Sin perfil activo devuelve el objeto sin tocar.
 */
export function mirrorToActiveProfile(data: Record<string, unknown>): Record<string, unknown> {
  const active = readActiveProfile(data);
  if (active === null) return data;
  const profiles = readProfiles(data);
  profiles[active] = snapshotFlat(data);
  return { ...data, profiles };
}

/** Resultado de aplicar un sub-comando: el zero.json nuevo + qué contar. */
export type ProfileResult =
  | { ok: true; data: Record<string, unknown>; message: string }
  | { ok: false; message: string };

/** Listado de perfiles, con `*` en el activo y `·` en el desviado. */
function listMessage(data: Record<string, unknown>): string {
  const profiles = readProfiles(data);
  const names = Object.keys(profiles).sort();
  if (names.length === 0) {
    return "zero · no hay perfiles todavía. Creá el primero con: /zero-models profile new <nombre>";
  }
  const active = readActiveProfile(data);
  const dirty = isProfileDirty(data);
  const rows = names.map((name) => {
    if (name !== active) return `    ${name}`;
    return dirty ? `  * ${name}  (activo · con cambios sin guardar)` : `  * ${name}  (activo)`;
  });
  return `zero · perfiles SDD:\n${rows.join("\n")}`;
}

/**
 * Aplicar un sub-comando `profile` sobre un zero.json.
 *
 * Función pura: devuelve el objeto nuevo y el mensaje, o un error sin tocar
 * nada. El handler decide si escribe.
 *
 * - `new`  crea desde la config actual (o clona `from`) y activa. Falla si ya existe.
 * - `save` guarda la config actual bajo un nombre; sin nombre consolida el activo.
 * - `use`  activa un perfil, volcándolo sobre los mapas planos.
 * - `delete` borra; si era el activo, deja la config plana como está, sin perfil.
 */
export function applyProfileCommand(
  data: Record<string, unknown>,
  command: ProfileCommand,
): ProfileResult {
  const profiles = readProfiles(data);

  switch (command.kind) {
    case "invalid":
      return { ok: false, message: command.message };

    case "list":
      return { ok: true, data, message: listMessage(data) };

    case "new": {
      if (command.name in profiles) {
        return {
          ok: false,
          message: `el perfil '${command.name}' ya existe — usá 'profile save ${command.name}' para pisarlo`,
        };
      }
      let base: Profile;
      if (command.from !== undefined) {
        const source = profiles[command.from];
        if (source === undefined) {
          return { ok: false, message: `no existe el perfil '${command.from}'` };
        }
        base = source;
      } else {
        base = snapshotFlat(data);
      }
      const next = flatten({ ...data, profiles: { ...profiles, [command.name]: base } }, base);
      next.activeProfile = command.name;
      const origen = command.from !== undefined ? ` (clonado de ${command.from})` : "";
      return {
        ok: true,
        data: next,
        message:
          `zero · perfil '${command.name}' creado y activo${origen}. ` +
          "Editá sus fases con /zero-models — los cambios van a este perfil.",
      };
    }

    case "save": {
      const name = command.name ?? readActiveProfile(data);
      if (name === null) {
        return {
          ok: false,
          message: "no hay perfil activo — dale un nombre: /zero-models profile save <nombre>",
        };
      }
      const snapshot = snapshotFlat(data);
      const next: Record<string, unknown> = {
        ...data,
        profiles: { ...profiles, [name]: snapshot },
        activeProfile: name,
      };
      const verbo = name in profiles ? "actualizado" : "creado";
      return { ok: true, data: next, message: `zero · perfil '${name}' ${verbo} y activo` };
    }

    case "use": {
      const profile = profiles[command.name];
      if (profile === undefined) {
        return {
          ok: false,
          message: `no existe el perfil '${command.name}' — ver: /zero-models profile list`,
        };
      }
      const next = flatten(data, profile);
      next.activeProfile = command.name;
      return {
        ok: true,
        data: next,
        message:
          `zero · perfil '${command.name}' activo. ` +
          "Reiniciá pi para que /forge regenere los agentes con estos modelos.",
      };
    }

    case "delete": {
      if (!(command.name in profiles)) {
        return { ok: false, message: `no existe el perfil '${command.name}'` };
      }
      const rest = { ...profiles };
      delete rest[command.name];
      const next: Record<string, unknown> = { ...data, profiles: rest };
      // Borrar el activo no cambia los modelos en uso: sólo deja de haber
      // perfil al que espejar los cambios.
      if (readActiveProfile(data) === command.name) delete next.activeProfile;
      return { ok: true, data: next, message: `zero · perfil '${command.name}' borrado` };
    }
  }
}

/** Re-export para los consumidores que sólo importan este módulo. */
export type { PhaseModels, PhaseProviders, PhaseThinking };
