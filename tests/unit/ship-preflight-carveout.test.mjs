import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = readFileSync(join(ROOT, 'jelou/references/subagent-base.md'), 'utf8');
const docker = readFileSync(join(ROOT, 'jelou/references/docker-conventions.md'), 'utf8');

describe('ship preflight carve-out', () => {
  test('subagent-base mentions the ship preflight build+install carve-out', () => {
    assert.match(base, /ship preflight/i);
  });
  test('docker-conventions notes build may run in-container for the ship preflight', () => {
    assert.match(docker, /ship preflight/i);
  });
  test('TDD pipeline stays host-only is still stated', () => {
    assert.match(base, /host-only|host runtime/i);
  });
});
