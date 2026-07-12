import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildScorecard } from '../../bin/lib/trace/scorecard.mjs';

function close(a, b) {
  return Math.abs(a - b) < 1e-9;
}

function start(o) {
  return { event_kind: 'span_start', ...o };
}

function end(o) {
  return { event_kind: 'span_end', ...o };
}

const T = (s) => `2026-07-11T10:00:${String(s).padStart(2, '0')}.000Z`;

function buildFixture() {
  const events = [
    start({ span_id: 'TA', trace_id: 'TA', name: 'execute_task', task_slug: 'alpha', ts: T(0) }),
    start({ span_id: 'TA_IMP', parent_span_id: 'TA', trace_id: 'TA', name: 'agent_dispatch', agent_role: 'implementer', task_slug: 'alpha', ts: T(1) }),
    end({ span_id: 'TA_IMP', trace_id: 'TA', name: 'agent_dispatch', status: 'ok', duration_ms: 30000, agent_role: 'implementer', attrs: { retry_count: 0, cost_usd: 0.10 } }),
    start({ span_id: 'TA_TW', parent_span_id: 'TA', trace_id: 'TA', name: 'agent_dispatch', agent_role: 'test-writer', task_slug: 'alpha', ts: T(2) }),
    end({ span_id: 'TA_TW', trace_id: 'TA', name: 'agent_dispatch', status: 'ok', duration_ms: 10000, agent_role: 'test-writer', attrs: { retry_count: 0 } }),
    end({ span_id: 'TA', trace_id: 'TA', name: 'execute_task', status: 'ok', duration_ms: 40000, attrs: { success: 'pass@1' } }),

    start({ span_id: 'TB', trace_id: 'TB', name: 'execute_task', task_slug: 'beta', ts: T(10) }),
    start({ span_id: 'TB_IMP', parent_span_id: 'TB', trace_id: 'TB', name: 'agent_dispatch', agent_role: 'implementer', task_slug: 'beta', ts: T(11) }),
    end({ span_id: 'TB_IMP', trace_id: 'TB', name: 'agent_dispatch', status: 'ok', duration_ms: 50000, agent_role: 'implementer', attrs: { retry_count: 1, cost_usd: 0.10 } }),
    end({ span_id: 'TB', trace_id: 'TB', name: 'execute_task', status: 'ok', duration_ms: 60000, attrs: { success: 'pass@k' } }),

    start({ span_id: 'TG', trace_id: 'TG', name: 'execute_task', task_slug: 'gamma', ts: T(20) }),
    end({ span_id: 'TG', trace_id: 'TG', name: 'execute_task', status: 'blocked', duration_ms: 5000, attrs: { success: 'fail' } }),

    start({ span_id: 'FE_A', trace_id: 'T_EXEC', name: 'agent_dispatch', agent_role: 'implementer', ts: T(30) }),
    end({ span_id: 'FE_A', trace_id: 'T_EXEC', name: 'agent_dispatch', status: 'failed', duration_ms: 1000, agent_role: 'implementer', attrs: { retry_count: 0 } }),

    start({ span_id: 'FV_A', trace_id: 'T_VERIF', name: 'agent_dispatch', agent_role: 'qa-agent', ts: T(31) }),
    end({ span_id: 'FV_A', trace_id: 'T_VERIF', name: 'agent_dispatch', status: 'failed', duration_ms: 1000, agent_role: 'qa-agent', attrs: { retry_count: 0 } }),

    start({ span_id: 'FC_PH', trace_id: 'T_COORD', name: 'phase', service_id: 'svc-x', phase_num: 1, ts: T(40) }),
    start({ span_id: 'FC_A1', parent_span_id: 'FC_PH', trace_id: 'T_COORD', name: 'agent_dispatch', agent_role: 'implementer', ts: T(41) }),
    end({ span_id: 'FC_A1', trace_id: 'T_COORD', name: 'agent_dispatch', status: 'failed', duration_ms: 1000, agent_role: 'implementer', attrs: { retry_count: 0 } }),
    start({ span_id: 'FC_A2', parent_span_id: 'FC_PH', trace_id: 'T_COORD', name: 'agent_dispatch', agent_role: 'implementer', ts: T(42) }),
    end({ span_id: 'FC_A2', trace_id: 'T_COORD', name: 'agent_dispatch', status: 'failed', duration_ms: 1000, agent_role: 'implementer', attrs: { retry_count: 0 } }),
    end({ span_id: 'FC_PH', trace_id: 'T_COORD', name: 'phase', status: 'failed', duration_ms: 3000 }),

    { event_kind: 'event', name: 'eval', span_id: 'EV_A', parent_span_id: 'TA_IMP', trace_id: 'TA', ts: T(3), attrs: { quality_score: 0.8, quality_dims: { correctness: 0.85, faithfulness_to_spec: 0.7, task_completion: 0.8 } } },
    { event_kind: 'event', name: 'eval', span_id: 'EV_B', parent_span_id: 'TB_IMP', trace_id: 'TB', ts: T(12), attrs: { quality_score: 0.6, quality_dims: { correctness: 0.65, faithfulness_to_spec: 0.5, task_completion: 0.6 } } },
  ];

  const feedback = [
    { span_id: 'TA_IMP', signal: 'accept', ts: T(4) },
    { span_id: 'TB_IMP', signal: 'reject', ts: T(13) },
    { span_id: 'ZZ', signal: 'implicit_negative', ts: T(14) },
    { span_id: 'YY', signal: 'edit', ts: T(15) },
  ];

  const history = [
    { kind: 'verification', rule_id: 'bump_model_tier', signature: 'implementer', met: true, ts: T(50) },
    { kind: 'verification', rule_id: 'suggest_parallelize', signature: 'svc-x:1', met: true, ts: T(51) },
    { kind: 'verification', rule_id: 'bump_model_tier', signature: 'test-writer', met: false, ts: T(52) },
    { rule_id: 'extend_patterns', signature: 'DEAD', ts: T(53) },
  ];

  return { events, feedback, history };
}

