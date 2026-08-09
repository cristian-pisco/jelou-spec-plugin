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

const SPEC_WORKSPACE_DIR = '.spec-workspace';

function hasUnifiedRegistry(dir) {
  return isFile(join(dir, 'registry', 'services.yaml'))
    || isFile(join(dir, 'registry', 'jelou-registry.yaml'));
}

function canonicalWorkspaceRoot(dir) {
  if (isFile(join(dir, 'jlu-services.json'))) return dir;
  if (hasUnifiedRegistry(dir) && isDir(join(dir, 'tasks'))) return dir;
  const specWorkspace = join(dir, SPEC_WORKSPACE_DIR);
  if (hasUnifiedRegistry(specWorkspace)) return specWorkspace;
  return null;
}

export function resolveWorkspace(startDir, { allowGitFallback = false } = {}) {
  const start = isAbsolute(startDir) ? startDir : resolve(startDir);
  let cur = start;

  while (true) {
    const root = canonicalWorkspaceRoot(cur);
    if (root) return finalize(root);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  if (allowGitFallback) {
    const top = gitToplevel(start);
    if (top) return finalize(top);
  }

  const err = new Error(
    `no workspace root found above ${start} — no jlu-services.json and no ${SPEC_WORKSPACE_DIR}/registry. ` +
    'Run /jlu:register-service from inside a project, or invoke from the workspace root.'
  );
  err.code = 'NO_WORKSPACE';
  throw err;
}

function registeredTmuxServiceCount(configPath) {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    return Array.isArray(parsed.services) ? parsed.services.length : 0;
  } catch {
    return 0;
  }
}

export function bootPathFor({ root, configPath }) {
  const base = root || (configPath ? dirname(configPath) : null);
  if (base && (hasUnifiedRegistry(base) || isFile(join(base, 'registry', 'registry.json')))) return 'jelou-stack';
  if (!configPath || !isFile(configPath)) return 'jelou-stack';
  return registeredTmuxServiceCount(configPath) > 0 ? 'tmux' : 'jelou-stack';
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
