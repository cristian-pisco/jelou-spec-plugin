// tests/unit/dev-orchestrator-tmux.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  tmuxAvailable, inTmuxSession, serverAlive,
  newSessionDetached, listWindows, findWindow, newWindow,
  splitWindow, selectLayout, selectPaneTitle, setPaneStyle,
  selectPane, selectWindow, sendKeys, capturePane, killWindow,
  listPanes
} from '../../bin/lib/dev-orchestrator/tmux.mjs';

function fakeRunner(handlers = {}) {
  const calls = [];
  const fn = (args, opts = {}) => {
    calls.push({ args: [...args], opts });
    const key = args[0];
    const handler = handlers[key];
    if (typeof handler === 'function') return handler(args, opts);
    return { status: 0, stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

describe('tmuxAvailable', () => {
  test('parses version when tmux is installed', () => {
    const r = fakeRunner({ '-V': () => ({ status: 0, stdout: 'tmux 3.5a\n', stderr: '' }) });
    const out = tmuxAvailable(r);
    assert.equal(out.ok, true);
    assert.equal(out.version, '3.5a');
  });

  test('returns ok:false when tmux is missing', () => {
    const r = fakeRunner({ '-V': () => ({ status: 127, stdout: '', stderr: 'tmux: command not found' }) });
    const out = tmuxAvailable(r);
    assert.equal(out.ok, false);
    assert.equal(out.version, null);
  });
});

describe('inTmuxSession', () => {
  test('true when env.TMUX is set', () => {
    assert.equal(inTmuxSession({ TMUX: '/tmp/tmux-1000/default,123,4' }), true);
  });
  test('false when env.TMUX is missing', () => {
    assert.equal(inTmuxSession({}), false);
  });
});

describe('serverAlive', () => {
  test('true when list-sessions exits 0', () => {
    const r = fakeRunner({ 'list-sessions': () => ({ status: 0, stdout: '', stderr: '' }) });
    assert.equal(serverAlive(r), true);
  });
  test('false when list-sessions exits non-zero', () => {
    const r = fakeRunner({ 'list-sessions': () => ({ status: 1, stdout: '', stderr: 'no server running' }) });
    assert.equal(serverAlive(r), false);
  });
});

describe('newSessionDetached', () => {
  test('shells correct args', () => {
    const r = fakeRunner();
    newSessionDetached('jlu-dev', r);
    assert.deepEqual(r.calls[0].args, ['new-session', '-d', '-s', 'jlu-dev']);
  });
});

describe('listWindows + findWindow', () => {
  test('parses list-windows output', () => {
    const r = fakeRunner({
      'list-windows': () => ({
        status: 0,
        stdout: 'main:0:jlu-dev-foo\nmain:1:other\nwork:0:jlu-dev-bar\n',
        stderr: ''
      })
    });
    const w = listWindows(r);
    assert.deepEqual(w, [
      { session: 'main', index: 0, name: 'jlu-dev-foo' },
      { session: 'main', index: 1, name: 'other' },
      { session: 'work', index: 0, name: 'jlu-dev-bar' }
    ]);
    assert.deepEqual(findWindow('jlu-dev-bar', r), { session: 'work', index: 0, name: 'jlu-dev-bar' });
    assert.equal(findWindow('not-there', r), null);
  });
});

describe('newWindow', () => {
  test('shells correct args', () => {
    const r = fakeRunner();
    newWindow({ session: 'main', name: 'jlu-dev-foo' }, r);
    assert.deepEqual(r.calls[0].args, ['new-window', '-t', 'main:', '-n', 'jlu-dev-foo']);
  });
});

describe('splitWindow + selectLayout', () => {
  test('split-window targets pane', () => {
    const r = fakeRunner();
    splitWindow({ target: 'main:jlu-dev-foo' }, r);
    assert.deepEqual(r.calls[0].args, ['split-window', '-t', 'main:jlu-dev-foo']);
  });
  test('select-layout uses requested layout', () => {
    const r = fakeRunner();
    selectLayout({ target: 'main:jlu-dev-foo', layout: 'tiled' }, r);
    assert.deepEqual(r.calls[0].args, ['select-layout', '-t', 'main:jlu-dev-foo', 'tiled']);
  });
});

describe('selectPaneTitle + setPaneStyle + selectPane + selectWindow', () => {
  test('select-pane -T sets title', () => {
    const r = fakeRunner();
    selectPaneTitle({ target: 'main:0.0', title: 'API' }, r);
    assert.deepEqual(r.calls[0].args, ['select-pane', '-t', 'main:0.0', '-T', 'API']);
  });
  test('set pane style via -P', () => {
    const r = fakeRunner();
    setPaneStyle({ target: 'main:0.0', style: 'fg=cyan' }, r);
    assert.deepEqual(r.calls[0].args, ['select-pane', '-t', 'main:0.0', '-P', 'fg=cyan']);
  });
  test('plain select-pane', () => {
    const r = fakeRunner();
    selectPane({ target: 'main:0.0' }, r);
    assert.deepEqual(r.calls[0].args, ['select-pane', '-t', 'main:0.0']);
  });
  test('plain select-window', () => {
    const r = fakeRunner();
    selectWindow({ target: 'main:jlu-dev-foo' }, r);
    assert.deepEqual(r.calls[0].args, ['select-window', '-t', 'main:jlu-dev-foo']);
  });
});

describe('sendKeys', () => {
  test('appends Enter to the literal command', () => {
    const r = fakeRunner();
    sendKeys({ target: 'main:0.0', keys: 'cd ./api && npm run dev' }, r);
    assert.deepEqual(r.calls[0].args, ['send-keys', '-t', 'main:0.0', 'cd ./api && npm run dev', 'Enter']);
  });
});

describe('capturePane', () => {
  test('returns stdout from capture-pane', () => {
    const r = fakeRunner({
      'capture-pane': () => ({ status: 0, stdout: 'line1\nline2\n', stderr: '' })
    });
    const out = capturePane({ target: 'main:0.0', lines: 100 }, r);
    assert.deepEqual(r.calls[0].args, ['capture-pane', '-p', '-S', '-100', '-t', 'main:0.0']);
    assert.equal(out, 'line1\nline2\n');
  });
});

describe('killWindow', () => {
  test('shells correct args', () => {
    const r = fakeRunner();
    killWindow({ target: 'main:jlu-dev-foo' }, r);
    assert.deepEqual(r.calls[0].args, ['kill-window', '-t', 'main:jlu-dev-foo']);
  });
});

describe('listPanes', () => {
  test('parses pane list output', () => {
    const r = fakeRunner({
      'list-panes': () => ({
        status: 0,
        stdout: '%23:API:0\n%24:web:0\n%25:dead-svc:1\n',
        stderr: ''
      })
    });
    const panes = listPanes({ window: 'main:jlu-dev-foo', runner: r });
    assert.deepEqual(panes, [
      { id: '%23', title: 'API', dead: false },
      { id: '%24', title: 'web', dead: false },
      { id: '%25', title: 'dead-svc', dead: true }
    ]);
  });
});
