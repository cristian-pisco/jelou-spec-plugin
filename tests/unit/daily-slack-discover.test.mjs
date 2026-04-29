// tests/unit/daily-slack-discover.test.mjs
//
// Run: `node --test tests/unit/daily-slack-discover.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-discover.mjs', import.meta.url).pathname;
const RESPONSABLE_ID = '4eda9295-191f-4ce1-ab10-c5cfa32462e5';
const USER_ID = '89213205';

function setup({ tasks, pluginIds = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-discover-'));
  const tasksPath = join(dir, 'tasks.json');
  const pluginIdsPath = join(dir, 'plugin-ids.json');
  writeFileSync(tasksPath, JSON.stringify(tasks));
  writeFileSync(pluginIdsPath, JSON.stringify(pluginIds));
  return { tasksPath, pluginIdsPath };
}

function run({ tasksPath, pluginIdsPath }, overrides = {}) {
  const args = [
    SCRIPT,
    '--tasks', tasksPath,
    '--user-id', overrides.userId ?? USER_ID,
    '--responsable-field-id', overrides.responsableFieldId ?? RESPONSABLE_ID,
    '--plugin-ids', pluginIdsPath,
  ];
  return spawnSync('node', args, { encoding: 'utf8' });
}

function task({ id, name = 'T', url, assignees = [], customFields = [] }) {
  return {
    id,
    name,
    url: url ?? `https://app.clickup.com/t/${id}`,
    assignees,
    custom_fields: customFields,
  };
}

function responsableField(value) {
  return { id: RESPONSABLE_ID, name: 'Responsable', type: 'users', value };
}

describe('daily-slack-discover — assignee match', () => {
  test('user listed in assignees → included', () => {
    const tasks = [task({ id: 'a', assignees: [{ id: USER_ID, username: 'me' }] })];
    const r = run(setup({ tasks }));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.length, 1);
    assert.equal(out[0].clickup_id, 'a');
    assert.equal(out[0].source, 'clickup-only');
    assert.equal(out[0].slug, null);
    assert.deepEqual(out[0].pr_urls, []);
  });

  test('user is one of several assignees → included', () => {
    const tasks = [
      task({ id: 'a', assignees: [{ id: '1' }, { id: USER_ID }, { id: '2' }] }),
    ];
    const r = run(setup({ tasks }));
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).length, 1);
  });

  test('user not in assignees and no Responsable → excluded', () => {
    const tasks = [task({ id: 'a', assignees: [{ id: '999' }] })];
    const r = run(setup({ tasks }));
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).length, 0);
  });

  test('numeric user-id matches stringified id', () => {
    const tasks = [task({ id: 'a', assignees: [{ id: Number(USER_ID) }] })];
    const r = run(setup({ tasks }));
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).length, 1);
  });
});

describe('daily-slack-discover — Responsable custom field match', () => {
  test('Responsable value is array of user objects → included', () => {
    const tasks = [
      task({
        id: 'a',
        assignees: [{ id: '999' }],
        customFields: [responsableField([{ id: USER_ID }])],
      }),
    ];
    const r = run(setup({ tasks }));
    assert.equal(JSON.parse(r.stdout).length, 1);
  });

  test('Responsable value is array of raw ids → included', () => {
    const tasks = [
      task({
        id: 'a',
        customFields: [responsableField([USER_ID])],
      }),
    ];
    const r = run(setup({ tasks }));
    assert.equal(JSON.parse(r.stdout).length, 1);
  });

  test('Responsable value is single user object → included', () => {
    const tasks = [
      task({ id: 'a', customFields: [responsableField({ id: USER_ID })] }),
    ];
    const r = run(setup({ tasks }));
    assert.equal(JSON.parse(r.stdout).length, 1);
  });

  test('Responsable value is JSON-stringified array → included', () => {
    const tasks = [
      task({
        id: 'a',
        customFields: [responsableField(JSON.stringify([{ id: USER_ID }]))],
      }),
    ];
    const r = run(setup({ tasks }));
    assert.equal(JSON.parse(r.stdout).length, 1);
  });

  test('Responsable value points to other user → excluded', () => {
    const tasks = [
      task({ id: 'a', customFields: [responsableField([{ id: '999' }])] }),
    ];
    const r = run(setup({ tasks }));
    assert.equal(JSON.parse(r.stdout).length, 0);
  });

  test('Responsable value is null → excluded', () => {
    const tasks = [
      task({ id: 'a', customFields: [responsableField(null)] }),
    ];
    const r = run(setup({ tasks }));
    assert.equal(JSON.parse(r.stdout).length, 0);
  });

  test('Responsable field absent → excluded when no assignee', () => {
    const tasks = [task({ id: 'a' })];
    const r = run(setup({ tasks }));
    assert.equal(JSON.parse(r.stdout).length, 0);
  });
});

describe('daily-slack-discover — plugin-set exclusion', () => {
  test('plugin-set IDs are skipped', () => {
    const tasks = [
      task({ id: 'plug', assignees: [{ id: USER_ID }] }),
      task({ id: 'gap', assignees: [{ id: USER_ID }] }),
    ];
    const r = run(setup({ tasks, pluginIds: ['plug'] }));
    const out = JSON.parse(r.stdout);
    assert.equal(out.length, 1);
    assert.equal(out[0].clickup_id, 'gap');
  });

  test('duplicate IDs in input are deduped', () => {
    const tasks = [
      task({ id: 'a', assignees: [{ id: USER_ID }] }),
      task({ id: 'a', assignees: [{ id: USER_ID }] }),
    ];
    const r = run(setup({ tasks }));
    assert.equal(JSON.parse(r.stdout).length, 1);
  });
});

describe('daily-slack-discover — IO and validation errors', () => {
  test('exits 2 when required arg missing', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /required arg\(s\) missing/);
  });

  test('exits 2 when --tasks is not a JSON array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daily-slack-discover-'));
    const tasksPath = join(dir, 'tasks.json');
    const pluginPath = join(dir, 'plugin.json');
    writeFileSync(tasksPath, JSON.stringify({ not: 'array' }));
    writeFileSync(pluginPath, JSON.stringify([]));
    const r = spawnSync('node', [
      SCRIPT,
      '--tasks', tasksPath,
      '--user-id', USER_ID,
      '--responsable-field-id', RESPONSABLE_ID,
      '--plugin-ids', pluginPath,
    ], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--tasks must contain a JSON array/);
  });

  test('exits 2 with malformed JSON message when --tasks is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daily-slack-discover-'));
    const tasksPath = join(dir, 'tasks.json');
    const pluginPath = join(dir, 'plugin.json');
    writeFileSync(tasksPath, '{ not json');
    writeFileSync(pluginPath, JSON.stringify([]));
    const r = spawnSync('node', [
      SCRIPT,
      '--tasks', tasksPath,
      '--user-id', USER_ID,
      '--responsable-field-id', RESPONSABLE_ID,
      '--plugin-ids', pluginPath,
    ], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--tasks is not valid JSON/);
  });
});

describe('daily-slack-discover — output shape', () => {
  test('emits exactly the documented stub fields', () => {
    const tasks = [
      task({
        id: 'a',
        name: 'My task',
        url: 'https://app.clickup.com/t/a',
        assignees: [{ id: USER_ID }],
      }),
    ];
    const r = run(setup({ tasks }));
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out[0], {
      clickup_id: 'a',
      name: 'My task',
      url: 'https://app.clickup.com/t/a',
      source: 'clickup-only',
      slug: null,
      pr_urls: [],
    });
  });
});
