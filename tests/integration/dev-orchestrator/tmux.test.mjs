// tests/integration/dev-orchestrator/tmux.test.mjs
//
// Run: `node --test tests/integration/dev-orchestrator/tmux.test.mjs`
// Skipped automatically if `tmux -V` fails.

import { test, describe, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  tmuxAvailable, newSessionDetached, listWindows, findWindow,
  newWindow, splitWindow, selectLayout, sendKeys, capturePane,
  killWindow, listPanes
} from '../../../bin/lib/dev-orchestrator/tmux.mjs';

const SOCKET = `jlu-test-${randomBytes(4).toString('hex')}`;
const SESSION = 'jlu-int-test';

// Bind a runner to our private socket so we never touch the user's tmux.
function socketRunner(args, opts = {}) {
  return spawnSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8', ...opts });
}

const skip = !tmuxAvailable(socketRunner).ok;

describe('tmux integration (real tmux)', { skip }, () => {
  before(() => {
    newSessionDetached(SESSION, socketRunner);
  });

  after(() => {
    socketRunner(['kill-server']);
  });

  test('creates a window, splits, and lists panes', () => {
    newWindow({ session: SESSION, name: 'jlu-dev-int' }, socketRunner);
    const win = findWindow('jlu-dev-int', socketRunner);
    assert.ok(win, 'window must exist');
    splitWindow({ target: `${SESSION}:jlu-dev-int` }, socketRunner);
    splitWindow({ target: `${SESSION}:jlu-dev-int` }, socketRunner);
    const panes = listPanes({ window: `${SESSION}:jlu-dev-int`, runner: socketRunner });
    assert.equal(panes.length, 3);
  });

  test('select-layout tiled does not error', () => {
    const r = selectLayout({ target: `${SESSION}:jlu-dev-int`, layout: 'tiled' }, socketRunner);
    assert.equal(r.status, 0);
  });

  test('send-keys + capture-pane round-trip', async () => {
    const target = `${SESSION}:jlu-dev-int.0`;
    sendKeys({ target, keys: 'echo HELLO_FROM_JLU' }, socketRunner);
    // Tmux is async; give the shell a moment.
    await new Promise(r => setTimeout(r, 250));
    const out = capturePane({ target, lines: 50 }, socketRunner);
    assert.match(out, /HELLO_FROM_JLU/);
  });

  test('kill-window removes the window', () => {
    killWindow({ target: `${SESSION}:jlu-dev-int` }, socketRunner);
    const win = findWindow('jlu-dev-int', socketRunner);
    assert.equal(win, null);
  });
});
