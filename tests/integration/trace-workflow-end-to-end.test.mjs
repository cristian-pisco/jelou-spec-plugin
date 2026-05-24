// tests/integration/trace-workflow-end-to-end.test.mjs
//
// Runs the same CLI sequence that execute-task.md's Step 7 emits, then
// asserts the resulting span tree shape. This is a structural check
// against the workflow's documented Bash blocks, NOT a real
// /jlu-execute-task run (which would require a real agent runtime).
//
// Run: `node --test tests/integration/trace-workflow-end-to-end.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const START = join(ROOT, 'bin/trace-start-span.mjs');
const END = join(ROOT, 'bin/trace-end-span.mjs');

let dir;
let file;

function start(args) {
  const r = spawnSync('node', [START, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function end(args) {
  const r = spawnSync('node', [END, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file },
  });
  assert.equal(r.status, 0, r.stderr);
}

function spans() {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wf-e2e-'));
  file = join(dir, '.traces', 'spans.jsonl');
  delete process.env.TRACE_DISABLED;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TRACE_DISABLED;
});

describe('execute-task span tree shape', () => {
  test('workflow → phase → 2 dispatches → close all produces 4 starts + 4 ends', () => {
    // Step 0.5 — workflow open
    const wf = start(['--name', 'execute_task', '--scope', 'task',
                      '--task', 'alpha']);

    // Step 7a.0 — phase open
    const ph = start(['--name', 'phase', '--scope', 'task',
                      '--task', 'alpha', '--service', 'svc-x', '--phase', '1',
                      '--parent', wf.span_id, '--trace', wf.trace_id]);

    // Step 7 — test-writer dispatch
    const tw = start(['--name', 'agent_dispatch', '--scope', 'task',
                      '--agent', 'test-writer', '--model', 'sonnet',
                      '--task', 'alpha', '--service', 'svc-x', '--phase', '1',
                      '--parent', ph.span_id, '--trace', wf.trace_id]);
    end(['--span', tw.span_id, '--status', 'ok',
         '--retries', '0', '--diff-size', '28',
         '--outcome', 'tests written: 3 files']);

    // Step 7 — implementer dispatch
    const im = start(['--name', 'agent_dispatch', '--scope', 'task',
                      '--agent', 'implementer', '--model', 'sonnet',
                      '--task', 'alpha', '--service', 'svc-x', '--phase', '1',
                      '--parent', ph.span_id, '--trace', wf.trace_id]);
    end(['--span', im.span_id, '--status', 'ok',
         '--retries', '1', '--diff-size', '87']);

    // Step 7z — phase close
    end(['--span', ph.span_id, '--status', 'ok']);

    // Step N — workflow close
    end(['--span', wf.span_id, '--status', 'ok']);

    const all = spans();
    assert.equal(all.length, 8);
    assert.equal(all.filter(e => e.event_kind === 'span_start').length, 4);
    assert.equal(all.filter(e => e.event_kind === 'span_end').length, 4);

    // All events carry trace_id == workflow root.
    assert.ok(all.every(e => e.trace_id === wf.trace_id));

    // Phase parent is workflow; dispatches' parent is phase.
    const phStart = all.find(e => e.event_kind === 'span_start' && e.name === 'phase');
    assert.equal(phStart.parent_span_id, wf.span_id);

    const dispatchStarts = all.filter(e =>
      e.event_kind === 'span_start' && e.name === 'agent_dispatch');
    assert.equal(dispatchStarts.length, 2);
    assert.ok(dispatchStarts.every(s => s.parent_span_id === ph.span_id));

    // Dispatch ends carry diff_size_loc.
    const dispatchEnds = all.filter(e =>
      e.event_kind === 'span_end' && e.name === 'agent_dispatch');
    assert.deepEqual(
      dispatchEnds.map(e => e.attrs.diff_size_loc).sort((a, b) => a - b),
      [28, 87]
    );
  });

  test('TRACE_DISABLED=1 produces zero spans even when CLIs are called', () => {
    process.env.TRACE_DISABLED = '1';
    const r = spawnSync('node', [START, '--name', 'execute_task', '--scope', 'task'], {
      encoding: 'utf8',
      env: { ...process.env, TRACE_FILE: file, TRACE_DISABLED: '1' },
    });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.span_id, '');
    assert.equal(out.trace_id, '');
    // No file should have been written.
    assert.throws(() => readFileSync(file, 'utf8'), /ENOENT/);
  });

  test('daemon-emitted events join the same store with scope: "daemon"', async () => {
    const { appendEvent, EVENT_TYPES } = await import(
      '../../bin/lib/dev-orchestrator/events.mjs');
    appendEvent(file, { type: EVENT_TYPES.pane_started, pane: 'svc-a' });
    appendEvent(file, { type: EVENT_TYPES.ready, pane: 'svc-a' });
    const all = spans();
    assert.equal(all.length, 2);
    assert.ok(all.every(e => e.scope === 'daemon'));
    assert.equal(all[0].name, 'pane_started');
    assert.equal(all[1].name, 'ready');
  });

  test('workflow span + daemon event co-reside in the same store', async () => {
    const { appendEvent, EVENT_TYPES } = await import(
      '../../bin/lib/dev-orchestrator/events.mjs');
    // Workflow opens a span
    const wf = start(['--name', 'execute_task', '--scope', 'task',
                      '--task', 'beta']);
    // Daemon emits an event mid-workflow
    appendEvent(file, { type: EVENT_TYPES.pattern_match, pane: 'svc-b', pattern: 'ECONNREFUSED' });
    // Workflow closes
    end(['--span', wf.span_id, '--status', 'ok']);

    const all = spans();
    assert.equal(all.length, 3);
    const taskSpans = all.filter(e => e.scope === 'task');
    const daemonEvents = all.filter(e => e.scope === 'daemon');
    assert.equal(taskSpans.length, 2);
    assert.equal(daemonEvents.length, 1);
    assert.equal(daemonEvents[0].name, 'pattern_match');
  });
});
