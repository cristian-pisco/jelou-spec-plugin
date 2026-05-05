# JLU Dev Orchestrator — Phase 2 (TMUX + minimal start/stop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the TMUX integration layer plus minimal `/jlu:start-dev` and `/jlu:stop-dev` commands. After this phase, a user can run `/jlu:start-dev` against a registered `jlu-services.json` and end up with a TMUX window where each declared service runs in its own pane. `/jlu:stop-dev` removes the window. No daemon, no monitoring, no readiness probes — those land in Phase 3.

**Architecture:** New module `bin/lib/dev-orchestrator/tmux.mjs` is a thin wrapper around the `tmux` CLI invoked via `spawnSync` with array args (no shell). Two new orchestrators (`start.mjs`, `stop.mjs`) compose the helpers from Phase 1 (`workspace`, `task-context`, `config`, `state`) plus the new tmux wrapper. Each command ships its full runtime trio: `skills/<name>/SKILL.md` + `jelou/workflows/<name>.md` + `.opencode/commands/jlu-<name>.md`. Daemon spawn is stubbed out for now — Phase 3 will swap in the real call.

**Tech Stack:** Node 20+ ESM. `node:test` for unit tests. Real `tmux` for integration tests, gated by `tmux -V` availability so CI without tmux is not blocked. TMUX 3.0+ for `select-pane -T/-P`.

**Spec:** `docs/superpowers/specs/2026-05-04-jlu-dev-orchestrator-design.md`
**Phase 1 plan (already shipped):** `docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator.md`

**Branch:** `feature/dev-orchestrator` (continues from Phase 1 — do NOT create a new branch).
**PR:** Same single PR for all phases. Do not open it yet; it lands when Phase 5 completes.

**Phase 2 deliverable:** Users can run `/jlu:start-dev` and `/jlu:stop-dev`. Services boot in TMUX panes; window can be closed cleanly. No background monitoring yet.

---

## Pre-flight (before Task 1)

Run from the repo root:

```bash
git status --short
git rev-parse --abbrev-ref HEAD     # must be feature/dev-orchestrator
npm test                            # must be 196/196 (Phase 1 baseline)
tmux -V                             # must be 3.0 or newer
```

If branch is wrong, switch: `git checkout feature/dev-orchestrator`. If suite is red, stop and surface to user. If tmux missing, integration tests will skip but unit tests proceed — note in commit messages.

---

## File Structure (Phase 2)

### Files to CREATE

| Path | Responsibility |
|------|---------------|
| `bin/lib/dev-orchestrator/tmux.mjs` | Wrap `tmux` CLI: server alive, list windows/panes, new-session, new-window, split-window, send-keys, select-pane title/color, capture-pane, kill-window, select-layout |
| `bin/lib/dev-orchestrator/start.mjs` | Implements `/jlu:start-dev` core: resolve workspace+slug, plan layout, create window, send commands. Daemon spawn is a callback wired to a stub for now |
| `bin/lib/dev-orchestrator/stop.mjs` | Implements `/jlu:stop-dev` core: kill daemon (no-op stub for now), optionally kill window |
| `jelou/workflows/start-dev.md` | Shared workflow for `start-dev` |
| `jelou/workflows/stop-dev.md` | Shared workflow for `stop-dev` |
| `skills/start-dev/SKILL.md` | Claude Code launcher |
| `skills/stop-dev/SKILL.md` | Claude Code launcher |
| `.opencode/commands/jlu-start-dev.md` | OpenCode mirror |
| `.opencode/commands/jlu-stop-dev.md` | OpenCode mirror |
| `tests/unit/dev-orchestrator-tmux.test.mjs` | Unit tests for argument-shape correctness via injected fake runner |
| `tests/integration/dev-orchestrator/tmux.test.mjs` | Real-tmux integration test, gated by `tmux -V` |
| `tests/unit/dev-orchestrator-start.test.mjs` | Unit tests for layout planning + command construction |
| `tests/unit/dev-orchestrator-stop.test.mjs` | Unit tests for stop logic |

### Files to MODIFY

