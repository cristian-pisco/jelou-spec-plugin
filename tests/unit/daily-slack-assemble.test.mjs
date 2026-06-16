// tests/unit/daily-slack-assemble.test.mjs
//
// Run: `node --test tests/unit/daily-slack-assemble.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-assemble.mjs', import.meta.url).pathname;
const RESPONSABLE_ID = '4eda9295-191f-4ce1-ab10-c5cfa32462e5';
const TIPO_ID = 'beb0d49d-46d4-4b46-972b-25e144ec1551';
const USER_ID = '89213205';

function setup({
  list,
  hydrated = [],
  pluginTasks = null,
  closedLike = null,
  statusPercentages = null,
}) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-assemble-'));
  const paths = {};
  paths.list = join(dir, 'list.json');
  writeFileSync(paths.list, JSON.stringify(list));
  paths.hydrated = join(dir, 'hydrated.json');
  writeFileSync(paths.hydrated, JSON.stringify(hydrated));
  if (pluginTasks != null) {
    paths.pluginTasks = join(dir, 'plugin-tasks.json');
    writeFileSync(paths.pluginTasks, JSON.stringify(pluginTasks));
  }
  if (closedLike != null) {
    paths.closedLike = join(dir, 'closed-like.json');
    writeFileSync(paths.closedLike, JSON.stringify(closedLike));
  }
  if (statusPercentages != null) {
    paths.statusPercentages = join(dir, 'status-pct.json');
    writeFileSync(paths.statusPercentages, JSON.stringify(statusPercentages));
  }
  return paths;
}

function run(paths, overrides = {}) {
  const args = [
    SCRIPT,
    '--list', paths.list,
    '--hydrated', paths.hydrated,
    '--user-id', overrides.userId ?? USER_ID,
    '--responsable-field-id', overrides.responsableFieldId ?? RESPONSABLE_ID,
    '--tipo-field-id', overrides.tipoFieldId ?? TIPO_ID,
  ];
  if (paths.pluginTasks) args.push('--plugin-tasks', paths.pluginTasks);
  if (paths.closedLike) args.push('--closed-like-statuses', paths.closedLike);
  if (paths.statusPercentages) args.push('--status-percentages', paths.statusPercentages);
  return spawnSync('node', args, { encoding: 'utf8' });
}

function light({ id, name = 'T', url, status = 'Open', assignees = [], due_date = null, date_closed = null }) {
  return { id, name, url: url ?? `https://app.clickup.com/t/${id}`, status, assignees, due_date, date_closed };
}

function hydratedTask({ id, name = 'T', url, status = 'Open', assignees = [], customFields = [], subtasks = null, due_date = null, date_closed = null, date_updated = null }) {
  const t = {
    id,
    name,
    url: url ?? `https://app.clickup.com/t/${id}`,
    status,
    assignees,
    custom_fields: customFields,
    due_date,
    date_closed,
    date_updated,
  };
  if (subtasks != null) t.subtasks = subtasks;
  return t;
}

function responsableField(value) {
  return { id: RESPONSABLE_ID, name: 'Responsable', type: 'users', value };
}

function tipoField(value, options) {
  return {
    id: TIPO_ID,
    name: 'Tipo Proyecto',
    type: 'drop_down',
    value,
    type_config: { options },
  };
}

const TIPO_OPTIONS = [
  { id: 'opt-issue', name: 'Issue Report', orderindex: 0 },
  { id: 'opt-internal', name: 'Internal request', orderindex: 1 },
  { id: 'opt-roadmap', name: 'Roadmap', orderindex: 2 },
];

describe('daily-slack-assemble — ownership', () => {
  test('assignee-owned task (light only, not hydrated) is included', () => {
    const list = [light({ id: 'a', assignees: [{ id: USER_ID }] })];
    const r = run(setup({ list, hydrated: [] }));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.length, 1);
    assert.equal(out[0].clickup_id, 'a');
    assert.equal(out[0].source, 'clickup-only');
  });

  test('Responsable-only task (hydrated) is included', () => {
    const list = [light({ id: 'a', assignees: [{ id: '999' }] })];
    const hydrated = [hydratedTask({ id: 'a', assignees: [{ id: '999' }], customFields: [responsableField([{ id: USER_ID }])] })];
    const r = run(setup({ list, hydrated }));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(JSON.parse(r.stdout).length, 1);
  });

  test('non-owned task is excluded', () => {
    const list = [light({ id: 'a', assignees: [{ id: '999' }] })];
    const hydrated = [hydratedTask({ id: 'a', assignees: [{ id: '999' }], customFields: [responsableField([{ id: '888' }])] })];
    const r = run(setup({ list, hydrated }));
    assert.equal(JSON.parse(r.stdout).length, 0);
  });

  test('non-assignee task with no hydrated entry is excluded (cannot confirm Responsable)', () => {
    const list = [light({ id: 'a', assignees: [{ id: '999' }] })];
    const r = run(setup({ list, hydrated: [] }));
    assert.equal(JSON.parse(r.stdout).length, 0);
  });
});

