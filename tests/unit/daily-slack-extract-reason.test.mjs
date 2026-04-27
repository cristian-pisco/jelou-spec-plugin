// tests/unit/daily-slack-extract-reason.test.mjs
//
// Run: `node --test tests/unit/daily-slack-extract-reason.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-extract-reason.mjs', import.meta.url).pathname;

function setup(task) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-reason-'));
  const taskPath = join(dir, 'task.json');
  writeFileSync(taskPath, JSON.stringify(task));
  return taskPath;
}

function run(taskPath) {
  return spawnSync('node', [SCRIPT, '--task', taskPath], { encoding: 'utf8' });
}

describe('daily-slack-extract-reason — priority 1', () => {
  test('post-cutoff comment wins over PR state and old comment', () => {
    const taskPath = setup({
      cutoff: '2026-04-25T08:00:00Z',
      comments: [
        { date_iso: '2026-04-26T07:30:00Z', text: 'Esperando feedback del PM.' },
        { date_iso: '2026-04-20T08:00:00Z', text: 'old comment' },
      ],
      pr_states: { 'https://gh/x/y/pull/1': { state: 'OPEN', isDraft: true, mergeable: true } },
    });
    const r = run(taskPath);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'Esperando feedback del PM.');
  });

  test('truncates long comment to 200 chars', () => {
    const long = 'x'.repeat(250);
    const taskPath = setup({
      cutoff: '2026-04-25T08:00:00Z',
      comments: [{ date_iso: '2026-04-26T07:30:00Z', text: long }],
      pr_states: {},
    });
    const r = run(taskPath);
    assert.equal(r.stdout.trim().length, 200);
  });
});
