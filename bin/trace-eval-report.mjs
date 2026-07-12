#!/usr/bin/env node
import { resolve, dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import { readFeedback } from './lib/trace/feedback.mjs';
import { buildScorecard } from './lib/trace/scorecard.mjs';
import { EVENT_KIND } from './lib/trace/schema.mjs';

function resolveTraceFile() {
  return process.env.TRACE_FILE || resolve(process.cwd(), '.traces', 'spans.jsonl');
}

function resolveFeedbackFile(traceFile) {
  return process.env.FEEDBACK_FILE || join(dirname(traceFile), 'feedback.jsonl');
}

function resolveHistoryFile() {
  return process.env.TRACE_SUGGEST_HISTORY
    || resolve(process.cwd(), '.spec-workspace', '.cache', 'suggestion-history.jsonl');
}

function loadHistory(file) {
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return out;
}

function parseArgs(argv) {
  const out = { json: false, task: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      out.json = true;
    } else if (a === '--task') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) return { error: '--task requires a slug' };
      out.task = next;
      i++;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return out;
}

function filterByTask(events, slug) {
  const traceIds = new Set();
  for (const e of events) {
    if (e.event_kind === EVENT_KIND.SPAN_START && e.task_slug === slug) {
      traceIds.add(e.trace_id);
    }
  }
  return events.filter((e) => traceIds.has(e.trace_id));
}

function fmt(n) {
  if (n === 0) return '0';
  if (n < 1000) return n.toFixed(0);
  if (n < 60000) return (n / 1000).toFixed(1) + 's';
  return (n / 60000).toFixed(1) + 'm';
}

function pct(x) {
  return `${(x * 100).toFixed(0)}%`;
}

function usd(x) {
  return `$${Number(x).toFixed(4)}`;
}

function q(x) {
  return x == null ? '-' : Number(x).toFixed(2);
}

function render(sc) {
  const lines = [];
  const t = sc.tasks;
  lines.push('Tasks & success');
  lines.push('---------------');
  lines.push(
    `total=${t.total}  pass@1=${t.pass_1}  pass@k=${t.pass_k}  fail=${t.fail}  ` +
    `autonomy=${pct(t.autonomy)}`,
  );
  lines.push('');

  lines.push('Cost');
  lines.push('----');
  lines.push(
    `total=${usd(sc.cost.total_usd)}  cost_per_successful_task=${usd(sc.cost.cost_per_successful_task)}`,
  );
  const models = Object.entries(sc.cost.by_model);
  if (models.length) {
    for (const [model, cost] of models) lines.push(`  ${model}: ${usd(cost)}`);
  }
  lines.push('');

  lines.push('Per-agent quality');
  lines.push('-----------------');
  if (sc.agents.length === 0) {
    lines.push('No agent_dispatch data found.');
  } else {
    lines.push('agent_role       n   p50      p95      retry_rate  wilson_lb  quality  faith');
    lines.push('---------------- --- -------- -------- ----------- ---------- -------- -----');
    for (const a of sc.agents) {
      lines.push(
        `${a.agent_role.padEnd(16)} ${String(a.n).padStart(3)} ` +
        `${fmt(a.p50_ms).padStart(8)} ${fmt(a.p95_ms).padStart(8)} ` +
        `${pct(a.retry_rate).padStart(10)}  ${a.wilson_lower_bound.toFixed(2).padStart(9)}  ` +
        `${q(a.mean_quality).padStart(7)}  ${q(a.mean_faithfulness).padStart(5)}`,
      );
    }
  }
  lines.push('');

  lines.push('Judge calibration');
  lines.push('-----------------');
  lines.push(
    `kappa=${sc.quality.kappa.toFixed(2)}  pairs=${sc.quality.pairs}  ` +
    `calibrated=${sc.quality.calibrated}  mean_quality_score=${q(sc.quality.mean_quality_score)}`,
  );
  lines.push('');

  lines.push('Failure taxonomy');
  lines.push('----------------');
  lines.push(
    Object.entries(sc.failures).map(([mode, count]) => `${mode}=${count}`).join('  '),
  );
  lines.push('');

  lines.push('Feedback');
  lines.push('--------');
  lines.push(
    Object.entries(sc.feedback).map(([signal, count]) => `${signal}=${count}`).join('  '),
  );
  lines.push('');

  lines.push('Suggestion hit-rate');
  lines.push('-------------------');
  lines.push(
    `verified=${sc.suggestions.verified}  met=${sc.suggestions.met}  ` +
    `hit_rate=${pct(sc.suggestions.hit_rate)}`,
  );
  return lines.join('\n') + '\n';
}

const args = parseArgs(process.argv.slice(2));
if (args.error) {
  process.stderr.write(
    'usage: trace-eval-report.mjs [--json | --task <slug>]\n' + args.error + '\n',
  );
  process.exit(1);
}

const traceFile = resolveTraceFile();
const feedbackFile = resolveFeedbackFile(traceFile);
const historyFile = resolveHistoryFile();

let events = [];
for (const f of listRotatedFiles(traceFile)) {
  for (const e of readSpans(f)) events.push(e);
}
const feedback = readFeedback(feedbackFile);
const history = loadHistory(historyFile);

if (args.task) events = filterByTask(events, args.task);

if (events.length === 0 && feedback.length === 0 && history.length === 0) {
  process.stdout.write('No evaluation data yet.\n');
  process.exit(0);
}

const scorecard = buildScorecard({ events, feedback, history });

if (args.json) {
  process.stdout.write(JSON.stringify(scorecard, null, 2) + '\n');
} else {
  process.stdout.write(render(scorecard));
}
