// tests/unit/trace-aggregate.test.mjs
//
// Run: `node --test tests/unit/trace-aggregate.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  groupByTrace,
  groupByAgent,
  groupByPhase,
  percentile,
  retryRate,
  retriedFraction,
  wilsonLowerBound,
  pairSpans,
  binarizeScore,
  cohensKappa,
} from '../../bin/lib/trace/aggregate.mjs';
import { readSpans } from '../../bin/lib/trace/reader.mjs';

const FIX = 'tests/fixtures/trace/aggregate-sample.jsonl';

function loadAll() {
  return [...readSpans(FIX)];
}

describe('pairSpans(events)', () => {
  test('pairs span_start with matching span_end by span_id', () => {
    const evts = loadAll();
    const pairs = pairSpans(evts);
    assert.equal(pairs.length, 8);
    for (const p of pairs) {
      assert.equal(p.start.event_kind, 'span_start');
      assert.equal(p.end.event_kind, 'span_end');
      assert.equal(p.start.span_id, p.end.span_id);
      assert.ok(p.duration_ms >= 0);
    }
  });

  test('orphan span_start (no matching end) is omitted from pairs', () => {
    const orphan = [{
      event_kind: 'span_start', span_id: 'X', trace_id: 'T', scope: 'task',
      name: 'phase', ts: '2026-05-20T10:00:00Z',
    }];
    assert.equal(pairSpans(orphan).length, 0);
  });
});

describe('groupByTrace(pairs)', () => {
  test('groups pairs by trace_id', () => {
    const pairs = pairSpans(loadAll());
    const grouped = groupByTrace(pairs);
    assert.deepEqual(Object.keys(grouped).sort(), ['T1', 'T2']);
    assert.equal(grouped.T1.length, 4);
  });
});

describe('groupByAgent(pairs)', () => {
  test('groups agent_dispatch pairs by agent_role', () => {
    const pairs = pairSpans(loadAll()).filter(p => p.start.name === 'agent_dispatch');
    const grouped = groupByAgent(pairs);
    assert.deepEqual(Object.keys(grouped).sort(), ['implementer', 'test-writer']);
    assert.equal(grouped.implementer.length, 2);
    assert.equal(grouped['test-writer'].length, 1);
  });

  test('ignores non-agent_dispatch spans', () => {
    const pairs = pairSpans(loadAll());
    const grouped = groupByAgent(pairs);
    assert.ok(Object.values(grouped).every(arr =>
      arr.every(p => p.start.name === 'agent_dispatch')
    ));
  });
});

describe('groupByPhase(pairs)', () => {
  test('groups phase pairs by (service_id, phase_num)', () => {
    const pairs = pairSpans(loadAll()).filter(p => p.start.name === 'phase');
    const grouped = groupByPhase(pairs);
    assert.deepEqual(Object.keys(grouped), ['svc-x:1']);
    assert.equal(grouped['svc-x:1'].length, 2);
  });
});

describe('percentile(arr, p)', () => {
  test('p50 of [1,2,3,4,5] is 3', () => {
    assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  });

  test('p95 of [1..100] is between 95 and 96 (linear interpolation)', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    const p95 = percentile(arr, 95);
    assert.ok(p95 >= 95 && p95 <= 96);
  });

  test('empty array returns 0', () => {
    assert.equal(percentile([], 50), 0);
  });

  test('single element returns that element', () => {
    assert.equal(percentile([42], 95), 42);
  });
});

describe('retryRate(agentPairs)', () => {
  test('returns sum(retry_count) / count for implementer in fixture', () => {
    const pairs = pairSpans(loadAll()).filter(p =>
      p.start.name === 'agent_dispatch' && p.start.agent_role === 'implementer');
    assert.equal(retryRate(pairs), 0.5);
  });

  test('returns 0 for empty input', () => {
    assert.equal(retryRate([]), 0);
  });

  test('treats missing retry_count as 0', () => {
    const pairs = [
      { end: { attrs: {} } },
      { end: { attrs: { retry_count: 2 } } },
    ];
    assert.equal(retryRate(pairs), 1);
  });
});

describe('wilsonLowerBound(successes, n, z)', () => {
  test('returns 0 when n is 0', () => {
    assert.equal(wilsonLowerBound(0, 0), 0);
  });

  test('6 of 10 lands above 0.20 and below the 0.6 point estimate', () => {
    const lb = wilsonLowerBound(6, 10);
    assert.ok(lb > 0.20);
    assert.ok(lb < 0.6);
  });

  test('clamps to the [0, 1] range', () => {
    assert.equal(wilsonLowerBound(0, 5), 0);
    assert.ok(wilsonLowerBound(5, 5) <= 1);
  });
});

describe('retriedFraction(agentPairs)', () => {
  test('counts pairs whose retry_count > 0', () => {
    const pairs = [
      { end: { attrs: { retry_count: 0 } } },
      { end: { attrs: { retry_count: 2 } } },
      { end: { attrs: { retry_count: 1 } } },
      { end: { attrs: {} } },
    ];
    const { k, n, fraction } = retriedFraction(pairs);
    assert.equal(n, 4);
    assert.equal(k, 2);
    assert.equal(fraction, 0.5);
  });

  test('empty list yields a zero fraction', () => {
    assert.deepEqual(retriedFraction([]), { k: 0, n: 0, fraction: 0 });
  });
});

describe('binarizeScore(score, threshold)', () => {
  test('at or above the default threshold is positive', () => {
    assert.equal(binarizeScore(0.5), 'positive');
    assert.equal(binarizeScore(0.91), 'positive');
  });

  test('below the default threshold is negative', () => {
    assert.equal(binarizeScore(0.49), 'negative');
    assert.equal(binarizeScore(0), 'negative');
  });

  test('honors a custom threshold', () => {
    assert.equal(binarizeScore(0.7, 0.8), 'negative');
    assert.equal(binarizeScore(0.8, 0.8), 'positive');
  });
});

describe('cohensKappa(pairs)', () => {
  test('empty input returns 1', () => {
    assert.equal(cohensKappa([]), 1);
  });

  test('perfect agreement across two categories returns 1', () => {
    const pairs = [
      { a: 'positive', b: 'positive' },
      { a: 'negative', b: 'negative' },
      { a: 'positive', b: 'positive' },
      { a: 'negative', b: 'negative' },
    ];
    assert.equal(cohensKappa(pairs), 1);
  });

  test('single-category perfect agreement returns 1 (guards expected agreement of 1)', () => {
    const pairs = [
      { a: 'positive', b: 'positive' },
      { a: 'positive', b: 'positive' },
    ];
    assert.equal(cohensKappa(pairs), 1);
  });

  test('chance / independent agreement is approximately 0', () => {
    const pairs = [
      { a: 'positive', b: 'positive' },
      { a: 'positive', b: 'negative' },
      { a: 'negative', b: 'positive' },
      { a: 'negative', b: 'negative' },
    ];
    assert.ok(Math.abs(cohensKappa(pairs)) < 1e-9);
  });

  test('total disagreement yields a negative kappa', () => {
    const pairs = [
      { a: 'positive', b: 'negative' },
      { a: 'negative', b: 'positive' },
    ];
    assert.ok(cohensKappa(pairs) < 0);
  });
});
