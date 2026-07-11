// tests/unit/trace-eval-core.test.mjs
//
// Run: `node --test tests/unit/trace-eval-core.test.mjs`
//
// Covers the additive Stage-1 evaluation foundation: new schema constants
// (SUCCESS, FAILURE_MODE, MIN_SAMPLE, ATTR) and the pure deterministic-signal
// aggregators (rollupCost, classifySuccess, trajectoryMatch, progressRate).

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  SUCCESS,
  FAILURE_MODE,
  MIN_SAMPLE,
  ATTR,
} from '../../bin/lib/trace/schema.mjs';
import {
  rollupCost,
  classifySuccess,
  trajectoryMatch,
  progressRate,
} from '../../bin/lib/trace/aggregate.mjs';

describe('schema — evaluation constants', () => {
  test('SUCCESS enumerates pass@1 / pass@k / fail and is frozen', () => {
    assert.equal(SUCCESS.PASS_1, 'pass@1');
    assert.equal(SUCCESS.PASS_K, 'pass@k');
    assert.equal(SUCCESS.FAIL, 'fail');
    assert.ok(Object.isFrozen(SUCCESS));
  });

  test('FAILURE_MODE is a MAST-seeded controlled enum and is frozen', () => {
    for (const m of ['spec', 'coordination', 'verification', 'execution', 'unknown']) {
      assert.ok(Object.values(FAILURE_MODE).includes(m), `FAILURE_MODE missing ${m}`);
    }
    assert.ok(Object.isFrozen(FAILURE_MODE));
  });

  test('MIN_SAMPLE is a positive integer floor for rate rules', () => {
    assert.equal(typeof MIN_SAMPLE, 'number');
    assert.ok(MIN_SAMPLE >= 1);
  });

  test('ATTR carries gen_ai-aligned key names for new fields', () => {
    assert.equal(ATTR.INPUT_TOKENS, 'gen_ai.usage.input_tokens');
    assert.equal(ATTR.OUTPUT_TOKENS, 'gen_ai.usage.output_tokens');
    assert.equal(ATTR.COST_USD, 'cost_usd');
    assert.equal(ATTR.SUCCESS, 'success');
    assert.equal(ATTR.QUALITY_SCORE, 'quality_score');
    assert.equal(ATTR.FAILURE_MODE, 'failure_mode');
    assert.ok(Object.isFrozen(ATTR));
  });
});

describe('rollupCost(pairs)', () => {
  function dispatch(role, model, cost) {
    return {
      start: { name: 'agent_dispatch', agent_role: role, attrs: { model_used: model } },
      end: { attrs: { cost_usd: cost } },
      duration_ms: 100,
    };
  }

  test('sums cost_usd across agent_dispatch pairs, by agent and by model', () => {
    const pairs = [
      dispatch('implementer', 'sonnet', 0.12),
      dispatch('implementer', 'sonnet', 0.08),
      dispatch('test-writer', 'haiku', 0.01),
    ];
    const r = rollupCost(pairs);
    assert.equal(Number(r.total_usd.toFixed(2)), 0.21);
    assert.equal(Number(r.by_agent.implementer.toFixed(2)), 0.20);
    assert.equal(Number(r.by_agent['test-writer'].toFixed(2)), 0.01);
    assert.equal(Number(r.by_model.sonnet.toFixed(2)), 0.20);
    assert.equal(Number(r.by_model.haiku.toFixed(2)), 0.01);
  });

  test('ignores non-dispatch spans and missing cost', () => {
    const pairs = [
      { start: { name: 'phase' }, end: { attrs: {} }, duration_ms: 1 },
      { start: { name: 'agent_dispatch', agent_role: 'qa', attrs: {} }, end: { attrs: {} }, duration_ms: 1 },
    ];
    const r = rollupCost(pairs);
    assert.equal(r.total_usd, 0);
  });

  test('empty input yields zeroed rollup', () => {
    const r = rollupCost([]);
    assert.equal(r.total_usd, 0);
    assert.deepEqual(r.by_agent, {});
    assert.deepEqual(r.by_model, {});
  });
});

describe('classifySuccess({ passed, attempts })', () => {
  test('passed on first attempt is pass@1', () => {
    assert.equal(classifySuccess({ passed: true, attempts: 1 }), SUCCESS.PASS_1);
  });

  test('passed with undefined attempts defaults to pass@1', () => {
    assert.equal(classifySuccess({ passed: true }), SUCCESS.PASS_1);
  });

  test('passed after retries is pass@k', () => {
    assert.equal(classifySuccess({ passed: true, attempts: 3 }), SUCCESS.PASS_K);
  });

  test('not passed is fail regardless of attempts', () => {
    assert.equal(classifySuccess({ passed: false, attempts: 5 }), SUCCESS.FAIL);
    assert.equal(classifySuccess({ passed: false }), SUCCESS.FAIL);
  });
});

describe('trajectoryMatch(actual, reference)', () => {
  const REF = ['red', 'green', 'refactor', 'qa', 'ship'];

  test('exact ordered run is in_order and subset, not off_plan', () => {
    const r = trajectoryMatch(['red', 'green', 'refactor', 'qa', 'ship'], REF);
    assert.equal(r.in_order, true);
    assert.equal(r.subset, true);
    assert.equal(r.off_plan, false);
    assert.deepEqual(r.unexpected, []);
  });

  test('reference as a gapped subsequence is still in_order (skips are allowed)', () => {
    const r = trajectoryMatch(['red', 'green', 'ship'], REF);
    assert.equal(r.in_order, true);
    assert.equal(r.subset, true);
    assert.equal(r.off_plan, false);
  });

  test('out-of-order run is not in_order', () => {
    const r = trajectoryMatch(['green', 'red', 'ship'], REF);
    assert.equal(r.in_order, false);
    assert.equal(r.subset, true);
  });

  test('a step outside the reference set is off_plan and reported as unexpected', () => {
    const r = trajectoryMatch(['red', 'green', 'hotfix', 'ship'], REF);
    assert.equal(r.off_plan, true);
    assert.equal(r.subset, false);
    assert.deepEqual(r.unexpected, ['hotfix']);
  });

  test('empty actual is neither in_order (nothing matched) nor off_plan', () => {
    const r = trajectoryMatch([], REF);
    assert.equal(r.off_plan, false);
    assert.deepEqual(r.unexpected, []);
  });
});

describe('progressRate(completed, planned)', () => {
  test('ratio of completed to planned', () => {
    assert.equal(progressRate(2, 4), 0.5);
    assert.equal(progressRate(3, 3), 1);
  });

  test('zero planned yields 0 (no divide-by-zero)', () => {
    assert.equal(progressRate(0, 0), 0);
    assert.equal(progressRate(2, 0), 0);
  });
});
