import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRecentEvents, buildDiagnoseInput, parseDiagnoseOutput, substituteFix
} from '../../bin/lib/dev-orchestrator/diagnose.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jlu-dx-')); }

describe('readRecentEvents', () => {
  test('filters to the requested service', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    writeFileSync(log, [
      JSON.stringify({ ts: '2026-05-04T10:00:00Z', type: 'pane_started', service: 'api' }),
      JSON.stringify({ ts: '2026-05-04T10:00:01Z', type: 'pane_started', service: 'web' }),
      JSON.stringify({ ts: '2026-05-04T10:01:00Z', type: 'pane_dead', service: 'api' })
    ].join('\n') + '\n');
    const events = readRecentEvents({ logPath: log, service: 'api' });
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'pane_started');
    assert.equal(events[1].type, 'pane_dead');
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns empty when log missing', () => {
    const events = readRecentEvents({ logPath: '/no/such/file', service: 'api' });
    assert.deepEqual(events, []);
  });

  test('respects limit', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    const lines = [];
    for (let i = 0; i < 100; i++) lines.push(JSON.stringify({ ts: `2026-05-04T10:00:0${i}Z`, type: 'pattern_match', service: 'api', i }));
    writeFileSync(log, lines.join('\n') + '\n');
    const events = readRecentEvents({ logPath: log, service: 'api', limit: 10 });
    assert.equal(events.length, 10);
    assert.equal(events[9].i, 99);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildDiagnoseInput', () => {
  test('resolves depends_on against allServices', () => {
    const allServices = [
      { name: 'redis', path: '.', command: 'docker compose up redis' },
      { name: 'api', path: './api', command: 'npm run dev', depends_on: ['redis', 'unknown'] }
    ];
    const out = buildDiagnoseInput({
      service: allServices[1],
      events: [],
      capture: 'foo',
      allServices,
      os: 'linux',
      workspaceRoot: '/work'
    });
    assert.equal(out.service.name, 'api');
    assert.equal(out.depends_on_resolved.length, 1);
    assert.equal(out.depends_on_resolved[0].name, 'redis');
    assert.equal(out.os, 'linux');
    assert.equal(out.workspaceRoot, '/work');
  });
});

describe('parseDiagnoseOutput', () => {
  test('parses well-formed JSON', () => {
    const raw = JSON.stringify({
      cause: 'missing module', confidence: 'high', evidence: ['Cannot find module foo'],
      proposed_fix: { command: 'npm i foo', runs_in: 'host', rationale: 'just install it' },
      alternative_fixes: [], register_pattern: null
    });
    const out = parseDiagnoseOutput(raw);
    assert.equal(out.cause, 'missing module');
  });

  test('strips code fences', () => {
    const wrapped = '```json\n' + JSON.stringify({
      cause: 'x', confidence: 'low', evidence: ['log line'],
      proposed_fix: null, alternative_fixes: []
    }) + '\n```';
    const out = parseDiagnoseOutput(wrapped);
    assert.equal(out.cause, 'x');
  });

  test('throws on missing required field', () => {
    assert.throws(() => parseDiagnoseOutput(JSON.stringify({ confidence: 'low', evidence: [] })));
  });

  test('throws on unparseable JSON', () => {
    assert.throws(() => parseDiagnoseOutput('not json'));
  });
});

describe('substituteFix', () => {
  test('host fix returns command as-is', () => {
    const out = substituteFix({
      service: { runtime: { type: 'host' } },
      fix: { command: 'npm i foo', runs_in: 'host', rationale: 'r' }
    });
    assert.equal(out, 'npm i foo');
  });

  test('container fix substitutes the compose template', () => {
    const out = substituteFix({
      service: {
        runtime: {
          type: 'docker-compose',
          compose_file: './docker-compose.yml',
          compose_service: 'api',
          exec_template: 'docker compose -f {compose_file} exec {compose_service} {cmd}'
        }
      },
      fix: { command: 'npm install', runs_in: 'container', rationale: 'r' }
    });
    assert.equal(out, 'docker compose -f ./docker-compose.yml exec api npm install');
  });

  test('container fix uses default template if not provided', () => {
    const out = substituteFix({
      service: {
        runtime: {
          type: 'docker-compose',
          compose_file: './docker-compose.yml',
          compose_service: 'api'
        }
      },
      fix: { command: 'npm install', runs_in: 'container', rationale: 'r' }
    });
    assert.equal(out, 'docker compose -f ./docker-compose.yml exec api npm install');
  });
});
