// tests/unit/stack-teardown-plan.test.mjs
//
// Run: `node --test tests/unit/stack-teardown-plan.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { pidsToKill, restorePlan } from '../../bin/lib/dev-orchestrator/stack/teardown-plan.mjs';

describe('pidsToKill', () => {
  test('valid, positive, deduped integers only', () => {
    const state = { hostPids: [{ role: 'vite', pid: 10 }, { role: 'inject', pid: 0 }, { role: 'observer', pid: 10 }, { role: 'x', pid: '20' }, { role: 'y', pid: null }] };
    assert.deepEqual(pidsToKill(state), [10, 20]);
  });

  test('empty when absent', () => {
    assert.deepEqual(pidsToKill({}), []);
  });
});

describe('restorePlan', () => {
  test('frontend + backend restore pairs (from=backup, to=live)', () => {
    const state = {
      frontendEnv: { path: '/f', envFile: '.env', envBackup: '.env.bak' },
      backendEnvBackups: [{ path: '/a/.env', backupPath: '/a/.env.bak' }]
    };
    assert.deepEqual(restorePlan(state), {
      frontend: { from: '/f/.env.bak', to: '/f/.env' },
      backend: [{ from: '/a/.env.bak', to: '/a/.env' }]
    });
  });

  test('null frontend and empty backend', () => {
    assert.deepEqual(restorePlan({}), { frontend: null, backend: [] });
  });
});
