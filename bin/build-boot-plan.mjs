#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { argv, exit, stdout } from 'node:process';
import { readUnifiedRegistry } from './lib/registry/read.mjs';
import { buildBootPlan } from './lib/boot-engine/plan.mjs';
import { parseOccupiedPorts } from './lib/dev-orchestrator/stack/ports.mjs';

export function buildPlanForWorkspace({ workspaceRoot, slug, worktreePaths, occupied, resolveImage, readEnv }) {
  const registry = readUnifiedRegistry(workspaceRoot);
  return buildBootPlan({ registry, slug, worktreePaths, occupied, resolveImage, readEnv });
}

function resolveWorktreePaths(registry, slug) {
  const out = {};
  for (const s of registry.services) {
    const p = join(s.path, '.worktrees', slug);
    if (existsSync(p)) out[s.id] = p;
  }
  return out;
}

function dockerOccupied() {
  const r = spawnSync('docker', ['ps', '--format', '{{.Ports}}'], { encoding: 'utf8' });
  return [...parseOccupiedPorts(r.stdout || '')];
}

function main() {
  const wi = argv.indexOf('--workspace');
  const si = argv.indexOf('--slug');
  if (wi === -1 || !argv[wi + 1] || si === -1 || !argv[si + 1]) {
    console.error('build-boot-plan: --workspace <root> --slug <slug> required');
    exit(2);
  }
  const workspaceRoot = argv[wi + 1];
  const slug = argv[si + 1];
  const registry = readUnifiedRegistry(workspaceRoot);
  const plan = buildBootPlan({ registry, slug, worktreePaths: resolveWorktreePaths(registry, slug), occupied: dockerOccupied() });
  stdout.write(JSON.stringify(plan, null, 2) + '\n');
}

if (import.meta.url === `file://${argv[1]}`) main();
