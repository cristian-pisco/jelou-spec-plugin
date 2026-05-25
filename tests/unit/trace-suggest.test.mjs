// tests/unit/trace-suggest.test.mjs
//
// Run: `node --test tests/unit/trace-suggest.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
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
  copyFileSync(FIX_RULES, traceFile);
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
});