None. (`tests/pressure/skills.test.mjs` and README updates land in Phase 5.)

### Coding rules (still apply)

- Node 20+ ESM (`.mjs`).
- All child-process calls use `spawnSync`/`spawn` with array args. The repo has a security hook that rejects shell-string forms.
- Tests live FLAT in `tests/unit/`. `npm test` is `node --test tests/unit/*.test.mjs`.
- Integration tests live under `tests/integration/dev-orchestrator/`. Run separately: `node --test tests/integration/dev-orchestrator/*.test.mjs`.
- Every commit ends with `[skip-bump]`.

---

## Task 1: tmux.mjs — RED unit test

**Files:**
- Create: `tests/unit/dev-orchestrator-tmux.test.mjs`

The wrapper exports plain functions that take a `runner` argument (defaulting to a real `spawnSync` invocation). Tests inject a fake runner that records calls. This keeps unit tests fast and tmux-free; integration tests (Task 3) cover the real path.

Required exports (all take `runner` as last param, defaulting to a real `spawnSync` wrapper):

- `tmuxAvailable(runner)` returns `{ ok, version }`.
- `inTmuxSession(env)` reads `env.TMUX`; pure function.
- `serverAlive(runner)` checks `tmux list-sessions`.
- `newSessionDetached(name, runner)` runs `tmux new-session -d -s <name>`.
- `attachSession(name)` returns the spawn args (caller runs in foreground).
- `listWindows(runner)` parses `[{ session, index, name }]`.
- `findWindow(name, runner)` returns one match or `null`.
- `newWindow({ session, name }, runner)` creates a window.
- `splitWindow({ target }, runner)` splits horizontally.
- `selectLayout({ target, layout }, runner)` applies layout.
- `selectPaneTitle({ target, title }, runner)` sets title.
- `setPaneStyle({ target, style }, runner)` sets pane border style.
- `selectPane({ target }, runner)` plain select-pane.
- `selectWindow({ target }, runner)` plain select-window.
- `sendKeys({ target, keys }, runner)` sends keys + Enter.
- `capturePane({ target, lines }, runner)` returns stdout string.
- `killWindow({ target }, runner)` kills.
- `listPanes({ window, runner })` parses `[{ id, title, dead }]`.

The `runner` interface (so tests fake it): called as `runner(args, opts)`, returns `{ status, stdout, stderr }` (same shape as `spawnSync`).

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test — confirm fail**

```bash
node --test tests/unit/dev-orchestrator-tmux.test.mjs
```

Expected: `Cannot find module .../tmux.mjs`.

- [ ] **Step 3: Commit RED**

```bash
git add tests/unit/dev-orchestrator-tmux.test.mjs
git commit -m "test(dev-orchestrator/tmux): red — tmux wrapper contract [skip-bump]"
```

---

## Task 2: tmux.mjs — GREEN

**Files:**
- Create: `bin/lib/dev-orchestrator/tmux.mjs`

- [ ] **Step 1: Implement the wrapper**

