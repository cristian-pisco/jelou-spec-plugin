#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import { readUnifiedRegistry } from './lib/registry/read.mjs';
import { hostByService } from './lib/boot-engine/host-map.mjs';
import { rewriteE2eEnv, E2E_ENV_FILE } from './lib/dev-orchestrator/stack/e2e-env.mjs';

function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1] || null;
}

function main() {
  const uiWorktree = flag('ui-worktree');
  const planPath = flag('plan');
  const workspace = flag('workspace');
  const frontendHost = flag('frontend-host');
  if (!uiWorktree || !planPath || !workspace) {
    console.error('rewrite-e2e-env: --ui-worktree <dir> --plan <plan.json> --workspace <root> [--frontend-host <port>] required');
    exit(2);
  }

  const target = join(uiWorktree, E2E_ENV_FILE);
  if (!existsSync(target)) {
    console.error(`rewrite-e2e-env: ${target} not found. The E2E overlay carries credentials this tool cannot synthesize — create it from the service's documented template (or an existing worktree copy) and re-run. Never boot the frontend without it: it bakes production URLs into the bundle.`);
    exit(4);
  }

  const registry = readUnifiedRegistry(workspace);
  if (!registry.frontend || !registry.frontend.envLocal) {
    console.error('rewrite-e2e-env: the unified registry declares no frontend.envLocal — nothing to wire.');
    exit(5);
  }

  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const { hostByService: hosts } = hostByService({ plan, registry });
  const isolated = plan.services.filter((s) => s.policy === 'task-isolated').map((s) => s.id);

  let out;
  try {
    out = rewriteE2eEnv({
      envText: readFileSync(target, 'utf8'),
      envLocal: registry.frontend.envLocal,
      envBlank: registry.frontend.envBlank,
      hostByService: hosts,
      manageOnly: isolated,
      frontendHost: frontendHost === null ? null : Number(frontendHost)
    });
  } catch (err) {
    console.error(`rewrite-e2e-env: ${err.message}`);
    exit(5);
  }

  writeFileSync(target, out.text, 'utf8');
  console.log(JSON.stringify({ file: target, managed: out.managed }, null, 2));
}

main();
