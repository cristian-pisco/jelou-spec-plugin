// tests/unit/stack-fix-status.test.mjs
//
// Run: `node --test tests/unit/stack-fix-status.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseFixStatus, nextAction } from '../../bin/lib/dev-orchestrator/stack/fix-status.mjs';

describe('parseFixStatus', () => {
  test('parses a DONE line', () => {
    assert.deepEqual(parseFixStatus('STATUS: DONE file=x hunk_hash=abc summary="y"'), { status: 'DONE', reason: null });
  });

  test('parses a BLOCKED line with a reason', () => {
    assert.deepEqual(parseFixStatus('STATUS: BLOCKED reason=backend_contract details="z"'), { status: 'BLOCKED', reason: 'backend_contract' });
  });

  test('unknown text is UNKNOWN', () => {
    assert.deepEqual(parseFixStatus('garbage'), { status: 'UNKNOWN', reason: null });
  });
});

describe('nextAction', () => {
  test('DONE reruns to verify', () => {
    assert.equal(nextAction({ status: 'DONE', attempt: 1, maxAttempts: 3 }), 'rerun');
  });

  test('BLOCKED / flagged / NEEDS_CONTEXT escalate', () => {
    assert.equal(nextAction({ status: 'BLOCKED', attempt: 1, maxAttempts: 3 }), 'escalate');
    assert.equal(nextAction({ status: 'FLAGGED', attempt: 1, maxAttempts: 3 }), 'escalate');
    assert.equal(nextAction({ status: 'NEEDS_CONTEXT', attempt: 1, maxAttempts: 3 }), 'escalate');
  });

  test('DONE reruns even on the final attempt (verify before the loop exhausts)', () => {
    assert.equal(nextAction({ status: 'DONE', attempt: 3, maxAttempts: 3 }), 'rerun');
  });
});