```javascript
// bin/lib/dev-orchestrator/tmux.mjs
//
// Thin wrapper around the tmux CLI. All callers go through `runner`, which
// defaults to spawnSync('tmux', args, ...). Tests inject a fake runner.
// No shell, no string interpolation.

import { spawnSync } from 'node:child_process';

function defaultRunner(args, opts = {}) {
  return spawnSync('tmux', args, { encoding: 'utf8', ...opts });
}

export function tmuxAvailable(runner = defaultRunner) {
  const r = runner(['-V']);
  if (r.status !== 0) return { ok: false, version: null };
  const m = /^tmux\s+(\S+)/.exec(r.stdout || '');
  return { ok: true, version: m ? m[1] : null };
}

export function inTmuxSession(env = process.env) {
  return Boolean(env && env.TMUX);
}

export function serverAlive(runner = defaultRunner) {
  return runner(['list-sessions']).status === 0;
}

export function newSessionDetached(name, runner = defaultRunner) {
  return runner(['new-session', '-d', '-s', name]);
}

export function attachSession(name) {
  return ['attach-session', '-t', name];
}

export function listWindows(runner = defaultRunner) {
  const r = runner(['list-windows', '-a', '-F', '#{session_name}:#{window_index}:#{window_name}']);
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [session, idx, ...rest] = line.split(':');
      return { session, index: parseInt(idx, 10), name: rest.join(':') };
    });
}

export function findWindow(name, runner = defaultRunner) {
  return listWindows(runner).find(w => w.name === name) || null;
}

export function newWindow({ session, name }, runner = defaultRunner) {
  return runner(['new-window', '-t', `${session}:`, '-n', name]);
}

export function splitWindow({ target }, runner = defaultRunner) {
  return runner(['split-window', '-t', target]);
}

export function selectLayout({ target, layout }, runner = defaultRunner) {
  return runner(['select-layout', '-t', target, layout]);
}

export function selectPaneTitle({ target, title }, runner = defaultRunner) {
  return runner(['select-pane', '-t', target, '-T', title]);
}

export function setPaneStyle({ target, style }, runner = defaultRunner) {
  return runner(['select-pane', '-t', target, '-P', style]);
}

export function selectPane({ target }, runner = defaultRunner) {
  return runner(['select-pane', '-t', target]);
}

export function selectWindow({ target }, runner = defaultRunner) {
  return runner(['select-window', '-t', target]);
}

export function sendKeys({ target, keys }, runner = defaultRunner) {
  return runner(['send-keys', '-t', target, keys, 'Enter']);
}

export function capturePane({ target, lines = 100 }, runner = defaultRunner) {
  const r = runner(['capture-pane', '-p', '-S', `-${lines}`, '-t', target]);
  return r.stdout || '';
}

export function killWindow({ target }, runner = defaultRunner) {
  return runner(['kill-window', '-t', target]);
}

export function listPanes({ window, runner = defaultRunner }) {
  const r = runner(['list-panes', '-t', window, '-F', '#{pane_id}:#{pane_title}:#{pane_dead}']);
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [id, title, dead] = line.split(':');
      return { id, title, dead: dead === '1' };
    });
}
```

- [ ] **Step 2: Run test — confirm pass**

```bash
node --test tests/unit/dev-orchestrator-tmux.test.mjs
```

Expected: 14 tests pass.

- [ ] **Step 3: Run full suite**

```bash
npm test
```

Expected: 196 + 14 = 210 tests, all pass.

- [ ] **Step 4: Commit GREEN**

```bash
git add bin/lib/dev-orchestrator/tmux.mjs
git commit -m "feat(dev-orchestrator/tmux): green — tmux CLI wrapper with injectable runner [skip-bump]"
```

---

## Task 3: tmux integration test (real tmux)

**Files:**
- Create: `tests/integration/dev-orchestrator/tmux.test.mjs`

These tests run against a real `tmux` server in a unique socket so they don't disturb the developer's running sessions. Each test creates a session, exercises the wrapper, and tears down.

- [ ] **Step 1: Write the integration test**

```javascript
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
```

- [ ] **Step 2: Run integration test**

```bash
node --test tests/integration/dev-orchestrator/tmux.test.mjs
```

