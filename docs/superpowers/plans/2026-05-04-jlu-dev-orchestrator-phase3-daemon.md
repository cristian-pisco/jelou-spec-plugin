# JLU Dev Orchestrator — Phase 3 (Daemon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the long-running monitor daemon that watches the TMUX window created by `/jlu:start-dev`, detects pane death, log-pattern matches, and readiness failures, writes structured events to `dev-events.log`, and fires OS notifications for hard failures. Wire the daemon spawn/kill callbacks (stubbed in Phase 2) into the real implementations. Add `/jlu:add-failure-pattern` for the live-edit-and-SIGHUP flow.

**Architecture:** A new long-running Node script `bin/lib/dev-orchestrator/daemon.mjs` runs detached, polls TMUX every `poll_interval_ms`, diffs pane captures, runs HTTP/TCP probes, and appends JSONL events. PID + flock files live under `~/.jlu/workspaces/<id>/<slug>/`. SIGHUP triggers config reload; SIGTERM triggers graceful exit. Notifications are dispatched via `notify-send` (Linux) or `osascript` (macOS) with cooldown. The `start.mjs` and `stop.mjs` orchestrators from Phase 2 are amended to pass real callbacks.

**Tech Stack:** Node 20+ ESM. `node:test`. No new deps. `node:net` for TCP probes, `node:http`/`node:https` for HTTP probes. `node:child_process` `spawn` for detached daemon launch. POSIX `flock(2)` via a tiny helper script (or `proper-lockfile`-style file existence + PID-liveness check — we will use the latter for zero deps).

**Spec:** `docs/superpowers/specs/2026-05-04-jlu-dev-orchestrator-design.md` § "Daemon"
**Phase 1 plan:** `docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator.md`
**Phase 2 plan:** `docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase2-tmux.md`

**Branch:** `feature/dev-orchestrator` (continues from Phase 2). Same single PR.

**Phase 3 deliverable:** Running `/jlu:start-dev` spawns a real daemon. The daemon writes events to `~/.jlu/workspaces/<id>/<slug>/dev-events.log`. `/jlu:stop-dev` kills it cleanly. `/jlu:add-failure-pattern` updates the JSON and SIGHUPs the daemon.

---

## Pre-flight (before Task 1)

```bash
git status --short
git rev-parse --abbrev-ref HEAD     # must be feature/dev-orchestrator
npm test                            # must be 225/225 (Phase 2 baseline)
which notify-send 2>/dev/null || which osascript 2>/dev/null || echo "notifier missing (warn only)"
```

If suite is red, stop and surface to user.

---

## File Structure (Phase 3)

### Files to CREATE

| Path | Responsibility |
|------|---------------|
| `bin/lib/dev-orchestrator/state-daemon.mjs` | PID + lock file primitives — write/read PID, take lock, release lock, check liveness |
| `bin/lib/dev-orchestrator/readiness.mjs` | HTTP and TCP probes with timeouts |
| `bin/lib/dev-orchestrator/patterns-matcher.mjs` | Compile patterns, match new lines from a capture diff, cooldown logic |
| `bin/lib/dev-orchestrator/notify.mjs` | OS notifications via `notify-send` / `osascript` with per-(service,type) cooldown |
| `bin/lib/dev-orchestrator/events.mjs` | JSONL writer for `dev-events.log`; event type constants |
| `bin/lib/dev-orchestrator/daemon-spawn.mjs` | Spawn detached daemon; expose `daemonSpawn` / `killDaemon` callbacks |
| `bin/lib/dev-orchestrator/daemon.mjs` | Long-running monitor process |
| `bin/lib/dev-orchestrator/patterns.mjs` | Implements `/jlu:add-failure-pattern`: append regex, validate, write, SIGHUP |
| `jelou/workflows/add-failure-pattern.md` | Workflow |
| `skills/add-failure-pattern/SKILL.md` | Claude Code launcher |
| `.opencode/commands/jlu-add-failure-pattern.md` | OpenCode mirror |
| `tests/unit/dev-orchestrator-state-daemon.test.mjs` | Unit tests for PID/lock primitives |
| `tests/unit/dev-orchestrator-readiness.test.mjs` | HTTP/TCP probe tests with mock servers |
| `tests/unit/dev-orchestrator-patterns-matcher.test.mjs` | Pattern matching + cooldown tests |
| `tests/unit/dev-orchestrator-notify.test.mjs` | Notification dispatch tests with fake runner |
| `tests/unit/dev-orchestrator-events.test.mjs` | JSONL writer tests |
| `tests/unit/dev-orchestrator-patterns.test.mjs` | add-failure-pattern core tests |
| `tests/integration/dev-orchestrator/daemon.test.mjs` | Real-tmux daemon E2E test |

### Files to MODIFY

| Path | Change |
|------|--------|
| `bin/lib/dev-orchestrator/start.mjs` | Default `daemonSpawn` to the real one from `daemon-spawn.mjs` |
| `bin/lib/dev-orchestrator/stop.mjs` | Default `killDaemon` to the real one + truncate `dev-events.log` |

### Coding rules

- Node 20+ ESM. No new deps.
- All child-process calls via `spawnSync` / `spawn` with array args (no shell).
- Tests FLAT in `tests/unit/`. Integration tests under `tests/integration/dev-orchestrator/`.
- Every commit ends with `[skip-bump]`.

---

## Task 1: state-daemon.mjs — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-state-daemon.test.mjs`
- Create: `bin/lib/dev-orchestrator/state-daemon.mjs`

Required exports:

- `pidFilePath({ workspaceId, slug, baseDir })` joined to `<state-dir>/daemon.pid`.
- `lockFilePath({ workspaceId, slug, baseDir })` joined to `<state-dir>/daemon.lock`.
- `eventsLogPath({ workspaceId, slug, baseDir })` joined to `<state-dir>/dev-events.log`.
- `daemonStderrPath({ workspaceId, slug, baseDir })` joined to `<state-dir>/daemon.stderr`.
- `windowNameFilePath(...)` joined to `<state-dir>/window-name`.
- `paneMapPath(...)` joined to `<state-dir>/pane-map.json`.
- `acquireLock(opts)` returns `{ acquired, holderPid }`. Behavior:
  - If lock file does not exist: write `{ pid: process.pid, ts: ISO }` and return `{ acquired: true }`.
  - If exists: read it; if the holder PID is not alive (verified via `kill(pid, 0)`), overwrite (stale lock) and return `{ acquired: true, takenOver: true }`.
  - If holder is alive: return `{ acquired: false, holderPid }`.
- `releaseLock(opts)` deletes the lock file if owned by current process; safe no-op otherwise.
- `writePid(opts, pid)` writes `<pid>\n` to the PID file.
- `readPid(opts)` returns the integer or `null` if missing/unreadable.
- `isAlive(pid)` returns boolean using `process.kill(pid, 0)`.
- `truncateEventsLog(opts)` truncates the file (preserves inode for tailers).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/dev-orchestrator-state-daemon.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pidFilePath, lockFilePath, eventsLogPath, daemonStderrPath, windowNameFilePath, paneMapPath,
  acquireLock, releaseLock, writePid, readPid, isAlive, truncateEventsLog
} from '../../bin/lib/dev-orchestrator/state-daemon.mjs';

function mkbase() { return mkdtempSync(join(tmpdir(), 'jlu-dst-')); }

