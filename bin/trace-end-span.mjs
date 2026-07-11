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
//   --tokens-in <n>            optional — attrs["gen_ai.usage.input_tokens"]
//   --tokens-out <n>           optional — attrs["gen_ai.usage.output_tokens"]
//   --reasoning-tokens <n>     optional — attrs["gen_ai.usage.reasoning_tokens"]
//   --cache-read-tokens <n>    optional — attrs["gen_ai.usage.cache_read_tokens"]
//   --cost <usd>               optional — attrs.cost_usd (overrides derivation)
//   --success <pass@1|pass@k|fail>  optional — attrs.success
//   --attempts <n>             optional — attrs.attempts_to_green
//
// When --cost is absent but token counts and the start span's model_used are
// present, cost_usd is derived from the tier price table (best-effort).
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
import { EVENT_KIND, STATUS, SUCCESS, ATTR } from './lib/trace/schema.mjs';
import { deriveCost } from './lib/trace/cost.mjs';

const VALID_STATUSES = new Set(Object.values(STATUS));
const VALID_SUCCESS = new Set(Object.values(SUCCESS));

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
if (args.success != null && !VALID_SUCCESS.has(args.success)) {
  die(`--success must be one of ${[...VALID_SUCCESS].join(', ')}`);
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

const tokensIn = args['tokens-in'] != null ? Number(args['tokens-in']) : undefined;
const tokensOut = args['tokens-out'] != null ? Number(args['tokens-out']) : undefined;
if (tokensIn != null) attrs[ATTR.INPUT_TOKENS] = tokensIn;
if (tokensOut != null) attrs[ATTR.OUTPUT_TOKENS] = tokensOut;
if (args['reasoning-tokens'] != null) attrs[ATTR.REASONING_TOKENS] = Number(args['reasoning-tokens']);
if (args['cache-read-tokens'] != null) attrs[ATTR.CACHE_READ_TOKENS] = Number(args['cache-read-tokens']);
if (args.success != null) attrs[ATTR.SUCCESS] = args.success;
if (args.attempts != null) attrs[ATTR.ATTEMPTS_TO_GREEN] = Number(args.attempts);

if (args.cost != null) {
  attrs[ATTR.COST_USD] = Number(args.cost);
} else if (tokensIn != null && tokensOut != null) {
  const derived = deriveCost(start?.attrs?.model_used, tokensIn, tokensOut);
  if (derived != null) attrs[ATTR.COST_USD] = derived;
}

if (!start) attrs.unmatched_start = true;

appendSpan(traceFile, {
  event_kind: EVENT_KIND.SPAN_END,
  span_id: args.span,
  trace_id: start ? start.trace_id : undefined,
  parent_span_id: start ? start.parent_span_id : undefined,
  scope: start ? start.scope : undefined,
  name: start ? start.name : undefined,
  task_slug: start ? start.task_slug : undefined,
  service_id: start ? start.service_id : undefined,
  phase_num: start ? start.phase_num : undefined,
  agent_role: start ? start.agent_role : undefined,
  duration_ms,
  status: args.status,
  attrs: Object.keys(attrs).length ? attrs : undefined,
});
