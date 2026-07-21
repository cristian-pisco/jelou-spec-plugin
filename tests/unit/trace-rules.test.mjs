// tests/unit/trace-rules.test.mjs
//
// Run: `node --test tests/unit/trace-rules.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  RULES, RULE_IDS, COOLDOWN_MS,
  evaluate, applyCooldown, formatSuggestion,
} from '../../bin/lib/trace/rules.mjs';
import { readSpans } from '../../bin/lib/trace/reader.mjs';
import { pairSpans } from '../../bin/lib/trace/aggregate.mjs';

const FIX = 'tests/fixtures/trace/rules-sample.jsonl';

// Rebase fixture timestamps onto "now" so the 24h-lookback rules (immediate_flag)
// stay time-stable: the fixture's span range is ~1h, far under any window, so
// shifting every ts by (now - maxTs) preserves durations while landing the
// newest span at ~now and the blocked span inside the 24h window.
function loadPairs() {
  const spans = [...readSpans(FIX)];
  const maxTs = Math.max(...spans.map((s) => Date.parse(s.ts)));
  const offset = Date.now() - maxTs;
  for (const s of spans) s.ts = new Date(Date.parse(s.ts) + offset).toISOString();
  return pairSpans(spans);
}

function makeDispatches(role, retryCounts) {
  const ts = new Date().toISOString();
  return retryCounts.map((rc, i) => ({
    start: { event_kind: 'span_start', span_id: `${role}${i}`, trace_id: `T_${role}${i}`,
             name: 'agent_dispatch', agent_role: role, scope: 'task', ts },
    end: { event_kind: 'span_end', span_id: `${role}${i}`, status: 'ok',
           ts, attrs: { retry_count: rc } },
    duration_ms: 1000,
  }));
}

describe('RULES constants', () => {
  test('exposes the stable rule ids', () => {
    assert.deepEqual(
      [...RULE_IDS].sort(),
      [
        'bump_model_tier', 'extend_patterns', 'faithfulness_below_baseline',
        'immediate_flag', 'quality_regression', 'suggest_parallelize',
      ]
    );
  });

  test('each rule has id, description, evaluate', () => {
    for (const r of RULES) {
      assert.ok(r.id);
      assert.ok(r.description);
      assert.ok(typeof r.evaluate === 'function');
    }
  });

  test('COOLDOWN_MS is 7 days', () => {
    assert.equal(COOLDOWN_MS, 7 * 24 * 60 * 60 * 1000);
  });
});

