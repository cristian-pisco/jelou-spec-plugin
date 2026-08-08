import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, rmSync } from 'node:fs';
import { readStackState, writeStackState, clearStackState } from './stack-state.mjs';
import { composeDownArgs } from './compose-down.mjs';
import { ownedCleanupPlan, pidsToKill, restorePlan } from './teardown-plan.mjs';
import { LIFECYCLE_STAGES } from '../events.mjs';

function cleanupIdentity(opts) {
  return { workspaceId: opts.workspaceId, taskSlug: opts.taskSlug || opts.slug, runId: opts.runId };
}

function cleanupOwnedAction(entry, deps, result) {
  const resource = entry.resource || {};
  if (entry.kind === 'container') {
    deps.run('docker', composeDownArgs(resource), { cwd: resource.cwd });
    result.projects.push(resource.projectName);
    return true;
  }
  if (entry.kind === 'process') {
    (deps.kill(resource.pid) ? result.killed : result.missing).push(resource.pid);
    return true;
  }
  if (entry.kind === 'overlay' || entry.kind === 'file') {
    deps.fs.remove(resource.path);
    result.removed.push(resource.path);
    return true;
  }
  if (entry.kind === 'restore') {
    if (!deps.fs.exists(resource.from)) return true;
    deps.fs.copy(resource.from, resource.to);
    deps.fs.remove(resource.from);
    result.restored.push(resource.to);
    return true;
  }
  if (entry.kind === 'credential' && deps.removeCredential) return deps.removeCredential(resource) !== false;
  if (entry.kind === 'testData' && deps.removeTestData) return deps.removeTestData(resource) !== false;
  return false;
}

function tearDownOwnedJournal(opts, state, deps, clearState, writeState) {
  deps.onLifecycle({ stage: LIFECYCLE_STAGES.cleanup, outcome: 'started' });
  const plan = ownedCleanupPlan(state, cleanupIdentity(opts));
  const result = { projects: [], killed: [], missing: [], restored: [], removed: [], refused: [...plan.refused] };
  const retained = [...plan.retained];
  for (const entry of plan.actions) {
    try {
      if (!cleanupOwnedAction(entry, deps, result)) {
        result.refused.push({ kind: entry.kind, resource: entry.resource, reason: 'cleanup-handler-missing' });
        retained.push(entry);
      }
    } catch {
      result.refused.push({ kind: entry.kind, resource: entry.resource, reason: 'cleanup-failed' });
      retained.push(entry);
    }
  }
  if (result.refused.length === 0) clearState(opts);
  else {
    const journal = state.mutationJournal || [];
    retained.sort((left, right) => journal.indexOf(left) - journal.indexOf(right));
    writeState(opts, { ...state, mutationJournal: retained });
  }
  deps.onLifecycle({ stage: LIFECYCLE_STAGES.cleanup, outcome: result.refused.length === 0 ? 'succeeded' : 'refused' });
  return result;
}

export function tearDownStack(opts, deps = {}) {
  const readState = deps.readState || readStackState;
  const clearState = deps.clearState || clearStackState;
  const writeState = deps.writeState || writeStackState;
  const run = deps.run || ((bin, args, o) => spawnSync(bin, args, { encoding: 'utf8', ...o }));
  const kill = deps.kill || ((pid) => { try { process.kill(pid); return true; } catch { return false; } });
  const fsx = deps.fs || { exists: existsSync, copy: copyFileSync, remove: rmSync };

  const state = readState(opts);
  if ((state.mutationJournal || []).length > 0) {
    return tearDownOwnedJournal(opts, state, {
      run,
      kill,
      fs: fsx,
      removeCredential: deps.removeCredential,
      removeTestData: deps.removeTestData,
      onLifecycle: deps.onLifecycle || (() => {}),
    }, clearState, writeState);
  }

  const projects = [];
  for (const p of state.projects) {
    run('docker', composeDownArgs({ projectName: p.projectName, composeFile: p.composeFile, overrideFile: p.overrideFile }), { cwd: p.cwd });
    projects.push(p.projectName);
  }

  const killed = [];
  const missing = [];
  for (const pid of pidsToKill(state)) {
    (kill(pid) ? killed : missing).push(pid);
  }

  const plan = restorePlan(state);
  const restored = [];
  const applyOne = (pair) => {
    if (pair && fsx.exists(pair.from)) {
      fsx.copy(pair.from, pair.to);
      fsx.remove(pair.from);
      restored.push(pair.to);
    }
  };
  applyOne(plan.frontend);
  for (const pair of plan.backend) applyOne(pair);

  clearState(opts);
  return { projects, killed, missing, restored };
}
