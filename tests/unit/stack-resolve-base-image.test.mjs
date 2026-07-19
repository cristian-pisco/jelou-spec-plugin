// tests/unit/stack-resolve-base-image.test.mjs
//
// Run: `node --test tests/unit/stack-resolve-base-image.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { baseImageArgs, resolveBaseImage } from '../../bin/lib/dev-orchestrator/stack/resolve-base-image.mjs';

describe('baseImageArgs', () => {
  test('config --images for the compose service, default project (no -p)', () => {
    assert.deepEqual(
      baseImageArgs({ composeFile: 'docker-compose.yml', composeService: 'app' }),
      ['compose', '-f', 'docker-compose.yml', 'config', '--images', 'app']
    );
  });
});

describe('resolveBaseImage', () => {
  test('runs docker in cwd and returns the first non-empty trimmed line', () => {
    const calls = [];
    const run = (bin, args, opts) => { calls.push({ bin, args, cwd: opts && opts.cwd }); return { status: 0, stdout: 'jelou-api-app\n' }; };
    const img = resolveBaseImage({ cwd: '/repo/a', composeFile: 'docker-compose.yml', composeService: 'app', run });
    assert.equal(img, 'jelou-api-app');
    assert.deepEqual(calls, [{ bin: 'docker', args: ['compose', '-f', 'docker-compose.yml', 'config', '--images', 'app'], cwd: '/repo/a' }]);
  });

  test('returns null on non-zero status or empty output', () => {
    assert.equal(resolveBaseImage({ cwd: '/r', composeFile: 'c.yml', composeService: 'app', run: () => ({ status: 1, stdout: 'x' }) }), null);
    assert.equal(resolveBaseImage({ cwd: '/r', composeFile: 'c.yml', composeService: 'app', run: () => ({ status: 0, stdout: '  \n' }) }), null);
  });
});