Expected: 4 tests pass (or all skipped if tmux unavailable).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/dev-orchestrator/tmux.test.mjs
git commit -m "test(dev-orchestrator/tmux): integration suite against real tmux server [skip-bump]"
```

---

## Task 4: start.mjs — RED

**Files:**
- Create: `tests/unit/dev-orchestrator-start.test.mjs`

`start.mjs` is the orchestrator for `/jlu:start-dev`. It composes everything from Phase 1 + the tmux wrapper. The Phase 2 version stubs out daemon spawn behind a callback.

Required exports:

- `chooseLayout(serviceCount)` returns `'single-pane' | 'even-horizontal' | 'tiled'`. N=1 returns single, N=2 or 3 returns even-horizontal, N at least 4 returns tiled.
- `buildPaneCommand({ service, paneCwd })` returns a string. Composes `cd <paneCwd>` + optional env-file source + service.command.
- `planStart({ config, workspaceRoot, slug, windowName })` — pure function returning a deterministic plan: `{ windowName, layout, panes, skipped }`.
- `startDev({ config, workspaceRoot, slug, env, runner, daemonSpawn })` — side-effecting orchestrator. `daemonSpawn` is a callback (Phase 2 default = no-op stub returning `{ pid: 0 }`).

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test — confirm fail**

```bash
node --test tests/unit/dev-orchestrator-start.test.mjs
```

Expected: `Cannot find module .../start.mjs`.

- [ ] **Step 3: Commit RED**

```bash
git add tests/unit/dev-orchestrator-start.test.mjs
git commit -m "test(dev-orchestrator/start): red — start-dev orchestrator contract [skip-bump]"
```

---

## Task 5: start.mjs — GREEN

**Files:**
- Create: `bin/lib/dev-orchestrator/start.mjs`

- [ ] **Step 1: Implement the orchestrator**

```javascript
// bin/lib/dev-orchestrator/start.mjs
//
// Implements /jlu:start-dev. Composes Phase 1 helpers + the tmux wrapper.
// Daemon spawn is a callback so Phase 3 can inject the real daemon without
// rewriting this module.

import { isAbsolute, resolve, relative } from 'node:path';
import {
  tmuxAvailable, inTmuxSession, serverAlive,
  newSessionDetached, findWindow, newWindow,
  splitWindow, selectLayout, selectPaneTitle, setPaneStyle,
  selectWindow, sendKeys
} from './tmux.mjs';

export function chooseLayout(n) {
  if (n <= 1) return 'single-pane';
  if (n <= 3) return 'even-horizontal';
  return 'tiled';
}

export function buildPaneCommand({ service, paneCwd }) {
  const parts = [`cd ${paneCwd}`];
  const env = service.env_file;
  if (env !== null && env !== undefined && env !== '') {
    parts.push(`[ -f ${env} ] && set -a && source ${env}; set +a`);
  }
  parts.push(service.command);
  return parts.join(' && ');
}

function paneCwdFor(workspaceRoot, service) {
  const rel = service.path || '.';
  return isAbsolute(rel) ? rel : resolve(workspaceRoot, rel);
}

