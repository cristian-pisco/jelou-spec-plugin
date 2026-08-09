// tests/unit/dev-orchestrator-events.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVENT_TYPES, LIFECYCLE_STAGES, SEVERITY, severityFor, appendDaemonEvent, appendEvent, appendLifecycleEvent } from '../../bin/lib/dev-orchestrator/events.mjs';

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

  test('records every lifecycle stage with an explicit outcome', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    const stages = [
      LIFECYCLE_STAGES.resolution,
      LIFECYCLE_STAGES.planning,
      LIFECYCLE_STAGES.boot,
      LIFECYCLE_STAGES.provisioning,
      LIFECYCLE_STAGES.login,
      LIFECYCLE_STAGES.browser,
      LIFECYCLE_STAGES.cleanup,
    ];

    for (const stage of stages) appendLifecycleEvent(log, { stage, outcome: 'succeeded', service: 'api' });

    const events = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map(({ type, stage, outcome }) => ({ type, stage, outcome })), stages.map((stage) => ({
      type: 'lifecycle_stage',
      stage,
      outcome: 'succeeded',
    })));
    rmSync(dir, { recursive: true, force: true });
  });

  test('redacts a secret from nested diagnostics and stdout-equivalent fields at the persistence boundary', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    const canary = 'phase04-canary-secret';

    appendLifecycleEvent(log, {
      stage: 'login',
      outcome: 'failed',
      password: canary,
      diagnostics: {
        stdout: `login failed for ${canary}`,
        stderr: `authorization: Bearer ${canary}`,
        trace: [{ message: `cookie=${canary}` }],
        command: ['login', '--password', canary],
      },
    });

    const body = readFileSync(log, 'utf8');
    assert.equal(body.includes(canary), false);
    const event = JSON.parse(body);
    assert.equal(event.password, '[REDACTED]');
    assert.equal(event.diagnostics.stdout, 'login failed for [REDACTED]');
    assert.equal(event.diagnostics.stderr, 'authorization: Bearer [REDACTED]');
    assert.equal(event.diagnostics.trace[0].message, 'cookie=[REDACTED]');
    assert.deepEqual(event.diagnostics.command, ['login', '--password', '[REDACTED]']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('preserves daemon events while adding boot and cleanup stage outcomes', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');

    appendDaemonEvent(log, { type: 'daemon_started', slug: 'task-a' });
    appendDaemonEvent(log, { type: 'ready', slug: 'task-a', service: 'api' });
    appendDaemonEvent(log, { type: 'readiness_failed', slug: 'task-a', service: 'web' });
    appendDaemonEvent(log, { type: 'daemon_stopping', slug: 'task-a' });

    const events = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map(({ type, stage, outcome }) => ({ type, stage, outcome })), [
      { type: 'daemon_started', stage: undefined, outcome: undefined },
      { type: 'lifecycle_stage', stage: 'boot', outcome: 'started' },
      { type: 'ready', stage: undefined, outcome: undefined },
      { type: 'lifecycle_stage', stage: 'boot', outcome: 'succeeded' },
      { type: 'readiness_failed', stage: undefined, outcome: undefined },
      { type: 'lifecycle_stage', stage: 'boot', outcome: 'failed' },
      { type: 'daemon_stopping', stage: undefined, outcome: undefined },
      { type: 'lifecycle_stage', stage: 'cleanup', outcome: 'succeeded' },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('rejects unsupported lifecycle stages and outcomes before writing', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');

    assert.throws(() => appendLifecycleEvent(log, { stage: 'database', outcome: 'succeeded' }), /unsupported lifecycle stage/);
    assert.throws(() => appendLifecycleEvent(log, { stage: 'boot', outcome: 'maybe' }), /unsupported lifecycle outcome/);
    assert.equal(existsSync(log), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('redacts a secret passed as the next command-line argument', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    const canary = 'phase04-argv-canary';

    appendLifecycleEvent(log, {
      stage: 'login',
      outcome: 'failed',
      diagnostics: { command: ['dashboard-login', '--password', canary] },
    });

    const body = readFileSync(log, 'utf8');
    assert.equal(body.includes(canary), false);
    assert.deepEqual(JSON.parse(body).diagnostics.command, ['dashboard-login', '--password', '[REDACTED]']);
    rmSync(dir, { recursive: true, force: true });
  });
});
