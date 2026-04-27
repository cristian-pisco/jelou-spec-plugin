// tests/unit/daily-slack-bucket.test.mjs
//
// Run: `node --test tests/unit/daily-slack-bucket.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-bucket.mjs', import.meta.url).pathname;

function setup(current, snapshot) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-bucket-'));
  const currentPath = join(dir, 'current.json');
  writeFileSync(currentPath, JSON.stringify(current));
  let snapshotPath = '';
  if (snapshot !== null) {
    snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));
  }
  return { currentPath, snapshotPath };
}

function run({ currentPath, snapshotPath }) {
  const args = [SCRIPT, '--current', currentPath];
  if (snapshotPath) args.push('--snapshot', snapshotPath);
  return spawnSync('node', args, { encoding: 'utf8' });
}

describe('daily-slack-bucket — first run', () => {
  test('all tasks go to not_achieved when no snapshot file', () => {
    const current = [
      { clickup_id: 'a', name: 'A', url: 'https://app.clickup.com/t/a', percentage: 30, status_type: 'in_progress' },
      { clickup_id: 'b', name: 'B', url: 'https://app.clickup.com/t/b', percentage: 0, status_type: 'open' },
    ];
    const r = run(setup(current, null));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.first_run, true);
    assert.equal(out.achieved.length, 0);
    assert.equal(out.not_achieved.length, 2);
    assert.deepEqual(out.new_snapshot.a, { name: 'A', url: 'https://app.clickup.com/t/a', percentage: 30, status_type: 'in_progress' });
  });
});

describe('daily-slack-bucket — delta', () => {
  test('percentage rose → achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 60, status_type: 'in_progress' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 30, status_type: 'in_progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.not_achieved.length, 0);
    assert.equal(out.first_run, false);
  });

  test('percentage unchanged → not_achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 30, status_type: 'in_progress' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 30, status_type: 'in_progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.achieved.length, 0);
  });

  test('regression → not_achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 20, status_type: 'in_progress' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 30, status_type: 'in_progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.not_achieved.length, 1);
  });

  test('became closed → achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 100, status_type: 'closed' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 100, status_type: 'in_progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
  });

  test('new task at >0% → achieved (added since snapshot)', () => {
    const current = [{ clickup_id: 'b', name: 'B', url: 'u', percentage: 50, status_type: 'in_progress' }];
    const snap = {};
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
  });

  test('new task at 0% → not_achieved', () => {
    const current = [{ clickup_id: 'b', name: 'B', url: 'u', percentage: 0, status_type: 'open' }];
    const snap = {};
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.not_achieved.length, 1);
  });

  test('task in snapshot but not current → dropped (not in either bucket)', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 100, status_type: 'closed' }];
    const snap = {
      a: { name: 'A', url: 'u', percentage: 50, status_type: 'in_progress' },
      gone: { name: 'Gone', url: 'u2', percentage: 50, status_type: 'in_progress' },
    };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length + out.not_achieved.length, 1);
    assert.ok(!out.new_snapshot.gone);
  });
});

describe('daily-slack-bucket — IO and validation errors', () => {
  test('exits 2 with usage message when no args', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /error: --current <path> is required/);
  });

  test('exits 2 with malformed JSON message when current is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daily-slack-bucket-'));
    const currentPath = join(dir, 'current.json');
    writeFileSync(currentPath, '{ this is not json');
    const r = spawnSync('node', [SCRIPT, '--current', currentPath], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--current is not valid JSON/);
  });

  test('exits 2 when a task is missing clickup_id', () => {
    const current = [{ name: 'No ID', url: 'u', percentage: 0, status_type: 'open' }];
    const r = run(setup(current, null));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /task missing clickup_id/);
  });
});
