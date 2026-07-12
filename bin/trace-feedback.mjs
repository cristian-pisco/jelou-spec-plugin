#!/usr/bin/env node
import { resolve, dirname, join } from 'node:path';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import { appendFeedback, resolveShipSpanId } from './lib/trace/feedback.mjs';
import { SIGNAL } from './lib/trace/schema.mjs';

const VALID_SIGNALS = new Set(Object.values(SIGNAL));

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
  process.stderr.write(`trace-feedback: ${msg}\n`);
  process.exit(1);
}

function resolveTraceFile() {
  if (process.env.TRACE_FILE) return process.env.TRACE_FILE;
  return resolve(process.cwd(), '.traces', 'spans.jsonl');
}

function resolveFeedbackFile(traceFile) {
  if (process.env.FEEDBACK_FILE) return process.env.FEEDBACK_FILE;
  return join(dirname(traceFile), 'feedback.jsonl');
}

const args = parseArgs(process.argv.slice(2));

if (!args.span && !args.task) die('--span or --task required');
if (!args.signal || !VALID_SIGNALS.has(args.signal)) {
  die(`--signal must be one of ${[...VALID_SIGNALS].join(', ')}`);
}

if (process.env.TRACE_DISABLED === '1') process.exit(0);

const traceFile = resolveTraceFile();
const feedbackFile = resolveFeedbackFile(traceFile);

let spanId = args.span;
if (!spanId) {
  const events = [];
  for (const f of listRotatedFiles(traceFile)) {
    for (const e of readSpans(f)) events.push(e);
  }
  spanId = resolveShipSpanId(events, args.task);
  if (!spanId) process.exit(0);
}

appendFeedback(feedbackFile, {
  span_id: spanId,
  signal: args.signal,
  source: args.source,
  note: args.note,
});

process.exit(0);
