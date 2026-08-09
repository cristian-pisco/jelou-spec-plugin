import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolveWorkspace, computeWorkspaceId, bootPathFor } from '../../bin/lib/dev-orchestrator/workspace.mjs';

function mktree() { return realpathSync(mkdtempSync(join(tmpdir(), 'jlu-ws-'))); }

function seedSpecWorkspace(root) {
  const registry = join(root, '.spec-workspace', 'registry');
  mkdirSync(registry, { recursive: true });
  writeFileSync(join(registry, 'services.yaml'), 'services: {}');
  return join(root, '.spec-workspace');
}

function gitInit(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir });
}

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

describe('resolveWorkspace — .spec-workspace registry', () => {
  test('resolves to .spec-workspace from the workspace root', () => {
    const root = mktree();
    const specWorkspace = seedSpecWorkspace(root);
    assert.equal(resolveWorkspace(root).root, specWorkspace);
  });

  test('resolves to .spec-workspace from a nested service directory', () => {
    const root = mktree();
    const specWorkspace = seedSpecWorkspace(root);
    const service = join(root, 'agent-harness-service');
    mkdirSync(service, { recursive: true });
    assert.equal(resolveWorkspace(service).root, specWorkspace);
  });

  test('a nested git repo never outranks the parent .spec-workspace', () => {
    const root = mktree();
    const specWorkspace = seedSpecWorkspace(root);
    const service = join(root, 'agent-harness-service');
    mkdirSync(service, { recursive: true });
    gitInit(service);
    assert.equal(resolveWorkspace(service, { allowGitFallback: true }).root, specWorkspace);
  });

  test('jelou-registry.yaml alone is enough of a marker', () => {
    const root = mktree();
    const registry = join(root, '.spec-workspace', 'registry');
    mkdirSync(registry, { recursive: true });
    writeFileSync(join(registry, 'jelou-registry.yaml'), 'services: {}');
    assert.equal(resolveWorkspace(root).root, join(root, '.spec-workspace'));
  });

  test('jlu-services.json still outranks a .spec-workspace at the same level', () => {
    const root = mktree();
    seedSpecWorkspace(root);
    writeFileSync(join(root, 'jlu-services.json'), '{}');
    assert.equal(resolveWorkspace(root).root, root);
  });
});

describe('resolveWorkspace — git fallback is opt-in', () => {
  test('a marker-less git repo throws NO_WORKSPACE by default', () => {
    const root = mktree();
    gitInit(root);
    assert.throws(() => resolveWorkspace(root), err => err && err.code === 'NO_WORKSPACE');
  });

  test('the same repo resolves when allowGitFallback is passed', () => {
    const root = mktree();
    gitInit(root);
    assert.equal(resolveWorkspace(root, { allowGitFallback: true }).root, root);
  });
});

describe('bootPathFor', () => {
  test('a workspace holding jlu-services.json takes the tmux path', () => {
    const root = mktree();
    writeFileSync(join(root, 'jlu-services.json'), '{}');
    assert.equal(bootPathFor(resolveWorkspace(root)), 'tmux');
  });

  test('a registry-only workspace takes the jelou-stack path', () => {
    const root = mktree();
    seedSpecWorkspace(root);
    assert.equal(bootPathFor(resolveWorkspace(root)), 'jelou-stack');
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
