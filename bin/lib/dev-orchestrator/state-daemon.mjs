// bin/lib/dev-orchestrator/state-daemon.mjs
//
// PID + lock + log-path primitives for the dev-orchestrator daemon.
// Builds on state.mjs's directory layout but adds daemon-specific files.

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, truncateSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateDir } from './state.mjs';

function fileIn(opts, name) {
  return join(stateDir(opts), name);
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
