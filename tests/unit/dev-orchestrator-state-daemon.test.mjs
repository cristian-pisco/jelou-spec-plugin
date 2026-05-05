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
    // Ensure parent dir exists by acquiring once first, then overwrite with self pid.
    acquireLock(opts);
    writeFileSync(lockFilePath(opts), JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
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
    acquireLock(opts);
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
    // Ensure parent dir exists first.
    writePid(opts, 1);
    writeFileSync(eventsLogPath(opts), 'event1\nevent2\n');
    truncateEventsLog(opts);
    assert.equal(readFileSync(eventsLogPath(opts), 'utf8'), '');
    rmSync(base, { recursive: true, force: true });
  });
});
