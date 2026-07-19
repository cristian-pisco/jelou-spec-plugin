// tests/unit/stack-teardown.test.mjs
//
// Run: `node --test tests/unit/stack-teardown.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { tearDownStack } from '../../bin/lib/dev-orchestrator/stack/stack-teardown.mjs';

function fixtureState() {
  return {
    projects: [
      { projectName: 'a-t1', cwd: '/repo/a', composeFile: 'docker-compose.yml', overrideFile: 'docker-compose.jlu.yml' },
      { projectName: 'b-t1', cwd: '/repo/b', composeFile: 'docker-compose.yml', overrideFile: 'docker-compose.jlu.yml' }
    ],
    hostPids: [{ role: 'vite', pid: 10 }, { role: 'inject', pid: 11 }, { role: 'observer', pid: 12 }],
    frontendEnv: { path: '/f', envFile: '.env', envBackup: '.env.bak' },
    backendEnvBackups: [{ path: '/repo/a/.env', backupPath: '/repo/a/.env.bak' }]
  };
}

describe('tearDownStack', () => {
  test('composes down each project, kills each pid, restores present backups, clears state', () => {
    const runCalls = [];
    const killed = [];
    const copies = [];
    const removes = [];
    let cleared = false;
    const present = new Set(['/f/.env.bak', '/repo/a/.env.bak']);

    const out = tearDownStack({ workspaceId: '/ws', slug: 't1' }, {
      readState: () => fixtureState(),
      clearState: () => { cleared = true; },
      run: (bin, args, opts) => { runCalls.push({ bin, args, cwd: opts && opts.cwd }); return { status: 0 }; },
      kill: (pid) => { killed.push(pid); return true; },
      fs: {
        exists: (p) => present.has(p),
        copy: (from, to) => copies.push([from, to]),
        remove: (p) => removes.push(p)
      }
    });

    assert.deepEqual(runCalls.map((c) => c.args), [
      ['compose', '-p', 'a-t1', '-f', 'docker-compose.yml', '-f', 'docker-compose.jlu.yml', 'down'],
      ['compose', '-p', 'b-t1', '-f', 'docker-compose.yml', '-f', 'docker-compose.jlu.yml', 'down']
    ]);
    assert.deepEqual(runCalls.map((c) => c.cwd), ['/repo/a', '/repo/b']);
    assert.deepEqual(killed, [10, 11, 12]);
    assert.deepEqual(copies, [['/f/.env.bak', '/f/.env'], ['/repo/a/.env.bak', '/repo/a/.env']]);
    assert.deepEqual(removes, ['/f/.env.bak', '/repo/a/.env.bak']);
    assert.equal(cleared, true);
    assert.deepEqual(out, { projects: ['a-t1', 'b-t1'], killed: [10, 11, 12], missing: [], restored: ['/f/.env', '/repo/a/.env'] });
  });

  test('skips a restore whose backup is absent; records a dead pid as missing', () => {
    const out = tearDownStack({ workspaceId: '/ws', slug: 't1' }, {
      readState: () => ({ projects: [], hostPids: [{ role: 'vite', pid: 7 }], frontendEnv: { path: '/f', envFile: '.env', envBackup: '.env.bak' }, backendEnvBackups: [] }),
      clearState: () => {},
      run: () => ({ status: 0 }),
      kill: () => false,
      fs: { exists: () => false, copy: () => { throw new Error('should not copy'); }, remove: () => { throw new Error('should not remove'); } }
    });
    assert.deepEqual(out, { projects: [], killed: [], missing: [7], restored: [] });
  });
});