describe('buildScorecard', () => {
  const sc = buildScorecard(buildFixture());

  test('success buckets and autonomy from execute_task pairs', () => {
    assert.equal(sc.tasks.total, 3);
    assert.equal(sc.tasks.pass_1, 1);
    assert.equal(sc.tasks.pass_k, 1);
    assert.equal(sc.tasks.fail, 1);
    assert.ok(close(sc.tasks.autonomy, 2 / 3));
  });

  test('cost rollup and cost_per_successful_task', () => {
    assert.ok(close(sc.cost.total_usd, 0.20));
    assert.ok(close(sc.cost.cost_per_successful_task, 0.10));
  });

  test('per-agent mean_quality / mean_faithfulness', () => {
    const impl = sc.agents.find((a) => a.agent_role === 'implementer');
    assert.ok(impl);
    assert.ok(close(impl.mean_quality, 0.7));
    assert.ok(close(impl.mean_faithfulness, 0.6));
    const tw = sc.agents.find((a) => a.agent_role === 'test-writer');
    assert.ok(tw);
    assert.equal(tw.mean_quality, null);
    assert.equal(tw.mean_faithfulness, null);
  });

  test('calibration passthrough and overall mean quality score', () => {
    assert.equal(sc.quality.pairs, 2);
    assert.equal(sc.quality.calibrated, false);
    assert.equal(typeof sc.quality.kappa, 'number');
    assert.ok(close(sc.quality.mean_quality_score, 0.7));
  });

  test('failure_mode distribution — one flag per trace at earliest-decisive', () => {
    assert.deepEqual(sc.failures, {
      spec: 0,
      coordination: 1,
      verification: 1,
      execution: 1,
      unknown: 1,
    });
  });

  test('feedback counts per signal', () => {
    assert.deepEqual(sc.feedback, {
      accept: 1,
      reject: 1,
      implicit_negative: 1,
      edit: 1,
    });
  });

  test('suggestion hit_rate from verification history only', () => {
    assert.equal(sc.suggestions.verified, 3);
    assert.equal(sc.suggestions.met, 2);
    assert.ok(close(sc.suggestions.hit_rate, 2 / 3));
  });
});

describe('buildScorecard — empty input', () => {
  test('returns zeros without throwing', () => {
    let sc;
    assert.doesNotThrow(() => {
      sc = buildScorecard({});
    });
    assert.deepEqual(sc.tasks, { total: 0, pass_1: 0, pass_k: 0, fail: 0, autonomy: 0 });
    assert.equal(sc.cost.total_usd, 0);
    assert.equal(sc.cost.cost_per_successful_task, 0);
    assert.deepEqual(sc.agents, []);
    assert.equal(sc.quality.pairs, 0);
    assert.equal(sc.quality.calibrated, false);
    assert.equal(sc.quality.mean_quality_score, null);
    assert.deepEqual(sc.failures, { spec: 0, coordination: 0, verification: 0, execution: 0, unknown: 0 });
    assert.deepEqual(sc.feedback, { accept: 0, reject: 0, implicit_negative: 0, edit: 0 });
    assert.deepEqual(sc.suggestions, { verified: 0, met: 0, hit_rate: 0 });
  });
});
