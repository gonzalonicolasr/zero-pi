import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('zero_execution schema exposes the wave and close actions with their array parameters', () => {
  let tool: any;
  register({ registerTool(t) { tool = t; } });
  for (const action of ['wave', 'wave-close', 'batch-close']) assert.ok(tool.parameters.properties.action.enum.includes(action));
  assert.equal(tool.parameters.properties.members.items.required.join(','), 'attemptId,task');
  assert.equal(tool.parameters.properties.tasks.type, 'array');
});

test('zero_execution schema and description expose adopt for the NODD handoff', () => {
  let tool: any;
  register({ registerTool(t) { tool = t; } });
  assert.ok(tool.parameters.properties.action.enum.includes('adopt'));
  assert.match(tool.description, /adopt\(slug\)[^.]*NODD/);
});

test('zero_execution schema and description expose the validate, checkpoint and cost gates but not archive', () => {
  let tool: any;
  register({ registerTool(t) { tool = t; } });
  for (const action of ['validate', 'checkpoint', 'cost']) {
    assert.ok(tool.parameters.properties.action.enum.includes(action), action);
    assert.match(tool.description, new RegExp(`${action}\\(runId\\)`));
  }
  assert.ok(!tool.parameters.properties.action.enum.includes('archive'));
  assert.match(tool.description, /never restores/);
});

const pkgFile = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function hooks() {
  const on: Record<string, Function> = {};
  register({ registerTool() {}, on(event: string, handler: Function) { on[event] = handler; } });
  return on;
}
/** What pi hands before_agent_start for `/forge <request>`: the template body after expansion. */
function expandedForge(request: string): string {
  return pkgFile('prompts/forge.md').replace(/^---\n[\s\S]*?\n---\n/, '').replaceAll('$ARGUMENTS', request);
}

test('a /forge run gets the full orchestrator rules attached before its first turn', () => {
  const start = hooks().before_agent_start;
  assert.equal(typeof start, 'function');
  for (const request of ['agregar parseDuration', '--continue parse-duration']) {
    const out = start({ type: 'before_agent_start', messageType: 'user', prompt: expandedForge(request) }, {});
    assert.equal(out.message.customType, 'zero-orchestrator-rules');
    assert.equal(out.message.display, false);
    assert.equal(out.message.content, pkgFile('prompts/orchestrator.md'));
  }
});

test('other runs, custom-message runs and a missing pi.on get no orchestrator rules', () => {
  const start = hooks().before_agent_start;
  assert.equal(start({ type: 'before_agent_start', messageType: 'user', prompt: 'arreglá el test de tiempo' }, {}), undefined);
  assert.equal(start({ type: 'before_agent_start', messageType: 'custom', message: { content: expandedForge('x') } }, {}), undefined);
  assert.doesNotThrow(() => register({ registerTool() {} }));
});

test('forge.md relies on the attached rules and stops when they are missing', () => {
  const forge = pkgFile('prompts/forge.md');
  assert.match(forge, /orchestrator rules[\s\S]*attached/i);
  assert.match(forge, /not in your\s+context[\s\S]*stop/i);
});

test('zero_execution attempt takes the brief and the explore output mode, and says it returns the launch arguments', () => {
  let tool: any;
  register({ registerTool(t) { tool = t; } });
  assert.equal(tool.parameters.properties.brief.type, 'string');
  assert.deepEqual(tool.parameters.properties.outputMode.enum, ['inline', 'file-only']);
  assert.match(tool.description, /attempt\(runId,phase,round,batch,brief[^)]*\)[\s\S]*?workflows\/<attemptId>\.js[\s\S]*?subagent/);
});

test('zero_execution description names the next step returned by analyze and the closes', () => {
  let tool: any;
  register({ registerTool(t) { tool = t; } });
  assert.match(tool.description, /continue also returns next/);
  assert.match(tool.description, /or next when none failed/);
  assert.match(tool.description, /plus next when complete/);
});
