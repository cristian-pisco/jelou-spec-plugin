#!/usr/bin/env node
// tests/fixtures/trace/generate-rules-sample.mjs
//
// Regenerate tests/fixtures/trace/rules-sample.jsonl with timestamps relative to
// "now" so rule windows (30-day, 24h) include the events when tests run.
//
// Usage: node tests/fixtures/trace/generate-rules-sample.mjs > tests/fixtures/trace/rules-sample.jsonl
//
// Note: The fixture is committed. Regenerate it if rule windows change.

const lines = [];
const NOW = Date.now();
const MIN = 60 * 1000;

function emit(obj) { lines.push(JSON.stringify(obj)); }

// --- 10 implementer dispatches in the last hour (rule a) ---
// retry_count pattern: [1,1,1,0,0,0,0,0,0,0] → rate = 0.30 (>0.20)
// First 3 carry error_signature DEAD_BEEF (rule b)
const retries = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
for (let i = 0; i < 10; i++) {
  const start = NOW - (60 - i * 6) * MIN; // spread within last hour
  const end = start + 30000;
  const spanId = `IMP${i}`;
  const traceId = `T_IMP${i}`;
  emit({
    ts: new Date(start).toISOString(),
    event_kind: 'span_start',
    span_id: spanId, trace_id: traceId,
    scope: 'task', name: 'agent_dispatch',
    task_slug: `t${i}`, service_id: 'svc-x', phase_num: 1,
    agent_role: 'implementer',
  });
  const attrs = { retry_count: retries[i], diff_size_loc: 50 };
  if (i < 3) attrs.error_signature = 'DEAD_BEEF';
  emit({
    ts: new Date(end).toISOString(),
    event_kind: 'span_end',
    span_id: spanId, trace_id: traceId,
    scope: 'task', name: 'agent_dispatch',
    status: 'ok', duration_ms: 30000,
    agent_role: 'implementer',
    attrs,
  });
}

// --- 10 phases in the last hour for svc-x:1 (rule c) ---
// Durations chosen so p95 / median > 3.0
const phaseDurations = [60000, 10000, 11000, 12000, 13000, 14000, 15000, 10500, 11500, 12500];
for (let i = 0; i < 10; i++) {
  const start = NOW - (50 - i * 5) * MIN;
  const end = start + phaseDurations[i];
  const spanId = `PH${i}`;
  const traceId = `T_PH${i}`;
  emit({
    ts: new Date(start).toISOString(),
    event_kind: 'span_start',
    span_id: spanId, trace_id: traceId,
    scope: 'task', name: 'phase',
    task_slug: `tp${i}`, service_id: 'svc-x', phase_num: 1,
  });
  emit({
    ts: new Date(end).toISOString(),
    event_kind: 'span_end',
    span_id: spanId, trace_id: traceId,
    scope: 'task', name: 'phase',
    status: 'ok', duration_ms: phaseDurations[i],
  });
}

// --- 1 blocked dispatch in last 30 minutes (rule d) ---
const blkStart = NOW - 30 * MIN;
const blkEnd = blkStart + 1000;
emit({
  ts: new Date(blkStart).toISOString(),
  event_kind: 'span_start',
  span_id: 'BLK1', trace_id: 'T_BLK',
  scope: 'task', name: 'agent_dispatch',
  task_slug: 'tblocked', service_id: 'svc-x', phase_num: 2,
  agent_role: 'qa-agent',
});
emit({
  ts: new Date(blkEnd).toISOString(),
  event_kind: 'span_end',
  span_id: 'BLK1', trace_id: 'T_BLK',
  scope: 'task', name: 'agent_dispatch',
  agent_role: 'qa-agent',
  status: 'blocked', duration_ms: 1000,
  attrs: { error_signature: 'BLOCKED_SIG', retry_count: 5 },
});

process.stdout.write(lines.join('\n') + '\n');
