// zero-pi — quick theme switcher for the ZERO theme pack.

interface ThemeSwitchCtx {
	ui?: {
		setTheme?: (theme: string) => { success: boolean; error?: string };
		notify?: (message: string, type?: "info" | "warning" | "error") => void;
	};
}

interface PiAPI {
	registerCommand?(name: string, options: { description: string; handler: (args: string, ctx: ThemeSwitchCtx) => unknown }): void;
}

export const ZERO_THEMES = {
	neon: "zero-omp-neon",
	omp: "zero-omp-neon",
	sunset: "zero-sunset",
	sdd: "zero-sdd",
	sith: "zero-sith",
	saiyan: "zero-saiyan",
	matrix: "zero-matrix",
	cyberpunk: "zero-cyberpunk",
} as const;

export type ZeroThemeAlias = keyof typeof ZERO_THEMES;

export function resolveZeroTheme(input: string): string | undefined {
	const raw = input.trim().toLowerCase();
	if (!raw) return undefined;
	return ZERO_THEMES[raw as ZeroThemeAlias] ?? (raw.startsWith("zero-") ? raw : undefined);
}

export function zeroThemeUsage(): string {
	return "Uso: /zero-theme neon|sunset|sdd|sith|saiyan|matrix|cyberpunk";
}

export default function register(api?: PiAPI): void {
	api?.registerCommand?.("zero-theme", {
		description: "Switch between ZERO theme pack variants",
		handler: (args, ctx) => {
			const theme = resolveZeroTheme(args);
			if (!theme) {
				ctx.ui?.notify?.(zeroThemeUsage(), "warning");
				return;
			}
			const result = ctx.ui?.setTheme?.(theme);
			if (!result?.success) {
				ctx.ui?.notify?.(`No pude activar ${theme}: ${result?.error ?? "theme no encontrado"}`, "error");
				return;
			}
			ctx.ui?.notify?.(`ZERO theme activo: ${theme}`, "info");
		},
	});
}
