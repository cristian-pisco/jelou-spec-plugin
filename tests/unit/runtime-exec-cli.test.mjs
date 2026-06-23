import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', '..', 'bin', 'runtime-exec.mjs');

function run(args, cwd) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd });
}

describe('runtime-exec CLI', () => {
  test('unregistered service in a non-workspace dir → empty prefix, host', () => {
    const r = run(['nonexistent-service', '--cwd', HERE]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^RUNTIME: host$/m);
    assert.match(r.stdout, /^EXEC_PREFIX:\s*$/m);
  });
  test('missing service arg → usage error exit 2', () => {
    const r = run([], HERE);
    assert.equal(r.status, 2);
  });
});
