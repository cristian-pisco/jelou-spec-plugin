import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'bin/trace-eval-report.mjs');

let dir;
let traceFile;
let feedbackFile;
let historyFile;

const SPANS = [
  { event_kind: 'span_start', span_id: 'TA', trace_id: 'TA', scope: 'task', name: 'execute_task', task_slug: 'alpha', ts: '2026-07-11T10:00:00.000Z' },
  { event_kind: 'span_start', span_id: 'TA_IMP', parent_span_id: 'TA', trace_id: 'TA', scope: 'task', name: 'agent_dispatch', agent_role: 'implementer', task_slug: 'alpha', ts: '2026-07-11T10:00:01.000Z' },
  { event_kind: 'span_end', span_id: 'TA_IMP', trace_id: 'TA', scope: 'task', name: 'agent_dispatch', status: 'ok', duration_ms: 30000, agent_role: 'implementer', attrs: { retry_count: 0, cost_usd: 0.10 } },
  { event_kind: 'span_end', span_id: 'TA', trace_id: 'TA', scope: 'task', name: 'execute_task', status: 'ok', duration_ms: 40000, attrs: { success: 'pass@1' } },
  { event_kind: 'event', name: 'eval', span_id: 'EV_A', parent_span_id: 'TA_IMP', trace_id: 'TA', ts: '2026-07-11T10:00:03.000Z', attrs: { quality_score: 0.8, quality_dims: { correctness: 0.85, faithfulness_to_spec: 0.7, task_completion: 0.8 } } },
];

const FEEDBACK = [
  { span_id: 'TA_IMP', signal: 'accept', ts: '2026-07-11T10:00:04.000Z' },
];

const HISTORY = [
  { kind: 'verification', rule_id: 'bump_model_tier', signature: 'implementer', met: true, ts: '2026-07-11T10:05:00.000Z' },
];

function jsonl(records) {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function run(args, env = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: traceFile, TRACE_SUGGEST_HISTORY: historyFile, ...env },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eval-report-'));
  traceFile = join(dir, '.traces/spans.jsonl');
  feedbackFile = join(dir, '.traces/feedback.jsonl');
  historyFile = join(dir, '.cache/suggestion-history.jsonl');
  mkdirSync(dirname(traceFile), { recursive: true });
  mkdirSync(dirname(historyFile), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed() {
  writeFileSync(traceFile, jsonl(SPANS));
  writeFileSync(feedbackFile, jsonl(FEEDBACK));
  writeFileSync(historyFile, jsonl(HISTORY));
}

describe('bin/trace-eval-report.mjs', () => {
  test('default prints the scorecard section headers', () => {
    seed();
    const r = run([]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Tasks & success/);
    assert.match(r.stdout, /Cost/);
    assert.match(r.stdout, /Per-agent quality/);
    assert.match(r.stdout, /Judge calibration/);
    assert.match(r.stdout, /Failure taxonomy/);
    assert.match(r.stdout, /Feedback/);
    assert.match(r.stdout, /Suggestion hit-rate/);
    assert.match(r.stdout, /pass@1=1/);
    assert.match(r.stdout, /implementer/);
  });

  test('--json emits parseable JSON with the scorecard keys', () => {
    seed();
    const r = run(['--json']);
    assert.equal(r.status, 0, r.stderr);
    const sc = JSON.parse(r.stdout);
    for (const key of ['tasks', 'cost', 'agents', 'quality', 'failures', 'feedback', 'suggestions']) {
      assert.ok(key in sc, `missing key ${key}`);
    }
    assert.equal(sc.tasks.pass_1, 1);
    assert.equal(sc.suggestions.verified, 1);
  });

  test('--task filters to one task slug', () => {
    seed();
    const r = run(['--task', 'alpha']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /total=1/);
  });

  test('empty store prints the no-data line and exits 0', () => {
    const r = run([]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no evaluation data yet/i);
  });

  test('invalid arg exits 1', () => {
    seed();
    const r = run(['--bogus']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /usage|unknown/i);
  });
});
