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
  test('exposes four rules with stable ids', () => {
    assert.deepEqual(
      [...RULE_IDS].sort(),
      ['bump_model_tier', 'extend_patterns', 'immediate_flag', 'suggest_parallelize']
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

  test('triggers for an orphaned span in last 24h', () => {
    const ts = new Date().toISOString();
    const pairs = [{
      start: { event_kind: 'span_start', span_id: 'ORPH', trace_id: 'T_ORPH',
               name: 'agent_dispatch', agent_role: 'implementer', scope: 'task', ts },
      end: { event_kind: 'span_end', span_id: 'ORPH', status: 'orphaned',
             ts, attrs: { error_signature: 'ORPHAN_SIG' } },
      duration_ms: 1000,
    }];
    const findings = evaluate(pairs).filter(f => f.rule_id === 'immediate_flag');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].evidence.status, 'orphaned');
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
});