describe('daily-slack-assemble — status normalization', () => {
  test('string status "Closed" → status_type closed, percentage 100', () => {
    const list = [light({ id: 'a', status: 'Closed', assignees: [{ id: USER_ID }] })];
    const r = run(setup({ list }));
    const out = JSON.parse(r.stdout);
    assert.equal(out[0].status_type, 'closed');
    assert.equal(out[0].status_name, 'Closed');
    assert.equal(out[0].percentage, 100);
  });

  test('string status "Open" → status_type open', () => {
    const list = [light({ id: 'a', status: 'Open', assignees: [{ id: USER_ID }] })];
    const r = run(setup({ list }));
    assert.equal(JSON.parse(r.stdout)[0].status_type, 'open');
  });

  test('string status "in progress" → status_type custom', () => {
    const list = [light({ id: 'a', status: 'in progress', assignees: [{ id: USER_ID }] })];
    const r = run(setup({ list }));
    assert.equal(JSON.parse(r.stdout)[0].status_type, 'custom');
  });

  test('hydrated object status uses status.type and status.status verbatim', () => {
    const list = [light({ id: 'a', status: 'whatever', assignees: [{ id: USER_ID }] })];
    const hydrated = [hydratedTask({ id: 'a', status: { status: 'in review', type: 'custom' }, assignees: [{ id: USER_ID }] })];
    const r = run(setup({ list, hydrated }));
    const out = JSON.parse(r.stdout);
    assert.equal(out[0].status_name, 'in review');
    assert.equal(out[0].status_type, 'custom');
  });
});

describe('daily-slack-assemble — percentage', () => {
  test('status_percentages map overrides (pending to production → 90)', () => {
    const list = [light({ id: 'a', status: 'pending to production', assignees: [{ id: USER_ID }] })];
    const r = run(setup({ list, statusPercentages: { 'pending to production': 90 } }));
    assert.equal(JSON.parse(r.stdout)[0].percentage, 90);
  });

  test('closed-like status name overrides to 100', () => {
    const list = [light({ id: 'a', status: 'deployed', assignees: [{ id: USER_ID }] })];
    const r = run(setup({ list, closedLike: ['deployed'] }));
    const out = JSON.parse(r.stdout);
    assert.equal(out[0].percentage, 100);
  });

  test('in-progress task with subtasks → closed/total ratio', () => {
    const list = [light({ id: 'a', status: 'in progress', assignees: [{ id: USER_ID }] })];
    const hydrated = [hydratedTask({
      id: 'a',
      status: 'in progress',
      assignees: [{ id: USER_ID }],
      subtasks: [
        { status: { type: 'closed' } },
        { status: { type: 'open' } },
        { status: { type: 'closed' } },
        { status: { type: 'open' } },
      ],
    })];
    const r = run(setup({ list, hydrated }));
    assert.equal(JSON.parse(r.stdout)[0].percentage, 50);
  });

  test('in-progress task with no subtasks → 0', () => {
    const list = [light({ id: 'a', status: 'in progress', assignees: [{ id: USER_ID }] })];
    const r = run(setup({ list }));
    assert.equal(JSON.parse(r.stdout)[0].percentage, 0);
  });
});

describe('daily-slack-assemble — task_type from Tipo Proyecto', () => {
  test('resolves dropdown value by option id', () => {
    const list = [light({ id: 'a', assignees: [{ id: USER_ID }] })];
    const hydrated = [hydratedTask({ id: 'a', assignees: [{ id: USER_ID }], customFields: [tipoField('opt-issue', TIPO_OPTIONS)] })];
    const r = run(setup({ list, hydrated }));
    assert.equal(JSON.parse(r.stdout)[0].task_type, 'Issue Report');
  });

  test('resolves dropdown value by orderindex', () => {
    const list = [light({ id: 'a', assignees: [{ id: USER_ID }] })];
    const hydrated = [hydratedTask({ id: 'a', assignees: [{ id: USER_ID }], customFields: [tipoField(2, TIPO_OPTIONS)] })];
    const r = run(setup({ list, hydrated }));
    assert.equal(JSON.parse(r.stdout)[0].task_type, 'Roadmap');
  });

  test('assignee task with no hydrated entry → task_type null', () => {
    const list = [light({ id: 'a', assignees: [{ id: USER_ID }] })];
    const r = run(setup({ list }));
    assert.equal(JSON.parse(r.stdout)[0].task_type, null);
  });
});

