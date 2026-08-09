// tests/unit/boot-dev-server.test.mjs
//
// boot-dev-server.mjs launches a dev server with env loaded from .env files via a robust
// parser (never bash source) and execs the command with the merged env. This pins that the
// child actually receives the overlay, that exit codes propagate, and that the boot contract
// + auth drivers are wired to the parser instead of `source`.
//
// Run: `node --test tests/unit/boot-dev-server.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOOT = join(ROOT, 'bin', 'boot-dev-server.mjs');

function run(args) {
  try {
    const stdout = execFileSync('node', [BOOT, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('boot-dev-server — env injection + exit handling', () => {
  let dir;
  test('setup', () => {
    dir = mkdtempSync(join(tmpdir(), 'jlu-bootdev-'));
    writeFileSync(join(dir, '.env'), 'TARGET=https://api.apps.jelou.ai/api\nWEIRD=a b&c\n');
    writeFileSync(join(dir, '.env.e2e'), 'TARGET=http://localhost:8484/api\n');
  });

  test('the spawned command receives the .env.e2e overlay over .env', () => {
    const r = run([
      '--worktree', dir,
      '--cmd', 'node -e "process.stdout.write(process.env.TARGET||\'UNSET\')"',
    ]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, 'http://localhost:8484/api');
  });

  test('a bash-hostile unquoted value is delivered intact (no shell execution)', () => {
    const r = run([
      '--worktree', dir,
      '--cmd', 'node -e "process.stdout.write(process.env.WEIRD||\'UNSET\')"',
    ]);
    assert.equal(r.stdout, 'a b&c');
  });

  test('propagates the child exit code', () => {
    const r = run(['--worktree', dir, '--cmd', 'exit 7']);
    assert.equal(r.code, 7);
  });

  test('usage error without --cmd exits 2', () => {
    const r = run(['--worktree', dir]);
    assert.equal(r.code, 2);
  });

  test('teardown', () => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('boot-dev-server — wiring into the boot contract and auth drivers', () => {
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');

  test('env-lifecycle npm/make/shell launcher uses boot-dev-server, not bash source', () => {
    const env = read('jelou/references/env-lifecycle.md');
    assert.match(env, /bin\/boot-dev-server\.mjs/);
    assert.match(env, /never bash `?source`?|NEVER bash `?source`?/i);
  });

  test('the auth drivers self-load env files from UI_WORKTREE via the parser', () => {
    for (const f of ['bin/e2e-session-probe.mjs', 'bin/e2e-login.mjs', 'bin/e2e-session-sync.mjs']) {
      const src = read(f);
      assert.match(src, /applyEnvFiles/, `${f} should self-load env files`);
      assert.match(src, /lib\/env-files\.mjs/, `${f} should import the parser lib`);
    }
  });
});
