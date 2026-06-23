import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wf = readFileSync(join(ROOT, 'jelou/workflows/ship.md'), 'utf8');

describe('ship workflow — Step 4b preflight', () => {
  test('has a Step 4b preflight section', () => {
    assert.match(wf, /Step 4b/);
    assert.match(wf, /Preflight/i);
  });
  test('deps gate runs before build gate', () => {
    const deps = wf.indexOf('jlu-deps-validator');
    const build = wf.indexOf('jlu-build-validator');
    assert.ok(deps > -1 && build > -1, 'both agents referenced');
    assert.ok(deps < build, 'deps validator referenced before build validator');
  });
  test('preflight sits between Step 4 and Step 5', () => {
    assert.ok(wf.indexOf('## Step 4b') > wf.indexOf('## Step 4 —'));
    assert.ok(wf.indexOf('## Step 4b') < wf.indexOf('## Step 5 —'));
  });
  test('documents override + recording on gate failure', () => {
    assert.match(wf, /override/i);
    assert.match(wf, /Shipped past failing preflight/);
  });
});
