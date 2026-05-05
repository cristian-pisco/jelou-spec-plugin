// tests/integration/dev-orchestrator/daemon.test.mjs
//
// Real-tmux E2E test for the daemon. Spawns a tmux session on a private socket,
// fills it with two panes (one short-lived that exits with non-zero, one long
// sleep), spawns the daemon, and asserts that pane_dead lands in dev-events.log.

import { test, describe, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  tmuxAvailable, newSessionDetached, newWindow, splitWindow, sendKeys, killWindow
} from '../../../bin/lib/dev-orchestrator/tmux.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DAEMON = join(here, '..', '..', '..', 'bin', 'lib', 'dev-orchestrator', 'daemon.mjs');
const SOCKET = `jlu-d-${randomBytes(4).toString('hex')}`;
const SESSION = 'jlu-d-test';

function socketRunner(args, opts = {}) {
  return spawnSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8', ...opts });
}

const skip = !tmuxAvailable(socketRunner).ok;

describe('daemon integration', { skip }, () => {
  let base, configPath;
  const workspaceId = 'integ';
  const slug = 'd1';

  before(() => {
    base = mkdtempSync(join(tmpdir(), 'jlu-dint-'));
    configPath = join(base, 'jlu-services.json');
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      defaults: { poll_interval_ms: 500 },
      services: [
        { name: 'good', path: '.', command: 'sleep 5', panel: { title: 'good' } },
        { name: 'bad', path: '.', command: 'sleep 1; exit 1', panel: { title: 'bad' } }
      ]
    }));

    newSessionDetached(SESSION, socketRunner);
    newWindow({ session: SESSION, name: 'jlu-dev-d1' }, socketRunner);
    // Keep panes alive after command exit so the daemon sees pane_dead=1.
    socketRunner(['set-option', '-w', '-t', `${SESSION}:jlu-dev-d1`, 'remain-on-exit', 'on']);
    sendKeys({ target: `${SESSION}:jlu-dev-d1.0`, keys: 'sleep 5' }, socketRunner);
    splitWindow({ target: `${SESSION}:jlu-dev-d1` }, socketRunner);
    sendKeys({ target: `${SESSION}:jlu-dev-d1.1`, keys: 'sleep 1; exit 1' }, socketRunner);
    socketRunner(['select-pane', '-t', `${SESSION}:jlu-dev-d1.0`, '-T', 'good']);
    socketRunner(['select-pane', '-t', `${SESSION}:jlu-dev-d1.1`, '-T', 'bad']);
  });

  after(() => {
    try { killWindow({ target: `${SESSION}:jlu-dev-d1` }, socketRunner); } catch {}
    socketRunner(['kill-server']);
    if (base) rmSync(base, { recursive: true, force: true });
  });

  test('emits pane_dead for the failing pane within 8s', async () => {
    const child = spawn('node', [
      DAEMON,
      '--workspace-id', workspaceId,
      '--slug', slug,
      '--window', 'jlu-dev-d1',
      '--config', configPath
    ], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, JLU_HOME: base, JLU_TMUX_SOCKET: SOCKET, TMUX: '' }
    });
    child.unref();

    // Wait up to 8s for events to materialize.
    const logPath = join(base, 'workspaces', workspaceId, slug, 'dev-events.log');
    let body = '';
    for (let i = 0; i < 40; i++) {
      if (existsSync(logPath)) {
        body = readFileSync(logPath, 'utf8');
        if (body.includes('pane_dead')) break;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    // Kill daemon.
    try { process.kill(child.pid, 'SIGTERM'); } catch {}
    // Give it a moment to flush + release lock.
    await new Promise(r => setTimeout(r, 200));

    assert.match(body, /pane_dead/);
  });
});
