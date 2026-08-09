#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { argv, exit, stdin } from 'node:process';
import { runBootPlan } from './lib/boot-engine/boot-plan-runner.mjs';

function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] || null;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => { data += chunk; });
    stdin.on('end', () => resolve(data));
  });
}

async function main() {
  const planFile = flag('--plan-file');
  const workspaceId = flag('--workspace-id');
  const slug = flag('--slug');
  const runId = flag('--run-id');
  if (!workspaceId || !slug || !runId) {
    console.error('boot-stack: --workspace-id, --slug and --run-id are required');
    exit(2);
  }
  const raw = planFile ? readFileSync(planFile, 'utf8') : await readStdin();
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (error) {
    console.error(`boot-stack: plan is not valid JSON (${error.message}) — pass --plan-file or pipe the build-boot-plan output`);
    exit(2);
    return;
  }
  const only = flag('--only');
  if (only) {
    const wanted = new Set(only.split(',').map((s) => s.trim()).filter(Boolean));
    plan = { ...plan, services: (plan.services || []).filter((entry) => wanted.has(entry.id)) };
  }

  const lifecycle = [];
  const result = await runBootPlan(
    { plan, runIdentity: { workspaceId, taskSlug: slug, runId } },
    { onLifecycle: (event) => lifecycle.push(event) }
  );
  process.stdout.write(JSON.stringify({ ...result, lifecycle }, null, 2) + '\n');
  exit(result.down.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`boot-stack: ${error && error.message || error}`);
  exit(3);
});