describe('path helpers', () => {
  test('all paths land under workspaces/<id>/<slug>/', () => {
    const base = mkbase();
    const opts = { workspaceId: 'wid', slug: 'foo', baseDir: base };
    assert.equal(pidFilePath(opts), join(base, 'workspaces', 'wid', 'foo', 'daemon.pid'));
    assert.equal(lockFilePath(opts), join(base, 'workspaces', 'wid', 'foo', 'daemon.lock'));
    assert.equal(eventsLogPath(opts), join(base, 'workspaces', 'wid', 'foo', 'dev-events.log'));
    assert.equal(daemonStderrPath(opts), join(base, 'workspaces', 'wid', 'foo', 'daemon.stderr'));
    assert.equal(windowNameFilePath(opts), join(base, 'workspaces', 'wid', 'foo', 'window-name'));
    assert.equal(paneMapPath(opts), join(base, 'workspaces', 'wid', 'foo', 'pane-map.json'));
    rmSync(base, { recursive: true, force: true });
  });
});

describe('isAlive + readPid + writePid', () => {
  test('current process is alive', () => {
    assert.equal(isAlive(process.pid), true);
  });
  test('absurd PID is not alive', () => {
    assert.equal(isAlive(2147483600), false);
  });
  test('writePid + readPid round-trip', () => {
    const base = mkbase();
    const opts = { workspaceId: 'wid', slug: 'foo', baseDir: base };
    writePid(opts, 4242);
    assert.equal(readPid(opts), 4242);
    rmSync(base, { recursive: true, force: true });
  });
  test('readPid returns null when missing', () => {
    const base = mkbase();
    const opts = { workspaceId: 'wid', slug: 'foo', baseDir: base };
    assert.equal(readPid(opts), null);
    rmSync(base, { recursive: true, force: true });
  });
});

