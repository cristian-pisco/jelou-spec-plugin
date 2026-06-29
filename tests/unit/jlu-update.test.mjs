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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SCRIPT = join(HERE, '..', '..', 'bin', 'jlu-update.sh');

function makeCache(version = '0.3.240') {
  const dir = mkdtempSync(join(tmpdir(), 'jlu-cache-'));
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, 'package.json'), `{ "version": "${version}" }\n`);
  return dir;
}

function makeShim(log) {
  const dir = mkdtempSync(join(tmpdir(), 'jlu-shim-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/usr/bin/env bash\necho "$*" >> "${log}"\necho "ok"\n`);
  chmodSync(bin, 0o755);
  return { dir, bin };
}

function makeScriptCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'jlu-script-'));
  const binDir = join(dir, 'bin');
  mkdirSync(binDir);
  const script = join(binDir, 'jlu-update.sh');
  writeFileSync(script, readFileSync(SCRIPT, 'utf8'));
  chmodSync(script, 0o755);
  return { dir, script };
}

function run(args = [], extraEnv = {}, script = SCRIPT) {
  return spawnSync('bash', [script, ...args], {
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
  test('falls back to the script repo when JLU_HOME is not a git repo', () => {
    const r = run(['--host', 'codex'], { JLU_HOME: '/nonexistent' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, new RegExp(`^CACHE: ${ROOT}$`, 'm'));
    assert.match(r.stdout, /^HOST: codex$/m);
    assert.match(r.stdout, /^PLAN: setup --host codex$/m);
  });
});

describe('jlu-update.sh — cache bootstrap', () => {
  test('codex without any git cache plans a cache clone and reinstall', () => {
    const copy = makeScriptCopy();
    const cache = join(copy.dir, 'cache');
    try {
      const r = run(['--host', 'codex'], { JLU_HOME: cache }, copy.script);
      assert.equal(r.status, 0);
      assert.match(r.stdout, new RegExp(`^CACHE: ${cache}$`, 'm'));
      assert.match(r.stdout, /^HOST: codex$/m);
      assert.match(r.stdout, /PLAN: clone https:\/\/github\.com\/cristian-pisco\/jelou-spec-plugin -> /);
      assert.match(r.stdout, /^PLAN: setup --host codex$/m);
    } finally {
      rmSync(copy.dir, { recursive: true, force: true });
    }
  });
});

describe('jlu-update.sh — claude (marketplace install, no git cache)', () => {
  test('dry run shows the plugin-CLI plan when the CLI is on PATH', () => {
    const shim = makeShim('/dev/null');
    try {
      const r = run(['--host', 'claude'], { JLU_HOME: '/nonexistent', JLU_CLAUDE_CLI: shim.bin });
      assert.equal(r.status, 0);
      assert.match(r.stdout, /^HOST: claude$/m);
      assert.match(r.stdout, /^PLAN: .*plugin update jlu@jelou-spec-plugin$/m);
    } finally {
      rmSync(shim.dir, { recursive: true, force: true });
    }
  });

  test('applied run invokes marketplace update then plugin update', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'jlu-log-'));
    const log = join(logDir, 'calls.txt');
    const shim = makeShim(log);
    try {
      const r = run(['--host', 'claude'], {
        JLU_HOME: '/nonexistent',
        JLU_CLAUDE_CLI: shim.bin,
        JLU_UPDATE_DRYRUN: '0',
      });
      assert.equal(r.status, 0);
      const calls = readFileSync(log, 'utf8');
      assert.match(calls, /plugin marketplace update jelou-spec-plugin/);
      assert.match(calls, /plugin update jlu@jelou-spec-plugin/);
      assert.match(r.stdout, /Restart Claude Code/);
    } finally {
      rmSync(shim.dir, { recursive: true, force: true });
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  test('falls back to /plugin update guidance when the claude CLI is absent', () => {
    const r = run(['--host', 'claude'], {
      JLU_HOME: '/nonexistent',
      JLU_CLAUDE_CLI: '/nonexistent/claude',
    });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /\/plugin update jlu@jelou-spec-plugin/);
  });
});
