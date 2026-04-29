// tests/unit/daily-slack-render.test.mjs
//
// Run: `node --test tests/unit/daily-slack-render.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-render.mjs', import.meta.url).pathname;

function setup(data) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-render-'));
  const dataPath = join(dir, 'data.json');
  writeFileSync(dataPath, JSON.stringify(data));
  return dataPath;
}

function run(dataPath) {
  return spawnSync('node', [SCRIPT, '--data', dataPath], { encoding: 'utf8' });
}

describe('daily-slack-render — happy path', () => {
  test('renders all three placeholders with content', () => {
    const data = {
      first_run: false,
      achieved: [{ name: 'API node', url: 'https://app.clickup.com/t/abc', percentage: 90 }],
      not_achieved: [{ name: 'Migration', url: 'https://app.clickup.com/t/def', reason: 'esperando revisión' }],
      short_term: [{ name: 'API node', url: 'https://app.clickup.com/t/abc', due_date: '2026-04-30T00:00:00Z' }],
    };
    const r = run(setup(data));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved_goals, '`[90%]` <https://app.clickup.com/t/abc|API node>');
    assert.equal(out.not_achieved_goals, 'Migration — esperando revisión\nhttps://app.clickup.com/t/def');
    assert.equal(out.short_term_goals, '`[2026-04-30]` <https://app.clickup.com/t/abc|API node>');
  });
});

describe('daily-slack-render — empty + first-run', () => {
  test('first-run banner replaces achieved_goals when first_run is true', () => {
    const data = { first_run: true, achieved: [], not_achieved: [], short_term: [] };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '_Primer reporte del sprint — sin línea base para comparar._');
  });

  test('achieved_goals empty string when not first run and no achievements', () => {
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [] };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '_Sin avances desde la última actualización._');
  });

  test('not_achieved_goals empty string when all advanced', () => {
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [] };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.not_achieved_goals, '_Todas las tareas avanzaron._');
  });
});

describe('daily-slack-render — short_term sorting + filtering', () => {
  test('sorts ascending by due_date and omits tasks without due_date', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'Late', url: 'u3', due_date: '2026-05-10T00:00:00Z' },
        { name: 'No date', url: 'u2' },
        { name: 'Early', url: 'u1', due_date: '2026-04-30T00:00:00Z' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(
      out.short_term_goals,
      '`[2026-04-30]` <u1|Early>\n`[2026-05-10]` <u3|Late>'
    );
  });

  test('empty short_term renders empty string', () => {
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [] };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.short_term_goals, '');
  });
});

describe('daily-slack-render — short_term closed strikethrough', () => {
  test('applies strikethrough to link for closed tasks', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'Done task', url: 'u1', due_date: '2026-04-30T00:00:00Z', status_type: 'closed' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.short_term_goals, '`[2026-04-30]` ~<u1|Done task>~');
  });

  test('does not apply strikethrough for open tasks', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'Open task', url: 'u1', due_date: '2026-04-30T00:00:00Z', status_type: 'open' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.short_term_goals, '`[2026-04-30]` <u1|Open task>');
  });

  test('mixed open and closed render with per-task strikethrough', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'Open', url: 'u1', due_date: '2026-04-30T00:00:00Z', status_type: 'open' },
        { name: 'Done', url: 'u2', due_date: '2026-05-01T00:00:00Z', status_type: 'closed' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(
      out.short_term_goals,
      '`[2026-04-30]` <u1|Open>\n`[2026-05-01]` ~<u2|Done>~'
    );
  });
});

describe('daily-slack-render — multi-task spacing', () => {
  test('separates multiple achieved items with single newline', () => {
    const data = {
      first_run: false,
      achieved: [
        { name: 'A', url: 'u1', percentage: 50 },
        { name: 'B', url: 'u2', percentage: 100 },
      ],
      not_achieved: [],
      short_term: [],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '`[50%]` <u1|A>\n`[100%]` <u2|B>');
  });
});

describe('daily-slack-render — IO and validation errors', () => {
  test('exits 2 with usage message when no args', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /error: --data <path> is required/);
  });

  test('exits 2 when --data file is missing', () => {
    const r = spawnSync('node', [SCRIPT, '--data', '/nonexistent/path.json'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot read --data file/);
  });

  test('exits 2 when --data file is malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daily-slack-render-'));
    const dataPath = join(dir, 'data.json');
    writeFileSync(dataPath, '{ this is not valid json');
    const r = spawnSync('node', [SCRIPT, '--data', dataPath], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--data is not valid JSON/);
  });
});
