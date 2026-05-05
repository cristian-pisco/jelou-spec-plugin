// tests/unit/dev-orchestrator-start.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  chooseLayout, buildPaneCommand, planStart, startDev
} from '../../bin/lib/dev-orchestrator/start.mjs';

function fakeRunner(handlers = {}) {
  const calls = [];
  const fn = (args) => {
    calls.push([...args]);
    const key = args[0];
    if (typeof handlers[key] === 'function') return handlers[key](args);
    return { status: 0, stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

describe('chooseLayout', () => {
  test('N=1 → single-pane', () => assert.equal(chooseLayout(1), 'single-pane'));
  test('N=2 → even-horizontal', () => assert.equal(chooseLayout(2), 'even-horizontal'));
  test('N=3 → even-horizontal', () => assert.equal(chooseLayout(3), 'even-horizontal'));
  test('N=4 → tiled', () => assert.equal(chooseLayout(4), 'tiled'));
  test('N=12 → tiled', () => assert.equal(chooseLayout(12), 'tiled'));
});

describe('buildPaneCommand', () => {
  test('without env_file → cd && command', () => {
    const cmd = buildPaneCommand({
      service: { name: 'api', path: './api', command: 'npm run dev' },
      paneCwd: '/work/api'
    });
    assert.equal(cmd, 'cd /work/api && npm run dev');
  });

  test('with env_file → conditional source', () => {
    const cmd = buildPaneCommand({
      service: { name: 'api', path: './api', command: 'npm run dev', env_file: '.env' },
      paneCwd: '/work/api'
    });
    assert.match(cmd, /cd \/work\/api &&/);
    assert.match(cmd, /\[ -f .env \]/);
    assert.match(cmd, /set -a && source .env; set \+a/);
    assert.match(cmd, /&& npm run dev/);
  });

  test('env_file null → no source', () => {
    const cmd = buildPaneCommand({
      service: { name: 'redis', path: '.', command: 'docker compose up redis', env_file: null },
      paneCwd: '/work'
    });
    assert.equal(cmd, 'cd /work && docker compose up redis');
  });
});

describe('planStart', () => {
  test('produces deterministic plan with title + color when provided', () => {
    const cfg = {
      version: 1,
      services: [
        { name: 'api', path: './api', command: 'npm run dev', panel: { title: 'API', color: 'fg=cyan' } },
        { name: 'web', path: './web', command: 'npm run dev' }
      ]
    };
    const plan = planStart({
      config: cfg, workspaceRoot: '/work', slug: 'auth-refactor', windowName: 'jlu-dev-auth-refactor'
    });
    assert.equal(plan.windowName, 'jlu-dev-auth-refactor');
    assert.equal(plan.layout, 'even-horizontal');
    assert.equal(plan.panes.length, 2);
    assert.equal(plan.panes[0].cwd, '/work/api');
    assert.equal(plan.panes[0].title, 'API');
    assert.equal(plan.panes[0].color, 'fg=cyan');
    assert.equal(plan.panes[1].title, 'web');
  });

  test('skips services whose path resolves outside the workspace root', () => {
    const cfg = {
      version: 1,
      services: [
        { name: 'api', path: '../outside', command: 'npm run dev' },
        { name: 'web', path: './web', command: 'npm run dev' }
      ]
    };
    const plan = planStart({ config: cfg, workspaceRoot: '/work', slug: '_global', windowName: 'jlu-dev-global' });
    assert.deepEqual(plan.panes.map(p => p.name), ['web']);
    assert.deepEqual(plan.skipped, [{ name: 'api', reason: 'path-outside-workspace' }]);
  });
});

describe('startDev — happy path inside tmux', () => {
  test('creates window, splits, sends commands, selects layout', () => {
    const runner = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: '', stderr: '' }),
      '-V': () => ({ status: 0, stdout: 'tmux 3.5a\n', stderr: '' })
    });
    let daemonCalled = 0;
    const daemonSpawn = () => { daemonCalled++; return { pid: 1234 }; };
    const cfg = {
      version: 1,
      services: [
        { name: 'a', path: './a', command: 'cmd-a' },
        { name: 'b', path: './b', command: 'cmd-b' }
      ]
    };
    const result = startDev({
      config: cfg, workspaceRoot: '/work', slug: '_global',
      env: { TMUX: '/tmp/x,1,2' }, runner, daemonSpawn
    });
    assert.equal(result.status, 'created');
    assert.equal(result.windowName, 'jlu-dev-_global');
    assert.equal(daemonCalled, 1);
    const ops = runner.calls.map(c => c[0]);
    assert.ok(ops.includes('new-window'));
    assert.ok(ops.includes('split-window'));
    assert.ok(ops.includes('send-keys'));
    assert.ok(ops.includes('select-layout'));
  });

  test('reports existing window without recreating', () => {
    const runner = fakeRunner({
      'list-windows': () => ({
        status: 0,
        stdout: 'main:0:jlu-dev-foo\n',
        stderr: ''
      }),
      '-V': () => ({ status: 0, stdout: 'tmux 3.5a\n', stderr: '' })
    });
    const cfg = { version: 1, services: [{ name: 'a', path: './a', command: 'cmd-a' }] };
    const result = startDev({
      config: cfg, workspaceRoot: '/work', slug: 'foo',
      env: { TMUX: '/tmp/x,1,2' }, runner, daemonSpawn: () => ({ pid: 1 })
    });
    assert.equal(result.status, 'exists');
    assert.equal(result.windowName, 'jlu-dev-foo');
    assert.equal(runner.calls.filter(c => c[0] === 'new-window').length, 0);
  });

  test('returns no-tmux status when tmux missing', () => {
    const runner = fakeRunner({ '-V': () => ({ status: 127, stdout: '', stderr: '' }) });
    const cfg = { version: 1, services: [{ name: 'a', path: './a', command: 'x' }] };
    const result = startDev({
      config: cfg, workspaceRoot: '/work', slug: '_global',
      env: {}, runner, daemonSpawn: () => ({ pid: 0 })
    });
    assert.equal(result.status, 'tmux-missing');
  });
});
