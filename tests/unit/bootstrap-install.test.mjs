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
