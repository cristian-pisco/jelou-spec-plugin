#!/usr/bin/env node
// bin/trace-suggest.mjs — scan recent traces, emit blocking suggestions.
//
// Inputs (env):
//   TRACE_FILE                workspace spans.jsonl (default <cwd>/.traces/spans.jsonl)
//   TRACE_SUGGEST_HISTORY     cooldown store (default <cwd>/.spec-workspace/.cache/suggestion-history.jsonl)
//   TRACE_DISABLED=1          short-circuit (exit 0 silently)
//
// Output: one SUGGEST block per finding (multi-line), separated by blank lines.
// Exit codes: 0 always (best-effort).

import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import { pairSpans } from './lib/trace/aggregate.mjs';
import { evaluate, applyCooldown, formatSuggestion } from './lib/trace/rules.mjs';

function resolveTraceFile() {
  return process.env.TRACE_FILE
    || resolve(process.cwd(), '.traces', 'spans.jsonl');
}

function resolveHistoryFile() {
  return process.env.TRACE_SUGGEST_HISTORY
    || resolve(process.cwd(), '.spec-workspace', '.cache', 'suggestion-history.jsonl');
}

function loadHistory(file) {
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

if (process.env.TRACE_DISABLED === '1') process.exit(0);

const traceFile = resolveTraceFile();
const historyFile = resolveHistoryFile();

const events = [];
for (const f of listRotatedFiles(traceFile)) {
  for (const e of readSpans(f)) events.push(e);
}

const pairs = pairSpans(events);
const findings = evaluate(pairs);
const history = loadHistory(historyFile);
const filtered = applyCooldown(findings, history);

if (filtered.length === 0) process.exit(0);

const out = filtered.map(formatSuggestion).join('\n\n');
process.stdout.write(out + '\n');
