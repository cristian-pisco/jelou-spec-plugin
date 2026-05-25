#!/usr/bin/env node
// bin/trace-analyze.mjs — query the workspace trace store.
//
// Modes:
//   --by-agent              table per agent_role
//   --by-phase              table per service:phase_num
//   --by-task <slug>        span tree of one task
//   --trends [--window 30d] week-over-week dispatch counts per agent
//
// Inputs (env):
//   TRACE_FILE  workspace spans.jsonl (default <cwd>/.traces/spans.jsonl)
//
// Output: human-readable tables/trees on stdout.
// Exit codes: 0 query produced output, 1 invalid args.

import { resolve } from 'node:path';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import {
  pairSpans, groupByAgent, groupByPhase, percentile, retryRate,
} from './lib/trace/aggregate.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function resolveTraceFile() {
  return process.env.TRACE_FILE
    || resolve(process.cwd(), '.traces', 'spans.jsonl');
}

function loadPairs() {
  const events = [];
  for (const f of listRotatedFiles(resolveTraceFile())) {
    for (const e of readSpans(f)) events.push(e);
  }
  return pairSpans(events);
}

function fmt(n) {
  if (n === 0) return '0';
  if (n < 1000) return n.toFixed(0);
  if (n < 60000) return (n / 1000).toFixed(1) + 's';
  return (n / 60000).toFixed(1) + 'm';
}

function byAgent(pairs) {
  const grouped = groupByAgent(pairs);
  if (Object.keys(grouped).length === 0) {
    process.stdout.write('No agent_dispatch data found.\n');
    return;
  }
  process.stdout.write('agent_role       n   p50      p95      retry_rate  escalation_rate\n');
  process.stdout.write('---------------- --- -------- -------- ----------- ----------------\n');
  for (const [role, ps] of Object.entries(grouped)) {
    const durations = ps.map(p => p.duration_ms);
    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    const rate = retryRate(ps);
    const escalated = ps.filter(p =>
      p.end?.status === 'escalated' || p.end?.status === 'blocked').length;
    const escRate = escalated / ps.length;
    process.stdout.write(
      `${role.padEnd(16)} ${String(ps.length).padStart(3)} ${fmt(p50).padStart(8)} ${fmt(p95).padStart(8)} ` +
      `${(rate * 100).toFixed(0).padStart(10)}% ${(escRate * 100).toFixed(0).padStart(15)}%\n`
    );
  }
}

function byPhase(pairs) {
  const grouped = groupByPhase(pairs);
  if (Object.keys(grouped).length === 0) {
    process.stdout.write('No phase data found.\n');
    return;
  }
  process.stdout.write('service:phase    n   p50      p95\n');
  process.stdout.write('---------------- --- -------- --------\n');
  for (const [key, ps] of Object.entries(grouped)) {
    const durations = ps.map(p => p.duration_ms);
    process.stdout.write(
      `${key.padEnd(16)} ${String(ps.length).padStart(3)} ` +
      `${fmt(percentile(durations, 50)).padStart(8)} ${fmt(percentile(durations, 95)).padStart(8)}\n`
    );
  }
}

function byTask(pairs, slug) {
  const taskPairs = pairs.filter(p => p.start.task_slug === slug);
  if (taskPairs.length === 0) {
    process.stdout.write(`No spans found for task '${slug}'.\n`);
    return;
  }
  const byParent = new Map();
  for (const p of taskPairs) {
    const parent = p.start.parent_span_id || 'ROOT';
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(p);
  }
  function emit(parent, depth) {
    const children = byParent.get(parent) || [];
    for (const p of children) {
      const indent = '  '.repeat(depth);
      const attrs = p.end?.attrs
        ? ` (${Object.entries(p.end.attrs).map(([k, v]) => `${k}=${v}`).join(', ')})`
        : '';
      process.stdout.write(
        `${indent}${p.start.name}` +
        (p.start.agent_role ? `:${p.start.agent_role}` : '') +
        ` ${fmt(p.duration_ms)} ${p.end?.status || '?'}${attrs}\n`
      );
      emit(p.start.span_id, depth + 1);
    }
  }
  emit('ROOT', 0);
}

function trends(pairs) {
  const grouped = groupByAgent(pairs);
  if (Object.keys(grouped).length === 0) {
    process.stdout.write('No data for trends.\n');
    return;
  }
  const now = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  process.stdout.write('agent_role       this_week  last_week  delta  dispatches\n');
  process.stdout.write('---------------- --------- --------- ------ ----------\n');
  for (const [role, ps] of Object.entries(grouped)) {
    let thisWeek = 0;
    let lastWeek = 0;
    for (const p of ps) {
      const ts = new Date(p.end?.ts || p.start.ts).getTime();
      if (now - ts < WEEK_MS) thisWeek += 1;
      else if (now - ts < 2 * WEEK_MS) lastWeek += 1;
    }
    const delta = thisWeek - lastWeek;
    const sign = delta > 0 ? '+' : '';
    process.stdout.write(
      `${role.padEnd(16)} ${String(thisWeek).padStart(9)} ${String(lastWeek).padStart(9)} ` +
      `${sign}${String(delta).padStart(5)} ${String(ps.length).padStart(10)}\n`
    );
  }
}

const args = parseArgs(process.argv.slice(2));
const pairs = loadPairs();

if (args['by-agent']) {
  byAgent(pairs);
} else if (args['by-phase']) {
  byPhase(pairs);
} else if (args['by-task']) {
  byTask(pairs, args['by-task']);
} else if (args['trends']) {
  trends(pairs);
} else {
  process.stderr.write(
    'usage: trace-analyze.mjs [--by-agent | --by-phase | --by-task <slug> | --trends]\n');
  process.exit(1);
}
