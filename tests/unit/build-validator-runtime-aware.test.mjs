import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const body = readFileSync(join(ROOT, 'agents', 'jlu-build-validator.md'), 'utf8');

describe('jlu-build-validator runtime awareness', () => {
  test('documents the optional ship-preflight exec prefix', () => {
    assert.match(body, /runtime-exec\.mjs/);
    assert.match(body, /EXEC_PREFIX/);
  });
  test('still defaults to host when no exec context is given', () => {
    assert.match(body, /host runtime directly/i);
  });
  test('scopes the container exception to the ship preflight only', () => {
    assert.match(body, /ship preflight/i);
  });
});
