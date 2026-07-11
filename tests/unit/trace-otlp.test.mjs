// tests/unit/trace-otlp.test.mjs
//
// Run: `node --test tests/unit/trace-otlp.test.mjs`
//
// The bespoke JSONL spans → OpenInference/gen_ai attribute shape, so traces
// are portable to Phoenix / Langfuse / Datadog with no custom importer.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spansToOpenInference } from '../../bin/lib/trace/otlp.mjs';

function evts() {
  return [
    { event_kind: 'span_start', span_id: 'W', trace_id: 'T', scope: 'task', name: 'execute_task', ts: '2026-07-01T10:00:00.000Z', task_slug: 'demo' },
    { event_kind: 'span_start', span_id: 'P', trace_id: 'T', parent_span_id: 'W', scope: 'task', name: 'phase', ts: '2026-07-01T10:00:01.000Z', phase_num: 3, service_id: 'svc' },
    { event_kind: 'span_start', span_id: 'A', trace_id: 'T', parent_span_id: 'P', scope: 'task', name: 'agent_dispatch', ts: '2026-07-01T10:00:02.000Z', agent_role: 'implementer', attrs: { model_used: 'sonnet' } },
    { event_kind: 'span_end', span_id: 'A', trace_id: 'T', name: 'agent_dispatch', scope: 'task', ts: '2026-07-01T10:00:05.000Z', duration_ms: 3000, status: 'ok', attrs: { 'gen_ai.usage.input_tokens': 12000, 'gen_ai.usage.output_tokens': 3000, cost_usd: 0.081, success: 'pass@1' } },
    { event_kind: 'span_end', span_id: 'P', trace_id: 'T', name: 'phase', scope: 'task', ts: '2026-07-01T10:00:06.000Z', duration_ms: 5000, status: 'failed' },
    { event_kind: 'span_end', span_id: 'W', trace_id: 'T', name: 'execute_task', scope: 'task', ts: '2026-07-01T10:00:07.000Z', duration_ms: 7000, status: 'ok' },
    { event_kind: 'event', span_id: 'E', trace_id: 'T', parent_span_id: 'A', scope: 'task', name: 'eval', ts: '2026-07-01T10:10:00.000Z', attrs: { quality_score: 0.82, evaluator: 'panel' } },
    { event_kind: 'event', span_id: 'D', trace_id: 'T', scope: 'daemon', name: 'pattern_match', ts: '2026-07-01T10:00:00.000Z' },
  ];
}

describe('spansToOpenInference(events)', () => {
  test('maps span names to OpenInference span kinds', () => {
    const { spans } = spansToOpenInference(evts());
    const kind = (id) => spans.find((s) => s.context.span_id === id).attributes['openinference.span.kind'];
    assert.equal(kind('W'), 'CHAIN');
    assert.equal(kind('P'), 'CHAIN');
    assert.equal(kind('A'), 'AGENT');
    assert.equal(kind('E'), 'EVALUATOR');
  });

  test('agent spans carry gen_ai.* request/usage attributes', () => {
    const { spans } = spansToOpenInference(evts());
    const a = spans.find((s) => s.context.span_id === 'A');
    assert.equal(a.attributes['gen_ai.operation.name'], 'invoke_agent');
    assert.equal(a.attributes['gen_ai.request.model'], 'sonnet');
    assert.equal(a.attributes['gen_ai.usage.input_tokens'], 12000);
    assert.equal(a.attributes['gen_ai.usage.output_tokens'], 3000);
    assert.equal(a.attributes['cost_usd'], 0.081);
    assert.equal(a.attributes['success'], 'pass@1');
  });

  test('preserves the trace tree via context + parent_id', () => {
    const { spans } = spansToOpenInference(evts());
    const a = spans.find((s) => s.context.span_id === 'A');
    assert.equal(a.context.trace_id, 'T');
    assert.equal(a.parent_id, 'P');
    const w = spans.find((s) => s.context.span_id === 'W');
    assert.equal(w.parent_id, null);
  });

  test('failed/blocked spans map to status_code ERROR, others OK', () => {
    const { spans } = spansToOpenInference(evts());
    assert.equal(spans.find((s) => s.context.span_id === 'P').status_code, 'ERROR');
    assert.equal(spans.find((s) => s.context.span_id === 'A').status_code, 'OK');
  });

  test('eval events become EVALUATOR spans carrying the evaluation score', () => {
    const { spans } = spansToOpenInference(evts());
    const e = spans.find((s) => s.context.span_id === 'E');
    assert.equal(e.parent_id, 'A');
    assert.equal(e.attributes['gen_ai.evaluation.score.value'], 0.82);
    assert.equal(e.start_time, e.end_time);
  });

  test('daemon events are excluded (not GenAI spans)', () => {
    const { spans } = spansToOpenInference(evts());
    assert.equal(spans.find((s) => s.context.span_id === 'D'), undefined);
  });

  test('orphan span_start (no end) is skipped', () => {
    const { spans } = spansToOpenInference([
      { event_kind: 'span_start', span_id: 'X', trace_id: 'T', scope: 'task', name: 'phase', ts: '2026-07-01T10:00:00.000Z' },
    ]);
    assert.equal(spans.length, 0);
  });
});
