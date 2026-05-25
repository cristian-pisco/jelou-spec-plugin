// tests/unit/trace-analyze.test.mjs
//
// Run: `node --test tests/unit/trace-analyze.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'bin/trace-analyze.mjs');
const FIX_AGG = join(ROOT, 'tests/fixtures/trace/aggregate-sample.jsonl');

let dir;
let file;

function run(args, env = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file, ...env },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'analyze-'));
  file = join(dir, '.traces/spans.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(FIX_AGG, file);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-analyze.mjs', () => {
  test('--by-agent shows table with implementer + test-writer rows', () => {
    const r = run(['--by-agent']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /agent_role/i);
    assert.match(r.stdout, /implementer/);
    assert.match(r.stdout, /test-writer/);
    assert.match(r.stdout, /retry_rate|p95/i);
  });

  test('--by-phase shows phase rows keyed by service:phase_num', () => {
    const r = run(['--by-phase']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /svc-x.*1|svc-x:1/);
  });

  test('--by-task shows tree of one task', () => {
    const r = run(['--by-task', 'alpha']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /execute_task/);
    assert.match(r.stdout, /phase/);
    assert.match(r.stdout, /agent_dispatch/);
    assert.match(r.stdout, /implementer/);
  });

  test('--by-task with unknown slug returns empty + non-error', () => {
    const r = run(['--by-task', 'nonexistent']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no spans found|empty/i);
  });

  test('--trends shows week-over-week dispatch counts', () => {
    const r = run(['--trends']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /week|trend|dispatches/i);
  });

  test('no flag prints usage and exits 1', () => {
    const r = run([]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /usage|--by-agent|--by-phase/i);
  });

  test('missing trace file: exits 0, reports empty', () => {
    rmSync(file);
    const r = run(['--by-agent']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no.*data|empty/i);
  });
});
