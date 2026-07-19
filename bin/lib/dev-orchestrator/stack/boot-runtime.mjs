import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadStack } from './registry.mjs';
import { parseOccupiedPorts } from './ports.mjs';
import { buildTaskStack } from './task-stack.mjs';
import { bootStack } from './boot-stack.mjs';
import { resolveBaseImage } from './resolve-base-image.mjs';

export function dockerOccupiedPorts(run) {
  const r = run('docker', ['ps', '--format', '{{.Ports}}'], {});
  return parseOccupiedPorts(r.stdout || '');
}

export function resolveBaseImages({ stack, worktreePaths, run }) {
  const images = {};
  for (const svc of stack.services) {
    const cwd = (worktreePaths && worktreePaths[svc.name]) || svc.path;
    const image = resolveBaseImage({ cwd, composeFile: svc.compose_file, composeService: svc.compose_service, run });
    if (image) images[svc.name] = image;
  }
  return images;
}

export async function bootBackendStack({ registryPath, slug, worktreePaths, readEnv, fetchImpl, sleepImpl }) {
  const stack = loadStack(registryPath);
  const run = (bin, args, opts) => spawnSync(bin, args, { encoding: 'utf8', ...opts });
  const occupied = dockerOccupiedPorts(run);
  const baseImages = resolveBaseImages({ stack, worktreePaths, run });
  const plan = buildTaskStack({ stack, slug, worktreePaths, occupied, readEnv, baseImages });
  const probe = async (url) => {
    try { await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(6000) }); return true; } catch { return false; }
  };
  return bootStack({ plan, writeFile: (p, c) => writeFileSync(p, c), run, probe, delay: () => sleepImpl(15000) });
}
