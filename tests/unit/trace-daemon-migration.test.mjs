// tests/unit/trace-daemon-migration.test.mjs
//
// Verifies bin/lib/dev-orchestrator/events.mjs delegates to the shared
// trace emitter while preserving the existing API contract.

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EVENT_TYPES,
  SEVERITY,
  severityFor,
  appendEvent,
} from '../../bin/lib/dev-orchestrator/events.mjs';

let dir;
let file;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'daemon-migration-'));
  file = join(dir, 'dev-events.log');
  delete process.env.TRACE_DISABLED;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TRACE_DISABLED;
});

describe('events.mjs preserves the legacy API', () => {
  test('exports EVENT_TYPES, SEVERITY, severityFor', () => {
    assert.equal(EVENT_TYPES.daemon_started, 'daemon_started');
    assert.equal(EVENT_TYPES.pane_dead, 'pane_dead');
    assert.equal(SEVERITY.info, 'info');
    assert.equal(SEVERITY.hard, 'hard');
    assert.equal(severityFor('pane_dead'), 'hard');
    assert.equal(severityFor('ready'), 'info');
  });
});

describe('appendEvent delegates to the shared emitter', () => {
  test('writes one JSONL line with envelope fields', () => {
    appendEvent(file, { type: 'pane_started', pane: 'svc-a' });
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.ok(parsed.ts, 'ts is populated');
    assert.equal(parsed.severity, 'info', 'severity derived from type');
    assert.equal(parsed.type, 'pane_started');
    assert.equal(parsed.pane, 'svc-a');
  });

  test('records scope: "daemon" so analyzer can filter', () => {
    appendEvent(file, { type: 'ready', pane: 'svc-b' });
    const parsed = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(parsed.scope, 'daemon');
  });

  test('records event_kind: "event" (effective span with no duration)', () => {
    appendEvent(file, { type: 'pattern_match', pane: 'svc-a', pattern: 'ECONNREFUSED' });
    const parsed = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(parsed.event_kind, 'event');
    assert.equal(parsed.name, 'pattern_match');
  });

  test('preserves legacy fields verbatim under attrs or top-level', () => {
    appendEvent(file, { type: 'pane_dead', pane: 'svc-a', exit_code: 137 });
    const parsed = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(parsed.type, 'pane_dead');
    assert.equal(parsed.pane, 'svc-a');
    assert.equal(parsed.exit_code, 137);
  });

  test('respects explicit ts and severity overrides', () => {
    appendEvent(file, { type: 'daemon_started', ts: '2026-05-01T00:00:00Z', severity: 'info' });
    const parsed = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(parsed.ts, '2026-05-01T00:00:00Z');
    assert.equal(parsed.severity, 'info');
  });

  test('TRACE_DISABLED=1 short-circuits writes', () => {
    process.env.TRACE_DISABLED = '1';
    appendEvent(file, { type: 'ready', pane: 'svc-x' });
    assert.throws(() => readFileSync(file, 'utf8'), /ENOENT/);
  });
});
