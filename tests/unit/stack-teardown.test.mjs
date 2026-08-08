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

  test('cleans only current-run mutations in reverse journal order and preserves reused resources', () => {
    const marker = { workspaceId: 'workspace-1', taskSlug: 'task-a', runId: 'run-17' };
    const reusedProject = { projectName: 'shared-main', cwd: '/repo/main', composeFile: 'compose.yml', overrideFile: 'override.yml' };
    const ownedProject = { projectName: 'api-task-a', cwd: '/repo/api', composeFile: 'compose.yml', overrideFile: 'override.yml' };
    const actions = [];
    const lifecycle = [];
    let cleared = false;
    const state = {
      projects: [reusedProject, ownedProject],
      hostPids: [{ role: 'preexisting', pid: 8 }, { role: 'owned', pid: 41 }],
      currentRun: marker,
      mutationJournal: [
        { marker, kind: 'container', resource: ownedProject },
        { marker, kind: 'process', resource: { pid: 41 } },
        { marker, kind: 'overlay', resource: { path: '/runtime/api.env' } },
        { marker, kind: 'credential', resource: { id: 'workspace-1/task-a' } },
        { marker, kind: 'testData', resource: { id: 'company-17' } },
      ],
    };

    const out = tearDownStack({ ...marker, slug: marker.taskSlug }, {
      readState: () => state,
      clearState: () => { cleared = true; },
      writeState: () => {},
      run: (_bin, args) => { actions.push(`container:${args[2]}`); return { status: 0 }; },
      kill: (pid) => { actions.push(`process:${pid}`); return true; },
      fs: {
        exists: () => true,
        copy: () => {},
        remove: (path) => actions.push(`overlay:${path}`),
      },
      removeCredential: ({ id }) => actions.push(`credential:${id}`),
      removeTestData: ({ id }) => actions.push(`testData:${id}`),
      onLifecycle: (event) => lifecycle.push(event),
    });

    assert.deepEqual(actions, [
      'testData:company-17',
      'credential:workspace-1/task-a',
      'overlay:/runtime/api.env',
      'process:41',
      'container:api-task-a',
    ]);
    assert.equal(actions.includes('container:shared-main'), false);
    assert.equal(actions.includes('process:8'), false);
    assert.equal(cleared, true);
    assert.deepEqual(out.refused, []);
    assert.deepEqual(lifecycle, [
      { stage: 'cleanup', outcome: 'started' },
      { stage: 'cleanup', outcome: 'succeeded' },
    ]);
  });

  test('refuses resources with missing or mismatched workspace task or run markers', () => {
    const marker = { workspaceId: 'workspace-1', taskSlug: 'task-a', runId: 'run-17' };
    const state = {
      currentRun: marker,
      mutationJournal: [
        { marker: { ...marker, workspaceId: 'workspace-2' }, kind: 'process', resource: { pid: 1 } },
        { marker: { ...marker, taskSlug: 'task-b' }, kind: 'process', resource: { pid: 2 } },
        { marker: { ...marker, runId: 'run-18' }, kind: 'process', resource: { pid: 3 } },
        { kind: 'process', resource: { pid: 4 } },
      ],
    };
    const killed = [];
    let cleared = false;

    const out = tearDownStack({ ...marker, slug: marker.taskSlug }, {
      readState: () => state,
      clearState: () => { cleared = true; },
      writeState: () => {},
      kill: (pid) => { killed.push(pid); return true; },
      run: () => ({ status: 0 }),
      fs: { exists: () => false, copy: () => {}, remove: () => {} },
    });

    assert.deepEqual(killed, []);
    assert.equal(cleared, false);
    assert.deepEqual(out.refused.map(({ resource }) => resource.pid).sort(), [1, 2, 3, 4]);
    assert.deepEqual(new Set(out.refused.map(({ reason }) => reason)), new Set(['ownership-marker-mismatch', 'ownership-marker-missing']));
  });

  test('refuses the journal when the requested current run does not match persisted state', () => {
    const stateMarker = { workspaceId: 'workspace-1', taskSlug: 'task-a', runId: 'run-17' };
    let killed = false;

    const out = tearDownStack({ workspaceId: 'workspace-1', slug: 'task-a', runId: 'run-18' }, {
      readState: () => ({
        currentRun: stateMarker,
        mutationJournal: [{ marker: stateMarker, kind: 'process', resource: { pid: 41 } }],
      }),
      clearState: () => { throw new Error('must preserve refused state'); },
      writeState: () => {},
      kill: () => { killed = true; return true; },
      run: () => ({ status: 0 }),
      fs: { exists: () => false, copy: () => {}, remove: () => {} },
    });

    assert.equal(killed, false);
    assert.deepEqual(out.refused, [{
      kind: 'process',
      resource: { pid: 41 },
      reason: 'current-run-marker-mismatch',
    }]);
  });

  test('persists only refused entries after a partial cleanup', () => {
    const marker = { workspaceId: 'workspace-1', taskSlug: 'task-a', runId: 'run-17' };
    const refusedEntry = { marker: { ...marker, runId: 'run-18' }, kind: 'process', resource: { pid: 42 } };
    const ownedEntry = { marker, kind: 'process', resource: { pid: 41 } };
    const written = [];
    const killed = [];

    const out = tearDownStack({ ...marker, slug: marker.taskSlug }, {
      readState: () => ({ currentRun: marker, mutationJournal: [ownedEntry, refusedEntry] }),
      clearState: () => { throw new Error('refused state must remain'); },
      writeState: (_opts, state) => written.push(state),
      kill: (pid) => { killed.push(pid); return true; },
      run: () => ({ status: 0 }),
      fs: { exists: () => false, copy: () => {}, remove: () => {} },
    });

    assert.deepEqual(killed, [41]);
    assert.deepEqual(out.refused, [{ kind: 'process', resource: { pid: 42 }, reason: 'ownership-marker-mismatch' }]);
    assert.deepEqual(written[0].mutationJournal, [refusedEntry]);
  });
});
