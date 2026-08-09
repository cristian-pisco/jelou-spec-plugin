import { test, describe, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'bin', 'task-setup.mjs');
const TASK_SLUG = 'demo-task';

const created = [];

afterEach(() => {
  while (created.length > 0) rmSync(created.pop(), { recursive: true, force: true });
});

function parseOutput(stdout) {
  const out = {};
  for (const line of String(stdout).split('\n')) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

const CONVENTIONS = `# Conventions

## Naming
Repositories end in Repository. Marker AARDVARK.
`;

const STRUCTURE = `# Structure

## Directory Tree
- src/
- test/
Marker BADGER-TREE-MUST-NOT-TRAVEL.

## Module Organization
One module per bounded context.

## File Naming Conventions
kebab-case for files.
`;

function makeWorkspace({ withWorktree = true, withStructure = true, conventions = CONVENTIONS } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'task-setup-ws-'));
  created.push(workspace);

  const repo = join(workspace, 'repos', 'svc');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'file.txt'), 'x\n');
  git(repo, 'add', 'file.txt');
  git(repo, 'commit', '-q', '-m', 'baseline');

  if (withWorktree) {
    const worktree = join(repo, '.worktrees', TASK_SLUG);
    mkdirSync(dirname(worktree), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', `production/${TASK_SLUG}`, worktree);
  }

  mkdirSync(join(workspace, 'registry'), { recursive: true });
  writeFileSync(
    join(workspace, 'registry', 'services.yaml'),
    'services:\n  - id: svc\n    path: repos/svc\n    stack: nestjs\n',
    'utf8',
  );

  const codebase = join(workspace, 'services', 'svc', 'codebase');
  mkdirSync(codebase, { recursive: true });
  if (conventions !== null) writeFileSync(join(codebase, 'CONVENTIONS.md'), conventions, 'utf8');
  if (withStructure) writeFileSync(join(codebase, 'STRUCTURE.md'), STRUCTURE, 'utf8');

  const taskDir = join(workspace, 'specs', '2026-08-09', TASK_SLUG);
  mkdirSync(join(taskDir, 'services', 'svc'), { recursive: true });
  writeFileSync(join(taskDir, 'TASKS.md'), '# Task: demo-task\n', 'utf8');

  return { workspace, repo, taskDir };
}

function runSetup(extraArgs) {
  const result = spawnSync(process.execPath, [SCRIPT, ...extraArgs], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, parsed: parseOutput(result.stdout) };
}

function baseArgs({ workspace, taskDir }) {
  return [
    `--task-dir=${taskDir}`,
    `--workspace=${workspace}`,
    `--task-slug=${TASK_SLUG}`,
    '--services=svc',
  ];
}

describe('task-setup.mjs — argument validation', () => {
  test('aborts when --services is missing', () => {
    const fx = makeWorkspace();
    const r = runSetup([`--task-dir=${fx.taskDir}`, `--workspace=${fx.workspace}`, `--task-slug=${TASK_SLUG}`]);
    assert.equal(r.code, 1);
    assert.equal(r.parsed.reason, 'missing_argument');
  });

  test('aborts when the workspace does not exist', () => {
    const fx = makeWorkspace();
    const r = runSetup([
      `--task-dir=${fx.taskDir}`,
      '--workspace=/nonexistent-task-setup-xyz',
      `--task-slug=${TASK_SLUG}`,
      '--services=svc',
    ]);
    assert.equal(r.code, 1);
    assert.equal(r.parsed.reason, 'workspace_missing');
  });
});

