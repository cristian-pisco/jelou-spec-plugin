// bin/lib/dev-orchestrator/daemon-spawn.mjs
//
// Detached spawn + kill of the daemon process.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openSync } from 'node:fs';
import {
  releaseLock, readPid, isAlive,
  daemonStderrPath
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
  // Wait up to 5s for graceful exit, polling every 100ms via /bin/sleep
  // (avoids CPU spin; spawnSync on `sleep` blocks without burning the core).
  const start = Date.now();
  while (isAlive(pid) && (Date.now() - start) < 5000) {
    spawnSync('sleep', ['0.1']);
  }
  if (isAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  releaseLock(opts);
  return { killed: true, pid };
}
