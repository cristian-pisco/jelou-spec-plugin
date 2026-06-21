#!/usr/bin/env node
// bin/install-dep.mjs
//
// Runtime-aware dependency installer. Detects the service's dev runtime from
// jlu-services.json and installs in the right context:
//   - host runtime (or unregistered service)  → install on the host (current behavior)
//   - docker-compose runtime                   → ensure the container is up (boot if
//                                                 down), then install INSIDE it
//
// Usage:
//   node bin/install-dep.mjs <service-name> <pkg>[ <pkg> ...] [--dev] [--cwd <dir>]
//
// The planning logic lives in bin/lib/install-dep.mjs (pure, unit-tested).

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { resolveWorkspace } from './lib/dev-orchestrator/workspace.mjs';
import { readConfig } from './lib/dev-orchestrator/config.mjs';
import { planInstall } from './lib/install-dep.mjs';

function parseArgs(argv) {
  const rest = argv.slice(2);
  const out = { dev: false, cwd: process.cwd(), packages: [], service: null };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--dev' || a === '-D') out.dev = true;
    else if (a === '--cwd') out.cwd = rest[++i];
    else if (out.service === null) out.service = a;
    else out.packages.push(a);
  }
  return out;
}

const defaultRunner = (cmd, { cwd } = {}) =>
  spawnSync('sh', ['-lc', cmd], { cwd, stdio: 'inherit', encoding: 'utf8' });

// `check` runs without inherited stdio so we can read the service list back.
function isContainerRunning(step, cwd) {
  const r = spawnSync('sh', ['-lc', step.cmd], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return false;
  return (r.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .includes(step.expectService);
}

export function executeInstall({
  plan,
  serviceDir,
  runner = defaultRunner,
  probe = (step) => isContainerRunning(step, serviceDir),
  log = console.error
}) {
  for (const w of plan.warnings) log(`warning: ${w}`);

  if (plan.runtime === 'host') {
    log(`service runtime=host → installing on the host (${plan.packageManager})`);
    const r = runner(plan.steps[0].cmd, { cwd: serviceDir });
    return r.status === 0 ? 0 : (r.status || 1);
  }

  let running = false;
  for (const step of plan.steps) {
    if (step.kind === 'check') {
      running = probe(step);
      log(`container '${plan.composeService}' ${running ? 'is running' : 'is not running'}`);
      continue;
    }
    if (step.kind === 'boot') {
      if (running) {
        log(`skipping boot — '${plan.composeService}' already up`);
        continue;
      }
      log(`booting '${plan.composeService}' (docker compose up -d)`);
      const r = runner(step.cmd, { cwd: serviceDir });
      if (r.status !== 0) {
        log(`error: failed to boot '${plan.composeService}' — cannot install inside it`);
        return r.status || 1;
      }
      continue;
    }
    if (step.kind === 'install') {
      log(`installing inside container '${plan.composeService}' (${plan.packageManager})`);
      const r = runner(step.cmd, { cwd: serviceDir });
      return r.status === 0 ? 0 : (r.status || 1);
    }
  }
  return 0;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.service || args.packages.length === 0) {
    console.error('usage: install-dep.mjs <service-name> <pkg>[ <pkg> ...] [--dev] [--cwd <dir>]');
    process.exit(2);
  }

  const startDir = isAbsolute(args.cwd) ? args.cwd : resolve(args.cwd);
  let service = null;
  let serviceDir = startDir;

  try {
    const { configPath, root } = resolveWorkspace(startDir);
    const cfg = readConfig(configPath);
    service = (cfg.services || []).find((s) => s.name === args.service) || null;
    if (service && service.path) {
      serviceDir = isAbsolute(service.path) ? service.path : resolve(root, service.path);
    }
  } catch {
    // No workspace / no config → fall back to a host install in --cwd.
  }

  if (!service) {
    console.error(`service '${args.service}' not registered in jlu-services.json → host install in ${serviceDir}`);
  }

  const plan = planInstall({ service, serviceDir, packages: args.packages, dev: args.dev });
  process.exit(executeInstall({ plan, serviceDir }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