function isInsideRoot(workspaceRoot, abs) {
  const rel = relative(workspaceRoot, abs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function windowNameFor(slug, prefix = '') {
  const safe = slug || '_global';
  return `${prefix}jlu-dev-${safe}`;
}

export function planStart({ config, workspaceRoot, slug, windowName }) {
  const services = config.services || [];
  const panes = [];
  const skipped = [];
  for (const svc of services) {
    const cwd = paneCwdFor(workspaceRoot, svc);
    if (!isInsideRoot(workspaceRoot, cwd)) {
      skipped.push({ name: svc.name, reason: 'path-outside-workspace' });
      continue;
    }
    panes.push({
      name: svc.name,
      cwd,
      command: buildPaneCommand({ service: svc, paneCwd: cwd }),
      title: (svc.panel && svc.panel.title) || svc.name,
      color: svc.panel && svc.panel.color
    });
  }
  return {
    windowName: windowName || windowNameFor(slug),
    layout: chooseLayout(panes.length),
    panes,
    skipped
  };
}

function ensureTmuxRunning({ env, runner }) {
  if (inTmuxSession(env)) return { mode: 'inside' };
  if (!serverAlive(runner)) newSessionDetached('jlu-dev', runner);
  return { mode: 'outside' };
}

export function startDev({
  config, workspaceRoot, slug, env = process.env,
  runner, daemonSpawn = () => ({ pid: 0 })
}) {
  const tmux = tmuxAvailable(runner);
  if (!tmux.ok) return { status: 'tmux-missing' };

  ensureTmuxRunning({ env, runner });

  const windowName = windowNameFor(slug);
  const existing = findWindow(windowName, runner);
  if (existing) {
    return { status: 'exists', windowName, session: existing.session };
  }

  const plan = planStart({ config, workspaceRoot, slug, windowName });
  const session = inTmuxSession(env) ? 'jlu-dev' : 'jlu-dev';
  // Note: when inside tmux, we use the user's current session if discoverable.
  // For Phase 2 simplicity we always operate on a session named 'jlu-dev'.
  // If the user is inside a different session, the orchestrator will create a
  // window in 'jlu-dev' which they can attach with: tmux attach -t jlu-dev.

  newWindow({ session, name: windowName }, runner);
  const winTarget = `${session}:${windowName}`;

  if (plan.panes.length > 0) {
    const p0 = plan.panes[0];
    selectPaneTitle({ target: `${winTarget}.0`, title: p0.title }, runner);
    if (p0.color) setPaneStyle({ target: `${winTarget}.0`, style: p0.color }, runner);
    sendKeys({ target: `${winTarget}.0`, keys: p0.command }, runner);
  }

  for (let i = 1; i < plan.panes.length; i++) {
    splitWindow({ target: winTarget }, runner);
    const p = plan.panes[i];
    selectPaneTitle({ target: winTarget + '.' + i, title: p.title }, runner);
    if (p.color) setPaneStyle({ target: winTarget + '.' + i, style: p.color }, runner);
    sendKeys({ target: winTarget + '.' + i, keys: p.command }, runner);
  }

  selectLayout({ target: winTarget, layout: plan.layout }, runner);
  selectWindow({ target: winTarget }, runner);

  const daemon = daemonSpawn({ slug, workspaceRoot, windowName });

  return {
    status: 'created',
    windowName,
    session,
    layout: plan.layout,
    paneCount: plan.panes.length,
    skipped: plan.skipped,
    daemonPid: daemon.pid
  };
}
```

- [ ] **Step 2: Run test — confirm pass**

```bash
node --test tests/unit/dev-orchestrator-start.test.mjs
npm test
```

Expected: 12 start tests pass; full suite at 222.

- [ ] **Step 3: Commit GREEN**

```bash
git add bin/lib/dev-orchestrator/start.mjs
git commit -m "feat(dev-orchestrator/start): green — start-dev orchestrator (no daemon yet) [skip-bump]"
```

---

## Task 6: stop.mjs — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-stop.test.mjs`
- Create: `bin/lib/dev-orchestrator/stop.mjs`

`stop.mjs` exports `stopDev({ workspaceId, slug, runner, killServices, killDaemon })`. `killDaemon` is a callback (Phase 2 stub returns `{ killed: false }`). `killServices` boolean: when true, kill the tmux window.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/dev-orchestrator-stop.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { stopDev } from '../../bin/lib/dev-orchestrator/stop.mjs';

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
      killDaemon: () => { daemonKilled++; return { killed: true, pid: 9999 }; }
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
      killDaemon: () => ({ killed: false })
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
      killDaemon: () => ({ killed: false })
    });
    assert.equal(out.daemon.killed, false);
  });
});
```

- [ ] **Step 2: Run — confirm fail**

```bash
node --test tests/unit/dev-orchestrator-stop.test.mjs
```

Expected: `Cannot find module .../stop.mjs`.

- [ ] **Step 3: Implement**

```javascript
// bin/lib/dev-orchestrator/stop.mjs
//
// Implements /jlu:stop-dev. Phase 2 version stubs out daemon-kill via a
// callback; Phase 3 will wire in the real PID-file/SIGTERM logic.

import { killWindow } from './tmux.mjs';

function windowNameFor(slug) {
  return `jlu-dev-${slug || '_global'}`;
}

export function stopDev({
  workspaceId, slug,
  runner,
  killServices = false,
  killDaemon = () => ({ killed: false })
}) {
  const daemon = killDaemon({ workspaceId, slug });
  const windowResult = { killed: false };
  if (killServices) {
    const target = windowNameFor(slug);
    killWindow({ target }, runner);
    windowResult.killed = true;
    windowResult.target = target;
  }
  return { daemon, window: windowResult };
}
```

- [ ] **Step 4: Run — confirm pass**

```bash
node --test tests/unit/dev-orchestrator-stop.test.mjs
npm test
```

Expected: 3 stop tests pass; full suite 225.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/dev-orchestrator-stop.test.mjs bin/lib/dev-orchestrator/stop.mjs
git commit -m "feat(dev-orchestrator/stop): stop-dev orchestrator (no daemon kill yet) [skip-bump]"
```

