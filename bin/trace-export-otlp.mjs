#!/usr/bin/env node
// bin/trace-export-otlp.mjs — export the workspace span store as OpenInference JSON.
//
// Reads the JSONL trace store and prints an OpenInference/gen_ai-attribute
// document to stdout, so traces can be ingested by Phoenix / Langfuse / Datadog
// without a bespoke importer.
//
// Inputs (env):
//   TRACE_FILE        workspace spans.jsonl (default <cwd>/.traces/spans.jsonl)
//   TRACE_DISABLED=1  short-circuit (exit 0, empty document)
//
// Flags:
//   --out <path>      write to a file instead of stdout
//
// Exit codes: 0 always (best-effort, consistent with the rest of the trace CLIs).

import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import { spansToOpenInference } from './lib/trace/otlp.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

function resolveTraceFile() {
  return process.env.TRACE_FILE || resolve(process.cwd(), '.traces', 'spans.jsonl');
}

const args = parseArgs(process.argv.slice(2));

if (process.env.TRACE_DISABLED === '1') {
  const doc = JSON.stringify({ spans: [] }, null, 2) + '\n';
  if (args.out) writeFileSync(args.out, doc); else process.stdout.write(doc);
  process.exit(0);
}

const events = [];
for (const f of listRotatedFiles(resolveTraceFile())) {
  for (const e of readSpans(f)) events.push(e);
}

const doc = JSON.stringify(spansToOpenInference(events), null, 2) + '\n';
if (args.out) writeFileSync(args.out, doc);
else process.stdout.write(doc);
process.exit(0);
