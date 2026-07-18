import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadStack } from './registry.mjs';
import { parseOccupiedPorts } from './ports.mjs';
import { buildTaskStack } from './task-stack.mjs';
import { bootStack } from './boot-stack.mjs';

export function dockerOccupiedPorts(run) {
  const r = run('docker', ['ps', '--format', '{{.Ports}}'], {});
  return parseOccupiedPorts(r.stdout || '');
}

export async function bootBackendStack({ registryPath, slug, worktreePaths, readEnv, fetchImpl, sleepImpl }) {
  const stack = loadStack(registryPath);
  const run = (bin, args, opts) => spawnSync(bin, args, { encoding: 'utf8', ...opts });
  const occupied = dockerOccupiedPorts(run);
  const plan = buildTaskStack({ stack, slug, worktreePaths, occupied, readEnv });
  const probe = async (url) => {
    try { await fetchImpl(url, { method: 'GET' }); return true; } catch { return false; }
  };
  return bootStack({ plan, writeFile: (p, c) => writeFileSync(p, c), run, probe, delay: () => sleepImpl(15000) });
}