---

## Task 7: start-dev workflow + skill + opencode mirror

**Files:**
- Create: `jelou/workflows/start-dev.md`
- Create: `skills/start-dev/SKILL.md`
- Create: `.opencode/commands/jlu-start-dev.md`

These three land in ONE commit (harness-parity test asserts each skill has matching workflow + opencode command).

The workflow file invokes the start.mjs orchestrator via small `node -e` snippets. Use the same shape as Phase 1 register-service workflow.

- [ ] **Step 1: Create the workflow** — content described below; copy verbatim:

````markdown
# /jlu:start-dev Workflow

> Purpose: Launch all registered services in a TMUX window dedicated to the active task slug.

Inputs:
- `cwd`: the user's current working directory.

## Step 1 — Resolve workspace and config

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs').then(({ resolveWorkspace }) => {
  process.stdout.write(JSON.stringify(resolveWorkspace(process.argv[1])));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

Capture `{ root, configPath, workspaceId }`. If `NO_WORKSPACE`, surface:

> `No workspace root. Run /jlu:register-service first to create jlu-services.json.`

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs').then(({ readConfig }) => {
  process.stdout.write(JSON.stringify(readConfig(process.argv[1])));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{configPath}"
```

If `readConfig` throws (file missing), surface: `No services registered yet. Run /jlu:register-service.` and stop.

## Step 2 — Resolve task slug

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/task-context.mjs').then(({ resolveTaskSlug }) => {
  const slug = resolveTaskSlug({ workspaceRoot: process.argv[1], cwd: process.argv[2] });
  process.stdout.write(slug);
});
" "{root}" "{cwd}"
```

If output starts with `AMBIGUOUS:`, parse the comma-separated list and use `question` (single-choice) to ask the user which task to use. Append `_global` as a "no task" option.

## Step 3 — Verify tmux availability

```bash
tmux -V || echo "TMUX_MISSING"
```

If `TMUX_MISSING`, surface: `tmux is required. Install: brew install tmux (macOS) / apt install tmux (Linux).` Stop.

## Step 4 — Plan the start (dry-run preview)

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/start.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs')
]).then(([s, c]) => {
  const cfg = c.readConfig(process.argv[1]);
  const plan = s.planStart({ config: cfg, workspaceRoot: process.argv[2], slug: process.argv[3] });
  process.stdout.write(JSON.stringify(plan));
});
" "{configPath}" "{root}" "{slug}"
```

Display: window name, layout, list of panes (name + cwd + first 60 chars of command). If `plan.skipped` is non-empty, list those services and the reason.

## Step 5 — Confirm and execute

Use `question` (single-choice): `"Start dev environment in window '{plan.windowName}'?"` with options `start` / `cancel`.

If cancel: print `Cancelled. No changes made.` and stop.

If start, run startDev:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/start.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs')
]).then(([s, c]) => {
  const cfg = c.readConfig(process.argv[1]);
  const out = s.startDev({
    config: cfg,
    workspaceRoot: process.argv[2],
    slug: process.argv[3],
    env: process.env
  });
  process.stdout.write(JSON.stringify(out));
});
" "{configPath}" "{root}" "{slug}"
```

## Step 6 — Report

Capture the JSON output.

- If `status: "tmux-missing"`, that should already have been caught at Step 3; surface as an error.
- If `status: "exists"`, ask via `question`: `"Window '{name}' already exists. (a) reuse and exit, (b) kill-and-restart, (c) cancel"`. On (b), kill the window via Bash (`tmux kill-window -t <name>`) and re-run Step 5.
- If `status: "created"`, print: `Started <paneCount> services in TMUX window '<windowName>' (layout: <layout>). Daemon will be wired in Phase 3.`

If `skipped` is non-empty, list the skipped services with reasons.

## Notes

