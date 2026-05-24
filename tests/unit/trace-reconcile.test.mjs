// tests/unit/trace-reconcile.test.mjs
//
// Run: `node --test tests/unit/trace-reconcile.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const SCRIPT = join(PROJECT_ROOT, 'bin/trace-reconcile.mjs');

let dir;
let file;

function run(env = {}) {
  return spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file, ...env },
  });
}

function startLine(span_id, opts = {}) {
  const ts = opts.ts || new Date().toISOString();
  return JSON.stringify({
    ts, event_kind: 'span_start', span_id, trace_id: opts.trace_id || 'T1',
    scope: opts.scope || 'task', name: opts.name || 'phase',
    task_slug: opts.task_slug,
  });
}

function endLine(span_id, opts = {}) {
  const ts = opts.ts || new Date().toISOString();
  return JSON.stringify({
    ts, event_kind: 'span_end', span_id, trace_id: opts.trace_id || 'T1',
    scope: opts.scope || 'task', name: opts.name || 'phase',
    status: opts.status || 'ok', duration_ms: opts.duration_ms || 0,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-reconcile-'));
  file = join(dir, 'spans.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-reconcile.mjs', () => {
  test('no-op when file does not exist', () => {
    const r = run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /reconciled: 0/);
  });

  test('no-op when no orphans', () => {
    writeFileSync(file, [
      startLine('S1'),
      endLine('S1'),
    ].join('\n') + '\n');
    const r = run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /reconciled: 0/);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
  });

  test('does not reconcile a recent orphan (< 30 min old)', () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    writeFileSync(file, startLine('S1', { ts: recent }) + '\n');
    const r = run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /reconciled: 0/);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
  });

  test('emits synthetic span_end for span_start older than 30 min', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, startLine('S1', { ts: old, task_slug: 'alpha' }) + '\n');
    const r = run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /reconciled: 1/);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    const end = JSON.parse(lines[1]);
    assert.equal(end.event_kind, 'span_end');
    assert.equal(end.span_id, 'S1');
    assert.equal(end.status, 'orphaned');
    assert.equal(end.attrs.reconciled, true);
    assert.equal(end.task_slug, 'alpha');
    assert.ok(end.duration_ms >= 45 * 60 * 1000);
  });

  test('idempotent: running twice does not re-emit', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, startLine('S1', { ts: old }) + '\n');
    run();
    const r2 = run();
    assert.equal(r2.status, 0);
    assert.match(r2.stdout, /reconciled: 0/);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2, 'no new span_end on second run');
  });

  test('TRACE_RECONCILE_AFTER_MS env overrides threshold', () => {
    const ts = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    writeFileSync(file, startLine('S1', { ts }) + '\n');
    const r = run({ TRACE_RECONCILE_AFTER_MS: '60000' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /reconciled: 1/);
  });

  test('multiple orphans across same trace are all closed', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, [
      startLine('S1', { ts: old, trace_id: 'TA' }),
      startLine('S2', { ts: old, trace_id: 'TA' }),
      startLine('S3', { ts: old, trace_id: 'TB' }),
    ].join('\n') + '\n');
    const r = run();
    assert.match(r.stdout, /reconciled: 3/);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 6);
  });

  test('TRACE_DISABLED=1: exits 0, no changes', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, startLine('S1', { ts: old }) + '\n');
    const r = run({ TRACE_DISABLED: '1' });
    assert.equal(r.status, 0);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
  });

  test('skips malformed lines but continues processing', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, [
      startLine('S1', { ts: old }),
      'not valid json',
      startLine('S2', { ts: old }),
    ].join('\n') + '\n');
    const r = run();
    assert.match(r.stdout, /reconciled: 2/);
  });

  test('span_start followed by span_end of different span: orphan stays detected', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, [
      startLine('S1', { ts: old }),
      endLine('S2'),
    ].join('\n') + '\n');
    const r = run();
    assert.match(r.stdout, /reconciled: 1/);
  });
});
