import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { logsFor } from '../../bin/lib/dev-orchestrator/logs.mjs';

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

describe('logsFor', () => {
  test('returns capture for a tracked pane', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: 'main:0:jlu-dev-foo\n', stderr: '' }),
      'list-panes': () => ({ status: 0, stdout: '%1:api:0\n%2:web:0\n', stderr: '' }),
      'capture-pane': () => ({ status: 0, stdout: 'log line 1\nlog line 2\n', stderr: '' })
    });
    const allServices = [
      { name: 'api', path: '.', command: 'x' },
      { name: 'web', path: '.', command: 'y' }
    ];
    const out = logsFor({ slug: 'foo', serviceName: 'api', allServices, runner: r });
    assert.equal(out.status, 'ok');
    assert.match(out.capture, /log line 1/);
  });

  test('returns no-window when window missing', () => {
    const r = fakeRunner({ 'list-windows': () => ({ status: 0, stdout: '', stderr: '' }) });
    const out = logsFor({ slug: 'foo', serviceName: 'api', allServices: [{ name: 'api', path: '.', command: 'x' }], runner: r });
    assert.equal(out.status, 'no-window');
  });

  test('returns not-registered when service missing in config', () => {
    const r = fakeRunner();
    const out = logsFor({ slug: 'foo', serviceName: 'api', allServices: [], runner: r });
    assert.equal(out.status, 'not-registered');
  });

  test('returns no-pane when service has no pane', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: 'main:0:jlu-dev-foo\n', stderr: '' }),
      'list-panes': () => ({ status: 0, stdout: '%1:other:0\n', stderr: '' })
    });
    const out = logsFor({ slug: 'foo', serviceName: 'api', allServices: [{ name: 'api', path: '.', command: 'x' }], runner: r });
    assert.equal(out.status, 'no-pane');
  });
});
