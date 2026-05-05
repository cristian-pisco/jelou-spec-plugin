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

function setup(current, snapshot, closedLike, statusPercentages) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-bucket-'));
  const currentPath = join(dir, 'current.json');
  writeFileSync(currentPath, JSON.stringify(current));
  let snapshotPath = '';
  if (snapshot !== null) {
    snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));
  }
  let closedPath = '';
  if (closedLike !== undefined) {
    closedPath = join(dir, 'closed-like.json');
    writeFileSync(closedPath, JSON.stringify(closedLike));
  }
  let statusPctPath = '';
  if (statusPercentages !== undefined) {
    statusPctPath = join(dir, 'status-pct.json');
    writeFileSync(statusPctPath, JSON.stringify(statusPercentages));
  }
  return { currentPath, snapshotPath, closedPath, statusPctPath };
}

function run({ currentPath, snapshotPath, closedPath, statusPctPath }, extra = []) {
  const args = [SCRIPT, '--current', currentPath];
  if (snapshotPath) args.push('--snapshot', snapshotPath);
  if (closedPath) args.push('--closed-like-statuses', closedPath);
  if (statusPctPath) args.push('--status-percentages', statusPctPath);
  return spawnSync('node', [...args, ...extra], { encoding: 'utf8' });
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

describe('daily-slack-bucket — closed → 100% normalization', () => {
  test('closed task without subtasks normalizes to 100 in achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'closed' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 50, status_type: 'in_progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.achieved[0].percentage, 100);
    assert.equal(out.new_snapshot.a.percentage, 100);
  });

  test('legacy closed snapshot at 0 does not produce false-positive achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'closed' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 0, status_type: 'closed' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 0);
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.new_snapshot.a.percentage, 100);
  });

  test('non-closed task at 0 is left untouched', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'open' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 0, status_type: 'open' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.not_achieved[0].percentage, 0);
    assert.equal(out.new_snapshot.a.percentage, 0);
  });

  test('new closed task (no prior entry) lands in achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'closed' }];
    const snap = {};
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.achieved[0].percentage, 100);
    assert.equal(out.new_snapshot.a.percentage, 100);
  });

  test('first run with closed task still goes to not_achieved (rule unchanged)', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'closed' }];
    const r = run(setup(current, null));
    const out = JSON.parse(r.stdout);
    assert.equal(out.first_run, true);
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.not_achieved[0].percentage, 100);
  });
});

describe('daily-slack-bucket — closed-like custom statuses (status_name)', () => {
  test('status_name in closed-like list normalizes percentage to 100 and lands in achieved on transition', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 30, status_type: 'custom', status_name: 'pending to production' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 30, status_type: 'in_progress', status_name: 'in progress' } };
    const r = run(setup(current, snap, ['pending to production']));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.achieved[0].percentage, 100);
    assert.equal(out.new_snapshot.a.percentage, 100);
    assert.equal(out.new_snapshot.a.status_name, 'pending to production');
  });

  test('case-insensitive match against closed-like list', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'custom', status_name: 'Pending To Production' }];
    const snap = {};
    const r = run(setup(current, snap, ['pending to production']));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.achieved[0].percentage, 100);
  });

  test('snapshot status_name in closed-like list does not retrigger achieved on rerun', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'custom', status_name: 'pending to production' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 0, status_type: 'custom', status_name: 'pending to production' } };
    const r = run(setup(current, snap, ['pending to production']));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 0);
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.not_achieved[0].percentage, 100);
  });

  test('absence of --closed-like-statuses preserves backwards-compatible behavior', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 30, status_type: 'custom', status_name: 'pending to production' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 30, status_type: 'in_progress', status_name: 'in progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 0);
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.not_achieved[0].percentage, 30);
  });
});

