#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { argv, exit, stdout } from 'node:process';
import { readUnifiedRegistry } from './lib/registry/read.mjs';
import { teardownSafetyCause } from './lib/registry/splice.mjs';
import { buildBootPlan } from './lib/boot-engine/plan.mjs';
import { parseOccupiedPorts } from './lib/dev-orchestrator/stack/ports.mjs';
import { normalizeSourceMode } from './lib/dev-orchestrator/source-mode.mjs';
import { resolveTaskSources } from './lib/dev-orchestrator/task-source.mjs';
import { resolveTaskContext } from './lib/dev-orchestrator/task-context.mjs';

export function unsafeTeardownEntries(plan) {
  const out = [];
  for (const entry of (plan && plan.services) || []) {
    const cause = teardownSafetyCause({ launcher: entry.launcher, teardown: entry.teardownCmd });
    if (cause) out.push({ id: entry.id, teardown: entry.teardownCmd, cause });
  }
  return out;
}

function assertTeardownsAreSafe(plan) {
  const unsafe = unsafeTeardownEntries(plan);
  if (unsafe.length === 0) return plan;
  const detail = unsafe.map((u) => `  ${u.id}: ${u.cause}`).join('\n');
  throw new Error(`refusing to build a boot plan — fix these dev blocks in services.yaml first:\n${detail}`);
}

export function buildPlanForWorkspace({ workspaceRoot, slug, sourceMode, taskContext, worktreePaths, occupied, resolveImage, readEnv, inspectGit, pathExists }) {
  const registry = readUnifiedRegistry(workspaceRoot);
  if (sourceMode === undefined) {
    return assertTeardownsAreSafe(buildBootPlan({ registry, slug, worktreePaths, occupied, resolveImage, readEnv }));
  }
  const normalizedMode = normalizeSourceMode(sourceMode, { hasActiveTask: Boolean(taskContext) });
  const sources = resolveTaskSources({
    sourceMode: normalizedMode,
    registry,
    taskContext,
    inspectGit,
    pathExists,
  });
  const resolvedWorktrees = Object.fromEntries(
    sources.filter((source) => source.mode === 'worktree').map((source) => [source.serviceId, source.sourcePath]),
  );
  const plan = assertTeardownsAreSafe(buildBootPlan({ registry, slug, worktreePaths: resolvedWorktrees, occupied, resolveImage, readEnv }));
  const sourceByService = new Map(sources.map((source) => [source.serviceId, source]));
  return {
    ...plan,
    sourceMode: normalizedMode,
    services: plan.services.map((service) => ({ ...service, source: sourceByService.get(service.id) })),
  };
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
  const mi = argv.indexOf('--source-mode');
  const sourceMode = mi === -1 ? null : argv[mi + 1];
  if (sourceMode !== null) {
    try {
      normalizeSourceMode(sourceMode, { hasActiveTask: slug !== '_global' });
    } catch (error) {
      console.error(`build-boot-plan: ${error.message}`);
      exit(2);
    }
  }
  if (sourceMode !== null) {
    try {
      const taskContext = sourceMode === 'task-aware'
        ? resolveTaskContext({ workspaceRoot, cwd: process.cwd(), slug })
        : null;
      const plan = buildPlanForWorkspace({
        workspaceRoot,
        slug,
        sourceMode,
        taskContext,
        occupied: dockerOccupied(),
      });
      stdout.write(JSON.stringify(plan, null, 2) + '\n');
    } catch (error) {
      console.error(`build-boot-plan: ${error.message}`);
      exit(3);
    }
    return;
  }
  const registry = readUnifiedRegistry(workspaceRoot);
  const plan = buildBootPlan({ registry, slug, worktreePaths: resolveWorktreePaths(registry, slug), occupied: dockerOccupied() });
  const unsafe = unsafeTeardownEntries(plan);
  if (unsafe.length > 0) {
    for (const u of unsafe) console.error(`build-boot-plan: ${u.id}: ${u.cause}`);
    console.error('build-boot-plan: refusing to emit a plan — fix these dev blocks in services.yaml first');
    exit(3);
  }
  stdout.write(JSON.stringify(plan, null, 2) + '\n');
}

if (import.meta.url === `file://${argv[1]}`) main();
