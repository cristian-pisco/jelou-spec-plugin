#!/usr/bin/env node
// bin/trace-reconcile.mjs — sweep orphan span_start entries and emit synthetic span_end.
//
// Scans TRACE_FILE (and rotated siblings) for span_start events whose span_id
// has no matching span_end and whose ts is older than RECONCILE_AFTER_MS
// (default 30 min, override with TRACE_RECONCILE_AFTER_MS).
//
// For each orphan, appends a synthetic span_end with:
//   status: "orphaned"
//   attrs.reconciled: true
//   duration_ms = now - start.ts
//
// Idempotent: a subsequent run sees the synthetic span_end and skips the start.
//
// Environment:
//   TRACE_FILE                  path to spans.jsonl
//   TRACE_RECONCILE_AFTER_MS    threshold in ms (default 1_800_000)
//   TRACE_DISABLED=1            short-circuit (exit 0)
//
// Output (stdout, single line):
//   reconciled: <N>
//
// Exit codes:
//   0  always (best-effort)

import { resolve } from 'node:path';
import { appendSpan } from './lib/trace/emitter.mjs';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import {
  EVENT_KIND, STATUS, RECONCILE_AFTER_MS,
} from './lib/trace/schema.mjs';

function resolveTraceFile() {
  if (process.env.TRACE_FILE) return process.env.TRACE_FILE;
  return resolve(process.cwd(), '.traces', 'spans.jsonl');
}

if (process.env.TRACE_DISABLED === '1') {
  process.stdout.write('reconciled: 0\n');
  process.exit(0);
}

const threshold = process.env.TRACE_RECONCILE_AFTER_MS
  ? Number(process.env.TRACE_RECONCILE_AFTER_MS)
  : RECONCILE_AFTER_MS;

const traceFile = resolveTraceFile();
const files = listRotatedFiles(traceFile);

const opens = new Map();     // span_id -> start event
const closed = new Set();    // span_ids with matching span_end

for (const f of files) {
  for (const evt of readSpans(f)) {
    if (evt.event_kind === EVENT_KIND.SPAN_START) {
      opens.set(evt.span_id, evt);
    } else if (evt.event_kind === EVENT_KIND.SPAN_END) {
      closed.add(evt.span_id);
    }
  }
}

const now = Date.now();
let reconciled = 0;

for (const [span_id, start] of opens) {
  if (closed.has(span_id)) continue;
  const startMs = new Date(start.ts).getTime();
  if (now - startMs < threshold) continue;
  appendSpan(traceFile, {
    event_kind: EVENT_KIND.SPAN_END,
    span_id,
    trace_id: start.trace_id,
    parent_span_id: start.parent_span_id,
    scope: start.scope,
    name: start.name,
    task_slug: start.task_slug,
    service_id: start.service_id,
    phase_num: start.phase_num,
    agent_role: start.agent_role,
    status: STATUS.ORPHANED,
    duration_ms: now - startMs,
    attrs: { reconciled: true },
  });
  reconciled += 1;
}

process.stdout.write(`reconciled: ${reconciled}\n`);