describe('acquireLock / releaseLock', () => {
  test('acquires when no lock exists', () => {
    const base = mkbase();
    const opts = { workspaceId: 'wid', slug: 'foo', baseDir: base };
    const r = acquireLock(opts);
    assert.equal(r.acquired, true);
    assert.equal(existsSync(lockFilePath(opts)), true);
    releaseLock(opts);
    assert.equal(existsSync(lockFilePath(opts)), false);
    rmSync(base, { recursive: true, force: true });
  });

  test('refuses when current pid holds the lock', () => {
    const base = mkbase();
    const opts = { workspaceId: 'wid', slug: 'foo', baseDir: base };
    writeFileSync(lockFilePath(opts), JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
    // ensure parent dir exists
    const r = acquireLock(opts);
    // The holder is "alive" (us), so should refuse.
    assert.equal(r.acquired, false);
    assert.equal(r.holderPid, process.pid);
    rmSync(base, { recursive: true, force: true });
  });

  test('takes over a stale lock (holder dead)', () => {
    const base = mkbase();
    const opts = { workspaceId: 'wid', slug: 'foo', baseDir: base };
    // Build the parent dir + lock.
    writeFileSync(lockFilePath(opts), JSON.stringify({ pid: 2147483600, ts: '2026-01-01T00:00:00Z' }));
    const r = acquireLock(opts);
    assert.equal(r.acquired, true);
    assert.equal(r.takenOver, true);
    rmSync(base, { recursive: true, force: true });
  });
});

describe('truncateEventsLog', () => {
  test('truncates file in place', () => {
    const base = mkbase();
    const opts = { workspaceId: 'wid', slug: 'foo', baseDir: base };
    writeFileSync(eventsLogPath(opts), 'event1\nevent2\n');
    truncateEventsLog(opts);
    assert.equal(readFileSync(eventsLogPath(opts), 'utf8'), '');
    rmSync(base, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test — confirm fail**

```bash
node --test tests/unit/dev-orchestrator-state-daemon.test.mjs
```

Expected: `Cannot find module .../state-daemon.mjs`.

- [ ] **Step 3: Implement**

```javascript
// bin/lib/dev-orchestrator/state-daemon.mjs
//
// PID + lock + log-path primitives for the dev-orchestrator daemon.
// Builds on state.mjs's directory layout but adds daemon-specific files.

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, truncateSync } from 'node:fs';
import { dirname } from 'node:path';
import { stateDir } from './state.mjs';

function fileIn(opts, name) {
  return stateDir(opts) + '/' + name;
}

export function pidFilePath(opts) { return fileIn(opts, 'daemon.pid'); }
export function lockFilePath(opts) { return fileIn(opts, 'daemon.lock'); }
export function eventsLogPath(opts) { return fileIn(opts, 'dev-events.log'); }
export function daemonStderrPath(opts) { return fileIn(opts, 'daemon.stderr'); }
export function windowNameFilePath(opts) { return fileIn(opts, 'window-name'); }
export function paneMapPath(opts) { return fileIn(opts, 'pane-map.json'); }

function ensureParent(p) {
  mkdirSync(dirname(p), { recursive: true });
}

export function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function readPid(opts) {
  const p = pidFilePath(opts);
  if (!existsSync(p)) return null;
  try {
    const s = readFileSync(p, 'utf8').trim();
    const n = parseInt(s, 10);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

export function writePid(opts, pid) {
  const p = pidFilePath(opts);
  ensureParent(p);
  writeFileSync(p, String(pid) + '\n', 'utf8');
}

export function acquireLock(opts) {
  const p = lockFilePath(opts);
  ensureParent(p);
  if (existsSync(p)) {
    let holder = null;
    try { holder = JSON.parse(readFileSync(p, 'utf8')); } catch { holder = null; }
    if (holder && Number.isInteger(holder.pid) && isAlive(holder.pid)) {
      return { acquired: false, holderPid: holder.pid };
    }
    // Stale — take over.
    writeFileSync(p, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }), 'utf8');
    return { acquired: true, takenOver: true };
  }
  writeFileSync(p, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }), 'utf8');
  return { acquired: true };
}

export function releaseLock(opts) {
  const p = lockFilePath(opts);
  if (!existsSync(p)) return;
  try {
    const holder = JSON.parse(readFileSync(p, 'utf8'));
    if (holder && holder.pid === process.pid) rmSync(p, { force: true });
  } catch {
    // ignore parse errors — leave the file
  }
}

export function truncateEventsLog(opts) {
  const p = eventsLogPath(opts);
  if (!existsSync(p)) return;
  truncateSync(p, 0);
}
```

- [ ] **Step 4: Run + commit**

```bash
node --test tests/unit/dev-orchestrator-state-daemon.test.mjs
npm test
git add bin/lib/dev-orchestrator/state-daemon.mjs tests/unit/dev-orchestrator-state-daemon.test.mjs
git commit -m "feat(dev-orchestrator/state-daemon): PID/lock/path primitives [skip-bump]"
```

---

## Task 2: readiness.mjs — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-readiness.test.mjs`
- Create: `bin/lib/dev-orchestrator/readiness.mjs`

Required exports:

- `probeHttp({ url, expectStatus = 200, timeoutMs = 1000 })` returns Promise resolving `{ ok: boolean, status?: number, error?: string }`.
- `probeTcp({ host, port, timeoutMs = 1000 })` returns Promise resolving `{ ok: boolean, error?: string }`.

Both probes must time out cleanly (no hanging sockets).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/dev-orchestrator-readiness.test.mjs
import { test, describe, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { probeHttp, probeTcp } from '../../bin/lib/dev-orchestrator/readiness.mjs';

let httpServer, tcpServer, httpPort, tcpPort;

before(async () => {
  await new Promise((resolve) => {
    httpServer = createHttpServer((req, res) => {
      if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
      if (req.url === '/notyet') { res.writeHead(503); res.end('busy'); return; }
      res.writeHead(404); res.end();
    }).listen(0, '127.0.0.1', () => { httpPort = httpServer.address().port; resolve(); });
  });
  await new Promise((resolve) => {
    tcpServer = createNetServer((s) => s.end()).listen(0, '127.0.0.1', () => { tcpPort = tcpServer.address().port; resolve(); });
  });
});

after(async () => {
  await new Promise(r => httpServer.close(r));
  await new Promise(r => tcpServer.close(r));
});

describe('probeHttp', () => {
  test('returns ok when status matches', async () => {
    const out = await probeHttp({ url: `http://127.0.0.1:${httpPort}/health` });
    assert.equal(out.ok, true);
    assert.equal(out.status, 200);
  });
  test('returns not-ok when status differs', async () => {
    const out = await probeHttp({ url: `http://127.0.0.1:${httpPort}/notyet`, expectStatus: 200 });
    assert.equal(out.ok, false);
    assert.equal(out.status, 503);
  });
  test('returns not-ok on connection refused', async () => {
    const out = await probeHttp({ url: 'http://127.0.0.1:1', timeoutMs: 500 });
    assert.equal(out.ok, false);
    assert.ok(out.error);
  });
  test('returns not-ok on timeout', async () => {
    // Connect to a non-routable address; no server. Should time out.
    const out = await probeHttp({ url: 'http://10.255.255.1:81/health', timeoutMs: 200 });
    assert.equal(out.ok, false);
    assert.ok(out.error);
  });
});

describe('probeTcp', () => {
  test('returns ok when port is open', async () => {
    const out = await probeTcp({ host: '127.0.0.1', port: tcpPort, timeoutMs: 500 });
    assert.equal(out.ok, true);
  });
  test('returns not-ok when port is closed', async () => {
    const out = await probeTcp({ host: '127.0.0.1', port: 1, timeoutMs: 500 });
    assert.equal(out.ok, false);
    assert.ok(out.error);
  });
});
```

- [ ] **Step 2: Confirm fail, then implement**

```javascript
// bin/lib/dev-orchestrator/readiness.mjs
//
// HTTP and TCP readiness probes with timeouts. No external deps.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Socket } from 'node:net';

export function probeHttp({ url, expectStatus = 200, timeoutMs = 1000 }) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch (e) { return resolve({ ok: false, error: 'bad-url' }); }
    const requestFn = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const opts = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: (parsed.pathname || '/') + (parsed.search || ''),
      timeout: timeoutMs
    };
    const req = requestFn(opts, (res) => {
      const ok = res.statusCode === expectStatus;
      // Drain to free the socket.
      res.resume();
      resolve({ ok, status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.end();
  });
}

export function probeTcp({ host, port, timeoutMs = 1000 }) {
  return new Promise((resolve) => {
    const sock = new Socket();
    let done = false;
    const finish = (out) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(out); };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish({ ok: true }));
    sock.on('timeout', () => finish({ ok: false, error: 'timeout' }));
    sock.on('error', (err) => finish({ ok: false, error: err.message }));
    sock.connect(port, host);
  });
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/unit/dev-orchestrator-readiness.test.mjs
npm test
git add bin/lib/dev-orchestrator/readiness.mjs tests/unit/dev-orchestrator-readiness.test.mjs
git commit -m "feat(dev-orchestrator/readiness): HTTP and TCP probes with timeouts [skip-bump]"
```

---

## Task 3: patterns-matcher.mjs — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-patterns-matcher.test.mjs`
- Create: `bin/lib/dev-orchestrator/patterns-matcher.mjs`

Required exports:

- `compilePatterns(strings)` returns array of `{ src, regex }` (case-insensitive).
- `matchLines(compiled, newLines)` returns array of `{ pattern, line }` for each match.
- `Cooldown(seconds)` factory returning `{ allow(key), reset() }`. `allow` returns `true` if no entry for `key`, or if last entry is older than `seconds`. Records the new ts internally.

- [ ] **Step 1: Test**

```javascript
// tests/unit/dev-orchestrator-patterns-matcher.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { compilePatterns, matchLines, Cooldown } from '../../bin/lib/dev-orchestrator/patterns-matcher.mjs';

describe('compilePatterns', () => {
  test('compiles each string with i flag', () => {
    const c = compilePatterns(['EADDRINUSE', 'cannot find module']);
    assert.equal(c.length, 2);
    assert.ok(c[0].regex.test('something EADDRINUSE happened'));
    assert.ok(c[1].regex.test('Error: Cannot find module ...'));
  });
  test('throws on bad regex', () => {
    assert.throws(() => compilePatterns(['[unclosed']));
  });
});

describe('matchLines', () => {
  test('returns one entry per match', () => {
    const c = compilePatterns(['EADDRINUSE', 'cannot find module']);
    const hits = matchLines(c, [
      'starting',
      'Error: EADDRINUSE: address already in use',
      'Error: Cannot find module foo',
      'unrelated'
    ]);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].pattern, 'EADDRINUSE');
    assert.equal(hits[1].pattern, 'cannot find module');
  });

  test('matches multiple patterns on the same line', () => {
    const c = compilePatterns(['EADDRINUSE', 'address']);
    const hits = matchLines(c, ['Error: EADDRINUSE address']);
    assert.equal(hits.length, 2);
  });
});

describe('Cooldown', () => {
  test('allows first call, blocks within window', () => {
    const cd = Cooldown(60);
    assert.equal(cd.allow('a:hard'), true);
    assert.equal(cd.allow('a:hard'), false);
    assert.equal(cd.allow('a:soft'), true);  // different key
  });
  test('reset clears all keys', () => {
    const cd = Cooldown(60);
    cd.allow('x');
    cd.reset();
    assert.equal(cd.allow('x'), true);
  });
});
```

- [ ] **Step 2: Implementation**

```javascript
// bin/lib/dev-orchestrator/patterns-matcher.mjs
//
// Compile + match log-failure patterns. Cooldown for notification dedup.

export function compilePatterns(strings) {
  return strings.map((src) => ({ src, regex: new RegExp(src, 'i') }));
}

export function matchLines(compiled, newLines) {
  const out = [];
  for (const line of newLines) {
    for (const { src, regex } of compiled) {
      if (regex.test(line)) out.push({ pattern: src, line });
    }
  }
  return out;
}

export function Cooldown(seconds) {
  const map = new Map();
  const windowMs = seconds * 1000;
  return {
    allow(key) {
      const now = Date.now();
      const last = map.get(key);
      if (last !== undefined && now - last < windowMs) return false;
      map.set(key, now);
      return true;
    },
    reset() { map.clear(); }
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/unit/dev-orchestrator-patterns-matcher.test.mjs
npm test
git add bin/lib/dev-orchestrator/patterns-matcher.mjs tests/unit/dev-orchestrator-patterns-matcher.test.mjs
git commit -m "feat(dev-orchestrator/patterns-matcher): compile + match + cooldown [skip-bump]"
```

---

## Task 4: notify.mjs — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-notify.test.mjs`
- Create: `bin/lib/dev-orchestrator/notify.mjs`

Required exports:

- `notifyOs({ title, body, urgency = 'normal', runner, platform = process.platform, hasNotifySend = null })` invokes `notify-send` (Linux) or `osascript` (macOS) via `runner`. If neither available, returns `{ delivered: false, reason: 'no-notifier' }`.
- `runner` mirrors the tmux wrapper interface (records calls).
- Detect `notify-send`/`osascript` availability via `runner(['-V'])` style probe, or accept a `hasNotifySend`/`hasOsascript` boolean injection for tests.

- [ ] **Step 1: Test**

```javascript
// tests/unit/dev-orchestrator-notify.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { notifyOs } from '../../bin/lib/dev-orchestrator/notify.mjs';

function fakeRunner(handlers = {}) {
  const calls = [];
  const fn = (cmd, args) => {
    calls.push({ cmd, args: [...args] });
    if (typeof handlers[cmd] === 'function') return handlers[cmd](args);
    return { status: 0, stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

describe('notifyOs — Linux', () => {
  test('calls notify-send with -u + title + body', () => {
    const r = fakeRunner();
    const out = notifyOs({ title: 't', body: 'b', urgency: 'critical', platform: 'linux', runner: r, hasNotifySend: true });
    assert.equal(out.delivered, true);
    const call = r.calls[0];
    assert.equal(call.cmd, 'notify-send');
    assert.ok(call.args.includes('-u'));
    assert.ok(call.args.includes('critical'));
    assert.ok(call.args.includes('t'));
    assert.ok(call.args.includes('b'));
  });

  test('returns no-notifier when notify-send unavailable', () => {
    const r = fakeRunner();
    const out = notifyOs({ title: 't', body: 'b', platform: 'linux', runner: r, hasNotifySend: false });
    assert.equal(out.delivered, false);
    assert.equal(out.reason, 'no-notifier');
  });
});

describe('notifyOs — macOS', () => {
  test('calls osascript with display notification', () => {
    const r = fakeRunner();
    const out = notifyOs({ title: 't', body: 'b', platform: 'darwin', runner: r });
    assert.equal(out.delivered, true);
    const call = r.calls[0];
    assert.equal(call.cmd, 'osascript');
    const joined = call.args.join(' ');
    assert.ok(joined.includes('display notification'));
    assert.ok(joined.includes('"t"'));
    assert.ok(joined.includes('"b"'));
  });
});

describe('notifyOs — unknown platform', () => {
  test('returns no-notifier on win32', () => {
    const r = fakeRunner();
    const out = notifyOs({ title: 't', body: 'b', platform: 'win32', runner: r });
    assert.equal(out.delivered, false);
    assert.equal(out.reason, 'no-notifier');
  });
});
```

- [ ] **Step 2: Implementation**

```javascript
// bin/lib/dev-orchestrator/notify.mjs
//
// OS-native notifications via notify-send (Linux) or osascript (macOS).
// Caller injects `runner` (cmd, args) -> { status, stdout, stderr } and may
// inject `hasNotifySend` for testing without spawning real binaries.

import { spawnSync } from 'node:child_process';

function defaultRunner(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function detectNotifySend(runner) {
  const r = runner('which', ['notify-send']);
  return r.status === 0 && (r.stdout || '').trim().length > 0;
}

function detectOsascript(runner) {
  const r = runner('which', ['osascript']);
  return r.status === 0 && (r.stdout || '').trim().length > 0;
}

export function notifyOs({
  title, body,
  urgency = 'normal',
  platform = process.platform,
  runner = defaultRunner,
  hasNotifySend = null,
  hasOsascript = null
}) {
  if (platform === 'linux') {
    const ok = hasNotifySend === null ? detectNotifySend(runner) : hasNotifySend;
    if (!ok) return { delivered: false, reason: 'no-notifier' };
    runner('notify-send', ['-u', urgency, title, body]);
    return { delivered: true };
  }
  if (platform === 'darwin') {
    const ok = hasOsascript === null ? detectOsascript(runner) : hasOsascript;
    if (!ok && hasOsascript === null) {
      // Probe failed; assume osascript exists on macOS by default but respect explicit false.
      // Fall through.
    }
    if (hasOsascript === false) return { delivered: false, reason: 'no-notifier' };
    const script = `display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
    runner('osascript', ['-e', script]);
    return { delivered: true };
  }
  return { delivered: false, reason: 'no-notifier' };
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/unit/dev-orchestrator-notify.test.mjs
npm test
git add bin/lib/dev-orchestrator/notify.mjs tests/unit/dev-orchestrator-notify.test.mjs
git commit -m "feat(dev-orchestrator/notify): OS-native notifications dispatch [skip-bump]"
```

---

## Task 5: events.mjs — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-events.test.mjs`
- Create: `bin/lib/dev-orchestrator/events.mjs`

Required exports:

- `EVENT_TYPES` constant: `daemon_started`, `pane_started`, `panes_changed`, `ready`, `daemon_reload`, `pattern_match`, `pane_dead`, `readiness_failed`.
- `SEVERITY` constant: `info`, `soft`, `hard`.
- `severityFor(type)` returns severity per the spec mapping.
- `appendEvent(absLogPath, evt)` writes one JSON line with newline. Auto-stamps `ts` if missing.

- [ ] **Step 1: Test**

```javascript
// tests/unit/dev-orchestrator-events.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVENT_TYPES, SEVERITY, severityFor, appendEvent } from '../../bin/lib/dev-orchestrator/events.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jlu-evt-')); }

describe('severityFor', () => {
  test('hard for pane_dead', () => assert.equal(severityFor('pane_dead'), SEVERITY.hard));
  test('hard for readiness_failed', () => assert.equal(severityFor('readiness_failed'), SEVERITY.hard));
  test('soft for pattern_match', () => assert.equal(severityFor('pattern_match'), SEVERITY.soft));
  test('info for ready', () => assert.equal(severityFor('ready'), SEVERITY.info));
});

describe('appendEvent', () => {
  test('writes one JSONL line', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    appendEvent(log, { service: 'api', type: EVENT_TYPES.pane_started });
    const body = readFileSync(log, 'utf8');
    const lines = body.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.service, 'api');
    assert.equal(parsed.type, 'pane_started');
    assert.ok(parsed.ts);
    rmSync(dir, { recursive: true, force: true });
  });

  test('appends a second line without truncating', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    appendEvent(log, { service: 'a', type: 'pane_started' });
    appendEvent(log, { service: 'a', type: 'ready' });
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Implementation**

```javascript
// bin/lib/dev-orchestrator/events.mjs
//
// JSONL writer + event type/severity constants for dev-events.log.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const EVENT_TYPES = Object.freeze({
  daemon_started: 'daemon_started',
  pane_started: 'pane_started',
  panes_changed: 'panes_changed',
  ready: 'ready',
  daemon_reload: 'daemon_reload',
  pattern_match: 'pattern_match',
  pane_dead: 'pane_dead',
  readiness_failed: 'readiness_failed'
});

export const SEVERITY = Object.freeze({
  info: 'info',
  soft: 'soft',
  hard: 'hard'
});

const SEVERITY_BY_TYPE = {
  daemon_started: SEVERITY.info,
  pane_started: SEVERITY.info,
  panes_changed: SEVERITY.info,
  ready: SEVERITY.info,
  daemon_reload: SEVERITY.info,
  pattern_match: SEVERITY.soft,
  pane_dead: SEVERITY.hard,
  readiness_failed: SEVERITY.hard
};

export function severityFor(type) {
  return SEVERITY_BY_TYPE[type] || SEVERITY.info;
}

export function appendEvent(absLogPath, evt) {
  const dir = dirname(absLogPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = { ts: evt.ts || new Date().toISOString(), severity: evt.severity || severityFor(evt.type), ...evt };
  appendFileSync(absLogPath, JSON.stringify(out) + '\n', 'utf8');
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/unit/dev-orchestrator-events.test.mjs
npm test
git add bin/lib/dev-orchestrator/events.mjs tests/unit/dev-orchestrator-events.test.mjs
git commit -m "feat(dev-orchestrator/events): JSONL event writer + type/severity constants [skip-bump]"
```

---

## Task 6: daemon.mjs — main loop (RED + GREEN)

**Files:**
- Create: `bin/lib/dev-orchestrator/daemon.mjs`

This is the long-running entry point. It does NOT have its own unit test — its behavior is exercised by the Phase 3 integration test (Task 9). The module's structure is:

```
parse argv → acquire lock → write PID → write window-name file
loop every poll_interval_ms:
  if window missing → emit daemon_stopping, release lock, exit 0
  list panes, diff vs previous → emit panes_changed if delta
  for each tracked service:
    if pane_dead → emit pane_dead (once); stop tracking
    capture-pane → diff lines → match patterns → emit pattern_match (with cooldown)
    if readiness declared and not yet ready:
      probe; pass → emit ready, mark ready
      timeout exceeded → emit readiness_failed, mark not-ready (won't retry)
  process pending signals: SIGHUP → reload config; SIGTERM → graceful exit
```

- [ ] **Step 1: Implement daemon.mjs**

```javascript
#!/usr/bin/env node
// bin/lib/dev-orchestrator/daemon.mjs
//
// Long-running monitor for /jlu:start-dev. Polls TMUX, diffs pane captures,
// runs readiness probes, and emits JSONL events.
//
// Argv: --workspace-id <id> --slug <slug> --window <name> --config <abs>
//
// Lifecycle:
//   - acquire lock; write PID
//   - emit daemon_started
//   - loop tick = defaults.poll_interval_ms
//   - SIGHUP → reload config → emit daemon_reload
//   - SIGTERM → release lock → emit daemon_stopping → exit 0
//   - if window disappears → release lock → exit 0

import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { listWindows, listPanes, capturePane } from './tmux.mjs';
import { effectiveDefaults, effectiveFailurePatterns, readConfig } from './config.mjs';
import {
  acquireLock, releaseLock, writePid,
  eventsLogPath, windowNameFilePath
} from './state-daemon.mjs';
import { compilePatterns, matchLines, Cooldown } from './patterns-matcher.mjs';
import { probeHttp, probeTcp } from './readiness.mjs';
import { notifyOs } from './notify.mjs';
import { appendEvent, EVENT_TYPES, severityFor, SEVERITY } from './events.mjs';

function parseArgv(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--workspace-id') out.workspaceId = argv[++i];
    else if (argv[i] === '--slug') out.slug = argv[++i];
    else if (argv[i] === '--window') out.windowName = argv[++i];
    else if (argv[i] === '--config') out.configPath = argv[++i];
  }
  return out;
}

function tmuxRunner(args, opts = {}) {
  return spawnSync('tmux', args, { encoding: 'utf8', ...opts });
}

function emit(logPath, evt) {
  appendEvent(logPath, evt);
}

function diffLines(prev, current) {
  if (!prev) return current.split(/\r?\n/);
  if (current.startsWith(prev)) return current.slice(prev.length).split(/\r?\n/).filter(Boolean);
  // Reset (capture rolled over) — treat all of `current` as new.
  return current.split(/\r?\n/);
}

async function tick(ctx) {
  const { logPath, opts, windowName, paneState, readyState, captures, cooldown, runtimeNotifier } = ctx;
  const wins = listWindows(tmuxRunner);
  if (!wins.find(w => w.name === windowName)) {
    emit(logPath, { type: 'daemon_stopping', slug: opts.slug, reason: 'window-gone' });
    return { stop: true };
  }

  const target = `${(wins.find(w => w.name === windowName).session)}:${windowName}`;
  const panes = listPanes({ window: target, runner: tmuxRunner });

  // Pane diff vs previous list.
  const prevTitles = Object.keys(paneState);
  const curTitles = panes.map(p => p.title);
  if (prevTitles.length && JSON.stringify(prevTitles.sort()) !== JSON.stringify(curTitles.sort())) {
    emit(logPath, {
      type: EVENT_TYPES.panes_changed,
      slug: opts.slug,
      added: curTitles.filter(t => !prevTitles.includes(t)),
      removed: prevTitles.filter(t => !curTitles.includes(t))
    });
  }

  // Per-pane processing.
  const cfg = ctx.config;
  for (const pane of panes) {
    const svc = (cfg.services || []).find(s => (s.panel && s.panel.title) === pane.title || s.name === pane.title);
    if (!svc) continue; // not a tracked service

    if (!paneState[pane.title]) {
      paneState[pane.title] = { id: pane.id, started: true, dead: false };
      emit(logPath, { type: EVENT_TYPES.pane_started, slug: opts.slug, service: svc.name, pane_id: pane.id });
    }

    if (pane.dead && !paneState[pane.title].dead) {
      paneState[pane.title].dead = true;
      emit(logPath, { type: EVENT_TYPES.pane_dead, slug: opts.slug, service: svc.name, pane_id: pane.id });
      const cdKey = `${svc.name}:hard`;
      if (cooldown.allow(cdKey)) {
        notifyOs({
          title: `jlu-dev: ${svc.name} failed`,
          body: `pane died — Run /jlu-diagnose ${svc.name}`,
          urgency: 'critical',
          runner: runtimeNotifier
        });
      }
      continue;
    }

    if (paneState[pane.title].dead) continue;

    // Capture-pane diff and pattern match.
    const out = capturePane({ target: `${target}.${panes.indexOf(pane)}`, lines: 200 }, tmuxRunner);
    const newLines = diffLines(captures[pane.title], out);
    captures[pane.title] = out;
    const compiled = compilePatterns(effectiveFailurePatterns(cfg, svc));
    const hits = matchLines(compiled, newLines);
    for (const hit of hits) {
      emit(logPath, { type: EVENT_TYPES.pattern_match, slug: opts.slug, service: svc.name, pattern: hit.pattern, line: hit.line });
    }

    // Readiness.
    if (svc.readiness && !readyState[svc.name]) {
      readyState[svc.name] = readyState[svc.name] || { tries: 0, started: Date.now() };
      const probe = svc.readiness.type === 'http'
        ? await probeHttp({ url: svc.readiness.url, expectStatus: svc.readiness.expect_status || 200, timeoutMs: 1000 })
        : await probeTcp({ host: svc.readiness.host, port: svc.readiness.port, timeoutMs: 1000 });
      readyState[svc.name].tries++;
      if (probe.ok) {
        readyState[svc.name].ready = true;
        emit(logPath, { type: EVENT_TYPES.ready, slug: opts.slug, service: svc.name });
      } else {
        const elapsed = (Date.now() - readyState[svc.name].started) / 1000;
        const limit = svc.readiness.timeout_seconds || effectiveDefaults(cfg).readiness_timeout_seconds;
        if (elapsed >= limit && !readyState[svc.name].failed) {
          readyState[svc.name].failed = true;
          emit(logPath, { type: EVENT_TYPES.readiness_failed, slug: opts.slug, service: svc.name, attempts: readyState[svc.name].tries });
          const cdKey = `${svc.name}:hard`;
          if (cooldown.allow(cdKey)) {
            notifyOs({
              title: `jlu-dev: ${svc.name} failed readiness`,
              body: `Run /jlu-diagnose ${svc.name}`,
              urgency: 'critical',
              runner: runtimeNotifier
            });
          }
        }
      }
    }
  }

  return { stop: false };
}

async function main() {
  const opts = parseArgv(process.argv);
  if (!opts.workspaceId || !opts.slug || !opts.windowName || !opts.configPath) {
    process.stderr.write('daemon: missing required argv\n');
    process.exit(2);
  }

  const lockResult = acquireLock(opts);
  if (!lockResult.acquired) {
    process.stderr.write(`daemon: lock held by pid ${lockResult.holderPid}\n`);
    process.exit(0);
  }

  writePid(opts, process.pid);
  writeFileSync(windowNameFilePath(opts), opts.windowName + '\n', 'utf8');

  let cfg = readConfig(opts.configPath);
  const logPath = eventsLogPath(opts);

  emit(logPath, { type: EVENT_TYPES.daemon_started, slug: opts.slug, pid: process.pid });

  const runtimeNotifier = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...o });
  const ctx = {
    config: cfg, opts, logPath, windowName: opts.windowName,
    paneState: {}, readyState: {}, captures: {},
    cooldown: Cooldown(effectiveDefaults(cfg).notification_cooldown_seconds),
    runtimeNotifier
  };

  let stop = false;
  process.on('SIGHUP', () => {
    try {
      cfg = readConfig(opts.configPath);
      ctx.config = cfg;
      emit(logPath, { type: EVENT_TYPES.daemon_reload, slug: opts.slug });
    } catch (e) {
      process.stderr.write(`daemon: SIGHUP reload failed: ${e.message}\n`);
    }
  });
  process.on('SIGTERM', () => { stop = true; });
  process.on('SIGINT', () => { stop = true; });

  while (!stop) {
    try {
      const r = await tick(ctx);
      if (r.stop) stop = true;
    } catch (e) {
      process.stderr.write(`daemon: tick error: ${e.stack || e.message}\n`);
    }
    if (stop) break;
    await new Promise(r => setTimeout(r, effectiveDefaults(cfg).poll_interval_ms));
  }

  releaseLock(opts);
  emit(logPath, { type: 'daemon_stopping', slug: opts.slug });
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`daemon: fatal: ${e.stack || e.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Make executable**

```bash
chmod +x bin/lib/dev-orchestrator/daemon.mjs
```

- [ ] **Step 3: Commit**

```bash
git add bin/lib/dev-orchestrator/daemon.mjs
git commit -m "feat(dev-orchestrator/daemon): main loop with signals + readiness + patterns [skip-bump]"
```

---

## Task 7: daemon-spawn.mjs — RED + GREEN

**Files:**
- Create: `bin/lib/dev-orchestrator/daemon-spawn.mjs`

Spawns the daemon detached. Exposes the callbacks `start.mjs` and `stop.mjs` consume.

```javascript
// bin/lib/dev-orchestrator/daemon-spawn.mjs
//
// Detached spawn + kill of the daemon process.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openSync } from 'node:fs';
import {
  acquireLock, releaseLock, writePid, readPid, isAlive,
  daemonStderrPath, eventsLogPath
} from './state-daemon.mjs';
import { ensureStateDir, writeMeta } from './state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DAEMON_PATH = join(here, 'daemon.mjs');

export function daemonSpawn({ slug, workspaceRoot, workspaceId, windowName, configPath }) {
  ensureStateDir({ workspaceId, slug });
  writeMeta({ workspaceId, workspaceRoot });

  const stderrFd = openSync(daemonStderrPath({ workspaceId, slug }), 'a');
  const child = spawn('node', [
    DAEMON_PATH,
    '--workspace-id', workspaceId,
    '--slug', slug,
    '--window', windowName,
    '--config', configPath
  ], {
    detached: true,
    stdio: ['ignore', stderrFd, stderrFd]
  });
  child.unref();
  return { pid: child.pid };
}

export function killDaemon({ workspaceId, slug }) {
  const opts = { workspaceId, slug };
  const pid = readPid(opts);
  if (!pid || !isAlive(pid)) {
    releaseLock(opts);
    return { killed: false, pid: pid || null };
  }
  try { process.kill(pid, 'SIGTERM'); } catch {}
  // Wait up to 5s.
  const start = Date.now();
  while (isAlive(pid) && (Date.now() - start) < 5000) {
    // Busy-poll briefly. (No async since callers may invoke synchronously.)
    const wait = 50;
    const target = Date.now() + wait;
    while (Date.now() < target) { /* spin */ }
  }
  if (isAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  releaseLock(opts);
  return { killed: true, pid };
}
```

- [ ] **Step 1: Commit**

```bash
git add bin/lib/dev-orchestrator/daemon-spawn.mjs
git commit -m "feat(dev-orchestrator/daemon-spawn): detached spawn + SIGTERM/SIGKILL kill [skip-bump]"
```

---

## Task 8: Wire daemon into start.mjs and stop.mjs

**Files:**
- Modify: `bin/lib/dev-orchestrator/start.mjs`
- Modify: `bin/lib/dev-orchestrator/stop.mjs`

- [ ] **Step 1: start.mjs — default daemonSpawn to the real one**

Replace the import block and `startDev` default param. Top of file, after the existing imports:

```javascript
import { daemonSpawn as realDaemonSpawn } from './daemon-spawn.mjs';
```

Change `startDev`'s signature default:

```javascript
export function startDev({
  config, workspaceRoot, slug, env = process.env,
  runner, daemonSpawn = realDaemonSpawn
}) {
  // ... rest unchanged
}
```

Pass `workspaceId` + `configPath` through. The caller (workflow) computes `workspaceId` via `workspace.mjs` and passes it as part of the call. Update the workflow's `node -e` snippet at the same time.

But **the existing tests in `tests/unit/dev-orchestrator-start.test.mjs` already inject `daemonSpawn`** so they keep passing. The default change only affects the real (workflow) invocation.

Also extend the `startDev` opts to accept and forward `workspaceId` + `configPath`:

```javascript
export function startDev({
  config, workspaceRoot, workspaceId, slug, configPath,
  env = process.env, runner, daemonSpawn = realDaemonSpawn
}) {
  // ... unchanged until daemonSpawn call:
  const daemon = daemonSpawn({ slug, workspaceRoot, workspaceId, windowName, configPath });
  // ...
}
```

- [ ] **Step 2: stop.mjs — default killDaemon + truncate log**

```javascript
import { killDaemon as realKillDaemon } from './daemon-spawn.mjs';
import { truncateEventsLog } from './state-daemon.mjs';
import { killWindow } from './tmux.mjs';

function windowNameFor(slug) { return `jlu-dev-${slug || '_global'}`; }

export function stopDev({
  workspaceId, slug,
  runner,
  killServices = false,
  killDaemon = realKillDaemon
}) {
  const daemon = killDaemon({ workspaceId, slug });
  truncateEventsLog({ workspaceId, slug });
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

- [ ] **Step 3: Update existing tests if needed**

The existing tests inject `daemonSpawn`/`killDaemon`, so they should continue to pass. Verify by running:

```bash
node --test tests/unit/dev-orchestrator-start.test.mjs
node --test tests/unit/dev-orchestrator-stop.test.mjs
```

If `stopDev` test references `truncateEventsLog`-protected paths and the test injects `workspaceId`/`slug`, the test should still pass because `truncateEventsLog` no-ops on missing files.

- [ ] **Step 4: Run + commit**

```bash
npm test
git add bin/lib/dev-orchestrator/start.mjs bin/lib/dev-orchestrator/stop.mjs
git commit -m "feat(dev-orchestrator/start+stop): wire real daemon spawn/kill + truncate log [skip-bump]"
```

---

## Task 9: patterns.mjs (the skill core) — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-patterns.test.mjs`
- Create: `bin/lib/dev-orchestrator/patterns.mjs`

Implements the core of `/jlu:add-failure-pattern`. Reads JSON, appends regex (deduped), validates compilability, atomic-writes, and returns `{ updated, daemonReloaded }`. SIGHUP delivery is a callback so unit tests don't actually signal a process.

Required exports:

- `addPattern({ configPath, serviceName, pattern })` returns `{ updated: boolean, reason?: string }`. Re-reads config, locates service, appends to `log_failure_patterns` if not duplicate, validates regex, validates config, atomic-writes.
- `signalDaemon({ workspaceId, slug, signal = 'SIGHUP', killer = process.kill })` reads PID, sends signal. Returns `{ signaled: boolean }`.

- [ ] **Step 1: Test**

```javascript
// tests/unit/dev-orchestrator-patterns.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPattern, signalDaemon } from '../../bin/lib/dev-orchestrator/patterns.mjs';
import { writePid } from '../../bin/lib/dev-orchestrator/state-daemon.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jlu-pat-')); }

describe('addPattern', () => {
  test('appends a new pattern', () => {
    const dir = tmp();
    const cfgPath = join(dir, 'jlu-services.json');
    writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      services: [{ name: 'api', path: '.', command: 'x', log_failure_patterns: ['EADDRINUSE'] }]
    }));
    const out = addPattern({ configPath: cfgPath, serviceName: 'api', pattern: 'Cannot find module' });
    assert.equal(out.updated, true);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    assert.deepEqual(cfg.services[0].log_failure_patterns, ['EADDRINUSE', 'Cannot find module']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('does not duplicate existing pattern', () => {
    const dir = tmp();
    const cfgPath = join(dir, 'jlu-services.json');
    writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      services: [{ name: 'api', path: '.', command: 'x', log_failure_patterns: ['EADDRINUSE'] }]
    }));
    const out = addPattern({ configPath: cfgPath, serviceName: 'api', pattern: 'EADDRINUSE' });
    assert.equal(out.updated, false);
    assert.equal(out.reason, 'duplicate');
    rmSync(dir, { recursive: true, force: true });
  });

  test('rejects unparseable regex', () => {
    const dir = tmp();
    const cfgPath = join(dir, 'jlu-services.json');
    writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      services: [{ name: 'api', path: '.', command: 'x' }]
    }));
    const out = addPattern({ configPath: cfgPath, serviceName: 'api', pattern: '[unclosed' });
    assert.equal(out.updated, false);
    assert.match(out.reason, /regex/i);
    rmSync(dir, { recursive: true, force: true });
  });

  test('rejects unknown service', () => {
    const dir = tmp();
    const cfgPath = join(dir, 'jlu-services.json');
    writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      services: [{ name: 'api', path: '.', command: 'x' }]
    }));
    const out = addPattern({ configPath: cfgPath, serviceName: 'web', pattern: 'foo' });
    assert.equal(out.updated, false);
    assert.match(out.reason, /service/i);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('signalDaemon', () => {
  test('reads PID and calls killer with SIGHUP', () => {
    const dir = tmp();
    const opts = { workspaceId: 'wid', slug: 'foo', baseDir: dir };
    writePid(opts, 12345);
    const calls = [];
    const killer = (pid, signal) => { calls.push({ pid, signal }); };
    const out = signalDaemon({ workspaceId: 'wid', slug: 'foo', baseDir: dir, killer });
    assert.equal(out.signaled, true);
    assert.equal(calls[0].pid, 12345);
    assert.equal(calls[0].signal, 'SIGHUP');
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns signaled:false when no PID file', () => {
    const dir = tmp();
    const out = signalDaemon({ workspaceId: 'wid', slug: 'foo', baseDir: dir, killer: () => {} });
    assert.equal(out.signaled, false);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Implementation**

```javascript
// bin/lib/dev-orchestrator/patterns.mjs
//
// Core of /jlu:add-failure-pattern. Read JSON, append regex (deduped),
// validate compilability, atomic-write, optionally signal daemon.

import { readConfig, writeConfigAtomic } from './config.mjs';
import { readPid } from './state-daemon.mjs';

export function addPattern({ configPath, serviceName, pattern }) {
  const cfg = readConfig(configPath);
  const services = cfg.services || [];
  const idx = services.findIndex((s) => s.name === serviceName);
  if (idx === -1) return { updated: false, reason: `service not found: ${serviceName}` };

  try { new RegExp(pattern, 'i'); }
  catch (e) { return { updated: false, reason: `regex error: ${e.message}` }; }

  const existing = services[idx].log_failure_patterns || [];
  if (existing.includes(pattern)) return { updated: false, reason: 'duplicate' };

  const next = {
    ...cfg,
    services: services.map((s, i) =>
      i === idx ? { ...s, log_failure_patterns: [...existing, pattern] } : s
    )
  };
  writeConfigAtomic(configPath, next);
  return { updated: true };
}

export function signalDaemon({ workspaceId, slug, baseDir, signal = 'SIGHUP', killer = process.kill.bind(process) }) {
  const pid = readPid({ workspaceId, slug, baseDir });
  if (!pid) return { signaled: false };
  try { killer(pid, signal); return { signaled: true, pid }; }
  catch (e) { return { signaled: false, error: e.message }; }
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/unit/dev-orchestrator-patterns.test.mjs
npm test
git add bin/lib/dev-orchestrator/patterns.mjs tests/unit/dev-orchestrator-patterns.test.mjs
git commit -m "feat(dev-orchestrator/patterns): add-failure-pattern core + signalDaemon [skip-bump]"
```

---

## Task 10: add-failure-pattern workflow + skill + opencode

**Files:**
- Create: `jelou/workflows/add-failure-pattern.md`
- Create: `skills/add-failure-pattern/SKILL.md`
- Create: `.opencode/commands/jlu-add-failure-pattern.md`

These three land in ONE commit (harness-parity).

- [ ] **Step 1: Workflow**

````markdown
# /jlu:add-failure-pattern Workflow

> Purpose: Append a regex to a service's log_failure_patterns and reload the daemon if running.

Inputs:
- `argument`: optional, of the form `<service> <pattern>` or just `<service>`.

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

## Step 2 — Ask for service + pattern

If argument provided, parse `<service> <pattern>`. Otherwise:

- `question` (single-choice from existing services): `"Service to extend?"`. Read services from configPath via:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs').then(({ readConfig }) => {
  const cfg = readConfig(process.argv[1]);
  process.stdout.write((cfg.services || []).map(s => s.name).join(','));
});
" "{configPath}"
```

- `question` (free-text): `"Regex pattern (case-insensitive)"`.

## Step 3 — Append + signal

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/patterns.mjs')
]).then(([p]) => {
  const out = p.addPattern({
    configPath: process.argv[1],
    serviceName: process.argv[2],
    pattern: process.argv[3]
  });
  process.stdout.write(JSON.stringify(out));
});
" "{configPath}" "{service}" "{pattern}"
```

If `updated: false`, surface the reason and stop.

If `updated: true`, signal the daemon:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/patterns.mjs')
]).then(([p]) => {
  const out = p.signalDaemon({ workspaceId: process.argv[1], slug: process.argv[2] });
  process.stdout.write(JSON.stringify(out));
});
" "{workspaceId}" "{slug}"
```

## Step 4 — Report

> `Pattern '{pattern}' added to '{service}'. Daemon: <reloaded|not-running>.`
````

- [ ] **Step 2: Skill**

````markdown
---
name: add-failure-pattern
description: Use to append a regex to a service's log_failure_patterns and reload the dev daemon. Triggers "add failure pattern", "register error pattern", "watch for log error"
argument-hint: "[<service> <pattern>]"
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

You are the orchestrator for the `/jlu:add-failure-pattern` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory.
2. `~/.claude/jelou/`.

If neither resolves, stop with: "Plugin root not found."

**Runtime contract.** Workflow uses `question` → `AskUserQuestion`. Never narrate as plain text.

**Run these in parallel:**
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/add-failure-pattern.md`
3. `ToolSearch`: `select:AskUserQuestion`.

Update banner / ToolSearch fallback as in other skills.

## Phase 2 — Execute Workflow

Follow the workflow inline. Argument is `{argument}`. Cwd is `{cwd}`.
````

- [ ] **Step 3: OpenCode mirror**

```markdown
---
description: Append a regex to a service's log_failure_patterns and reload the daemon
agent: build
---
Execute this workflow exactly: @jelou/workflows/add-failure-pattern.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Always reference commands with the `jlu-` prefix.
```

- [ ] **Step 4: Verify and commit**

```bash
npm test
git add jelou/workflows/add-failure-pattern.md skills/add-failure-pattern/SKILL.md .opencode/commands/jlu-add-failure-pattern.md
git commit -m "feat(add-failure-pattern): workflow + skill + opencode command [skip-bump]"
```

---

## Task 11: Daemon integration test (E2E)

**Files:**
- Create: `tests/integration/dev-orchestrator/daemon.test.mjs`

Spawn the daemon against a real tmux session with a couple of trivial commands (`sleep 5; exit 0` and `sleep 1; exit 1`). After ~3s, read `dev-events.log` and assert `pane_dead` for the failing pane.

- [ ] **Step 1: Write the integration test**

```javascript
// tests/integration/dev-orchestrator/daemon.test.mjs
import { test, describe, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { tmuxAvailable, newSessionDetached, newWindow, splitWindow, sendKeys, killWindow } from '../../../bin/lib/dev-orchestrator/tmux.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DAEMON = join(here, '..', '..', '..', 'bin', 'lib', 'dev-orchestrator', 'daemon.mjs');
const SOCKET = `jlu-d-${randomBytes(4).toString('hex')}`;
const SESSION = 'jlu-d-test';

function socketRunner(args, opts = {}) {
  return spawnSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8', ...opts });
}

const skip = !tmuxAvailable(socketRunner).ok;

describe('daemon integration', { skip }, () => {
  let base, configPath, workspaceId = 'integ', slug = 'd1';

  before(() => {
    base = mkdtempSync(join(tmpdir(), 'jlu-dint-'));
    configPath = join(base, 'jlu-services.json');
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      services: [
        { name: 'good', path: '.', command: 'sleep 5', panel: { title: 'good' } },
        { name: 'bad', path: '.', command: 'sleep 1; exit 1', panel: { title: 'bad' } }
      ]
    }));
    newSessionDetached(SESSION, socketRunner);
    newWindow({ session: SESSION, name: 'jlu-dev-d1' }, socketRunner);
    sendKeys({ target: `${SESSION}:jlu-dev-d1.0`, keys: 'sleep 5' }, socketRunner);
    splitWindow({ target: `${SESSION}:jlu-dev-d1` }, socketRunner);
    sendKeys({ target: `${SESSION}:jlu-dev-d1.1`, keys: 'sleep 1; exit 1' }, socketRunner);
    socketRunner(['select-pane', '-t', `${SESSION}:jlu-dev-d1.0`, '-T', 'good']);
    socketRunner(['select-pane', '-t', `${SESSION}:jlu-dev-d1.1`, '-T', 'bad']);
  });

  after(() => {
    killWindow({ target: `${SESSION}:jlu-dev-d1` }, socketRunner);
    socketRunner(['kill-server']);
    rmSync(base, { recursive: true, force: true });
  });

  test('emits pane_dead for the failing pane within 5s', async () => {
    // Spawn daemon detached. We bypass our daemon-spawn module and invoke
    // node directly so we can inject the test base dir via env.
    const child = spawn('node', [
      DAEMON,
      '--workspace-id', workspaceId,
      '--slug', slug,
      '--window', 'jlu-dev-d1',
      '--config', configPath
    ], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, JLU_HOME: base, TMUX: '' /* outside-of-tmux */ }
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

    assert.match(body, /pane_dead/);
  });
});
```

**Note:** the daemon as written uses `~/.jlu` via `state.mjs`'s `DEFAULT_BASE`. For the integration test to use the test's tmpdir, `state.mjs` must support an env-var override (e.g. read `process.env.JLU_HOME` if set). Add a small extension to `state.mjs`:

```javascript
// In state.mjs, change DEFAULT_BASE to:
const DEFAULT_BASE = process.env.JLU_HOME || join(homedir(), '.jlu');
```

If you make that change, also extend the existing state.mjs unit test to verify `JLU_HOME` override is honored.

- [ ] **Step 2: Run + commit**

```bash
node --test tests/integration/dev-orchestrator/daemon.test.mjs
npm test
git add tests/integration/dev-orchestrator/daemon.test.mjs bin/lib/dev-orchestrator/state.mjs tests/unit/dev-orchestrator-state.test.mjs
git commit -m "test(dev-orchestrator/daemon): integration E2E + JLU_HOME override [skip-bump]"
```

---

## Task 12: Smoke verification

- [ ] **Step 1: Full unit + integration**

```bash
npm test
node --test tests/integration/dev-orchestrator/*.test.mjs
```

Expected: unit suite green; integration daemon test passes (or skips without tmux).

- [ ] **Step 2: Manual smoke (user-driven)**

In a fresh Claude Code session against a scratch workspace:
1. `mkdir -p /tmp/jlu-p3-smoke/api && cd /tmp/jlu-p3-smoke/api && echo '{}' > package.json`
2. `/jlu:register-service api` (use command `sleep 30` to keep the pane alive)
3. `/jlu:start-dev` — verify daemon PID file exists at `~/.jlu/workspaces/<id>/_global/daemon.pid`.
4. `cat ~/.jlu/workspaces/<id>/_global/dev-events.log` — verify `daemon_started` and `pane_started` events.
5. Kill the pane manually (`Ctrl+b x`). After ~3s, verify `pane_dead` event landed and an OS notification fired.
6. `/jlu:add-failure-pattern api "Custom error"` — verify `daemon_reload` event lands.
7. `/jlu:stop-dev --kill-services` — verify PID file cleared and window gone.
8. Cleanup: `rm -rf /tmp/jlu-p3-smoke ~/.jlu/workspaces/<id>`.

---

## Self-Review

| Spec section | Implemented in |
|---|---|
| PID + lock primitives | Task 1 |
| HTTP/TCP probes | Task 2 |
| Pattern matcher + cooldown | Task 3 |
| OS notifications | Task 4 |
| JSONL event writer | Task 5 |
| Daemon main loop | Task 6 |
| Detached spawn + kill | Task 7 |
| Wire into start/stop | Task 8 |
| add-failure-pattern + SIGHUP | Tasks 9, 10 |
| Integration coverage | Task 11 |

**Boundary respected:** Phase 4 will introduce the diagnose agent + add-service + logs. Daemon's event format is stable; consumers in Phase 4 will tail `dev-events.log` and capture-pane.

---

## Branch handoff

After Task 12:
- Branch is still `feature/dev-orchestrator`.
- Around 12 new commits in Phase 3.
- Suite green; no PR opened yet.

Next: invoke the Phase 4 plan (`docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase4-diagnose.md`).
