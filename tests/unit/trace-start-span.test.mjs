// tests/unit/trace-start-span.test.mjs
//
// Run: `node --test tests/unit/trace-start-span.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

let dir;
let file;
const SCRIPT = join(PROJECT_ROOT, 'bin/trace-start-span.mjs');

function run(args, env = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file, ...env },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-start-cli-'));
  file = join(dir, 'spans.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-start-span.mjs', () => {
  test('emits a workflow root span and prints {span_id, trace_id} on stdout', () => {
    const r = run(['--name', 'execute_task', '--scope', 'task',
                   '--task', 'alpha']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.span_id);
    assert.ok(out.trace_id);
    assert.equal(out.parent, null);
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(line.event_kind, 'span_start');
    assert.equal(line.name, 'execute_task');
    assert.equal(line.task_slug, 'alpha');
  });

  test('with --parent, inherits trace_id and sets parent_span_id', () => {
    const root = JSON.parse(run(['--name', 'execute_task', '--scope', 'task',
                                  '--task', 'alpha']).stdout);
    const child = JSON.parse(run(['--name', 'phase', '--scope', 'task',
                                   '--task', 'alpha', '--service', 'svc-x',
                                   '--phase', '1',
                                   '--parent', root.span_id,
                                   '--trace', root.trace_id]).stdout);
    assert.equal(child.trace_id, root.trace_id);
    assert.notEqual(child.span_id, root.span_id);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const childLine = JSON.parse(lines[1]);
    assert.equal(childLine.parent_span_id, root.span_id);
    assert.equal(childLine.service_id, 'svc-x');
    assert.equal(childLine.phase_num, 1);
  });

  test('exits 1 when --name is missing', () => {
    const r = run(['--scope', 'task']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--name required/i);
  });

  test('exits 1 when --scope is invalid', () => {
    const r = run(['--name', 'phase', '--scope', 'invalid']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--scope must be one of/i);
  });

  test('TRACE_DISABLED=1: exits 0, writes nothing, prints empty ids', () => {
    const r = run(['--name', 'execute_task', '--scope', 'task'],
                  { TRACE_DISABLED: '1' });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.span_id, '');
    assert.equal(out.trace_id, '');
  });

  test('agent_dispatch span carries --agent and --model', () => {
    const root = JSON.parse(run(['--name', 'execute_task', '--scope', 'task',
                                  '--task', 'a']).stdout);
    const r = run(['--name', 'agent_dispatch', '--scope', 'task',
                   '--agent', 'implementer', '--model', 'sonnet',
                   '--task', 'a', '--service', 'svc-x', '--phase', '1',
                   '--parent', root.span_id, '--trace', root.trace_id]);
    assert.equal(r.status, 0);
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[1]);
    assert.equal(line.agent_role, 'implementer');
    assert.equal(line.attrs.model_used, 'sonnet');
  });

  test('span carries --phase-parallelism, --wave-index and --wave-width as numeric attrs', () => {
    const r = run(['--name', 'agent_dispatch', '--scope', 'task',
                   '--agent', 'tdd-cycle', '--model', 'sonnet',
                   '--phase-parallelism', '2',
                   '--wave-index', '1', '--wave-width', '3']);
    assert.equal(r.status, 0, r.stderr);
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(line.attrs.model_used, 'sonnet');
    assert.equal(line.attrs.phase_parallelism, 2);
    assert.equal(line.attrs.wave_index, 1);
    assert.equal(line.attrs.wave_width, 3);
  });

  test('exits 1 when --wave-index is not a number', () => {
    const r = run(['--name', 'phase', '--scope', 'task',
                   '--wave-index', 'abc']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--wave-index must be a number/);
  });

  test('exits 1 when --phase-parallelism is not a number', () => {
    const r = run(['--name', 'phase', '--scope', 'task',
                   '--phase-parallelism', 'auto']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--phase-parallelism must be a number/);
  });

  test('TRACE_FILE unset: resolves <WORKSPACE>/.traces/spans.jsonl from cwd', () => {
    const r = spawnSync('node', [SCRIPT, '--name', 'execute_task',
                                 '--scope', 'task'], {
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, TRACE_FILE: '' },
    });
    assert.equal(r.status, 0);
    const expectedFile = join(dir, '.traces', 'spans.jsonl');
    const content = readFileSync(expectedFile, 'utf8');
    assert.ok(content.length > 0);
  });

  test('writes ts in ISO-8601 UTC', () => {
    const r = run(['--name', 'execute_task', '--scope', 'task']);
    assert.equal(r.status, 0);
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.match(line.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });
});
