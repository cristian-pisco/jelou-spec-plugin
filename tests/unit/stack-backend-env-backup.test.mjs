// tests/unit/stack-backend-env-backup.test.mjs
//
// Run: `node --test tests/unit/stack-backend-env-backup.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { backendEnvBackupPlan } from '../../bin/lib/dev-orchestrator/stack/backend-env-backup.mjs';

describe('backendEnvBackupPlan', () => {
  const services = [
    { name: 'svc-a', path: '/repo/a' },
    { name: 'svc-b', path: '/repo/b' }
  ];

  test('only non-worktree services get a backup pair', () => {
    const out = backendEnvBackupPlan({ services, worktreePaths: { 'svc-b': '/wt/b' }, backupName: '.env.jelou-local-stack.bak' });
    assert.deepEqual(out, [
      { service: 'svc-a', path: '/repo/a/.env', backupPath: '/repo/a/.env.jelou-local-stack.bak' }
    ]);
  });

  test('all services when none are worktrees; custom env filename', () => {
    const out = backendEnvBackupPlan({ services, worktreePaths: {}, backupName: '.bak', envFileName: '.env.local' });
    assert.deepEqual(out.map((x) => x.path), ['/repo/a/.env.local', '/repo/b/.env.local']);
    assert.deepEqual(out.map((x) => x.backupPath), ['/repo/a/.bak', '/repo/b/.bak']);
  });
});