describe('daily-slack-assemble — plugin merge', () => {
  test('plugin task ids are excluded from clickup-only and plugin tasks appended verbatim', () => {
    const list = [
      light({ id: 'plug', assignees: [{ id: USER_ID }] }),
      light({ id: 'gap', assignees: [{ id: USER_ID }] }),
    ];
    const pluginTasks = [{
      clickup_id: 'plug',
      name: 'Plugin task',
      url: 'https://app.clickup.com/t/plug',
      percentage: 100,
      status_type: 'closed',
      status_name: 'Closed',
      task_type: 'Issue',
      due_date: null,
      date_closed: 123,
      date_updated: null,
      source: 'plugin',
      slug: 'plugin-task',
      pr_urls: ['https://github.com/x/y/pull/1'],
    }];
    const r = run(setup({ list, pluginTasks }));
    const out = JSON.parse(r.stdout);
    const ids = out.map((t) => t.clickup_id).sort();
    assert.deepEqual(ids, ['gap', 'plug']);
    const plug = out.find((t) => t.clickup_id === 'plug');
    assert.equal(plug.source, 'plugin');
    assert.equal(plug.slug, 'plugin-task');
    assert.deepEqual(plug.pr_urls, ['https://github.com/x/y/pull/1']);
  });
});

describe('daily-slack-assemble — dedup and output shape', () => {
  test('duplicate ids in list are deduped (first wins)', () => {
    const list = [
      light({ id: 'a', assignees: [{ id: USER_ID }] }),
      light({ id: 'a', assignees: [{ id: USER_ID }] }),
    ];
    const r = run(setup({ list }));
    assert.equal(JSON.parse(r.stdout).length, 1);
  });

  test('emits exactly the documented current-task fields', () => {
    const list = [light({ id: 'a', name: 'My task', status: 'Closed', assignees: [{ id: USER_ID }], due_date: '1781514000000', date_closed: '1781618164226' })];
    const r = run(setup({ list }));
    const out = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(out[0]).sort(), [
      'clickup_id', 'date_closed', 'date_updated', 'due_date', 'name',
      'percentage', 'pr_urls', 'slug', 'source', 'status_name', 'status_type', 'task_type', 'url',
    ]);
    assert.equal(out[0].date_closed, 1781618164226);
  });
});

describe('daily-slack-assemble — --hydrated-dir gather', () => {
  function setupDir({ list, dumps }) {
    const dir = mkdtempSync(join(tmpdir(), 'daily-slack-assemble-'));
    const listPath = join(dir, 'list.json');
    writeFileSync(listPath, JSON.stringify(list));
    const dumpDir = mkdtempSync(join(tmpdir(), 'tool-results-'));
    let t = 1700000000;
    for (const d of dumps) {
      const p = join(dumpDir, d.file);
      writeFileSync(p, JSON.stringify(d.body));
      utimesSync(p, t, t);
      t += 100;
    }
    return { listPath, dumpDir };
  }

  function runDir({ listPath, dumpDir }) {
    return spawnSync('node', [
      SCRIPT,
      '--list', listPath,
      '--hydrated-dir', dumpDir,
      '--user-id', USER_ID,
      '--responsable-field-id', RESPONSABLE_ID,
      '--tipo-field-id', TIPO_ID,
    ], { encoding: 'utf8' });
  }

  test('gathers get_task dump files and resolves Responsable ownership', () => {
    const { listPath, dumpDir } = setupDir({
      list: [light({ id: 'a', assignees: [{ id: '999' }] })],
      dumps: [
        { file: 'mcp-clickup-clickup_get_task-1.txt', body: hydratedTask({ id: 'a', assignees: [{ id: '999' }], customFields: [responsableField([{ id: USER_ID }])] }) },
        { file: 'mcp-clickup-clickup_filter_tasks-1.txt', body: { tasks: [{ id: 'a' }], count: 1 } },
      ],
    });
    const r = runDir({ listPath, dumpDir });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.length, 1);
    assert.equal(out[0].clickup_id, 'a');
  });

  test('newest dump per id wins (by mtime)', () => {
    const { listPath, dumpDir } = setupDir({
      list: [light({ id: 'a', assignees: [{ id: '999' }] })],
      dumps: [
        { file: 'mcp-clickup-clickup_get_task-old.txt', body: hydratedTask({ id: 'a', assignees: [{ id: '999' }], customFields: [responsableField([{ id: '888' }])] }) },
        { file: 'mcp-clickup-clickup_get_task-new.txt', body: hydratedTask({ id: 'a', assignees: [{ id: '999' }], customFields: [responsableField([{ id: USER_ID }])] }) },
      ],
    });
    const out = JSON.parse(runDir({ listPath, dumpDir }).stdout);
    assert.equal(out.length, 1);
  });

  test('ignores dump files that are not task objects', () => {
    const { listPath, dumpDir } = setupDir({
      list: [light({ id: 'a', assignees: [{ id: USER_ID }] })],
      dumps: [
        { file: 'some-error.txt', body: { error: 'nope' } },
        { file: 'mcp-clickup-clickup_filter_tasks-1.txt', body: { tasks: [], count: 0 } },
      ],
    });
    const out = JSON.parse(runDir({ listPath, dumpDir }).stdout);
    assert.equal(out.length, 1);
    assert.equal(out[0].clickup_id, 'a');
  });
});

describe('daily-slack-assemble — IO and validation errors', () => {
  test('exits 2 when required arg missing', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /required arg\(s\) missing/);
  });

  test('exits 2 when --list is not a JSON array', () => {
    const paths = setup({ list: { not: 'array' } });
    const r = run(paths);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--list must contain a JSON array/);
  });
});
