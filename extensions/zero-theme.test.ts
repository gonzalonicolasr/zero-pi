import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveZeroTheme, zeroThemeUsage } from "./zero-theme.ts";

test("resolveZeroTheme maps short aliases to packaged theme names", () => {
	assert.equal(resolveZeroTheme("sith"), "zero-sith");
	assert.equal(resolveZeroTheme("saiyan"), "zero-saiyan");
	assert.equal(resolveZeroTheme("matrix"), "zero-matrix");
	assert.equal(resolveZeroTheme("cyberpunk"), "zero-cyberpunk");
	assert.equal(resolveZeroTheme("neon"), "zero-omp-neon");
});

test("resolveZeroTheme accepts explicit zero-* theme names", () => {
	assert.equal(resolveZeroTheme("zero-sith"), "zero-sith");
});

test("resolveZeroTheme rejects empty and unknown names", () => {
	assert.equal(resolveZeroTheme(""), undefined);
	assert.equal(resolveZeroTheme("banana"), undefined);
});

test("zeroThemeUsage lists the fantasy variants", () => {
	const usage = zeroThemeUsage();
	assert.match(usage, /sith/);
	assert.match(usage, /saiyan/);
	assert.match(usage, /matrix/);
});
