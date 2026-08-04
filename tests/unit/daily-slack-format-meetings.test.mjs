import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-format-meetings.mjs', import.meta.url).pathname;

function setup(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-meets-'));
  const p = join(dir, 'events.json');
  writeFileSync(p, typeof payload === 'string' ? payload : JSON.stringify(payload));
  return p;
}

function run(eventsPath) {
  const args = [SCRIPT];
  if (eventsPath !== undefined) args.push('--events', eventsPath);
  return spawnSync('node', args, {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/Guayaquil' },
  });
}

const daily = {
  summary: 'Daily Apps',
  start: { dateTime: '2026-08-04T09:00:00-05:00' },
  end: { dateTime: '2026-08-04T09:15:00-05:00' },
};
const retro = {
  summary: 'Retro sprint 34',
  start: { dateTime: '2026-08-04T15:30:00-05:00' },
  end: { dateTime: '2026-08-04T16:30:00-05:00' },
};
const allDay = {
  summary: 'OOO Juan',
  start: { date: '2026-08-04' },
  end: { date: '2026-08-05' },
};

describe('daily-slack-format-meetings — lines', () => {
  test('timed event renders summary with local HH:MM–HH:MM', () => {
    const r = run(setup([daily]));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout, 'Daily Apps (09:00–09:15)\n');
  });

  test('all-day event renders bare summary', () => {
    const r = run(setup([allDay]));
    assert.equal(r.stdout, 'OOO Juan\n');
  });

  test('missing summary renders (sin título)', () => {
    const r = run(setup([{ start: { dateTime: '2026-08-04T10:00:00-05:00' }, end: { dateTime: '2026-08-04T11:00:00-05:00' } }]));
    assert.equal(r.stdout, '(sin título) (10:00–11:00)\n');
  });

  test('sorts by start ascending', () => {
    const r = run(setup([retro, allDay, daily]));
    assert.equal(r.stdout, 'OOO Juan\nDaily Apps (09:00–09:15)\nRetro sprint 34 (15:30–16:30)\n');
  });

  test('normalizes UTC dateTime to local time', () => {
    const utc = {
      summary: 'Sync producto',
      start: { dateTime: '2026-08-04T19:00:00Z' },
      end: { dateTime: '2026-08-04T20:00:00Z' },
    };
    const r = run(setup([utc]));
    assert.equal(r.stdout, 'Sync producto (14:00–15:00)\n');
  });
});

describe('daily-slack-format-meetings — payload shapes', () => {
  test('accepts {events: [...]}', () => {
    const r = run(setup({ events: [daily] }));
    assert.equal(r.stdout, 'Daily Apps (09:00–09:15)\n');
  });

  test('accepts {items: [...]}', () => {
    const r = run(setup({ items: [daily] }));
    assert.equal(r.stdout, 'Daily Apps (09:00–09:15)\n');
  });

  test('empty array produces empty stdout, exit 0', () => {
    const r = run(setup([]));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('object without events/items produces empty stdout, exit 0', () => {
    const r = run(setup({ nextPageToken: null }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
});

describe('daily-slack-format-meetings — errors', () => {
  test('missing --events exits 2', () => {
    const r = run(undefined);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--events/);
  });

  test('invalid JSON exits 2', () => {
    const r = run(setup('{nope'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not valid JSON/);
  });

  test('unreadable file exits 2', () => {
    const r = run('/nonexistent/events.json');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot read/);
  });
});
