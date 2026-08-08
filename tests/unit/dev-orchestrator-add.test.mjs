import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addService } from '../../bin/lib/dev-orchestrator/add.mjs';

const addWorkflow = readFileSync(join(import.meta.dirname, '..', '..', 'jelou', 'workflows', 'add-service.md'), 'utf8');

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

describe('addService', () => {
  test('adds pane to existing window', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: 'main:0:jlu-dev-foo\n', stderr: '' }),
      'list-panes': () => ({ status: 0, stdout: '%1:other:0\n', stderr: '' })
    });
    const lifecycle = [];
    const cfg = { version: 1, services: [{ name: 'api', path: './api', command: 'cmd' }] };
    const out = addService({
      config: cfg, workspaceRoot: '/work', slug: 'foo', serviceName: 'api', runner: r,
      onLifecycle: (event) => lifecycle.push(event)
    });
    assert.equal(out.status, 'added');
    const ops = r.calls.map(c => c[0]);
    assert.ok(ops.includes('split-window'));
    assert.ok(ops.includes('send-keys'));
    assert.ok(ops.includes('select-layout'));
    assert.ok(ops.includes('select-pane'));
    assert.deepEqual(lifecycle, [
      { stage: 'boot', outcome: 'started', taskSlug: 'foo', service: 'api' },
      { stage: 'boot', outcome: 'succeeded', taskSlug: 'foo', service: 'api' },
    ]);
  });

  test('returns no-window when window missing', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: '', stderr: '' })
    });
    const cfg = { version: 1, services: [{ name: 'api', path: './api', command: 'cmd' }] };
    const out = addService({
      config: cfg, workspaceRoot: '/work', slug: 'foo', serviceName: 'api', runner: r
    });
    assert.equal(out.status, 'no-window');
  });

  test('returns not-registered when service missing in config', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: 'main:0:jlu-dev-foo\n', stderr: '' })
    });
    const cfg = { version: 1, services: [] };
    const out = addService({
      config: cfg, workspaceRoot: '/work', slug: 'foo', serviceName: 'api', runner: r
    });
    assert.equal(out.status, 'not-registered');
  });

  test('returns pane-exists when title already taken', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: 'main:0:jlu-dev-foo\n', stderr: '' }),
      'list-panes': () => ({ status: 0, stdout: '%1:api:0\n', stderr: '' })
    });
    const cfg = { version: 1, services: [{ name: 'api', path: './api', command: 'cmd' }] };
    const out = addService({
      config: cfg, workspaceRoot: '/work', slug: 'foo', serviceName: 'api', runner: r
    });
    assert.equal(out.status, 'pane-exists');
  });

  test('the workflow persists pane lifecycle events in the task event log', () => {
    assert.match(addWorkflow, /appendLifecycleEvent[\s\S]*eventsLogPath/);
  });
});
