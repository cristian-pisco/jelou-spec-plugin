// bin/lib/dev-orchestrator/workspace.mjs
//
// Workspace root resolver + workspace ID. Walk-up from cwd in priority order:
//   1. directory containing jlu-services.json
//   2. directory containing registry/services.yaml AND tasks/
//   3. git rev-parse --show-toplevel
// Returns { root, configPath, workspaceId }.
// All child-process calls use spawnSync with array args (no shell).

import { readFileSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function computeWorkspaceId(absolutePath) {
  return createHash('sha256').update(absolutePath).digest('hex').slice(0, 12);
}

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

function pointerWorkspace(pointer) {
  try {
    const value = JSON.parse(readFileSync(pointer, 'utf8')).workspace;
    if (!value) return null;
    const workspaceRoot = isAbsolute(value) ? value : resolve(dirname(pointer), value);
    return isDir(join(workspaceRoot, 'specs')) ? workspaceRoot : null;
  } catch {
    return null;
  }
}

function gitToplevel(cwd) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

export function resolveWorkspace(startDir) {
  const start = isAbsolute(startDir) ? startDir : resolve(startDir);
  let cur = start;

  while (true) {
    if (isFile(join(cur, 'jlu-services.json'))) return finalize(cur);
    if (isFile(join(cur, 'registry', 'services.yaml')) && isDir(join(cur, 'tasks'))) return finalize(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  const top = gitToplevel(start);
  if (top) return finalize(top);

  const err = new Error('no workspace root found — run /jlu:register-service from inside a project');
  err.code = 'NO_WORKSPACE';
  throw err;
}

export function resolveSpecWorkspace(startDir) {
  let cur = isAbsolute(startDir) ? startDir : resolve(startDir);
  for (let depth = 0; depth <= 6; depth++) {
    const pointer = join(cur, '.spec-workspace.json');
    if (isFile(pointer)) {
      const workspaceRoot = pointerWorkspace(pointer);
      if (workspaceRoot) return workspaceRoot;
    }
    const local = join(cur, '.spec-workspace');
    if (isDir(join(local, 'specs'))) return local;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function finalize(root) {
  return {
    root,
    configPath: join(root, 'jlu-services.json'),
    workspaceId: computeWorkspaceId(root)
  };
}
