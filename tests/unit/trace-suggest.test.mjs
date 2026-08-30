// tests/unit/trace-suggest.test.mjs
//
// Run: `node --test tests/unit/trace-suggest.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'bin/trace-suggest.mjs');
const FIX_RULES = join(ROOT, 'tests/fixtures/trace/rules-sample.jsonl');

let dir;
let traceFile;
let historyFile;

function fixtureShiftedIntoLookbackWindow(source) {
  const spans = readFileSync(source, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const newest = Math.max(...spans.map((span) => new Date(span.ts).getTime()));
  const shift = Date.now() - newest;
  const shifted = spans.map((span) => ({
    ...span,
    ts: new Date(new Date(span.ts).getTime() + shift).toISOString(),
  }));
  return `${shifted.map((span) => JSON.stringify(span)).join('\n')}\n`;
}

function run(env = {}) {
  return spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TRACE_FILE: traceFile,
      TRACE_SUGGEST_HISTORY: historyFile,
      ...env,
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suggest-'));
  traceFile = join(dir, '.traces/spans.jsonl');
  historyFile = join(dir, '.spec-workspace/.cache/suggestion-history.jsonl');
  mkdirSync(dirname(traceFile), { recursive: true });
  writeFileSync(traceFile, fixtureShiftedIntoLookbackWindow(FIX_RULES));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-suggest.mjs', () => {
  test('emits SUGGEST lines for each triggered rule', () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /SUGGEST \[bump_model_tier\]/);
    assert.match(r.stdout, /SUGGEST \[extend_patterns\]/);
  });

  test('TRACE_DISABLED=1 short-circuits to exit 0 with no output', () => {
    const r = run({ TRACE_DISABLED: '1' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });

  test('respects 7-day cooldown via suggestion-history.jsonl', () => {
    mkdirSync(dirname(historyFile), { recursive: true });
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    writeFileSync(historyFile,
      JSON.stringify({
        rule_id: 'bump_model_tier', signature: 'implementer',
        action: 'declined', ts: recent,
      }) + '\n');
    const r = run();
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /SUGGEST \[bump_model_tier\][^\n]*implementer/);
  });

  test('emits empty output when no rules fire', () => {
    writeFileSync(traceFile, '');
    const r = run();
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });

  test('handles missing trace file gracefully', () => {
    rmSync(traceFile);
    const r = run();
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });

  test('prints the dormant-judge line when eval events exist but the judge is uncalibrated', () => {
    const ts = new Date().toISOString();
    const lines = [
      JSON.stringify({ ts, event_kind: 'span_start', span_id: 'S0', trace_id: 'T0', scope: 'task', name: 'agent_dispatch', agent_role: 'implementer' }),
      JSON.stringify({ ts, event_kind: 'span_end', span_id: 'S0', trace_id: 'T0', scope: 'task', name: 'agent_dispatch', status: 'ok', duration_ms: 1000, attrs: { retry_count: 0 } }),
      JSON.stringify({ ts, event_kind: 'event', name: 'eval', span_id: 'EV0', parent_span_id: 'S0', attrs: { quality_score: 0.8, quality_dims: { correctness: 0.8, faithfulness_to_spec: 0.8, task_completion: 0.8 } } }),
    ];
    writeFileSync(traceFile, lines.join('\n') + '\n');
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /quality rules dormant: judge uncalibrated/);
    assert.match(r.stdout, /pairs=0/);
    assert.match(r.stdout, /need kappa>=0\.4 & pairs>=10/);
  });

  test('prints a prediction-check section and appends verification records', () => {
    writeFileSync(traceFile, '');
    const approvalTs = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const lines = [];
    for (let i = 0; i < 3; i++) {
      const ts = new Date(Date.now() - (30 - i) * 60 * 1000).toISOString();
      lines.push(JSON.stringify({ ts, event_kind: 'span_start', span_id: `D${i}`, trace_id: `TD${i}`, scope: 'task', name: 'agent_dispatch', agent_role: 'implementer' }));
      lines.push(JSON.stringify({ ts, event_kind: 'span_end', span_id: `D${i}`, trace_id: `TD${i}`, scope: 'task', name: 'agent_dispatch', status: 'ok', duration_ms: 1000, attrs: { retry_count: 0 } }));
    }
    writeFileSync(traceFile, lines.join('\n') + '\n');
    mkdirSync(dirname(historyFile), { recursive: true });
    writeFileSync(historyFile, JSON.stringify({
      rule_id: 'bump_model_tier', signature: 'implementer', action: 'approved', ts: approvalTs,
      expected_improvement: {
        metric: 'retried_fraction', signature: 'implementer',
        baseline: 0.6, target: 0.2, window_n: 3, direction: 'decrease',
      },
    }) + '\n');

    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /prediction check:/);
    assert.match(r.stdout, /prior \[bump_model_tier\] implementer: predicted ≤0\.20 → actual 0\.00 MET/);

    const appended = readFileSync(historyFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const verification = appended.find(e => e.kind === 'verification');
    assert.ok(verification);
    assert.equal(verification.rule_id, 'bump_model_tier');
    assert.equal(verification.met, true);
  });
});
