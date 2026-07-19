// tests/unit/registry-read.test.mjs
//
// Run: `node --test tests/unit/registry-read.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUnifiedRegistry } from '../../bin/lib/registry/read.mjs';

describe('readUnifiedRegistry', () => {
  test('reads the compiled registry.json', () => {
    const ws = mkdtempSync(join(tmpdir(), 'jlu-read-'));
    mkdirSync(join(ws, 'registry'), { recursive: true });
    writeFileSync(join(ws, 'registry', 'registry.json'), JSON.stringify({ services: [{ id: 'a' }], auth: null, frontend: null, network: { basePort: 3100 } }));
    const reg = readUnifiedRegistry(ws);
    assert.equal(reg.services[0].id, 'a');
    assert.equal(reg.network.basePort, 3100);
  });

  test('throws a clear error when not compiled yet', () => {
    const ws = mkdtempSync(join(tmpdir(), 'jlu-read-'));
    assert.throws(() => readUnifiedRegistry(ws), /registry.json.*seed-registry|compile-registry/);
  });
});
