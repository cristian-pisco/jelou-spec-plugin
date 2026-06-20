// tests/unit/bootstrap-install.test.mjs
//
// Tests for install.sh — the remote curl|bash bootstrap. All runs use
// JLU_BOOTSTRAP_DRYRUN=1 so nothing clones or executes; we assert on the
// printed PLAN/REF/CACHE lines and on exit codes.
//
// Run: `node --test tests/unit/bootstrap-install.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', '..', 'install.sh');

function run(args = [], extraEnv = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, JLU_BOOTSTRAP_DRYRUN: '1', ...extraEnv },
  });
}

describe('install.sh — ref resolution', () => {
  test('defaults to main', () => {
    const r = run(['--host', 'claude']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^REF: main$/m);
  });
});

describe('install.sh — flags', () => {
  test('--ref is honored', () => {
    const r = run(['--host', 'codex', '--ref', 'v0.3.235']);
    assert.match(r.stdout, /^REF: v0\.3\.235$/m);
  });
  test('single --host produces exactly that host', () => {
    const r = run(['--host', 'codex']);
    assert.match(r.stdout, /^PLAN: setup --host codex$/m);
  });
  test('multiple --host flags accumulate in order', () => {
    const r = run(['--host', 'claude', '--host', 'opencode']);
    assert.match(r.stdout, /^PLAN: setup --host claude --host opencode$/m);
  });
  test('passthrough flags are forwarded', () => {
    const r = run(['--host', 'opencode', '--project', '/tmp/x']);
    assert.match(r.stdout, /--project \/tmp\/x/);
  });
  test('invalid --host exits 2', () => {
    const r = run(['--host', 'bogus']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--host must be one of/);
  });
  test('unknown option exits 2', () => {
    const r = run(['--frobnicate']);
    assert.equal(r.status, 2);
  });
});

describe('install.sh — auto-detect', () => {
  test('detects the injected set when no --host given', () => {
    const r = run([], { JLU_DETECT_OVERRIDE: 'claude codex' });
    assert.match(r.stdout, /^PLAN: setup --host claude --host codex$/m);
  });
  test('explicit --host overrides detection', () => {
    const r = run(['--host', 'opencode'], { JLU_DETECT_OVERRIDE: 'claude codex' });
    assert.match(r.stdout, /^PLAN: setup --host opencode$/m);
  });
  test('zero hosts detected exits non-zero with guidance', () => {
    const r = run([], { JLU_DETECT_OVERRIDE: ' ' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no supported (CLI|tool)|pass --host/i);
  });
});