describe('rule: bump_model_tier', () => {
  test('triggers when the Wilson lower bound clears the threshold', () => {
    const pairs = loadPairs();
    const findings = evaluate(pairs).filter(f => f.rule_id === 'bump_model_tier');
    assert.ok(findings.length >= 1);
    const f = findings.find(x => x.signature === 'implementer');
    assert.ok(f);
    assert.ok(f.evidence.retry_rate > 0.20);
    assert.ok(f.evidence.wilson_lower_bound > 0.20);
    assert.equal(f.evidence.retried_fraction, 0.6);
    assert.equal(f.evidence.dispatches_checked, 10);
  });

  test('does not trigger when nothing retried', () => {
    const pairs = makeDispatches('cleaner', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const findings = evaluate(pairs).filter(f => f.rule_id === 'bump_model_tier');
    assert.equal(findings.length, 0);
  });

  test('does not trigger at 3/10 retried (Wilson lower bound below threshold)', () => {
    const pairs = makeDispatches('gamma', [1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const findings = evaluate(pairs).filter(f => f.rule_id === 'bump_model_tier');
    assert.equal(findings.length, 0);
  });

  test('triggers at 6/10 retried (Wilson lower bound above threshold)', () => {
    const pairs = makeDispatches('delta', [1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
    const findings = evaluate(pairs).filter(f => f.rule_id === 'bump_model_tier');
    const f = findings.find(x => x.signature === 'delta');
    assert.ok(f);
    assert.ok(f.evidence.wilson_lower_bound > 0.20);
    assert.equal(f.evidence.retried_fraction, 0.6);
  });

  test('does not trigger with fewer than MIN_SAMPLE dispatches', () => {
    const pairs = makeDispatches('epsilon', [1, 1, 1, 1, 1]);
    const findings = evaluate(pairs).filter(f => f.rule_id === 'bump_model_tier');
    assert.equal(findings.length, 0);
  });
});

describe('rule: extend_patterns', () => {
  test('triggers when error_signature appears >= 3 times', () => {
    const pairs = loadPairs();
    const findings = evaluate(pairs).filter(f => f.rule_id === 'extend_patterns');
    assert.ok(findings.length >= 1);
    const f = findings.find(x => x.signature === 'DEAD_BEEF');
    assert.ok(f);
    assert.ok(f.evidence.occurrences >= 3);
  });
});

describe('rule: suggest_parallelize', () => {
  test('triggers when p95 / median > 3.0 for a phase pair', () => {
    const pairs = loadPairs();
    const findings = evaluate(pairs).filter(f => f.rule_id === 'suggest_parallelize');
    assert.ok(findings.length >= 1);
  });
});

describe('rule: immediate_flag', () => {
  test('triggers for any blocked span in last 24h', () => {
    const pairs = loadPairs();
    const findings = evaluate(pairs).filter(f => f.rule_id === 'immediate_flag');
    assert.ok(findings.length >= 1);
  });

  test('never triggers for an orphaned span (self-healing, no user action)', () => {
    const ts = new Date().toISOString();
    const pairs = [{
      start: { event_kind: 'span_start', span_id: 'ORPH', trace_id: 'T_ORPH',
               name: 'execute_task', agent_role: 'implementer', scope: 'task',
               task_slug: 'some-task', ts },
      end: { event_kind: 'span_end', span_id: 'ORPH', status: 'orphaned',
             ts, attrs: { error_signature: 'ORPHAN_SIG' } },
      duration_ms: 1000,
    }];
    const findings = evaluate(pairs).filter(f => f.rule_id === 'immediate_flag');
    assert.equal(findings.length, 0);
  });

  test('currentTask scopes out flags from an unrelated task', () => {
    const ts = new Date().toISOString();
    const pairs = [{
      start: { event_kind: 'span_start', span_id: 'OTHER', trace_id: 'T_OTHER',
               name: 'execute_task', agent_role: 'implementer', scope: 'task',
               task_slug: 'unrelated-old-task', ts },
      end: { event_kind: 'span_end', span_id: 'OTHER', status: 'blocked',
             ts, attrs: { error_signature: 'OTHER_SIG' } },
      duration_ms: 1000,
    }];
    const unscoped = evaluate(pairs).filter(f => f.rule_id === 'immediate_flag');
    assert.equal(unscoped.length, 1);
    const scoped = evaluate(pairs, { currentTask: 'my-current-task' })
      .filter(f => f.rule_id === 'immediate_flag');
    assert.equal(scoped.length, 0);
  });

  test('currentTask keeps flags for the current task', () => {
    const ts = new Date().toISOString();
    const pairs = [{
      start: { event_kind: 'span_start', span_id: 'MINE', trace_id: 'T_MINE',
               name: 'execute_task', agent_role: 'implementer', scope: 'task',
               task_slug: 'my-current-task', ts },
      end: { event_kind: 'span_end', span_id: 'MINE', status: 'failed',
             ts, attrs: { error_signature: 'MINE_SIG' } },
      duration_ms: 1000,
    }];
    const scoped = evaluate(pairs, { currentTask: 'my-current-task' })
      .filter(f => f.rule_id === 'immediate_flag');
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].evidence.task_slug, 'my-current-task');
  });

  test('does not trigger for blocked spans older than 24h', () => {
    const oldTs = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const pairs = [{
      start: { event_kind: 'span_start', span_id: 'S1', trace_id: 'T1',
               name: 'agent_dispatch', agent_role: 'implementer', scope: 'task',
               ts: oldTs },
      end: { event_kind: 'span_end', span_id: 'S1', status: 'blocked',
             ts: oldTs, attrs: { error_signature: 'OLD_ERR' } },
      duration_ms: 1000,
    }];
    const findings = evaluate(pairs).filter(f => f.rule_id === 'immediate_flag');
    assert.equal(findings.length, 0);
  });
});

describe('applyCooldown(findings, history)', () => {
  test('removes findings whose (rule_id, signature) is within cooldown', () => {
    const findings = [
      { rule_id: 'bump_model_tier', signature: 'implementer', evidence: {} },
      { rule_id: 'extend_patterns', signature: 'DEAD_BEEF', evidence: {} },
    ];
    const now = Date.now();
    const history = [
      { rule_id: 'bump_model_tier', signature: 'implementer',
        action: 'declined', ts: new Date(now - 60 * 60 * 1000).toISOString() },
    ];
    const filtered = applyCooldown(findings, history);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].rule_id, 'extend_patterns');
  });

  test('keeps findings whose cooldown has elapsed', () => {
    const findings = [
      { rule_id: 'bump_model_tier', signature: 'implementer', evidence: {} },
    ];
    const ancient = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const history = [
      { rule_id: 'bump_model_tier', signature: 'implementer',
        action: 'declined', ts: ancient },
    ];
    const filtered = applyCooldown(findings, history);
    assert.equal(filtered.length, 1);
  });

  test('approved actions also start a cooldown', () => {
    const findings = [
      { rule_id: 'bump_model_tier', signature: 'implementer', evidence: {} },
    ];
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const history = [
      { rule_id: 'bump_model_tier', signature: 'implementer',
        action: 'approved', ts: recent },
    ];
    const filtered = applyCooldown(findings, history);
    assert.equal(filtered.length, 0);
  });
});

describe('formatSuggestion(finding)', () => {
  test('renders human-readable suggestion with inline evidence', () => {
    const out = formatSuggestion({
      rule_id: 'bump_model_tier',
      signature: 'implementer',
      evidence: { retry_rate: 0.3, dispatches_checked: 10 },
      message: 'implementer has 30% retry rate (3/10 last runs)',
    });
    assert.match(out, /SUGGEST \[bump_model_tier\]/);
    assert.match(out, /implementer/);
    assert.match(out, /30%/);
    assert.match(out, /apply:|action:|y\/n/i);
  });

  test('renders a predict line when the finding carries expected_improvement', () => {
    const out = formatSuggestion({
      rule_id: 'bump_model_tier',
      signature: 'implementer',
      evidence: { retried_fraction: 0.6 },
      message: 'implementer has 60% retry rate (6/10 last runs)',
      expected_improvement: {
        metric: 'retried_fraction', signature: 'implementer',
        baseline: 0.6, target: 0.2, window_n: 10, direction: 'decrease',
      },
    });
    assert.match(out, /predict: retried_fraction implementer 0\.60 → ≤0\.20 within 10 dispatches/);
  });
});

describe('bump_model_tier: expected_improvement', () => {
  test('the finding carries a falsifiable retried_fraction prediction', () => {
    const pairs = makeDispatches('delta', [1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
    const f = evaluate(pairs).find(x => x.rule_id === 'bump_model_tier' && x.signature === 'delta');
    assert.ok(f);
    assert.ok(f.expected_improvement);
    assert.equal(f.expected_improvement.metric, 'retried_fraction');
    assert.equal(f.expected_improvement.signature, 'delta');
    assert.equal(f.expected_improvement.baseline, 0.6);
    assert.equal(f.expected_improvement.target, 0.2);
    assert.equal(f.expected_improvement.window_n, 10);
    assert.equal(f.expected_improvement.direction, 'decrease');
  });
});

function failedDispatch(span_id, trace_id, ts, role, status = 'failed') {
  return {
    start: { event_kind: 'span_start', span_id, trace_id, name: 'agent_dispatch',
             agent_role: role, scope: 'task', task_slug: 'tcascade', ts },
    end: { event_kind: 'span_end', span_id, status, ts,
           attrs: { error_signature: `SIG_${span_id}` } },
    duration_ms: 1000,
  };
}

describe('immediate_flag: earliest-decisive attribution + cascade dedup', () => {
  test('a single trace with cascading failures yields ONE flag at the earliest, with failure_mode', () => {
    const base = Date.now() - 60 * 60 * 1000;
    const pairs = [
      failedDispatch('E1', 'T_CASCADE', new Date(base).toISOString(), 'implementer'),
      failedDispatch('E2', 'T_CASCADE', new Date(base + 1000).toISOString(), 'implementer'),
      failedDispatch('E3', 'T_CASCADE', new Date(base + 2000).toISOString(), 'implementer'),
    ];
    const findings = evaluate(pairs).filter(f => f.rule_id === 'immediate_flag');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].evidence.span_id, 'E1');
    assert.equal(findings[0].evidence.failure_mode, 'execution');
    assert.equal(findings[0].evidence.failed_in_trace, 3);
  });

  test('independent failures in different traces each flag', () => {
    const now = Date.now() - 30 * 60 * 1000;
    const pairs = [
      failedDispatch('A1', 'T_A', new Date(now).toISOString(), 'implementer'),
      failedDispatch('B1', 'T_B', new Date(now + 1000).toISOString(), 'qa-agent'),
    ];
    const findings = evaluate(pairs).filter(f => f.rule_id === 'immediate_flag');
    assert.equal(findings.length, 2);
    const modes = findings.map(f => f.evidence.failure_mode).sort();
    assert.deepEqual(modes, ['execution', 'verification']);
  });

  test('a phase span with multiple failed children attributes to coordination', () => {
    const base = Date.now() - 60 * 60 * 1000;
    const phasePair = {
      start: { event_kind: 'span_start', span_id: 'PH', trace_id: 'T_COORD', name: 'phase',
               service_id: 'svc-x', phase_num: 3, scope: 'task', task_slug: 'tc', ts: new Date(base).toISOString() },
      end: { event_kind: 'span_end', span_id: 'PH', status: 'failed', ts: new Date(base).toISOString(), attrs: {} },
      duration_ms: 1000,
    };
    const pairs = [
      phasePair,
      failedDispatch('C1', 'T_COORD', new Date(base + 1000).toISOString(), 'implementer'),
      failedDispatch('C2', 'T_COORD', new Date(base + 2000).toISOString(), 'implementer'),
    ];
    const findings = evaluate(pairs).filter(f => f.rule_id === 'immediate_flag');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].evidence.span_id, 'PH');
    assert.equal(findings[0].evidence.failure_mode, 'coordination');
  });
});

