// tests/integration/trace-suggester-end-to-end.test.mjs
//
// Seed a synthetic 15-run trace store with 30% retry rate on implementer,
// run the suggester, verify it emits bump_model_tier with correct evidence.
// Also verify the 7-day cooldown suppresses re-emission.
//
// Run: `node --test tests/integration/trace-suggester-end-to-end.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SUGGEST = join(ROOT, 'bin/trace-suggest.mjs');

let dir;
let traceFile;
let historyFile;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suggester-e2e-'));
  traceFile = join(dir, '.traces/spans.jsonl');
  historyFile = join(dir, '.spec-workspace/.cache/suggestion-history.jsonl');
  mkdirSync(dirname(traceFile), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seedRuns(file, count, retryRateTarget) {
  const lines = [];
  const now = Date.now();

  // Distribute retries across all runs to ensure the last N_WINDOW (10) runs
  // have the target retry rate
  const N_WINDOW = 10;
  const lookbackStart = Math.max(0, count - N_WINDOW);
  const runsInWindow = count - lookbackStart;
  const retriesInWindow = Math.round(runsInWindow * retryRateTarget);

  for (let i = 0; i < count; i++) {
    const startTs = now - (count - i) * 1000;
    // Distribute retries evenly across runs that will be in the evaluation window
    const shouldRetry = i >= lookbackStart && (i - lookbackStart) < retriesInWindow;
    const retry_count = shouldRetry ? 1 : 0;

    lines.push(JSON.stringify({
      ts: new Date(startTs).toISOString(),
      event_kind: 'span_start',
      span_id: `S${i}`, trace_id: `T${i}`,
      scope: 'task', name: 'agent_dispatch',
      task_slug: `task-${i}`, service_id: 'svc-x', phase_num: 1,
      agent_role: 'implementer',
    }));
    lines.push(JSON.stringify({
      ts: new Date(startTs + 60000).toISOString(),
      event_kind: 'span_end',
      span_id: `S${i}`, trace_id: `T${i}`,
      scope: 'task', name: 'agent_dispatch',
      agent_role: 'implementer',
      status: 'ok', duration_ms: 60000,
      attrs: { retry_count, diff_size_loc: 50 },
    }));
  }
  writeFileSync(file, lines.join('\n') + '\n');
}

describe('suggester end-to-end against synthetic trace store', () => {
  test('15 runs with 60% retry rate emits bump_model_tier for implementer', () => {
    seedRuns(traceFile, 15, 0.60);
    const r = spawnSync('node', [SUGGEST], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRACE_FILE: traceFile,
        TRACE_SUGGEST_HISTORY: historyFile,
      },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /SUGGEST \[bump_model_tier\]/);
    assert.match(r.stdout, /implementer/);
    assert.match(r.stdout, /60%/);
  });

  test('15 runs with 30% retry rate does NOT emit bump_model_tier', () => {
    seedRuns(traceFile, 15, 0.30);
    const r = spawnSync('node', [SUGGEST], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRACE_FILE: traceFile,
        TRACE_SUGGEST_HISTORY: historyFile,
      },
    });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /bump_model_tier/);
  });

  test('15 runs with 10% retry rate does NOT emit bump_model_tier', () => {
    seedRuns(traceFile, 15, 0.10);
    const r = spawnSync('node', [SUGGEST], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRACE_FILE: traceFile,
        TRACE_SUGGEST_HISTORY: historyFile,
      },
    });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /bump_model_tier/);
  });

  test('cooldown: declining a suggestion suppresses it on the next run', () => {
    seedRuns(traceFile, 15, 0.60);
    // First run — should emit
    let r = spawnSync('node', [SUGGEST], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRACE_FILE: traceFile,
        TRACE_SUGGEST_HISTORY: historyFile,
      },
    });
    assert.match(r.stdout, /bump_model_tier/);
    // Simulate user declining
    mkdirSync(dirname(historyFile), { recursive: true });
    writeFileSync(historyFile,
      JSON.stringify({
        rule_id: 'bump_model_tier', signature: 'implementer',
        action: 'declined', ts: new Date().toISOString(),
      }) + '\n');
    // Second run — should be silent for that rule
    r = spawnSync('node', [SUGGEST], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRACE_FILE: traceFile,
        TRACE_SUGGEST_HISTORY: historyFile,
      },
    });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /SUGGEST \[bump_model_tier\][^\n]*implementer/);
  });
});
