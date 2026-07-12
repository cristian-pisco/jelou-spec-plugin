// tests/unit/trace-verify.test.mjs
//
// Run: `node --test tests/unit/trace-verify.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { verifyPredictions } from '../../bin/lib/trace/verify.mjs';

const APPROVAL_TS = '2026-07-11T10:00:00Z';
const NOW = Date.parse('2026-07-11T11:00:00Z');

function dispatch(role, minute, retry_count) {
  const ts = new Date(Date.parse(APPROVAL_TS) + minute * 60000).toISOString();
  return {
    start: { span_id: `${role}${minute}`, trace_id: `T${minute}`, name: 'agent_dispatch', agent_role: role, ts },
    end: { span_id: `${role}${minute}`, status: 'ok', ts, attrs: { retry_count } },
    duration_ms: 1000,
  };
}

function approval(expected_improvement) {
  return {
    rule_id: 'bump_model_tier',
    signature: 'implementer',
    action: 'approved',
    ts: APPROVAL_TS,
    expected_improvement,
  };
}

const PREDICTION = {
  metric: 'retried_fraction',
  signature: 'implementer',
  baseline: 0.6,
  target: 0.2,
  window_n: 3,
  direction: 'decrease',
};

describe('verifyPredictions', () => {
  test('MET: post-approval window satisfies the target', () => {
    const pairs = [dispatch('implementer', 1, 0), dispatch('implementer', 2, 0), dispatch('implementer', 3, 0)];
    const out = verifyPredictions(pairs, [approval(PREDICTION)], { now: NOW });
    assert.equal(out.length, 1);
    assert.equal(out[0].rule_id, 'bump_model_tier');
    assert.equal(out[0].signature, 'implementer');
    assert.equal(out[0].metric, 'retried_fraction');
    assert.equal(out[0].predicted_target, 0.2);
    assert.equal(out[0].actual, 0);
    assert.equal(out[0].met, true);
    assert.equal(out[0].ts, APPROVAL_TS);
  });

  test('UNMET: post-approval window misses the target', () => {
    const pairs = [dispatch('implementer', 1, 1), dispatch('implementer', 2, 1), dispatch('implementer', 3, 1)];
    const out = verifyPredictions(pairs, [approval(PREDICTION)], { now: NOW });
    assert.equal(out.length, 1);
    assert.equal(out[0].actual, 1);
    assert.equal(out[0].met, false);
  });

  test('window not yet elapsed: fewer than window_n dispatches is excluded', () => {
    const pairs = [dispatch('implementer', 1, 0), dispatch('implementer', 2, 0)];
    const out = verifyPredictions(pairs, [approval(PREDICTION)], { now: NOW });
    assert.equal(out.length, 0);
  });

  test('approved entry without expected_improvement is excluded', () => {
    const pairs = [dispatch('implementer', 1, 0), dispatch('implementer', 2, 0), dispatch('implementer', 3, 0)];
    const entry = { rule_id: 'bump_model_tier', signature: 'implementer', action: 'approved', ts: APPROVAL_TS };
    const out = verifyPredictions(pairs, [entry], { now: NOW });
    assert.equal(out.length, 0);
  });

  test('declined entries and verification records are ignored', () => {
    const pairs = [dispatch('implementer', 1, 0), dispatch('implementer', 2, 0), dispatch('implementer', 3, 0)];
    const history = [
      { rule_id: 'bump_model_tier', signature: 'implementer', action: 'declined', ts: APPROVAL_TS, expected_improvement: PREDICTION },
      { kind: 'verification', rule_id: 'bump_model_tier', signature: 'implementer', met: true, actual: 0, ts: APPROVAL_TS },
    ];
    assert.equal(verifyPredictions(pairs, history, { now: NOW }).length, 0);
  });

  test('empty history returns []', () => {
    assert.deepEqual(verifyPredictions([], [], { now: NOW }), []);
  });
});
