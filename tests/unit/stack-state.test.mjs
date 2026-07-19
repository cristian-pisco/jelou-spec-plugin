// tests/unit/stack-state.test.mjs
//
// Run: `node --test tests/unit/stack-state.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyStackState, addProject, addHostPid, setFrontendEnv, addBackendEnvBackup,
  readStackState, writeStackState, clearStackState, stackStatePath
} from '../../bin/lib/dev-orchestrator/stack/stack-state.mjs';

describe('stack-state pure helpers', () => {
  test('addProject dedupes by projectName', () => {
    let s = emptyStackState();
    s = addProject(s, { projectName: 'a-t1', cwd: '/a', composeFile: 'c.yml', overrideFile: 'o.yml' });
    s = addProject(s, { projectName: 'a-t1', cwd: '/a2', composeFile: 'c.yml', overrideFile: 'o.yml' });
    assert.equal(s.projects.length, 1);
    assert.equal(s.projects[0].cwd, '/a2');
  });

  test('addHostPid dedupes by role', () => {
    let s = emptyStackState();
    s = addHostPid(s, { role: 'vite', pid: 1 });
    s = addHostPid(s, { role: 'vite', pid: 2 });
    s = addHostPid(s, { role: 'inject', pid: 3 });
    assert.deepEqual(s.hostPids, [{ role: 'inject', pid: 3 }, { role: 'vite', pid: 2 }]);
  });

  test('setFrontendEnv replaces', () => {
    let s = emptyStackState();
    s = setFrontendEnv(s, { path: '/f', envFile: '.env', envBackup: '.env.bak' });
    assert.deepEqual(s.frontendEnv, { path: '/f', envFile: '.env', envBackup: '.env.bak' });
  });

  test('addBackendEnvBackup dedupes by path', () => {
    let s = emptyStackState();
    s = addBackendEnvBackup(s, { path: '/a/.env', backupPath: '/a/.env.bak' });
    s = addBackendEnvBackup(s, { path: '/a/.env', backupPath: '/a/.env.bak2' });
    assert.equal(s.backendEnvBackups.length, 1);
    assert.equal(s.backendEnvBackups[0].backupPath, '/a/.env.bak2');
  });
});

describe('stack-state persistence', () => {
  test('round-trip write then read; missing file is empty; clear removes', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-stack-state-'));
    const opts = { workspaceId: '/ws', slug: 't1', baseDir };
    assert.deepEqual(readStackState(opts), emptyStackState());
    let s = addHostPid(emptyStackState(), { role: 'vite', pid: 99 });
    const p = writeStackState(opts, s);
    assert.equal(p, stackStatePath(opts));
    assert.deepEqual(readStackState(opts).hostPids, [{ role: 'vite', pid: 99 }]);
    clearStackState(opts);
    assert.deepEqual(readStackState(opts), emptyStackState());
  });

  test('corrupt json reads as empty', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-stack-state-'));
    const opts = { workspaceId: '/ws', slug: 't2', baseDir };
    writeStackState(opts, emptyStackState());
    writeFileSync(stackStatePath(opts), '{ not json');
    assert.deepEqual(readStackState(opts), emptyStackState());
  });
});
