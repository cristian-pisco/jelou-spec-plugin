// tests/unit/boot-engine-readiness-target.test.mjs
//
// Run: `node --test tests/unit/boot-engine-readiness-target.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readinessPollUrl } from '../../bin/lib/boot-engine/readiness-target.mjs';

describe('readinessPollUrl', () => {
  test('http_200 with a path', () => {
    assert.equal(readinessPollUrl({ readiness: { type: 'http_200', path: '/health' }, host: 3100 }), 'http://localhost:3100/health');
  });

  test('http_200 without a path defaults to /', () => {
    assert.equal(readinessPollUrl({ readiness: { type: 'http_200' }, host: 8484 }), 'http://localhost:8484/');
  });

  test('port_open polls the root', () => {
    assert.equal(readinessPollUrl({ readiness: { type: 'port_open' }, host: 9001 }), 'http://localhost:9001/');
  });

  test('stdout_match returns null', () => {
    assert.equal(readinessPollUrl({ readiness: { type: 'stdout_match', pattern: 'started' }, host: 3100 }), null);
  });

  test('absent readiness returns null', () => {
    assert.equal(readinessPollUrl({ readiness: undefined, host: 3100 }), null);
  });
});
