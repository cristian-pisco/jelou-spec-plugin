#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `task-setup.mjs — one call per task for execute-task Step 6.

Per affected service it resolves the source path (mode-driven, per
jelou/references/worktree-resolution.md) and records the pre-execution baseline
SHA. It also resolves the fan-out cap through
bin/plan-phase-waves.mjs --emit-cap-only, which owns the formula.

  --workspace=<abs path>    REQUIRED (spec workspace root)
  --task-slug=<slug>        REQUIRED
  --setup-mode=<worktree|branch>   defaults to worktree
  --services=<a,b,c>        REQUIRED (affected service ids)

Output: key=value lines on stdout, one block per service prefixed
\`service.<id>.\`, plus \`fanout_cap=\`. WARN lines go to stderr and are advisory.
Exit 0 on success, 1 with status=abort + reason=<machine-readable> otherwise.`;

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function abort(reason, message) {
  process.stdout.write('status=abort\n');
  process.stdout.write(`reason=${reason}\n`);
  process.stderr.write(`task-setup: ${message}\n`);
  process.exit(1);
}

function warn(message) {
  process.stderr.write(`${message}\n`);
}

function splitList(value) {
  if (!value || value === true) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function servicePathsFrom(text) {
  const byId = {};
  let currentId = null;
  let currentIndent = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    const listItem = line.trim().match(/^-\s+id:\s*(.+)$/);
    if (listItem) {
      currentId = listItem[1].trim().replace(/^["']|["']$/g, '');
      currentIndent = indent;
      byId[currentId] = byId[currentId] ?? null;
      continue;
    }

    const mapKey = line.match(/^\s{2,}([A-Za-z0-9._-]+):\s*$/);
    if (mapKey && indent <= 2) {
      currentId = mapKey[1];
      currentIndent = indent;
      byId[currentId] = byId[currentId] ?? null;
      continue;
    }

    if (currentId === null) continue;
    if (indent <= currentIndent && !line.trim().startsWith('path:')) {
      if (/^\S/.test(line)) currentId = null;
      continue;
    }
    const pathKey = line.trim().match(/^path:\s*(.+)$/);
    if (pathKey && byId[currentId] === null) {
      byId[currentId] = pathKey[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return byId;
}

function readServicesYaml(workspace) {
  const path = join(workspace, 'registry', 'services.yaml');
  if (!existsSync(path)) return {};
  return servicePathsFrom(readFileSync(path, 'utf8'));
}

function repoRootFor(workspace, declaredPath, serviceId) {
  return resolve(workspace, declaredPath || serviceId);
}

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function baselineSha(sourcePath) {
  const result = spawnSync('git', ['-C', sourcePath, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

for (const required of ['workspace', 'task-slug', 'services']) {
  if (!args[required] || args[required] === true) abort('missing_argument', `--${required} required`);
}

const workspace = resolve(args.workspace);
if (!isDirectory(workspace)) abort('workspace_missing', `workspace not found: ${workspace}`);

const services = splitList(args.services);
if (services.length === 0) abort('no_services', '--services resolved to an empty list');

const setupMode = args['setup-mode'] === 'branch' ? 'branch' : 'worktree';
const taskSlug = String(args['task-slug']);
const registry = readServicesYaml(workspace);
const binDir = dirname(fileURLToPath(import.meta.url));

const emitted = ['status=ok', `setup_mode=${setupMode}`];

for (const serviceId of services) {
  const repoRoot = repoRootFor(workspace, registry[serviceId], serviceId);
  const worktreePath = join(repoRoot, '.worktrees', taskSlug);
  let sourcePath = repoRoot;
  let resolution = 'main_repo';

  if (setupMode === 'worktree') {
    if (isDirectory(worktreePath)) {
      sourcePath = worktreePath;
      resolution = 'worktree';
    } else {
      resolution = 'worktree_missing_fallback_main_repo';
      warn(`WARN: Worktree missing for ${serviceId} despite Mode: worktree — using main repo.`);
    }
  } else if (isDirectory(worktreePath)) {
    resolution = 'branch_mode_leftover_worktree_ignored';
    warn(`WARN: Branch-mode task ${taskSlug} has a leftover worktree at ${worktreePath}. Ignoring it for execution; remove it with git worktree remove.`);
  }

  emitted.push(`service.${serviceId}.source_path=${sourcePath}`);
  emitted.push(`service.${serviceId}.resolution=${resolution}`);

  if (!isDirectory(sourcePath)) {
    emitted.push(`service.${serviceId}.baseline_sha=`);
    warn(`WARN: Source path missing for ${serviceId}: ${sourcePath}`);
    continue;
  }

  emitted.push(`service.${serviceId}.baseline_sha=${baselineSha(sourcePath)}`);
}

const cap = spawnSync(
  process.execPath,
  [join(binDir, 'plan-phase-waves.mjs'), '--emit-cap-only', `--limit=${services.length}`],
  { encoding: 'utf8' },
);
emitted.push(`fanout_cap=${cap.status === 0 ? cap.stdout.trim() : '1'}`);

process.stdout.write(`${emitted.join('\n')}\n`);
