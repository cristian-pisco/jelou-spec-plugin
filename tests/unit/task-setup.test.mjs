import { test, describe, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function makeWorkspace({ withWorktree = true } = {}) {
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
  writeFileSync(join(codebase, 'CONVENTIONS.md'), '# Conventions\nMarker AARDVARK.\n', 'utf8');
  writeFileSync(join(codebase, 'STRUCTURE.md'), '# Structure\nMarker BADGER.\n', 'utf8');

  const taskDir = join(workspace, 'specs', '2026-08-09', TASK_SLUG);
  mkdirSync(join(taskDir, 'services', 'svc'), { recursive: true });
  writeFileSync(join(taskDir, 'TASKS.md'), '# Task: demo-task\n', 'utf8');

  return { workspace, repo, taskDir };
}

function runSetup(extraArgs) {
  const result = spawnSync(process.execPath, [SCRIPT, ...extraArgs], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, parsed: parseOutput(result.stdout) };
}

function baseArgs({ workspace }) {
  return [
    `--workspace=${workspace}`,
    `--task-slug=${TASK_SLUG}`,
    '--services=svc',
  ];
}

describe('task-setup.mjs — argument validation', () => {
  test('aborts when --services is missing', () => {
    const fx = makeWorkspace();
    const r = runSetup([`--workspace=${fx.workspace}`, `--task-slug=${TASK_SLUG}`]);
    assert.equal(r.code, 1);
    assert.equal(r.parsed.reason, 'missing_argument');
  });

  test('aborts when the workspace does not exist', () => {
    const fx = makeWorkspace();
    const r = runSetup([
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

describe('task-setup.mjs — generated codebase docs are never touched', () => {
  test('emits no docs keys and writes no doc cache, even when the docs exist', () => {
    const fx = makeWorkspace();
    const r = runSetup([...baseArgs(fx)]);
    assert.equal(r.code, 0, r.stderr);

    for (const key of Object.keys(r.parsed)) {
      assert.ok(!key.startsWith('service.svc.docs'), `unexpected docs key emitted: ${key}`);
    }
    assert.doesNotMatch(r.stderr, /SERVICE_DOC_CACHE/);
    assert.ok(!existsSync(join(fx.taskDir, 'services', 'svc', 'service-docs.md')));
    assert.doesNotMatch(r.stdout, /AARDVARK|BADGER/);
  });

  test('a missing source path still emits an empty baseline and no docs keys', () => {
    const fx = makeWorkspace({ withWorktree: false });
    writeFileSync(
      join(fx.workspace, 'registry', 'services.yaml'),
      'services:\n  - id: svc\n    path: repos/ghost\n    stack: nestjs\n',
      'utf8',
    );
    const r = runSetup([...baseArgs(fx), '--setup-mode=worktree']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed['service.svc.baseline_sha'], '');
    for (const key of Object.keys(r.parsed)) {
      assert.ok(!key.startsWith('service.svc.docs'), `unexpected docs key emitted: ${key}`);
    }
    assert.match(r.stderr, /WARN: Source path missing for svc/);
    assert.doesNotMatch(r.stderr, /SERVICE_DOC_CACHE/);
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
