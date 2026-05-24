#!/usr/bin/env node
// bin/trace-snapshot-task.mjs — snapshot all spans for a task slug to a file.
//
// Usage:
//   node bin/trace-snapshot-task.mjs --task <slug> --out <path/to/snapshot.jsonl>
//
// Reads spans.jsonl (and any rotated siblings) from TRACE_FILE (or
// <cwd>/.traces/spans.jsonl), filters by task_slug, and writes matching
// events to the given --out path.
//
// Best-effort: exits 0 on any I/O failure so callers can use `|| true`.
// TRACE_DISABLED=1: exits 0 immediately (no-op).

import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';

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
  process.stderr.write(`trace-snapshot-task: ${msg}\n`);
  process.exit(0); // best-effort: always exit 0
}

if (process.env.TRACE_DISABLED === '1') process.exit(0);

const args = parseArgs(process.argv.slice(2));

if (!args.task) die('--task <slug> required');
if (!args.out) die('--out <path> required');

const slug = args.task;
const outPath = resolve(args.out);
const baseFile = process.env.TRACE_FILE
  ? resolve(process.env.TRACE_FILE)
  : resolve(process.cwd(), '.traces', 'spans.jsonl');

try {
  mkdirSync(dirname(outPath), { recursive: true });
  const w = createWriteStream(outPath);
  const files = listRotatedFiles(baseFile);
  for (const f of files) {
    for (const evt of readSpans(f, { filter: (e) => e.task_slug === slug })) {
      w.write(JSON.stringify(evt) + '\n');
    }
  }
  w.end();
} catch (err) {
  process.stderr.write(`trace-snapshot-task: warning: ${err.message}\n`);
  process.exit(0);
}
