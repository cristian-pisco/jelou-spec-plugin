// tests/unit/stack-boot-runtime.test.mjs
//
// Run: `node --test tests/unit/stack-boot-runtime.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { dockerOccupiedPorts } from '../../bin/lib/dev-orchestrator/stack/boot-runtime.mjs';

describe('dockerOccupiedPorts', () => {
  test('parses occupied host ports from an injected docker ps runner', () => {
    const run = () => ({ stdout: '0.0.0.0:13100->8080/tcp\n0.0.0.0:5433->5432/tcp' });
    const ports = dockerOccupiedPorts(run);
    assert.equal(ports.has(13100), true);
    assert.equal(ports.has(5433), true);
  });
});
