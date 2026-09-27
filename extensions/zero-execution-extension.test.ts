import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import register from './zero-execution-extension.ts';

test('zero_execution throws operation failures so Pi marks the tool result as error', () => {
  let tool: any;
  register({ registerTool(t) { tool = t; } });
  const cwd = mkdtempSync(join(tmpdir(), 'zero-tool-error-'));
  try {
    assert.throws(() => tool.execute('id', { action: 'start', slug: '../escape', request: 'hello' }, undefined, undefined, { cwd }), /Invalid slug/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