describe('daily-slack-bucket — status_percentages mapping', () => {
  test('maps "pending to production" → 90 and counts the percentage rise as achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'custom', status_name: 'pending to production' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 50, status_type: 'in_progress', status_name: 'in progress' } };
    const r = run(setup(current, snap, [], { 'pending to production': 90 }));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.achieved[0].percentage, 90);
    assert.equal(out.new_snapshot.a.percentage, 90);
  });

  test('maps QA-related statuses (case-insensitive) → 80', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 30, status_type: 'custom', status_name: 'In QA' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 30, status_type: 'in_progress', status_name: 'in progress' } };
    const r = run(setup(current, snap, [], { 'in qa': 80 }));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved[0].percentage, 80);
  });

  test('closed-like takes precedence over status_percentages', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 30, status_type: 'closed', status_name: 'Closed' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 30, status_type: 'in_progress', status_name: 'in progress' } };
    const r = run(setup(current, snap, [], { closed: 50 }));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved[0].percentage, 100);
  });

  test('unmapped status preserves the entry percentage', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 25, status_type: 'open', status_name: 'in progress' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 25, status_type: 'open', status_name: 'in progress' } };
    const r = run(setup(current, snap, [], { 'pending to production': 90 }));
    const out = JSON.parse(r.stdout);
    assert.equal(out.not_achieved[0].percentage, 25);
  });

  test('rejects non-numeric values in status_percentages', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'open', status_name: 'in progress' }];
    const r = run(setup(current, null, [], { 'in qa': 'eighty' }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /must be a number 0-100/);
  });
});

describe('daily-slack-bucket — cutoff-ms (date_closed-driven achieved)', () => {
  test('task closed within cutoff lands in achieved even when prior snapshot already had it at 100', () => {
    const closedAt = Date.parse('2026-05-04T18:00:00Z');
    const cutoff = Date.parse('2026-05-04T00:00:00Z');
    const current = [
      {
        clickup_id: 'a', name: 'A', url: 'u', percentage: 100, status_type: 'closed', status_name: 'Closed',
        date_closed: closedAt,
      },
    ];
    const snap = { a: { name: 'A', url: 'u', percentage: 100, status_type: 'closed', status_name: 'Closed' } };
    const r = run(setup(current, snap), ['--cutoff-ms', String(cutoff)]);
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.not_achieved.length, 0);
  });

  test('task closed BEFORE cutoff stays in not_achieved when snapshot already had it', () => {
    const closedAt = Date.parse('2026-05-02T18:00:00Z');
    const cutoff = Date.parse('2026-05-04T00:00:00Z');
    const current = [
      {
        clickup_id: 'a', name: 'A', url: 'u', percentage: 100, status_type: 'closed', status_name: 'Closed',
        date_closed: closedAt,
      },
    ];
    const snap = { a: { name: 'A', url: 'u', percentage: 100, status_type: 'closed', status_name: 'Closed' } };
    const r = run(setup(current, snap), ['--cutoff-ms', String(cutoff)]);
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 0);
    assert.equal(out.not_achieved.length, 1);
  });

  test('cutoff-ms applies on first run too (no snapshot)', () => {
    const closedAt = Date.parse('2026-05-04T18:00:00Z');
    const cutoff = Date.parse('2026-05-04T00:00:00Z');
    const current = [
      {
        clickup_id: 'a', name: 'A', url: 'u', percentage: 100, status_type: 'closed', status_name: 'Closed',
        date_closed: closedAt,
      },
      {
        clickup_id: 'b', name: 'B', url: 'u', percentage: 100, status_type: 'closed', status_name: 'Closed',
        date_closed: Date.parse('2026-04-30T00:00:00Z'),
      },
    ];
    const r = run(setup(current, null), ['--cutoff-ms', String(cutoff)]);
    const out = JSON.parse(r.stdout);
    assert.equal(out.first_run, true);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.achieved[0].clickup_id, 'a');
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.not_achieved[0].clickup_id, 'b');
  });

  test('rejects non-numeric --cutoff-ms', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'open', status_name: 'in progress' }];
    const r = run(setup(current, null), ['--cutoff-ms', 'tomorrow']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--cutoff-ms must be a number/);
  });
});
