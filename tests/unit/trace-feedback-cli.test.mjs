import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const SCRIPT = join(PROJECT_ROOT, 'bin/trace-feedback.mjs');

let dir;
let traceFile;
let feedbackFile;

function run(args, env = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: traceFile, FEEDBACK_FILE: feedbackFile, ...env },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-feedback-cli-'));
  traceFile = join(dir, 'spans.jsonl');
  feedbackFile = join(dir, 'feedback.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-feedback.mjs', () => {
  test('--span writes a feedback entry', () => {
    const r = run(['--span', 'SHIP1', '--signal', 'accept',
                   '--source', 'pr_merge', '--note', 'merged_clean']);
    assert.equal(r.status, 0, r.stderr);
    const lines = readFileSync(feedbackFile, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const e = JSON.parse(lines[0]);
    assert.equal(e.span_id, 'SHIP1');
    assert.equal(e.signal, 'accept');
    assert.equal(e.source, 'pr_merge');
    assert.equal(e.note, 'merged_clean');
  });

  test('--task resolves the ship span from a seeded store and writes', () => {
    writeFileSync(traceFile, [
      JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', event_kind: 'span_start', name: 'ship', span_id: 'SHIP_OLD', trace_id: 'T', scope: 'task', task_slug: 'my-task' }),
      JSON.stringify({ ts: '2026-01-02T00:00:00.000Z', event_kind: 'span_start', name: 'ship', span_id: 'SHIP_NEW', trace_id: 'T2', scope: 'task', task_slug: 'my-task' }),
    ].join('\n') + '\n');
    const r = run(['--task', 'my-task', '--signal', 'accept', '--source', 'pr_merge']);
    assert.equal(r.status, 0, r.stderr);
    const e = JSON.parse(readFileSync(feedbackFile, 'utf8').split('\n').filter(Boolean)[0]);
    assert.equal(e.span_id, 'SHIP_NEW');
    assert.equal(e.signal, 'accept');
  });

  test('--task with no matching ship span exits 0 and writes nothing', () => {
    writeFileSync(traceFile, JSON.stringify({
      ts: '2026-01-01T00:00:00.000Z', event_kind: 'span_start', name: 'ship',
      span_id: 'S', scope: 'task', task_slug: 'other',
    }) + '\n');
    const r = run(['--task', 'my-task', '--signal', 'accept']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(feedbackFile), false, 'no feedback file written');
  });

  test('invalid --signal exits 1', () => {
    const r = run(['--span', 'S1', '--signal', 'maybe']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--signal must be one of/i);
  });

  test('missing both --span and --task exits 1', () => {
    const r = run(['--signal', 'accept']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--span.*--task|--task.*--span/i);
  });

  test('TRACE_DISABLED=1 exits 0 and writes nothing', () => {
    const r = run(['--span', 'S1', '--signal', 'accept'], { TRACE_DISABLED: '1' });
    assert.equal(r.status, 0);
    assert.equal(existsSync(feedbackFile), false, 'no feedback file written');
  });
});
