// tests/unit/dev-orchestrator-patterns.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPattern, signalDaemon } from '../../bin/lib/dev-orchestrator/patterns.mjs';
import { writePid } from '../../bin/lib/dev-orchestrator/state-daemon.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jlu-pat-')); }

describe('addPattern', () => {
  test('appends a new pattern', () => {
    const dir = tmp();
    const cfgPath = join(dir, 'jlu-services.json');
    writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      services: [{ name: 'api', path: '.', command: 'x', log_failure_patterns: ['EADDRINUSE'] }]
    }));
    const out = addPattern({ configPath: cfgPath, serviceName: 'api', pattern: 'Cannot find module' });
    assert.equal(out.updated, true);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    assert.deepEqual(cfg.services[0].log_failure_patterns, ['EADDRINUSE', 'Cannot find module']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('does not duplicate existing pattern', () => {
    const dir = tmp();
    const cfgPath = join(dir, 'jlu-services.json');
    writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      services: [{ name: 'api', path: '.', command: 'x', log_failure_patterns: ['EADDRINUSE'] }]
    }));
    const out = addPattern({ configPath: cfgPath, serviceName: 'api', pattern: 'EADDRINUSE' });
    assert.equal(out.updated, false);
    assert.equal(out.reason, 'duplicate');
    rmSync(dir, { recursive: true, force: true });
  });

  test('rejects unparseable regex', () => {
    const dir = tmp();
    const cfgPath = join(dir, 'jlu-services.json');
    writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      services: [{ name: 'api', path: '.', command: 'x' }]
    }));
    const out = addPattern({ configPath: cfgPath, serviceName: 'api', pattern: '[unclosed' });
    assert.equal(out.updated, false);
    assert.match(out.reason, /regex/i);
    rmSync(dir, { recursive: true, force: true });
  });

  test('rejects unknown service', () => {
    const dir = tmp();
    const cfgPath = join(dir, 'jlu-services.json');
    writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      services: [{ name: 'api', path: '.', command: 'x' }]
    }));
    const out = addPattern({ configPath: cfgPath, serviceName: 'web', pattern: 'foo' });
    assert.equal(out.updated, false);
    assert.match(out.reason, /service/i);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('signalDaemon', () => {
  test('reads PID and calls killer with SIGHUP', () => {
    const dir = tmp();
    const opts = { workspaceId: 'wid', slug: 'foo', baseDir: dir };
    writePid(opts, 12345);
    const calls = [];
    const killer = (pid, signal) => { calls.push({ pid, signal }); };
    const out = signalDaemon({ workspaceId: 'wid', slug: 'foo', baseDir: dir, killer });
    assert.equal(out.signaled, true);
    assert.equal(calls[0].pid, 12345);
    assert.equal(calls[0].signal, 'SIGHUP');
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns signaled:false when no PID file', () => {
    const dir = tmp();
    const out = signalDaemon({ workspaceId: 'wid', slug: 'foo', baseDir: dir, killer: () => {} });
    assert.equal(out.signaled, false);
    rmSync(dir, { recursive: true, force: true });
  });
});
