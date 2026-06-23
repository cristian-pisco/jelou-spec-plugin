#!/usr/bin/env node
// bin/runtime-exec.mjs
//
// Resolves a service's dev runtime from jlu-services.json and prints the command
// prefix needed to run a command in the right context (empty for host, a
// `docker compose ... exec ...` prefix for docker-compose). Used by the build
// preflight so jlu-build-validator runs the build where the service's deps live.
//
// Usage: node bin/runtime-exec.mjs <service-name> [--cwd <dir>]

import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace } from './lib/dev-orchestrator/workspace.mjs';
import { readConfig } from './lib/dev-orchestrator/config.mjs';
import { resolveRuntimeExec } from './lib/runtime-exec.mjs';

function parseArgs(argv) {
  const rest = argv.slice(2);
  const out = { cwd: process.cwd(), service: null };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--cwd') out.cwd = rest[++i];
    else if (out.service === null) out.service = rest[i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.service) {
    console.error('usage: runtime-exec.mjs <service-name> [--cwd <dir>]');
    process.exit(2);
  }
  const startDir = isAbsolute(args.cwd) ? args.cwd : resolve(args.cwd);
  let service = null;
  try {
    const { configPath } = resolveWorkspace(startDir);
    const cfg = readConfig(configPath);
    service = (cfg.services || []).find((s) => s.name === args.service) || null;
  } catch {
    // No workspace / config → host.
  }
  const { runtime, execPrefix } = resolveRuntimeExec({ service });
  console.log(`RUNTIME: ${runtime}`);
  console.log(`EXEC_PREFIX: ${execPrefix}`);
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
