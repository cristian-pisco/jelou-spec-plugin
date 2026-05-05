// bin/lib/dev-orchestrator/workspace.mjs
//
// Workspace root resolver + workspace ID. Walk-up from cwd in priority order:
//   1. directory containing jlu-services.json
//   2. directory containing registry/services.yaml AND tasks/
//   3. git rev-parse --show-toplevel
// Returns { root, configPath, workspaceId }.
// All child-process calls use spawnSync with array args (no shell).

import { statSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function computeWorkspaceId(absolutePath) {
  return createHash('sha256').update(absolutePath).digest('hex').slice(0, 12);
}

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

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

function finalize(root) {
  return {
    root,
    configPath: join(root, 'jlu-services.json'),
    workspaceId: computeWorkspaceId(root)
  };
}
