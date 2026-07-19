// tests/unit/stack-compose-down.test.mjs
//
// Run: `node --test tests/unit/stack-compose-down.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { composeDownArgs } from '../../bin/lib/dev-orchestrator/stack/compose-down.mjs';

describe('composeDownArgs', () => {
  test('mirrors composeUpArgs with down', () => {
    assert.deepEqual(
      composeDownArgs({ projectName: 'jelou-api-t42', composeFile: 'docker-compose.yml', overrideFile: 'docker-compose.jlu.yml' }),
      ['compose', '-p', 'jelou-api-t42', '-f', 'docker-compose.yml', '-f', 'docker-compose.jlu.yml', 'down']
    );
  });
});
