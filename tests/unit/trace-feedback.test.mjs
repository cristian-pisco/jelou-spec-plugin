import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendFeedback,
  readFeedback,
  harvestImplicitNegatives,
  resolveShipSpanId,
} from '../../bin/lib/trace/feedback.mjs';
import { SIGNAL } from '../../bin/lib/trace/schema.mjs';

let dir;
let file;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-feedback-'));
  file = join(dir, 'feedback.jsonl');
  delete process.env.TRACE_DISABLED;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TRACE_DISABLED;
});

describe('appendFeedback(file, entry)', () => {
  test('writes one JSON line with the entry shape', () => {
    appendFeedback(file, {
      span_id: 'S1', signal: SIGNAL.ACCEPT, source: 'pr_merge', note: 'merged_clean',
    });
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const e = JSON.parse(lines[0]);
    assert.equal(e.span_id, 'S1');
    assert.equal(e.signal, 'accept');
    assert.equal(e.source, 'pr_merge');
    assert.equal(e.note, 'merged_clean');
    assert.ok(e.ts, 'ts is auto-populated');
  });

  test('omits undefined optional fields', () => {
    appendFeedback(file, { span_id: 'S1', signal: SIGNAL.REJECT });
    const e = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean)[0]);
    assert.ok(!('source' in e), 'source omitted when undefined');
    assert.ok(!('note' in e), 'note omitted when undefined');
  });

  test('honors an explicit ts', () => {
    appendFeedback(file, { span_id: 'S1', signal: SIGNAL.EDIT, ts: '2026-01-01T00:00:00.000Z' });
    const e = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean)[0]);
    assert.equal(e.ts, '2026-01-01T00:00:00.000Z');
  });

  test('throws on invalid signal', () => {
    assert.throws(
      () => appendFeedback(file, { span_id: 'S1', signal: 'maybe' }),
      /signal/i,
    );
  });

  test('TRACE_DISABLED=1 short-circuits (no file write)', () => {
    process.env.TRACE_DISABLED = '1';
    appendFeedback(file, { span_id: 'S1', signal: SIGNAL.ACCEPT });
    assert.throws(() => readFileSync(file, 'utf8'), /ENOENT/);
  });

  test('best-effort: stderr warning, no throw, when dir unwritable', () => {
    const blocking = join(dir, 'blocker');
    writeFileSync(blocking, 'plain', 'utf8');
    const bad = join(blocking, 'sub/feedback.jsonl');
    const warnings = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { warnings.push(String(chunk)); return true; };
    try {
      appendFeedback(bad, { span_id: 'S1', signal: SIGNAL.ACCEPT });
    } finally {
      process.stderr.write = origStderr;
    }
    assert.ok(
      warnings.some((w) => /feedback.*write.*failed/i.test(w)),
      'expected stderr warning',
    );
  });
});

describe('readFeedback(file)', () => {
  test('returns [] when file missing', () => {
    assert.deepEqual(readFeedback(join(dir, 'nope.jsonl')), []);
  });

  test('skips malformed lines and returns parsed entries', () => {
    writeFileSync(file, [
      JSON.stringify({ span_id: 'S1', signal: 'accept' }),
      'not json',
      JSON.stringify({ span_id: 'S2', signal: 'reject' }),
      '',
    ].join('\n'));
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    let out;
    try {
      out = readFeedback(file);
    } finally {
      process.stderr.write = origStderr;
    }
    assert.equal(out.length, 2);
    assert.equal(out[0].span_id, 'S1');
    assert.equal(out[1].span_id, 'S2');
  });
});

describe('harvestImplicitNegatives(pairs)', () => {
  test('one implicit_negative per agent_dispatch pair with retry_count > 0', () => {
    const pairs = [
      { start: { span_id: 'A', name: 'agent_dispatch' }, end: { attrs: { retry_count: 2 } } },
      { start: { span_id: 'B', name: 'agent_dispatch' }, end: { attrs: { retry_count: 0 } } },
      { start: { span_id: 'C', name: 'agent_dispatch' }, end: { attrs: {} } },
      { start: { span_id: 'D', name: 'phase' }, end: { attrs: { retry_count: 5 } } },
    ];
    const out = harvestImplicitNegatives(pairs);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], {
      span_id: 'A', signal: 'implicit_negative', source: 're_dispatch',
    });
  });

  test('returns [] for empty input', () => {
    assert.deepEqual(harvestImplicitNegatives([]), []);
  });
});

describe('resolveShipSpanId(events, task_slug)', () => {
  test('returns span_id of the most recent ship span for the task', () => {
    const events = [
      { event_kind: 'span_start', name: 'ship', span_id: 'SHIP1', task_slug: 't', ts: '2026-01-01T00:00:00.000Z' },
      { event_kind: 'span_start', name: 'phase', span_id: 'P', task_slug: 't', ts: '2026-01-02T00:00:00.000Z' },
      { event_kind: 'span_start', name: 'ship', span_id: 'SHIP2', task_slug: 't', ts: '2026-01-03T00:00:00.000Z' },
      { event_kind: 'span_start', name: 'ship', span_id: 'SHIPX', task_slug: 'other', ts: '2026-01-04T00:00:00.000Z' },
    ];
    assert.equal(resolveShipSpanId(events, 't'), 'SHIP2');
  });

  test('returns null when no ship span_start matches the task', () => {
    const events = [
      { event_kind: 'span_start', name: 'ship', span_id: 'S', task_slug: 'other', ts: '2026-01-01T00:00:00.000Z' },
      { event_kind: 'span_end', name: 'ship', span_id: 'S', task_slug: 't', ts: '2026-01-02T00:00:00.000Z' },
    ];
    assert.equal(resolveShipSpanId(events, 't'), null);
  });
});
