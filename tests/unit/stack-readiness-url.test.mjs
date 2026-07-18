// tests/unit/stack-readiness-url.test.mjs
//
// Run: `node --test tests/unit/stack-readiness-url.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readinessPollUrl } from '../../bin/lib/dev-orchestrator/stack/readiness-url.mjs';

describe('readinessPollUrl', () => {
  test('swaps the registry host port for the allocated primary host port', () => {
    const entry = {
      ports: [{ internal: 8080, host: 13100, portEnv: 'APP_PORT', primary: true }, { internal: 9001, host: 13101, portEnv: 'DEBUG_PORT', primary: false }],
      readiness: { type: 'http', url: 'http://localhost:8383/v1/company' }
    };
    assert.equal(readinessPollUrl(entry), 'http://localhost:13100/v1/company');
  });

  test('preserves a query string and root path', () => {
    const entry = {
      ports: [{ internal: 3000, host: 13102, portEnv: 'PORT', primary: true }],
      readiness: { type: 'http', url: 'http://localhost:3002/health?deep=1' }
    };
    assert.equal(readinessPollUrl(entry), 'http://localhost:13102/health?deep=1');
  });
});
