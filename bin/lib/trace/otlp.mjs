// bin/lib/trace/otlp.mjs
//
// Pure mapper from the plugin-native JSONL span store to the OpenInference /
// OTel-GenAI attribute shape. Stdlib only, no I/O. The V1 schema was declared
// "OTLP-shaped" precisely so this alias could ship without re-instrumenting.
//
//   - spansToOpenInference(events): { spans: [...] } — one entry per paired
//     span (span_start+span_end) plus one per `eval` event (kind EVALUATOR).
//     Daemon-scope events and orphan starts are omitted.

import { pairSpans } from './aggregate.mjs';
import { EVAL_EVENT_NAME } from './schema.mjs';

const KIND_BY_NAME = {
  agent_dispatch: 'AGENT',
  phase: 'CHAIN',
  execute_task: 'CHAIN',
  new_task: 'CHAIN',
  refine_task: 'CHAIN',
  ship: 'CHAIN',
  report_task: 'CHAIN',
  close_task: 'CHAIN',
};

const GEN_AI_PASSTHROUGH = [
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.reasoning_tokens',
  'gen_ai.usage.cache_read_tokens',
  'cost_usd',
  'success',
  'quality_score',
  'failure_mode',
];

function statusCode(status) {
  return status === 'failed' || status === 'blocked' ? 'ERROR' : 'OK';
}

function spanAttributes(pair) {
  const { start, end } = pair;
  const kind = KIND_BY_NAME[start.name] || 'CHAIN';
  const attributes = { 'openinference.span.kind': kind };
  if (kind === 'AGENT') {
    attributes['gen_ai.operation.name'] = 'invoke_agent';
    if (start.agent_role) attributes['gen_ai.agent.name'] = start.agent_role;
  } else {
    attributes['gen_ai.operation.name'] = 'chain';
  }
  const model = start.attrs?.model_used || end?.attrs?.model_used;
  if (model) attributes['gen_ai.request.model'] = model;
  const endAttrs = end?.attrs || {};
  for (const key of GEN_AI_PASSTHROUGH) {
    if (endAttrs[key] != null) attributes[key] = endAttrs[key];
  }
  return attributes;
}

export function spansToOpenInference(events) {
  const spans = [];

  for (const pair of pairSpans(events)) {
    const { start, end } = pair;
    spans.push({
      context: { trace_id: start.trace_id, span_id: start.span_id },
      parent_id: start.parent_span_id || null,
      name: start.name,
      start_time: start.ts,
      end_time: end.ts,
      status_code: statusCode(end.status),
      attributes: spanAttributes(pair),
    });
  }

  for (const e of events) {
    if (e.event_kind !== 'event' || e.name !== EVAL_EVENT_NAME) continue;
    const attributes = { 'openinference.span.kind': 'EVALUATOR' };
    if (e.attrs?.evaluator != null) attributes['gen_ai.evaluation.name'] = e.attrs.evaluator;
    if (e.attrs?.quality_score != null) attributes['gen_ai.evaluation.score.value'] = e.attrs.quality_score;
    spans.push({
      context: { trace_id: e.trace_id, span_id: e.span_id },
      parent_id: e.parent_span_id || null,
      name: e.name,
      start_time: e.ts,
      end_time: e.ts,
      status_code: 'OK',
      attributes,
    });
  }

  return { spans };
}
