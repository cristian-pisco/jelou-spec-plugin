// tests/unit/stack-observer-source.test.mjs
//
// Run: `node --test tests/unit/stack-observer-source.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { logSourceArgs } from '../../bin/lib/dev-orchestrator/stack/observer-source.mjs';

describe('logSourceArgs', () => {
  test('exec mode tails the in-container dev log', () => {
    assert.deepEqual(
      logSourceArgs({ mode: 'exec', projectName: 'jelou-api-t', tailLines: 200 }),
      ['exec', 'jelou-api-t', 'tail', '-n', '200', '/tmp/jelou-api-t.dev.log']
    );
  });

  test('start mode reads docker logs', () => {
    assert.deepEqual(
      logSourceArgs({ mode: 'start', projectName: 'agent-harness-t', tailLines: 200 }),
      ['logs', '--tail', '200', 'agent-harness-t']
    );
  });

  test('compose mode reads docker logs', () => {
    assert.deepEqual(
      logSourceArgs({ mode: 'compose', projectName: 'jelou-functions-api-t', tailLines: 50 }),
      ['logs', '--tail', '50', 'jelou-functions-api-t']
    );
  });
});