- Phase 2 deliberately does NOT spawn a daemon. The `daemonSpawn` callback in `startDev` defaults to a stub returning `{ pid: 0 }`. Phase 3 will wire in the real daemon.
- Use `/jlu-start-dev` in messages (works for both runtimes).
- If the user is not inside tmux, the orchestrator creates a default `jlu-dev` session. The user may need to `tmux attach -t jlu-dev` afterwards.
````

- [ ] **Step 2: Create skill**

````markdown
---
name: start-dev
description: Use to launch all registered services in a TMUX window dedicated to the active task slug. Triggers "start dev", "boot services", "launch dev environment"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - ToolSearch
---

You are the orchestrator for the `/jlu:start-dev` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory.
2. `~/.claude/jelou/`.

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names: `question` → `AskUserQuestion`, `task` → `Agent` (not used). Never narrate questions as plain text.

**Run these in parallel** (single tool-call message):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/start-dev.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1).

**Update banner.** If output starts with `UPDATE_AVAILABLE`, print it and continue.

**ToolSearch fallback.** If `AskUserQuestion` unavailable, fall back to plain text and warn user.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT spawn a sub-agent. The current working directory is `{cwd}`.
````

- [ ] **Step 3: Create OpenCode mirror**

```markdown
---
description: Launch all registered services in a TMUX window for the active task
agent: build
---
Execute this workflow exactly: @jelou/workflows/start-dev.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Use `task` for subagent dispatches (not used in this workflow).
Always reference commands with the `jlu-` prefix (never `jlu:`).
```

- [ ] **Step 4: Verify and commit**

```bash
npm test
git add jelou/workflows/start-dev.md skills/start-dev/SKILL.md .opencode/commands/jlu-start-dev.md
git commit -m "feat(start-dev): workflow + skill + opencode command [skip-bump]"
```

Expected: harness-parity green; suite at 225/225.

---

## Task 8: stop-dev workflow + skill + opencode mirror

**Files:**
- Create: `jelou/workflows/stop-dev.md`
- Create: `skills/stop-dev/SKILL.md`
- Create: `.opencode/commands/jlu-stop-dev.md`

- [ ] **Step 1: Workflow**

````markdown
# /jlu:stop-dev Workflow

> Purpose: Stop the daemon (no-op in Phase 2) and optionally kill the TMUX window.

Inputs:
- `argument`: optional `--kill-services` flag.

## Step 1 — Resolve workspace + slug

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/task-context.mjs')
]).then(([w, t]) => {
  const ws = w.resolveWorkspace(process.argv[1]);
  const slug = t.resolveTaskSlug({ workspaceRoot: ws.root, cwd: process.argv[1] });
  process.stdout.write(JSON.stringify({ ws, slug }));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

If `slug` starts with `AMBIGUOUS:`, prompt the user to disambiguate. If `_global`, proceed.

## Step 2 — Confirm scope

If argument is `--kill-services`, skip the prompt and use `killServices: true`.
Otherwise use `question` (single-choice): `"Stop dev environment for '<slug>'? (a) keep services running, (b) kill TMUX window too, (c) cancel"`.

If cancel, print `Cancelled.` and stop.

## Step 3 — Execute stop

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stop.mjs').then(({ stopDev }) => {
  const out = stopDev({
    workspaceId: process.argv[1],
    slug: process.argv[2],
    killServices: process.argv[3] === 'true'
  });
  process.stdout.write(JSON.stringify(out));
});
" "{workspaceId}" "{slug}" "{killServices}"
```

## Step 4 — Report

Print:
> `Stopped jlu-dev for '{slug}'. Daemon: <killed|not-running>. Window: <killed|kept>.`

## Notes

- Phase 2: daemon is not yet alive, so killDaemon is a no-op.
- `/jlu-stop-dev --kill-services` is the non-interactive shortcut.
````

- [ ] **Step 2: Skill**

````markdown
---
name: stop-dev
description: Use to stop the dev environment daemon and optionally close the TMUX window. Triggers "stop dev", "tear down services", "close dev environment"
argument-hint: "[--kill-services]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - ToolSearch
---

You are the orchestrator for the `/jlu:stop-dev` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory.
2. `~/.claude/jelou/`.

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** Workflow uses `question` → `AskUserQuestion`. Never narrate as plain text.

**Run these in parallel:**
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/stop-dev.md`
3. `ToolSearch`: `select:AskUserQuestion`.

