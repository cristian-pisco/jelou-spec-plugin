// bin/lib/dev-orchestrator/state.mjs
//
// State directory layout: ~/.jlu/workspaces/<workspace-id>/<slug>/.
// Phase 1 only exposes path helpers and ensureStateDir + writeMeta.
// Daemon-related primitives (PID file, flock, log paths) land in Phase 3.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_BASE = join(homedir(), '.jlu');

function base(opts) {
  return (opts && opts.baseDir) || DEFAULT_BASE;
}

export function stateDir({ workspaceId, slug = '_global', baseDir }) {
  return join(base({ baseDir }), 'workspaces', workspaceId, slug);
}

export function ensureStateDir({ workspaceId, slug = '_global', baseDir }) {
  const p = stateDir({ workspaceId, slug, baseDir });
  mkdirSync(p, { recursive: true });
  return p;
}

export function writeMeta({ workspaceId, workspaceRoot, baseDir }) {
  const dir = join(base({ baseDir }), 'workspaces', workspaceId);
  mkdirSync(dir, { recursive: true });
  const meta = { path: workspaceRoot, name: basename(workspaceRoot), updated_at: new Date().toISOString() };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

export function currentSymlinkPath(baseDir) {
  return join(base({ baseDir }), 'current');
}
