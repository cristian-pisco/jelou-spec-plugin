// bin/lib/dev-orchestrator/task-context.mjs
//
// Resolves the active task slug in priority order:
//   1. override
//   2. cwd matches /.worktrees/<slug>/
//   3. branch matches task/<slug>, spec/<slug>, or <slug> with tasks/<slug>/TASKS.md
//   4. workspace TASKS.md scan (specs/<date>/<slug>/ and legacy tasks/<slug>/):
//      unique implementing|validating wins
//   5. _global
// When multiple tasks are in-flight at step 4, returns "AMBIGUOUS:s1,s2,..."
// (caller must prompt the user).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deriveTask, listTaskLocations } from '../task-index/scan.mjs';
import { resolveSpecWorkspace } from './workspace.mjs';

const WORKTREE_RE = /\/\.worktrees\/([a-z0-9][a-z0-9-]*)(?:\/|$)/;
const BRANCH_PREFIXED_RE = /^(?:task|spec|production)\/([a-z0-9][a-z0-9-]*)$/;
const BRANCH_BARE_RE = /^[a-z0-9][a-z0-9-]*$/;
const STATE_RE = /State:\s*(implementing|validating)/i;

export function getCurrentBranch(cwd) {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function legacyTaskPaths(workspaceRoot) {
  const tasksDir = join(workspaceRoot, 'tasks');
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir).map((slug) => ({ slug, path: join(tasksDir, slug, 'TASKS.md') }));
}

function specTaskPaths(workspaceRoot) {
  let locations = [];
  try {
    locations = listTaskLocations(workspaceRoot);
  } catch {
    return [];
  }
  return locations.map((location) => ({
    slug: location.slug,
    path: join(workspaceRoot, 'specs', location.date_on_disk, location.slug, 'TASKS.md'),
  }));
}

function inFlightSlugs(workspaceRoot) {
  const out = new Set();
  for (const candidate of [...legacyTaskPaths(workspaceRoot), ...specTaskPaths(workspaceRoot)]) {
    if (!existsSync(candidate.path)) continue;
    if (STATE_RE.test(readFileSync(candidate.path, 'utf8'))) out.add(candidate.slug);
  }
  return [...out].sort();
}

/**
 * Resolves the active task slug for state-keying purposes.
 * @param {object} opts
 * @param {string} opts.workspaceRoot — required, absolute path; used for tasks/ scan and TASKS.md existence checks.
 * @param {string} opts.cwd — required, absolute path; checked for /.worktrees/<slug>/ pattern.
 * @param {string} [opts.branch] — optional override of current branch; falls back to `git rev-parse --abbrev-ref HEAD` from cwd.
 * @param {string} [opts.override] — explicit slug; bypasses all detection.
 * @returns {string} A slug, "_global", or "AMBIGUOUS:s1,s2,..." sentinel (caller prompts the user).
 */
export function resolveTaskSlug({ workspaceRoot, cwd, branch, override }) {
  if (!workspaceRoot) throw new Error('resolveTaskSlug: workspaceRoot is required');
  if (!cwd) throw new Error('resolveTaskSlug: cwd is required');
  if (override) return override;

  const m = WORKTREE_RE.exec(cwd);
  if (m) return m[1];

  const br = branch ?? getCurrentBranch(cwd);
  if (br) {
    const pm = BRANCH_PREFIXED_RE.exec(br);
    if (pm) return pm[1];
    if (BRANCH_BARE_RE.test(br) && existsSync(join(workspaceRoot, 'tasks', br, 'TASKS.md'))) {
      return br;
    }
  }

  const inflight = inFlightSlugs(workspaceRoot);
  if (inflight.length === 1) return inflight[0];
  if (inflight.length > 1) return `AMBIGUOUS:${inflight.join(',')}`;

  return '_global';
}

function affectedServicesFromTasks(tasksText) {
  const frontmatter = tasksText.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) return [];
  const services = [];
  let current = null;
  for (const line of frontmatter[1].split('\n')) {
    const id = line.match(/^\s*-\s+id:\s*(\S+)/);
    if (id) {
      current = { id: id[1], branch: null };
      services.push(current);
      continue;
    }
    const branch = line.match(/^\s+branch:\s*(\S+)/);
    if (branch && current) current.branch = branch[1];
  }
  return services;
}

export function resolveTaskContext({ projectRoot, workspaceRoot, cwd, branch, slug }) {
  const sharedRoot = workspaceRoot || resolveSpecWorkspace(projectRoot || cwd);
  if (!sharedRoot) return null;
  const selectedSlug = slug || resolveTaskSlug({ workspaceRoot: sharedRoot, cwd, branch });
  if (selectedSlug === '_global') return null;
  if (selectedSlug.startsWith('AMBIGUOUS:')) throw new Error(`active task is ambiguous: ${selectedSlug.slice('AMBIGUOUS:'.length)}`);
  const matches = listTaskLocations(sharedRoot).filter((candidate) => candidate.slug === selectedSlug);
  if (matches.length !== 1) throw new Error(`active task ${selectedSlug} does not resolve to one TASKS.md in ${sharedRoot}`);
  const task = deriveTask(sharedRoot, matches[0].date_on_disk, selectedSlug);
  const taskRoot = join(sharedRoot, task.root_path);
  const tasksPath = join(sharedRoot, task.sources.tasks.path);
  const tasksText = readFileSync(tasksPath, 'utf8');
  return {
    workspaceRoot: sharedRoot,
    registryPath: join(sharedRoot, 'registry', 'registry.json'),
    taskRoot,
    tasksPath,
    slug: selectedSlug,
    status: task.status,
    mode: task.setup_mode,
    affectedServices: affectedServicesFromTasks(tasksText),
  };
}
