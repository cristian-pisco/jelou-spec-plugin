import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, rmSync } from 'node:fs';
import { readStackState, clearStackState } from './stack-state.mjs';
import { composeDownArgs } from './compose-down.mjs';
import { pidsToKill, restorePlan } from './teardown-plan.mjs';

export function tearDownStack(opts, deps = {}) {
  const readState = deps.readState || readStackState;
  const clearState = deps.clearState || clearStackState;
  const run = deps.run || ((bin, args, o) => spawnSync(bin, args, { encoding: 'utf8', ...o }));
  const kill = deps.kill || ((pid) => { try { process.kill(pid); return true; } catch { return false; } });
  const fsx = deps.fs || { exists: existsSync, copy: copyFileSync, remove: rmSync };

  const state = readState(opts);

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
