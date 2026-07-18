// tests/unit/stack-auth-runtime.test.mjs
//
// Run: `node --test tests/unit/stack-auth-runtime.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readOtpFromRedis } from '../../bin/lib/dev-orchestrator/stack/auth-runtime.mjs';

describe('readOtpFromRedis', () => {
  test('returns a factory function', () => {
    assert.equal(typeof readOtpFromRedis({ redisContainer: 'redis', keyPrefix: '2fa-code-' }), 'function');
  });
});