function buildCalibration({ role = 'implementer', faithfulness = 0.3, aligned = true, feedbackCount = 10 } = {}) {
  const events = [];
  const feedback = [];
  const base = Date.parse('2026-07-11T09:00:00Z');
  for (let i = 0; i < 10; i++) {
    const spanId = `A${i}`;
    const ts = new Date(base + i * 1000).toISOString();
    const highScore = i % 2 === 0;
    const quality_score = highScore ? 0.9 : 0.2;
    events.push({ event_kind: 'span_start', span_id: spanId, trace_id: `T${i}`, name: 'agent_dispatch', agent_role: role, ts });
    events.push({
      event_kind: 'event', name: 'eval', span_id: `EV${i}`, parent_span_id: spanId, ts,
      attrs: { quality_score, quality_dims: { correctness: faithfulness, faithfulness_to_spec: faithfulness, task_completion: faithfulness } },
    });
    if (i < feedbackCount) {
      const accept = aligned ? highScore : !highScore;
      feedback.push({ span_id: spanId, signal: accept ? 'accept' : 'reject', ts });
    }
  }
  return { events, feedback };
}

function buildPhaseRegression() {
  const events = [];
  const base = Date.parse('2026-07-11T09:30:00Z');
  for (let i = 0; i < 10; i++) {
    const spanId = `P${i}`;
    const ts = new Date(base + i * 1000).toISOString();
    const quality_score = i === 9 ? 0.5 : 0.9;
    events.push({ event_kind: 'span_start', span_id: spanId, trace_id: `TP${i}`, name: 'phase', service_id: 'svc-x', phase_num: 1, ts });
    events.push({
      event_kind: 'event', name: 'eval', span_id: `PEV${i}`, parent_span_id: spanId, ts,
      attrs: { quality_score, quality_dims: { correctness: 0.9, faithfulness_to_spec: 0.9, task_completion: 0.9 } },
    });
  }
  return events;
}

