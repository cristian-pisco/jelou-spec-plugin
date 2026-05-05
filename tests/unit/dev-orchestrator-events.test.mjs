// tests/unit/dev-orchestrator-events.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVENT_TYPES, SEVERITY, severityFor, appendEvent } from '../../bin/lib/dev-orchestrator/events.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jlu-evt-')); }

describe('severityFor', () => {
  test('hard for pane_dead', () => assert.equal(severityFor('pane_dead'), SEVERITY.hard));
  test('hard for readiness_failed', () => assert.equal(severityFor('readiness_failed'), SEVERITY.hard));
  test('soft for pattern_match', () => assert.equal(severityFor('pattern_match'), SEVERITY.soft));
  test('info for ready', () => assert.equal(severityFor('ready'), SEVERITY.info));
});

describe('appendEvent', () => {
  test('writes one JSONL line', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    appendEvent(log, { service: 'api', type: EVENT_TYPES.pane_started });
    const body = readFileSync(log, 'utf8');
    const lines = body.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.service, 'api');
    assert.equal(parsed.type, 'pane_started');
    assert.ok(parsed.ts);
    rmSync(dir, { recursive: true, force: true });
  });

  test('appends a second line without truncating', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    appendEvent(log, { service: 'a', type: 'pane_started' });
    appendEvent(log, { service: 'a', type: 'ready' });
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    rmSync(dir, { recursive: true, force: true });
  });
});
