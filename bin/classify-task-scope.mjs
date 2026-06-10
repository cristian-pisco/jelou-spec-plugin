#!/usr/bin/env node
// bin/classify-task-scope.mjs — classify a task as `fullstack` or `full-backend`.
//
// A task is `fullstack` when at least one affected service is a UI service;
// otherwise it is `full-backend`. UI detection mirrors ui-qa-run.md Phase 2
// step 11: a service is UI when its `stack` is a known frontend framework, or
// (legacy fallback) its `description` matches a frontend keyword.
//
// Usage:
//   node bin/classify-task-scope.mjs '<json>'   # json = [{id,stack,description}, ...]
//   node bin/classify-task-scope.mjs --version
//
// Prints { scope, ui_services, backend_services, warnings }. Exits 0 on success;
// exits 1 with a stderr message on empty/invalid input.

import { argv, stdout, stderr, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.0';

const UI_STACKS = ['react', 'nextjs', 'vue', 'angular', 'svelte'];
const UI_DESC_RE = /(react|next\.?js|vue|angular|svelte|frontend|ui app|operator app)/i;

function isUiByStack(stack) {
  return typeof stack === 'string' && UI_STACKS.includes(stack.trim().toLowerCase());
}

function isUiByDescription(description) {
  return typeof description === 'string' && UI_DESC_RE.test(description);
}

export function classifyTaskScope(services) {
  if (!Array.isArray(services) || services.length === 0) {
    throw new Error(
      'classify-task-scope: affected_services is empty — a task with at least one affected service is required',
    );
  }
  const ui_services = [];
  const backend_services = [];
  const warnings = [];
  for (const svc of services) {
    const id = svc && svc.id;
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('classify-task-scope: each service needs a non-empty string id');
    }
    const byStack = isUiByStack(svc.stack);
    const byDesc = !byStack && isUiByDescription(svc.description);
    if (byStack || byDesc) {
      ui_services.push(id);
      if (byDesc) {
        warnings.push(
          `service '${id}' detected as UI by description but has no stack field — set stack: <react|nextjs|vue|angular|svelte> in services.yaml`,
        );
      }
    } else {
      backend_services.push(id);
    }
  }
  const scope = ui_services.length > 0 ? 'fullstack' : 'full-backend';
  return { scope, ui_services, backend_services, warnings };
}

function main() {
  const arg = argv[2];
  if (arg === '--version') {
    stdout.write(`${VERSION}\n`);
    exit(0);
  }
  let services;
  try {
    services = JSON.parse(arg);
  } catch {
    stderr.write('classify-task-scope: argument must be a JSON array of {id,stack,description}\n');
    exit(1);
  }
  let result;
  try {
    result = classifyTaskScope(services);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    exit(1);
  }
  stdout.write(`${JSON.stringify(result)}\n`);
  exit(0);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
