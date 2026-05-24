#!/usr/bin/env node
// bin/trace-end-span.mjs — emit a span_end, compute duration from matching start.
//
// Inputs (CLI flags):
//   --span <span_id>           REQUIRED — span_id of the open span to close
//   --status <ok|blocked|failed|escalated|orphaned>  REQUIRED
//   --duration <ms>            optional — override computed duration
//   --retries <n>              optional — attrs.retry_count
//   --outcome <string>         optional — attrs.outcome
//   --diff-size <n>            optional — attrs.diff_size_loc
//   --error-sig <hex>          optional — attrs.error_signature
//   --escalation <reason>      optional — attrs.escalation_reason
//   --artifacts <a,b,c>        optional — attrs.artifacts (comma-separated)
//
// Behavior:
//   - Looks up the matching span_start in TRACE_FILE to derive trace_id, scope,
//     name, task_slug, service_id, phase_num, agent_role, and start ts.
//   - duration_ms = now - start_ts unless --duration overrides.
//   - If no matching span_start is found, still emits span_end but flags
//     attrs.unmatched_start: true (reconciler may pair them later, otherwise
//     analyzer treats as orphan tail).
//
// Environment:
//   TRACE_FILE        path to spans.jsonl
//   TRACE_DISABLED=1  short-circuit
//
// Exit codes:
//   0  span_end emitted (or TRACE_DISABLED)
//   1  invalid args

import { resolve } from 'node:path';
import { appendSpan } from './lib/trace/emitter.mjs';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import { EVENT_KIND, STATUS } from './lib/trace/schema.mjs';

const VALID_STATUSES = new Set(Object.values(STATUS));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

function die(msg) {
  process.stderr.write(`trace-end-span: ${msg}\n`);
  process.exit(1);
}

function resolveTraceFile() {
  if (process.env.TRACE_FILE) return process.env.TRACE_FILE;
  return resolve(process.cwd(), '.traces', 'spans.jsonl');
}

function findStart(traceFile, spanId) {
  for (const f of listRotatedFiles(traceFile)) {
    for (const evt of readSpans(f, {
      filter: (e) => e.event_kind === EVENT_KIND.SPAN_START && e.span_id === spanId,
    })) {
      return evt;
    }
  }
  return null;
}

if (process.env.TRACE_DISABLED === '1') process.exit(0);

const args = parseArgs(process.argv.slice(2));

if (!args.span) die('--span required');
if (!args.status) die('--status required');
if (!VALID_STATUSES.has(args.status)) {
  die(`--status must be one of ${[...VALID_STATUSES].join(', ')}`);
}

const traceFile = resolveTraceFile();
const start = findStart(traceFile, args.span);

let duration_ms;
if (args.duration != null) duration_ms = Number(args.duration);
else if (start) duration_ms = Date.now() - new Date(start.ts).getTime();

const attrs = {};
if (args.retries != null) attrs.retry_count = Number(args.retries);
if (args.outcome) attrs.outcome = args.outcome;
if (args['diff-size'] != null) attrs.diff_size_loc = Number(args['diff-size']);
if (args['error-sig']) attrs.error_signature = args['error-sig'];
if (args.escalation) attrs.escalation_reason = args.escalation;
if (args.artifacts) attrs.artifacts = args.artifacts.split(',').map((s) => s.trim());
if (!start) attrs.unmatched_start = true;

appendSpan(traceFile, {
  event_kind: EVENT_KIND.SPAN_END,
  span_id: args.span,
  trace_id: start && start.trace_id,
  parent_span_id: start && start.parent_span_id,
  scope: start && start.scope,
  name: start && start.name,
  task_slug: start && start.task_slug,
  service_id: start && start.service_id,
  phase_num: start && start.phase_num,
  agent_role: start && start.agent_role,
  duration_ms,
  status: args.status,
  attrs: Object.keys(attrs).length ? attrs : undefined,
});