**Update banner / ToolSearch fallback** as in other skills.

## Phase 2 — Execute Workflow

Follow the workflow inline. Argument is `{argument}`. Cwd is `{cwd}`.
````

- [ ] **Step 3: OpenCode mirror**

```markdown
---
description: Stop the dev environment daemon and optionally close the TMUX window
agent: build
---
Execute this workflow exactly: @jelou/workflows/stop-dev.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Always reference commands with the `jlu-` prefix.
```

- [ ] **Step 4: Verify and commit**

```bash
npm test
git add jelou/workflows/stop-dev.md skills/stop-dev/SKILL.md .opencode/commands/jlu-stop-dev.md
git commit -m "feat(stop-dev): workflow + skill + opencode command [skip-bump]"
```

Expected: harness-parity green; suite at 225/225.

---

## Task 9: Smoke verification

**Files:** none (verification only).

- [ ] **Step 1: Run unit + integration**

```bash
npm test
node --test tests/integration/dev-orchestrator/tmux.test.mjs
```

Expected: unit 225/225, integration 4/4 (or skipped if tmux missing).

- [ ] **Step 2: Programmatic dry-run of planStart against the plugin's own repo**

```bash
node -e "
import('./bin/lib/dev-orchestrator/start.mjs').then(({ planStart }) => {
  const cfg = { version: 1, services: [
    { name: 'plugin-tests', path: '.', command: 'npm test' }
  ]};
  console.log(JSON.stringify(planStart({ config: cfg, workspaceRoot: process.cwd(), slug: '_global' }), null, 2));
});
"
```

Expected: a plan with one pane, layout `single-pane`, panes[0].command starts with `cd /home/...`.

- [ ] **Step 3: Manual interactive smoke (user-driven)**

In a fresh Claude Code session (or OpenCode):
1. Make a scratch workspace: `mkdir -p /tmp/jlu-p2-smoke/api && cd /tmp/jlu-p2-smoke/api && echo '{}' > package.json`.
2. Run `/jlu:register-service api`. Step through the interview.
3. Run `/jlu:start-dev`. Confirm a TMUX window is created with the api service.
4. `tmux list-windows` should show the new window.
5. Run `/jlu:stop-dev` and choose "kill window".
6. Verify the window is gone.
7. Cleanup: `rm -rf /tmp/jlu-p2-smoke`.

This step is for the user — do not commit anything.

---

## Self-Review (before declaring Phase 2 done)

**Spec coverage:**

| Spec section | Implemented in |
|---|---|
| TMUX wrapper API | Tasks 1–2 (tmux.mjs) |
| Real-tmux integration coverage | Task 3 |
| `start-dev` core (layout, plan, side effects) | Tasks 4–5 (start.mjs) |
| `stop-dev` core | Task 6 (stop.mjs) |
| start-dev runtime trio | Task 7 |
| stop-dev runtime trio | Task 8 |
| Phase 2 boundary (no daemon yet, callbacks stubbed) | Tasks 5, 6 (`daemonSpawn`/`killDaemon` callbacks) |

**Placeholder scan:** zero hits expected for `TBD`, `TODO`, "fill in".

**Type consistency:** `daemonSpawn(opts)` returns `{ pid }`. `killDaemon(opts)` returns `{ killed, pid? }`. Phase 3 daemon module exports must match these shapes.

**Boundary respected:** `start.mjs` and `stop.mjs` have no internal references to PID files, flock, or `~/.jlu/` paths. Those land in Phase 3.

---

## Branch handoff

After Task 9:
- Branch is still `feature/dev-orchestrator`.
- Suite at 225/225 (Phase 1: 196 + Phase 2: 14 tmux + 12 start + 3 stop = 225).
- Around 7 new commits in Phase 2.
- No PR opened yet (planned for end of Phase 5).

Next: invoke the Phase 3 plan (`docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase3-daemon.md`). Do NOT merge or push — work continues on this branch.
