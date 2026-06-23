import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { executeValidate } from '../../bin/install-dep.mjs';

const okRunner = () => ({ status: 0 });

describe('executeValidate', () => {
  test('skip plan → 0', () => {
    assert.equal(executeValidate({ plan: { runtime: 'skip', steps: [] }, serviceDir: '/x', log: () => {} }), 0);
  });
  test('host frozen install success → 0', () => {
    const plan = { runtime: 'host', packageManager: 'npm', steps: [{ kind: 'install', cmd: 'npm ci' }] };
    assert.equal(executeValidate({ plan, serviceDir: '/x', runner: okRunner, log: () => {} }), 0);
  });
  test('host frozen install failure → 1', () => {
    const plan = { runtime: 'host', packageManager: 'npm', steps: [{ kind: 'install', cmd: 'npm ci' }] };
    assert.equal(executeValidate({ plan, serviceDir: '/x', runner: () => ({ status: 1 }), log: () => {} }), 1);
  });
  test('docker-compose clean (no drift) → 0', () => {
    const plan = { runtime: 'docker-compose', composeService: 'app', packageManager: 'npm', steps: [
      { kind: 'check', cmd: 'ps', expectService: 'app' },
      { kind: 'boot', cmd: 'up' },
      { kind: 'install', cmd: 'exec app npm install' },
      { kind: 'drift_check', lockfile: 'package-lock.json', cmd: 'git diff', revertCmd: 'git checkout' },
    ] };
    assert.equal(executeValidate({ plan, serviceDir: '/x', runner: okRunner, probe: () => true, log: () => {} }), 0);
  });
  test('docker-compose drift → 3 and reverts lockfile', () => {
    const calls = [];
    const runner = (cmd) => { calls.push(cmd); return { status: cmd === 'git diff' ? 1 : 0 }; };
    const plan = { runtime: 'docker-compose', composeService: 'app', packageManager: 'npm', steps: [
      { kind: 'check', cmd: 'ps', expectService: 'app' },
      { kind: 'boot', cmd: 'up' },
      { kind: 'install', cmd: 'exec app npm install' },
      { kind: 'drift_check', lockfile: 'package-lock.json', cmd: 'git diff', revertCmd: 'git checkout' },
    ] };
    assert.equal(executeValidate({ plan, serviceDir: '/x', runner, probe: () => true, log: () => {} }), 3);
    assert.ok(calls.includes('git checkout'), 'reverts the drifted lockfile');
  });
});
