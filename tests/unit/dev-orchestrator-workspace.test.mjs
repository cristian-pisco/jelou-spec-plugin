import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { resolveWorkspace, computeWorkspaceId } from '../../bin/lib/dev-orchestrator/workspace.mjs';

function mktree() { return mkdtempSync(join(tmpdir(), 'jlu-ws-')); }

describe('resolveWorkspace — direct config hit', () => {
  test('finds jlu-services.json in cwd', () => {
    const root = mktree();
    writeFileSync(join(root, 'jlu-services.json'), '{}');
    const r = resolveWorkspace(root);
    assert.equal(r.root, root);
    assert.equal(r.configPath, join(root, 'jlu-services.json'));
  });

  test('finds jlu-services.json in ancestor', () => {
    const root = mktree();
    writeFileSync(join(root, 'jlu-services.json'), '{}');
    const sub = join(root, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    const r = resolveWorkspace(sub);
    assert.equal(r.root, root);
  });
});

describe('resolveWorkspace — canonical workspace structure', () => {
  test('finds registry/services.yaml + tasks/ pair', () => {
    const root = mktree();
    mkdirSync(join(root, 'registry'));
    writeFileSync(join(root, 'registry', 'services.yaml'), 'services: []');
    mkdirSync(join(root, 'tasks'));
    const r = resolveWorkspace(root);
    assert.equal(r.root, root);
    assert.equal(r.configPath, join(root, 'jlu-services.json'));
  });
});

describe('resolveWorkspace — fallback throws NO_WORKSPACE', () => {
  test('throws Error with code NO_WORKSPACE when no marker and no git repo', () => {
    const root = mktree();
    // GIT_CEILING_DIRECTORIES guards against tmpdir() being inside a git repo.
    const prev = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = root;
    try {
      assert.throws(
        () => resolveWorkspace(root),
        err => err && err.code === 'NO_WORKSPACE'
      );
    } finally {
      if (prev === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = prev;
    }
  });
});

describe('computeWorkspaceId', () => {
  test('returns first 12 chars of sha256 of absolute path', () => {
    const id = computeWorkspaceId('/abs/path');
    const expected = createHash('sha256').update('/abs/path').digest('hex').slice(0, 12);
    assert.equal(id, expected);
    assert.equal(id.length, 12);
  });

  test('is deterministic', () => {
    assert.equal(computeWorkspaceId('/x'), computeWorkspaceId('/x'));
  });
});
