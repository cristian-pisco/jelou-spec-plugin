// tests/unit/finalize-phase.test.mjs
//
// Smoke tests for bin/finalize-phase.sh — the batched git commit script used
// by execute-task.md Step 7j. Verifies the abort paths and happy path emit
// the documented key=value output and exit codes.
//
// Run: `node --test tests/unit/finalize-phase.test.mjs`

import { test, describe, before, after, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', '..', 'bin', 'finalize-phase.sh');

function parseOutput(stdout) {
  const out = {};
  for (const line of stdout.split('\n')) {
    if (!line.includes('=')) continue;
    const idx = line.indexOf('=');
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function runScript(env) {
  const result = spawnSync('bash', [SCRIPT_PATH], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: parseOutput(result.stdout),
  };
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function setupRepo(branch = 'production/test-task') {
  const dir = mkdtempSync(join(tmpdir(), 'finalize-phase-test-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'checkout', '-q', '-b', branch);
  writeFileSync(join(dir, 'a.ts'), 'hello\n');
  writeFileSync(join(dir, 'b.ts'), 'world\n');
  git(dir, 'add', 'a.ts', 'b.ts');
  git(dir, 'commit', '-q', '-m', 'baseline');
  return dir;
}

const BASE_ENV = {
  FINALIZE_TASK_SLUG: 'test-task',
  FINALIZE_PHASE_NN: '01',
  FINALIZE_PHASE_TITLE: 'smoke',
  FINALIZE_SERVICE_ID: 'svc',
  FINALIZE_COMMIT_TYPE: 'feat',
};

describe('finalize-phase.sh — pre-flight', () => {
  test('aborts when FINALIZE_SOURCE_PATH does not exist', () => {
    const r = runScript({
      ...BASE_ENV,
      FINALIZE_SOURCE_PATH: '/nonexistent-xyz-12345',
      FINALIZE_EXPECTED: 'a.ts',
    });
    assert.equal(r.code, 1);
    assert.equal(r.parsed.status, 'abort');
    assert.equal(r.parsed.reason, 'source_path_missing');
  });

  test('aborts when source path is not a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'finalize-phase-nogit-'));
    try {
      const r = runScript({
        ...BASE_ENV,
        FINALIZE_SOURCE_PATH: dir,
        FINALIZE_EXPECTED: 'a.ts',
      });
      assert.equal(r.code, 1);
      assert.equal(r.parsed.status, 'abort');
      assert.equal(r.parsed.reason, 'not_a_git_repo');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('aborts on wrong branch', () => {
    const dir = setupRepo('main');
    try {
      const r = runScript({
        ...BASE_ENV,
        FINALIZE_SOURCE_PATH: dir,
        FINALIZE_EXPECTED: 'a.ts',
      });
      assert.equal(r.code, 1);
      assert.equal(r.parsed.status, 'abort');
      assert.equal(r.parsed.reason, 'wrong_branch');
      assert.equal(r.parsed.expected_branch, 'production/test-task');
      assert.equal(r.parsed.current_branch, 'main');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('aborts on invalid commit type', () => {
    const dir = setupRepo();
    try {
      const r = runScript({
        ...BASE_ENV,
        FINALIZE_COMMIT_TYPE: 'wat',
        FINALIZE_SOURCE_PATH: dir,
        FINALIZE_EXPECTED: 'a.ts',
      });
      assert.equal(r.code, 1);
      assert.equal(r.parsed.status, 'abort');
      assert.equal(r.parsed.reason, 'invalid_commit_type');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('finalize-phase.sh — scope check', () => {
  test('aborts when diff contains undeclared file', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'a.ts'), 'hello\nmod\n');
      writeFileSync(join(dir, 'b.ts'), 'world\nmod\n');
      const r = runScript({
        ...BASE_ENV,
        FINALIZE_SOURCE_PATH: dir,
        FINALIZE_EXPECTED: 'a.ts',
      });
      assert.equal(r.code, 2);
      assert.equal(r.parsed.status, 'abort');
      assert.equal(r.parsed.reason, 'unexpected_files_in_diff');
      assert.match(r.parsed.unexpected_files, /b\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('allows known auto-staged manifests without declaration', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'a.ts'), 'hello\nmod\n');
      writeFileSync(join(dir, 'package.json'), '{}\n');
      git(dir, 'add', 'package.json');
      git(dir, 'commit', '-q', '-m', 'add manifest');
      writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
      const r = runScript({
        ...BASE_ENV,
        FINALIZE_SOURCE_PATH: dir,
        FINALIZE_EXPECTED: 'a.ts',
      });
      assert.equal(r.code, 0, `expected ok, got: ${r.stdout}\n${r.stderr}`);
      assert.equal(r.parsed.status, 'ok');
      assert.equal(r.parsed.files_committed, '2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('aborts when no changes in working tree', () => {
    const dir = setupRepo();
    try {
      const r = runScript({
        ...BASE_ENV,
        FINALIZE_SOURCE_PATH: dir,
        FINALIZE_EXPECTED: 'a.ts',
      });
      assert.equal(r.code, 1);
      assert.equal(r.parsed.status, 'abort');
      assert.equal(r.parsed.reason, 'no_changes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('finalize-phase.sh — happy path', () => {
  test('commits declared files and returns sha + count', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'a.ts'), 'hello\nmod\n');
      const r = runScript({
        ...BASE_ENV,
        FINALIZE_SOURCE_PATH: dir,
        FINALIZE_EXPECTED: 'a.ts',
      });
      assert.equal(r.code, 0, `expected ok, got: ${r.stdout}\n${r.stderr}`);
      assert.equal(r.parsed.status, 'ok');
      assert.match(r.parsed.commit_sha, /^[0-9a-f]{7,}$/);
      assert.equal(r.parsed.files_committed, '1');

      const log = git(dir, 'log', '--format=%s', '-1').trim();
      assert.equal(log, 'feat(svc): smoke');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('supports multiple expected files via newline separator', () => {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'a.ts'), 'mod a\n');
      writeFileSync(join(dir, 'b.ts'), 'mod b\n');
      const r = runScript({
        ...BASE_ENV,
        FINALIZE_SOURCE_PATH: dir,
        FINALIZE_EXPECTED: 'a.ts\nb.ts',
      });
      assert.equal(r.code, 0, `expected ok, got: ${r.stdout}\n${r.stderr}`);
      assert.equal(r.parsed.status, 'ok');
      assert.equal(r.parsed.files_committed, '2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
