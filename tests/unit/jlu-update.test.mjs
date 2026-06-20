// tests/unit/jlu-update.test.mjs
//
// Tests for bin/jlu-update.sh — the local, in-runtime plugin updater behind
// /jlu-update. Dry runs (JLU_UPDATE_DRYRUN=1) assert on the printed
// REF/CACHE/HOST/PLAN lines and exit codes; nothing is pulled or installed.
//
// Run: `node --test tests/unit/jlu-update.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', '..', 'bin', 'jlu-update.sh');

function makeCache(version = '0.3.240') {
  const dir = mkdtempSync(join(tmpdir(), 'jlu-cache-'));
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, 'package.json'), `{ "version": "${version}" }\n`);
  return dir;
}

function run(args = [], extraEnv = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, JLU_UPDATE_DRYRUN: '1', ...extraEnv },
  });
}

describe('jlu-update.sh — argument validation', () => {
  test('missing --host exits 2', () => {
    const r = run([], { JLU_HOME: '/nonexistent' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--host is required/);
  });
  test('invalid --host exits 2', () => {
    const r = run(['--host', 'bogus']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--host must be one of/);
  });
  test('unknown option exits 2', () => {
    const r = run(['--frobnicate'], { JLU_HOME: '/nonexistent' });
    assert.equal(r.status, 2);
  });
});

describe('jlu-update.sh — cache resolution', () => {
  test('uses JLU_HOME when it is a git repo', () => {
    const cache = makeCache();
    try {
      const r = run(['--host', 'codex'], { JLU_HOME: cache });
      assert.equal(r.status, 0);
      assert.match(r.stdout, new RegExp(`^CACHE: ${cache}$`, 'm'));
      assert.match(r.stdout, /^HOST: codex$/m);
      assert.match(r.stdout, /^PLAN: setup --host codex$/m);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
  test('defaults REF to main and honors --ref', () => {
    const cache = makeCache();
    try {
      assert.match(run(['--host', 'opencode'], { JLU_HOME: cache }).stdout, /^REF: main$/m);
      assert.match(
        run(['--host', 'opencode', '--ref', 'v0.3.235'], { JLU_HOME: cache }).stdout,
        /^REF: v0\.3\.235$/m,
      );
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
  test('falls back to --source when JLU_HOME is not a git repo', () => {
    const cache = makeCache();
    try {
      const r = run(['--host', 'codex', '--source', cache], { JLU_HOME: '/nonexistent' });
      assert.equal(r.status, 0);
      assert.match(r.stdout, new RegExp(`^CACHE: ${cache}$`, 'm'));
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});

describe('jlu-update.sh — no cache guidance', () => {
  test('codex without a cache exits 3 with the reinstall one-liner', () => {
    const r = run(['--host', 'codex'], { JLU_HOME: '/nonexistent' });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /No local plugin git cache/);
    assert.match(r.stderr, /install\.sh \| bash -s -- --host codex/);
  });
  test('claude without a cache exits 0 and points to the marketplace', () => {
    const r = run(['--host', 'claude'], { JLU_HOME: '/nonexistent' });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /\/plugin update jlu@jelou-spec-plugin/);
  });
});
