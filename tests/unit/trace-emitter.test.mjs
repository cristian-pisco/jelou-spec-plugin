// tests/unit/trace-emitter.test.mjs
//
// Run: `node --test tests/unit/trace-emitter.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid, appendSpan, startSpan, endSpan } from '../../bin/lib/trace/emitter.mjs';
import { EVENT_KIND, STATUS, SCOPE } from '../../bin/lib/trace/schema.mjs';

let dir;
let file;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-emitter-'));
  file = join(dir, 'spans.jsonl');
  delete process.env.TRACE_DISABLED;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TRACE_DISABLED;
});

describe('ulid()', () => {
  test('returns a 26-character Crockford base32 string', () => {
    const id = ulid();
    assert.equal(id.length, 26);
    assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('consecutive ulids are strictly monotonic over the full 26 chars', () => {
    // Generate 500 ulids in a tight loop (mostly same-ms), assert strict lexical ordering.
    const ids = [];
    for (let i = 0; i < 500; i++) ids.push(ulid());
    for (let i = 1; i < ids.length; i++) {
      assert.ok(ids[i] > ids[i - 1],
        `ulid ${i} (${ids[i]}) not > ulid ${i-1} (${ids[i-1]})`);
    }
  });

  test('uniqueness across 1000 calls', () => {
    const set = new Set();
    for (let i = 0; i < 1000; i++) set.add(ulid());
    assert.equal(set.size, 1000);
  });
});

describe('appendSpan(file, event)', () => {
  test('writes one JSONL line with required fields', () => {
    appendSpan(file, {
      event_kind: EVENT_KIND.SPAN_START,
      span_id: '01HXY7K2ABCDEFGHJKMNPQRSTV',
      trace_id: '01HXY7K2ABCDEFGHJKMNPQRSTV',
      scope: SCOPE.TASK,
      name: 'execute_task',
    });
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.event_kind, 'span_start');
    assert.equal(parsed.scope, 'task');
    assert.equal(parsed.name, 'execute_task');
    assert.ok(parsed.ts, 'ts is auto-populated');
  });

  test('appends successive lines without overwriting', () => {
    for (let i = 0; i < 3; i++) {
      appendSpan(file, {
        event_kind: EVENT_KIND.SPAN_START,
        span_id: ulid(), trace_id: ulid(), scope: SCOPE.TASK, name: 'x',
      });
    }
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 3);
  });

  test('creates parent directory if missing', () => {
    const nested = join(dir, 'a/b/c/spans.jsonl');
    appendSpan(nested, {
      event_kind: EVENT_KIND.EVENT,
      span_id: ulid(), trace_id: ulid(), scope: SCOPE.GLOBAL, name: 'ping',
    });
    assert.ok(readFileSync(nested, 'utf8').length > 0);
  });

  test('TRACE_DISABLED=1 short-circuits (no file write)', () => {
    process.env.TRACE_DISABLED = '1';
    appendSpan(file, {
      event_kind: EVENT_KIND.SPAN_START,
      span_id: ulid(), trace_id: ulid(), scope: SCOPE.TASK, name: 'x',
    });
    // No file should be created
    assert.throws(() => readFileSync(file, 'utf8'), /ENOENT/);
  });

  test('payload over 3500 bytes drops outcome + artifacts and writes', () => {
    const big = 'x'.repeat(5000);
    appendSpan(file, {
      event_kind: EVENT_KIND.SPAN_END,
      span_id: ulid(), trace_id: ulid(), scope: SCOPE.TASK, name: 'phase',
      status: STATUS.OK,
      attrs: { outcome: big, artifacts: [big, big], retry_count: 1 },
    });
    const parsed = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(parsed.attrs.outcome, undefined,
      'outcome dropped when over cap');
    assert.equal(parsed.attrs.artifacts, undefined,
      'artifacts dropped when over cap');
    assert.equal(parsed.attrs.retry_count, 1,
      'small attrs preserved');
    assert.equal(parsed.attrs.payload_capped, true,
      'cap is signalled');
  });

  test('fallback to stderr when file is not writable', (t) => {
    // Point at a path under a non-existent read-only mount style location.
    // Simulate by passing a path whose parent is a regular file.
    const blocking = join(dir, 'blocker');
    writeFileSync(blocking, 'plain', 'utf8');
    const bad = join(blocking, 'sub/spans.jsonl');
    const warnings = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { warnings.push(String(chunk)); return true; };
    try {
      appendSpan(bad, {
        event_kind: EVENT_KIND.EVENT,
        span_id: ulid(), trace_id: ulid(), scope: SCOPE.GLOBAL, name: 'x',
      });
    } finally {
      process.stderr.write = origStderr;
    }
    assert.ok(
      warnings.some((w) => /trace.*write.*failed/i.test(w)),
      'expected stderr warning'
    );
  });
});

describe('startSpan(file, event) / endSpan(file, event)', () => {
  test('startSpan auto-fills event_kind and returns ids', () => {
    const r = startSpan(file, {
      scope: SCOPE.TASK, name: 'phase', parent_span_id: null,
    });
    assert.ok(r.span_id);
    assert.ok(r.trace_id);
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(line.event_kind, 'span_start');
    assert.equal(line.span_id, r.span_id);
    assert.equal(line.trace_id, r.trace_id);
  });

  test('startSpan with parent inherits trace_id', () => {
    const root = startSpan(file, { scope: SCOPE.TASK, name: 'execute_task' });
    const child = startSpan(file, {
      scope: SCOPE.TASK, name: 'phase',
      parent_span_id: root.span_id, trace_id: root.trace_id,
    });
    assert.equal(child.trace_id, root.trace_id);
    assert.notEqual(child.span_id, root.span_id);
  });

  test('endSpan emits span_end with status and attrs', () => {
    endSpan(file, {
      span_id: 'S1', trace_id: 'T1', name: 'phase',
      scope: SCOPE.TASK, status: STATUS.OK,
      duration_ms: 1234,
      attrs: { retry_count: 0 },
    });
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(line.event_kind, 'span_end');
    assert.equal(line.duration_ms, 1234);
    assert.equal(line.attrs.retry_count, 0);
  });
});
