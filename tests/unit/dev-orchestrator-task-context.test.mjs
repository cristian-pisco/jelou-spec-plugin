import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTaskSlug } from '../../bin/lib/dev-orchestrator/task-context.mjs';

function mkws() {
  const root = mkdtempSync(join(tmpdir(), 'jlu-tc-'));
  mkdirSync(join(root, 'tasks'), { recursive: true });
  return root;
}

describe('resolveTaskSlug — explicit override wins', () => {
  test('returns the explicit override', () => {
    const root = mkws();
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, override: 'my-task' });
    assert.equal(slug, 'my-task');
  });
});

describe('resolveTaskSlug — worktree path detection', () => {
  test('extracts slug from .worktrees/<slug>/ path', () => {
    const root = mkws();
    const cwd = join(root, 'service-a', '.worktrees', 'auth-refactor', 'sub');
    mkdirSync(cwd, { recursive: true });
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd });
    assert.equal(slug, 'auth-refactor');
  });
});

describe('resolveTaskSlug — branch-name detection', () => {
  test('matches task/<slug> branch with TASKS.md present', () => {
    const root = mkws();
    mkdirSync(join(root, 'tasks', 'auth-refactor'));
    writeFileSync(join(root, 'tasks', 'auth-refactor', 'TASKS.md'), '# State: implementing');
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, branch: 'task/auth-refactor' });
    assert.equal(slug, 'auth-refactor');
  });

  test('matches spec/<slug> branch', () => {
    const root = mkws();
    mkdirSync(join(root, 'tasks', 'foo'));
    writeFileSync(join(root, 'tasks', 'foo', 'TASKS.md'), '# State: planned');
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, branch: 'spec/foo' });
    assert.equal(slug, 'foo');
  });
});

describe('resolveTaskSlug — TASKS.md scan single in-flight', () => {
  test('returns the unique task in implementing state', () => {
    const root = mkws();
    mkdirSync(join(root, 'tasks', 'alpha'));
    writeFileSync(join(root, 'tasks', 'alpha', 'TASKS.md'), '## State\nState: implementing');
    mkdirSync(join(root, 'tasks', 'beta'));
    writeFileSync(join(root, 'tasks', 'beta', 'TASKS.md'), '## State\nState: closed');
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, branch: 'main' });
    assert.equal(slug, 'alpha');
  });
});

describe('resolveTaskSlug — fallback', () => {
  test('returns _global when nothing matches', () => {
    const root = mkws();
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, branch: 'main' });
    assert.equal(slug, '_global');
  });

  test('returns AMBIGUOUS marker when multiple in-flight', () => {
    const root = mkws();
    for (const s of ['a', 'b']) {
      mkdirSync(join(root, 'tasks', s));
      writeFileSync(join(root, 'tasks', s, 'TASKS.md'), 'State: implementing');
    }
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, branch: 'main' });
    assert.equal(slug, 'AMBIGUOUS:a,b');
  });
});
