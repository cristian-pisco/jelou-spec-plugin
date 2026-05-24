// tests/unit/trace-end-span.test.mjs
//
// Run: `node --test tests/unit/trace-end-span.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const SCRIPT = join(PROJECT_ROOT, 'bin/trace-end-span.mjs');

let dir;
let file;

function run(args, env = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file, ...env },
  });
}

function startSpanLine(span_id, trace_id, name, scope, extras = {}) {
  return JSON.stringify({
    ts: '2026-05-20T10:00:00.000Z',
    event_kind: 'span_start',
    span_id, trace_id, scope, name, ...extras,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-end-cli-'));
  file = join(dir, 'spans.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-end-span.mjs', () => {
  test('emits span_end and computes duration from matching start', () => {
    const startTs = new Date(Date.now() - 5000).toISOString();
    writeFileSync(file, JSON.stringify({
      ts: startTs, event_kind: 'span_start', span_id: 'S1', trace_id: 'T1',
      scope: 'task', name: 'phase',
    }) + '\n');
    const r = run(['--span', 'S1', '--status', 'ok']);
    assert.equal(r.status, 0, r.stderr);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    const end = JSON.parse(lines[1]);
    assert.equal(end.event_kind, 'span_end');
    assert.equal(end.span_id, 'S1');
    assert.equal(end.trace_id, 'T1');
    assert.equal(end.status, 'ok');
    assert.ok(end.duration_ms >= 4000 && end.duration_ms <= 6000,
      `duration_ms ${end.duration_ms} should be ~5000`);
  });

  test('--duration overrides computed value', () => {
    writeFileSync(file, startSpanLine('S1', 'T1', 'phase', 'task') + '\n');
    const r = run(['--span', 'S1', '--status', 'ok', '--duration', '1234']);
    assert.equal(r.status, 0);
    const end = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean)[1]);
    assert.equal(end.duration_ms, 1234);
  });

  test('passes through --retries, --outcome, --diff-size, --error-sig, --escalation', () => {
    writeFileSync(file, startSpanLine('S1', 'T1', 'agent_dispatch', 'task',
      { agent_role: 'implementer' }) + '\n');
    const r = run(['--span', 'S1', '--status', 'blocked',
                   '--retries', '3', '--outcome', 'still red after 5 strikes',
                   '--diff-size', '87', '--error-sig', 'a1b2c3d4',
                   '--escalation', 'five_strike_blocked']);
    assert.equal(r.status, 0);
    const end = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean)[1]);
    assert.equal(end.status, 'blocked');
    assert.equal(end.attrs.retry_count, 3);
    assert.equal(end.attrs.outcome, 'still red after 5 strikes');
    assert.equal(end.attrs.diff_size_loc, 87);
    assert.equal(end.attrs.error_signature, 'a1b2c3d4');
    assert.equal(end.attrs.escalation_reason, 'five_strike_blocked');
  });

  test('--artifacts: comma-separated list passed through', () => {
    writeFileSync(file, startSpanLine('S1', 'T1', 'agent_dispatch', 'task',
      { agent_role: 'implementer' }) + '\n');
    const r = run(['--span', 'S1', '--status', 'ok',
                   '--artifacts', 'src/a.ts,src/b.ts,tests/a.test.ts']);
    assert.equal(r.status, 0);
    const end = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean)[1]);
    assert.deepEqual(end.attrs.artifacts, ['src/a.ts', 'src/b.ts', 'tests/a.test.ts']);
  });

  test('--span missing: exit 1', () => {
    const r = run(['--status', 'ok']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--span required/i);
  });

  test('invalid --status: exit 1', () => {
    const r = run(['--span', 'S1', '--status', 'weird']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--status must be one of/i);
  });

  test('matching span_start not found: exit 0, writes span_end without duration', () => {
    const r = run(['--span', 'GHOST', '--status', 'ok']);
    assert.equal(r.status, 0);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const end = JSON.parse(lines[0]);
    assert.equal(end.event_kind, 'span_end');
    assert.equal(end.duration_ms, undefined);
    assert.equal(end.attrs && end.attrs.unmatched_start, true);
    // Issue #3 from code review: when no matching start, carried-over fields
    // must be absent from the JSONL line, not serialized as null.
    assert.ok(!('trace_id' in end), 'trace_id should be absent, not null');
    assert.ok(!('scope' in end), 'scope should be absent, not null');
    assert.ok(!('name' in end), 'name should be absent, not null');
  });

  test('TRACE_DISABLED=1: exits 0, writes nothing', () => {
    writeFileSync(file, startSpanLine('S1', 'T1', 'phase', 'task') + '\n');
    const r = run(['--span', 'S1', '--status', 'ok'], { TRACE_DISABLED: '1' });
    assert.equal(r.status, 0);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'no new line written');
  });
});
