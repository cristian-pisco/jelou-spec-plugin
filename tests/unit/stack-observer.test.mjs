// tests/unit/stack-observer.test.mjs
//
// Run: `node --test tests/unit/stack-observer.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { compilePatterns } from '../../bin/lib/dev-orchestrator/patterns-matcher.mjs';
import { observeTick } from '../../bin/lib/dev-orchestrator/stack/observer.mjs';

describe('observeTick', () => {
  test('emits a match for a new failing line on stdout and updates the capture', () => {
    const services = [{ name: 'api', args: ['logs', '--tail', '200', 'api-t'] }];
    const compiledByService = { api: compilePatterns(['ECONNREFUSED']) };
    const prevCaptures = { api: 'ok\n' };
    const matches = [];
    const run = () => ({ stdout: 'ok\nboom ECONNREFUSED 127.0.0.1:6379', stderr: '' });

    observeTick({ services, run, compiledByService, prevCaptures, onMatch: (m) => matches.push(m) });

    assert.deepEqual(matches, [{ service: 'api', pattern: 'ECONNREFUSED', line: 'boom ECONNREFUSED 127.0.0.1:6379' }]);
    assert.equal(prevCaptures.api, 'ok\nboom ECONNREFUSED 127.0.0.1:6379');
  });

  test('matches a failing line that arrives on stderr', () => {
    const services = [{ name: 'api', args: ['logs', '--tail', '200', 'api-t'] }];
    const compiledByService = { api: compilePatterns(['ECONNREFUSED']) };
    const prevCaptures = {};
    const matches = [];
    const run = () => ({ stdout: 'starting', stderr: 'ECONNREFUSED on boot' });

    observeTick({ services, run, compiledByService, prevCaptures, onMatch: (m) => matches.push(m) });

    assert.deepEqual(matches, [{ service: 'api', pattern: 'ECONNREFUSED', line: 'ECONNREFUSED on boot' }]);
  });

  test('emits nothing when no new line matches', () => {
    const services = [{ name: 'api', args: ['logs', '--tail', '200', 'api-t'] }];
    const compiledByService = { api: compilePatterns(['ECONNREFUSED']) };
    const prevCaptures = { api: 'ok\n' };
    const matches = [];
    const run = () => ({ stdout: 'ok\nall good', stderr: '' });

    observeTick({ services, run, compiledByService, prevCaptures, onMatch: (m) => matches.push(m) });

    assert.deepEqual(matches, []);
  });
});