describe('quality rules: kappa gate', () => {
  test('faithfulness_below_baseline FIRES when judge calibrated and floor breached', () => {
    const { events, feedback } = buildCalibration({ faithfulness: 0.3, aligned: true });
    const findings = evaluate([], { events, feedback }).filter(f => f.rule_id === 'faithfulness_below_baseline');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].signature, 'implementer');
    assert.equal(findings[0].expected_improvement.metric, 'faithfulness_to_spec');
    assert.equal(findings[0].expected_improvement.direction, 'increase');
    assert.ok(findings[0].expected_improvement.baseline < 0.6);
  });

  test('faithfulness_below_baseline DORMANT when too few calibration pairs', () => {
    const { events, feedback } = buildCalibration({ faithfulness: 0.3, aligned: true, feedbackCount: 5 });
    const findings = evaluate([], { events, feedback }).filter(f => f.rule_id === 'faithfulness_below_baseline');
    assert.equal(findings.length, 0);
  });

  test('faithfulness_below_baseline DORMANT when kappa below floor', () => {
    const { events, feedback } = buildCalibration({ faithfulness: 0.3, aligned: false });
    const findings = evaluate([], { events, feedback }).filter(f => f.rule_id === 'faithfulness_below_baseline');
    assert.equal(findings.length, 0);
  });

  test('quality_regression FIRES for a calibrated judge when a phase drops below its median', () => {
    const { events, feedback } = buildCalibration({ faithfulness: 0.9, aligned: true });
    const allEvents = [...events, ...buildPhaseRegression()];
    const findings = evaluate([], { events: allEvents, feedback }).filter(f => f.rule_id === 'quality_regression');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].signature, 'svc-x:1');
    assert.ok(findings[0].evidence.recent_score < findings[0].evidence.historical_median);
  });

  test('quality_regression DORMANT when judge uncalibrated', () => {
    const { events, feedback } = buildCalibration({ faithfulness: 0.9, aligned: false });
    const allEvents = [...events, ...buildPhaseRegression()];
    const findings = evaluate([], { events: allEvents, feedback }).filter(f => f.rule_id === 'quality_regression');
    assert.equal(findings.length, 0);
  });
});
