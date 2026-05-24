// tests/unit/trace-reader.test.mjs
//
// Run: `node --test tests/unit/trace-reader.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSpans, listRotatedFiles } from '../../bin/lib/trace/reader.mjs';

let dir;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'trace-reader-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const FIX = 'tests/fixtures/trace';

describe('readSpans(file)', () => {
  test('reads all events in file order', () => {
    const events = [...readSpans(`${FIX}/sample-spans.jsonl`)];
    assert.equal(events.length, 5);
    assert.equal(events[0].span_id, 'S1');
    assert.equal(events[4].name, 'pattern_match');
  });

  test('skips malformed lines and continues', () => {
    const warnings = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { warnings.push(String(chunk)); return true; };
    let events;
    try {
      events = [...readSpans(`${FIX}/corrupt-spans.jsonl`)];
    } finally {
      process.stderr.write = origStderr;
    }
    assert.equal(events.length, 2, 'malformed line is skipped');
    assert.ok(warnings.some((w) => /skip.*malformed/i.test(w)));
  });

  test('returns empty iterator when file does not exist', () => {
    const events = [...readSpans(join(dir, 'missing.jsonl'))];
    assert.equal(events.length, 0);
  });

  test('filter: by task_slug', () => {
    const events = [...readSpans(`${FIX}/sample-spans.jsonl`,
      { filter: (e) => e.task_slug === 'alpha' })];
    assert.equal(events.length, 4);
    assert.ok(events.every((e) => e.task_slug === 'alpha'));
  });

  test('filter: by event_kind', () => {
    const events = [...readSpans(`${FIX}/sample-spans.jsonl`,
      { filter: (e) => e.event_kind === 'span_end' })];
    assert.equal(events.length, 2);
  });
});

describe('listRotatedFiles(baseFile)', () => {
  test('returns base file plus rotated siblings in order', () => {
    const base = join(dir, 'spans.jsonl');
    writeFileSync(base, '');
    writeFileSync(join(dir, 'spans-001.jsonl'), '');
    writeFileSync(join(dir, 'spans-002.jsonl'), '');
    writeFileSync(join(dir, 'unrelated.jsonl'), '');
    const files = listRotatedFiles(base);
    assert.deepEqual(
      files.map((f) => f.replace(dir + '/', '')),
      ['spans-001.jsonl', 'spans-002.jsonl', 'spans.jsonl']
    );
  });

  test('returns only base when no rotation', () => {
    const base = join(dir, 'spans.jsonl');
    writeFileSync(base, '');
    const files = listRotatedFiles(base);
    assert.deepEqual(
      files.map((f) => f.replace(dir + '/', '')),
      ['spans.jsonl']
    );
  });

  test('returns empty when base missing', () => {
    const base = join(dir, 'spans.jsonl');
    assert.deepEqual(listRotatedFiles(base), []);
  });
});
