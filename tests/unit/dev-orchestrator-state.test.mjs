import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { stateDir, ensureStateDir, writeMeta, currentSymlinkPath } from '../../bin/lib/dev-orchestrator/state.mjs';

describe('stateDir', () => {
  test('joins ~/.jlu/workspaces/<id>/<slug>/', () => {
    const p = stateDir({ workspaceId: 'abc123', slug: 'my-task' });
    assert.equal(p, join(homedir(), '.jlu', 'workspaces', 'abc123', 'my-task'));
  });

  test('uses _global slug when omitted', () => {
    const p = stateDir({ workspaceId: 'abc123' });
    assert.equal(p, join(homedir(), '.jlu', 'workspaces', 'abc123', '_global'));
  });
});

describe('ensureStateDir', () => {
  test('creates the directory if missing', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'jlu-state-'));
    const p = ensureStateDir({ workspaceId: 'wid', slug: 'slg', baseDir: fakeHome });
    assert.equal(existsSync(p), true);
    assert.equal(p, join(fakeHome, 'workspaces', 'wid', 'slg'));
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test('uses _global slug when omitted', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'jlu-state-'));
    const p = ensureStateDir({ workspaceId: 'wid', baseDir: fakeHome });
    assert.equal(p, join(fakeHome, 'workspaces', 'wid', '_global'));
    assert.equal(existsSync(p), true);
    rmSync(fakeHome, { recursive: true, force: true });
  });
});

describe('writeMeta', () => {
  test('writes meta.json with workspace path', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'jlu-meta-'));
    writeMeta({ workspaceId: 'wid', workspaceRoot: '/x/y', baseDir: fakeHome });
    const meta = JSON.parse(readFileSync(join(fakeHome, 'workspaces', 'wid', 'meta.json'), 'utf8'));
    assert.equal(meta.path, '/x/y');
    assert.ok(typeof meta.name === 'string');
    assert.ok(!Number.isNaN(Date.parse(meta.updated_at)), `updated_at must parse: ${meta.updated_at}`);
    rmSync(fakeHome, { recursive: true, force: true });
  });
});

describe('currentSymlinkPath', () => {
  test('returns ~/.jlu/current path', () => {
    assert.equal(currentSymlinkPath(), join(homedir(), '.jlu', 'current'));
  });
});