describe('task-setup.mjs — source path resolution is mode-driven', () => {
  test('worktree mode resolves to the task worktree', () => {
    const fx = makeWorkspace();
    const r = runSetup([...baseArgs(fx), '--setup-mode=worktree']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed['service.svc.resolution'], 'worktree');
    assert.equal(r.parsed['service.svc.source_path'], join(fx.repo, '.worktrees', TASK_SLUG));
    assert.match(r.parsed['service.svc.baseline_sha'], /^[0-9a-f]{7,}$/);
  });

  test('worktree mode falls back to the main repo and warns when the worktree is missing', () => {
    const fx = makeWorkspace({ withWorktree: false });
    const r = runSetup([...baseArgs(fx), '--setup-mode=worktree']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed['service.svc.resolution'], 'worktree_missing_fallback_main_repo');
    assert.equal(r.parsed['service.svc.source_path'], fx.repo);
    assert.match(r.stderr, /Worktree missing for svc despite Mode: worktree/);
  });

  test('branch mode ignores a leftover worktree and warns', () => {
    const fx = makeWorkspace();
    const r = runSetup([...baseArgs(fx), '--setup-mode=branch']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed.setup_mode, 'branch');
    assert.equal(r.parsed['service.svc.resolution'], 'branch_mode_leftover_worktree_ignored');
    assert.equal(r.parsed['service.svc.source_path'], fx.repo);
    assert.match(r.stderr, /leftover worktree/);
  });
});

describe('task-setup.mjs — service doc cache', () => {
  test('materializes CONVENTIONS.md plus the two STRUCTURE.md sections and nothing else', () => {
    const fx = makeWorkspace();
    const r = runSetup([...baseArgs(fx)]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed['service.svc.docs_mode'], 'contents');

    const cached = readFileSync(r.parsed['service.svc.docs_file'], 'utf8');
    assert.match(cached, /AARDVARK/);
    assert.match(cached, /## Module Organization/);
    assert.match(cached, /## File Naming Conventions/);
    assert.ok(!cached.includes('BADGER-TREE-MUST-NOT-TRAVEL'), 'the STRUCTURE.md directory tree must never be cached');
  });

  test('degrades to CONVENTIONS.md alone when the STRUCTURE.md sections are absent', () => {
    const fx = makeWorkspace({ withStructure: false });
    const r = runSetup([...baseArgs(fx)]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed['service.svc.docs_mode'], 'contents');
    assert.match(r.stderr, /WARN: SERVICE_DOC_CACHE\[svc\] — STRUCTURE\.md sections unavailable/);
    assert.match(readFileSync(r.parsed['service.svc.docs_file'], 'utf8'), /AARDVARK/);
  });

  test('caches paths instead of contents past the size budget', () => {
    const fx = makeWorkspace({ conventions: `${CONVENTIONS}\n${'x'.repeat(40000)}\n` });
    const r = runSetup([...baseArgs(fx)]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed['service.svc.docs_mode'], 'paths');
    assert.match(r.stderr, /WARN: SERVICE_DOC_CACHE\[svc\] is ~\d+ tokens \(> 8k\) — caching paths instead of contents/);

    const cached = readFileSync(r.parsed['service.svc.docs_file'], 'utf8');
    assert.match(cached, /CONVENTIONS\.md/);
    assert.ok(!cached.includes('AARDVARK'), 'past the budget the cache holds paths, not contents');
  });

  test('reports an absent cache when the service has no codebase docs', () => {
    const fx = makeWorkspace({ conventions: null, withStructure: false });
    const r = runSetup([...baseArgs(fx)]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed['service.svc.docs_mode'], 'absent');
    assert.equal(r.parsed['service.svc.docs_note'], 'conventions_missing');
  });
});

describe('task-setup.mjs — fan-out cap', () => {
  test('delegates the cap to the wave planner and never exceeds the service count', () => {
    const fx = makeWorkspace();
    const r = runSetup([...baseArgs(fx)]);
    assert.equal(r.code, 0, r.stderr);
    const cap = Number(r.parsed.fanout_cap);
    assert.ok(Number.isInteger(cap) && cap >= 1, `expected an integer cap, got ${r.parsed.fanout_cap}`);
    assert.ok(cap <= 1, 'a single-service task can never fan out beyond 1');
  });
});
