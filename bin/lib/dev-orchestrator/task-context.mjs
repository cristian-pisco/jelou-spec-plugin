// bin/lib/dev-orchestrator/task-context.mjs
//
// Resolves the active task slug in priority order:
//   1. override
//   2. cwd matches /.worktrees/<slug>/
//   3. branch matches task/<slug>, spec/<slug>, or <slug> with tasks/<slug>/TASKS.md
//   4. workspace tasks/*/TASKS.md scan: unique implementing|validating wins
//   5. _global
// When multiple tasks are in-flight at step 4, returns "AMBIGUOUS:s1,s2,..."
// (caller must prompt the user).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const WORKTREE_RE = /\/\.worktrees\/([a-z0-9][a-z0-9-]*)(?:\/|$)/;
const BRANCH_PREFIXED_RE = /^(?:task|spec)\/([a-z0-9][a-z0-9-]*)$/;
const BRANCH_BARE_RE = /^[a-z0-9][a-z0-9-]*$/;
const STATE_RE = /State:\s*(implementing|validating)/i;

export function getCurrentBranch(cwd) {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function inFlightSlugs(workspaceRoot) {
  const tasksDir = join(workspaceRoot, 'tasks');
  if (!existsSync(tasksDir)) return [];
  const out = [];
  for (const name of readdirSync(tasksDir)) {
    const tmd = join(tasksDir, name, 'TASKS.md');
    if (!existsSync(tmd)) continue;
    const body = readFileSync(tmd, 'utf8');
    if (STATE_RE.test(body)) out.push(name);
  }
  return out.sort();
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
