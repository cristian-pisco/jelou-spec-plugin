#!/usr/bin/env node
import { argv, exit } from 'node:process';
import { readStackState, staleRunAudit } from './lib/dev-orchestrator/stack/stack-state.mjs';
import { tearDownStack } from './lib/dev-orchestrator/stack/stack-teardown.mjs';

function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] || null;
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function main() {
  const workspaceId = flag('--workspace-id');
  const slug = flag('--slug');
  if (!workspaceId || !slug) {
    console.error('reconcile-stack-run: --workspace-id and --slug are required');
    exit(2);
  }
  const opts = { workspaceId, slug };
  const state = readStackState(opts);
  const audit = staleRunAudit(state, { isAlive: pidIsAlive });

  if (!audit.hasRun) {
    process.stdout.write(JSON.stringify({ status: 'clean' }) + '\n');
    return;
  }
  if (!audit.stale) {
    process.stdout.write(JSON.stringify({ status: 'active', currentRun: audit.currentRun, livePids: audit.livePids }) + '\n');
    exit(1);
  }
  const teardown = tearDownStack({ ...opts, taskSlug: slug, runId: audit.currentRun.runId });
  process.stdout.write(JSON.stringify({ status: 'reconciled', previousRun: audit.currentRun, teardown }) + '\n');
}

main();
