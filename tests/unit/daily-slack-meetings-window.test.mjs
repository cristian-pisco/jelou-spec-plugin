import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('../../bin/daily-slack-meetings-window.mjs', import.meta.url).pathname;

function run(nowArg) {
  const args = [SCRIPT];
  if (nowArg !== undefined) args.push('--now', nowArg);
  return spawnSync('node', args, {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/Guayaquil' },
  });
}

function windowFor(nowArg) {
  const r = run(nowArg);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

describe('daily-slack-meetings-window — previous business day', () => {
  test('regular weekday: Wednesday reports Tuesday', () => {
    const w = windowFor('2026-08-05T09:00:00');
    assert.ok(w.timeMin.startsWith('2026-08-04T00:00:00.000'));
    assert.ok(w.timeMax.startsWith('2026-08-04T23:59:59.999'));
  });

  test('Monday reports Friday', () => {
    const w = windowFor('2026-08-03T09:00:00');
    assert.ok(w.timeMin.startsWith('2026-07-31T00:00:00.000'));
    assert.ok(w.timeMax.startsWith('2026-07-31T23:59:59.999'));
  });

  test('Sunday reports Friday', () => {
    const w = windowFor('2026-08-02T14:00:00');
    assert.ok(w.timeMin.startsWith('2026-07-31T00:00:00.000'));
  });

  test('Saturday reports Friday', () => {
    const w = windowFor('2026-08-01T14:00:00');
    assert.ok(w.timeMin.startsWith('2026-07-31T00:00:00.000'));
  });

  test('month boundary: Tuesday Sep 1 reports Monday Aug 31', () => {
    const w = windowFor('2026-09-01T09:00:00');
    assert.ok(w.timeMin.startsWith('2026-08-31T00:00:00.000'));
  });

  test('emits the local UTC offset', () => {
    const w = windowFor('2026-08-05T09:00:00');
    assert.ok(w.timeMin.endsWith('-05:00'), `got: ${w.timeMin}`);
    assert.ok(w.timeMax.endsWith('-05:00'), `got: ${w.timeMax}`);
  });

  test('no --now still produces a valid window', () => {
    const w = windowFor(undefined);
    assert.ok(w.timeMin < w.timeMax);
    const day = new Date(`${w.timeMin.slice(0, 10)}T12:00:00Z`).getUTCDay();
    assert.ok(day !== 0 && day !== 6);
  });

  test('invalid --now exits 2', () => {
    const r = run('not-a-date');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not a valid date/);
  });
});
