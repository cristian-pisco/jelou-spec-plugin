// tests/unit/dev-orchestrator-stop.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stopDev } from '../../bin/lib/dev-orchestrator/stop.mjs';

const stopWorkflow = readFileSync(join(import.meta.dirname, '..', '..', 'jelou', 'workflows', 'stop-dev.md'), 'utf8');

function fakeRunner(handlers = {}) {
  const calls = [];
  const fn = (args) => {
    calls.push([...args]);
    if (typeof handlers[args[0]] === 'function') return handlers[args[0]](args);
    return { status: 0, stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

describe('stopDev', () => {
  test('kills daemon and reports without touching window when killServices=false', () => {
    const r = fakeRunner();
    let daemonKilled = 0;
    const out = stopDev({
      workspaceId: 'wid', slug: '_global',
      runner: r,
      killServices: false,
      killDaemon: () => { daemonKilled++; return { killed: true, pid: 9999 }; },
      tearDownStack: () => ({ projects: [], killed: [], missing: [], restored: [] })
    });
    assert.equal(daemonKilled, 1);
    assert.equal(out.daemon.killed, true);
    assert.equal(out.window.killed, false);
    assert.equal(r.calls.filter(c => c[0] === 'kill-window').length, 0);
  });

  test('also kills window when killServices=true', () => {
    const r = fakeRunner();
    const out = stopDev({
      workspaceId: 'wid', slug: 'foo',
      runner: r,
      killServices: true,
      killDaemon: () => ({ killed: false }),
      tearDownStack: () => ({ projects: [], killed: [], missing: [], restored: [] })
    });
    assert.equal(out.window.killed, true);
    const kw = r.calls.find(c => c[0] === 'kill-window');
    assert.ok(kw, 'kill-window must have been called');
    assert.deepEqual(kw, ['kill-window', '-t', 'jlu-dev-foo']);
  });

  test('reports daemon killed=false when callback returns false', () => {
    const r = fakeRunner();
    const out = stopDev({
      workspaceId: 'wid', slug: '_global',
      runner: r,
      killServices: false,
      killDaemon: () => ({ killed: false }),
      tearDownStack: () => ({ projects: [], killed: [], missing: [], restored: [] })
    });
    assert.equal(out.daemon.killed, false);
  });

  test('stopDev runs stack teardown and surfaces its result', () => {
    const calls = [];
    const stackResult = { projects: ['a-t1'], killed: [10], missing: [], restored: ['/f/.env'] };
    const out = stopDev({
      workspaceId: '/ws', slug: 't1',
      killDaemon: () => ({ killed: false }),
      tearDownStack: (o) => { calls.push(o); return stackResult; }
    });
    assert.deepEqual(calls, [{ workspaceId: '/ws', slug: 't1' }]);
    assert.deepEqual(out.stack, stackResult);
  });

  test('passes the current run id to ownership-checked stack teardown', () => {
    const calls = [];

    stopDev({
      workspaceId: 'workspace-1',
      slug: 'task-a',
      runId: 'run-17',
      killDaemon: () => ({ killed: false }),
      tearDownStack: (opts) => {
        calls.push(opts);
        return { projects: [], killed: [], missing: [], restored: [], refused: [] };
      },
    });

    assert.deepEqual(calls, [{ workspaceId: 'workspace-1', slug: 'task-a', runId: 'run-17' }]);
  });

  test('the workflow reads and passes the persisted current run marker', () => {
    assert.match(stopWorkflow, /readStackState/);
    assert.match(stopWorkflow, /runId:\s*state\.currentRun\?\.runId/);
  });

  test('reports the final cleanup outcome after stack teardown', () => {
    const lifecycle = [];

    stopDev({
      workspaceId: 'workspace-1',
      slug: 'task-a',
      runId: 'run-17',
      killDaemon: () => ({ killed: false }),
      tearDownStack: () => ({ projects: [], killed: [], missing: [], restored: [], refused: [] }),
      onLifecycle: (event) => lifecycle.push(event),
    });

    assert.deepEqual(lifecycle, [{ stage: 'cleanup', outcome: 'succeeded', taskSlug: 'task-a' }]);
  });

  test('the workflow persists the final cleanup outcome after stop', () => {
    assert.match(stopWorkflow, /appendLifecycleEvent[\s\S]*eventsLogPath/);
  });
});
