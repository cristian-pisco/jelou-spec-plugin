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

function setup(data, closedLike) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-render-'));
  const dataPath = join(dir, 'data.json');
  writeFileSync(dataPath, JSON.stringify(data));
  if (closedLike === undefined) return dataPath;
  const closedPath = join(dir, 'closed-like.json');
  writeFileSync(closedPath, JSON.stringify(closedLike));
  return { dataPath, closedPath };
}

function run(dataPathOrObj) {
  if (typeof dataPathOrObj === 'string') {
    return spawnSync('node', [SCRIPT, '--data', dataPathOrObj], { encoding: 'utf8' });
  }
  const { dataPath, closedPath } = dataPathOrObj;
  return spawnSync(
    'node',
    [SCRIPT, '--data', dataPath, '--closed-like-statuses', closedPath],
    { encoding: 'utf8' }
  );
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
    assert.equal(
      out.achieved_goals,
      '- :clipboard: Tareas\n   * `[90%]` <https://app.clickup.com/t/abc|API node>'
    );
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

describe('daily-slack-render — short_term closed full-line strikethrough', () => {
  test('wraps entire line (date + link) in ~~ for closed tasks', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'Done task', url: 'u1', due_date: '2026-04-30T00:00:00Z', status_type: 'closed' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.short_term_goals, '~~`[2026-04-30]` <u1|Done task>~~');
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

  test('mixed open and closed render with per-task formatting', () => {
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
      '`[2026-04-30]` <u1|Open>\n~~`[2026-05-01]` <u2|Done>~~'
    );
  });
});

describe('daily-slack-render — short_term status_note for open tasks', () => {
  test('appends italicized status_note when present and task is open', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        {
          name: 'Probar bulk',
          url: 'u1',
          due_date: '2026-05-07T00:00:00Z',
          status_type: 'custom',
          status_name: 'pending to production',
          status_note: 'pendiente a producción · PR jelou-apps#5582 abierto',
        },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(
      out.short_term_goals,
      '`[2026-05-07]` <u1|Probar bulk> — _pendiente a producción · PR jelou-apps#5582 abierto_'
    );
  });

  test('omits the dash separator when status_note is empty or whitespace', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'A', url: 'u1', due_date: '2026-04-30T00:00:00Z', status_type: 'open', status_note: '' },
        { name: 'B', url: 'u2', due_date: '2026-05-01T00:00:00Z', status_type: 'open', status_note: '   ' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(
      out.short_term_goals,
      '`[2026-04-30]` <u1|A>\n`[2026-05-01]` <u2|B>'
    );
  });

  test('ignores status_note for closed-like items (strikethrough overrides)', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        {
          name: 'Done',
          url: 'u1',
          due_date: '2026-04-30T00:00:00Z',
          status_type: 'closed',
          status_note: 'irrelevant for closed',
        },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.short_term_goals, '~~`[2026-04-30]` <u1|Done>~~');
  });
});

describe('daily-slack-render — multi-task spacing', () => {
  test('groups multiple non-issue achieved tasks under the Tareas header', () => {
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
    assert.equal(
      out.achieved_goals,
      '- :clipboard: Tareas\n   * `[50%]` <u1|A>\n   * `[100%]` <u2|B>'
    );
  });
});

describe('daily-slack-render — achieved goal categorization', () => {
  test('groups Issue tasks under :ladybug: and other tasks under :clipboard:', () => {
    const data = {
      first_run: false,
      achieved: [
        { name: 'Bug fix', url: 'u1', percentage: 100, task_type: 'Issue' },
        { name: 'Feature', url: 'u2', percentage: 80, task_type: 'Improvement' },
        { name: 'Crash', url: 'u3', percentage: 100, task_type: 'Issue' },
        { name: 'Default-type task', url: 'u4', percentage: 50 },
      ],
      not_achieved: [],
      short_term: [],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(
      out.achieved_goals,
      [
        '- :ladybug: Issues',
        '   * `[100%]` <u1|Bug fix>',
        '   * `[100%]` <u3|Crash>',
        '- :clipboard: Tareas',
        '   * `[80%]` <u2|Feature>',
        '   * `[50%]` <u4|Default-type task>',
      ].join('\n')
    );
  });

  test('matches task_type case-insensitively for the Issue bucket', () => {
    const data = {
      first_run: false,
      achieved: [{ name: 'A', url: 'u1', percentage: 100, task_type: 'issue' }],
      not_achieved: [],
      short_term: [],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '- :ladybug: Issues\n   * `[100%]` <u1|A>');
  });

  test('omits Issues header when no Issue tasks are present', () => {
    const data = {
      first_run: false,
      achieved: [{ name: 'A', url: 'u1', percentage: 50, task_type: 'Task' }],
      not_achieved: [],
      short_term: [],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '- :clipboard: Tareas\n   * `[50%]` <u1|A>');
  });

  test('omits Tareas header when only Issues are present', () => {
    const data = {
      first_run: false,
      achieved: [{ name: 'A', url: 'u1', percentage: 100, task_type: 'Issue' }],
      not_achieved: [],
      short_term: [],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '- :ladybug: Issues\n   * `[100%]` <u1|A>');
  });
});

describe('daily-slack-render — meetings sub-bucket', () => {
  test('appends Meets section from multi-line meetings input', () => {
    const data = {
      first_run: false,
      achieved: [{ name: 'A', url: 'u1', percentage: 100, task_type: 'Issue' }],
      not_achieved: [],
      short_term: [],
      meetings: ':repeat: Daily\n:repeat: 1:1 con manager',
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(
      out.achieved_goals,
      [
        '- :ladybug: Issues',
        '   * `[100%]` <u1|A>',
        '- :calendar: Meets',
        '   * :repeat: Daily',
        '   * :repeat: 1:1 con manager',
      ].join('\n')
    );
  });

  test('renders only the Meets section when there are no achieved tasks', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [],
      meetings: ':repeat: Daily',
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '- :calendar: Meets\n   * :repeat: Daily');
  });

  test('trims blank lines and whitespace from meetings input', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [],
      meetings: '\n   :repeat: Daily   \n\n   :repeat: Planning\n',
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(
      out.achieved_goals,
      '- :calendar: Meets\n   * :repeat: Daily\n   * :repeat: Planning'
    );
  });

  test('omits Meets when meetings is empty, whitespace, or missing', () => {
    for (const meetings of ['', '   \n\n', undefined, null]) {
      const data = {
        first_run: false,
        achieved: [{ name: 'A', url: 'u1', percentage: 50 }],
        not_achieved: [],
        short_term: [],
        meetings,
      };
      const out = JSON.parse(run(setup(data)).stdout);
      assert.equal(out.achieved_goals, '- :clipboard: Tareas\n   * `[50%]` <u1|A>');
    }
  });

  test('first_run banner is suppressed when meetings provide content', () => {
    const data = {
      first_run: true,
      achieved: [],
      not_achieved: [],
      short_term: [],
      meetings: ':repeat: Daily',
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '- :calendar: Meets\n   * :repeat: Daily');
  });
});

describe('daily-slack-render — closed-like custom statuses (status_name)', () => {
  test('treats a status_name in --closed-like-statuses as closed (full-line strike), even when status_type is not "closed"', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'A', url: 'u1', due_date: '2026-04-30T00:00:00Z', status_type: 'custom', status_name: 'pending to production' },
        { name: 'B', url: 'u2', due_date: '2026-05-01T00:00:00Z', status_type: 'open', status_name: 'in progress' },
      ],
    };
    const out = JSON.parse(run(setup(data, ['pending to production', 'in review'])).stdout);
    assert.equal(
      out.short_term_goals,
      '~~`[2026-04-30]` <u1|A>~~\n`[2026-05-01]` <u2|B>'
    );
  });

  test('matches status_name case-insensitively', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'A', url: 'u1', due_date: '2026-04-30T00:00:00Z', status_type: 'custom', status_name: 'Pending To Production' },
      ],
    };
    const out = JSON.parse(run(setup(data, ['pending to production'])).stdout);
    assert.equal(out.short_term_goals, '~~`[2026-04-30]` <u1|A>~~');
  });

  test('still applies strikethrough when status_type is "closed" regardless of --closed-like-statuses', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'A', url: 'u1', due_date: '2026-04-30T00:00:00Z', status_type: 'closed', status_name: 'closed' },
      ],
    };
    const out = JSON.parse(run(setup(data, [])).stdout);
    assert.equal(out.short_term_goals, '~~`[2026-04-30]` <u1|A>~~');
  });

  test('absence of --closed-like-statuses preserves backwards-compatible behavior (only status_type=closed strikes)', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'A', url: 'u1', due_date: '2026-04-30T00:00:00Z', status_type: 'custom', status_name: 'pending to production' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.short_term_goals, '`[2026-04-30]` <u1|A>');
  });
});

describe('daily-slack-render — short_term epoch-ms due_date', () => {
  test('converts numeric epoch-ms string to ISO date', () => {
    // 1778490000000 ms = 2026-05-11T17:00:00.000Z → ISO date `2026-05-11`
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'A', url: 'u1', due_date: '1778490000000', status_type: 'open' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.short_term_goals, '`[2026-05-11]` <u1|A>');
  });

  test('accepts a raw number epoch-ms', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'A', url: 'u1', due_date: 1778490000000, status_type: 'open' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.short_term_goals, '`[2026-05-11]` <u1|A>');
  });

  test('still slices ISO strings (back-compat)', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'A', url: 'u1', due_date: '2026-04-30T00:00:00Z', status_type: 'open' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.short_term_goals, '`[2026-04-30]` <u1|A>');
  });
});

describe('daily-slack-render — tasks_by_status grouping', () => {
  test('groups all_tasks by status_name with title-cased headers', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [],
      all_tasks: [
        { name: 'A', url: 'u1', percentage: 60, status_type: 'custom', status_name: 'in progress' },
        { name: 'B', url: 'u2', percentage: 80, status_type: 'custom', status_name: 'internal qa' },
        { name: 'C', url: 'u3', percentage: 40, status_type: 'custom', status_name: 'in progress' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    // Internal QA group max=80, In Progress group max=60 → Internal QA first.
    // Within group: sort by percentage desc, then name asc.
    assert.equal(
      out.tasks_by_status,
      '**Internal QA**\n`[80%]` <u2|B>\n\n**In Progress**\n`[60%]` <u1|A>\n`[40%]` <u3|C>'
    );
  });

  test('sorts groups by descending max percentage and breaks ties alphabetically', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [],
      all_tasks: [
        { name: 'A', url: 'u1', percentage: 90, status_type: 'custom', status_name: 'pending to production' },
        { name: 'B', url: 'u2', percentage: 90, status_type: 'custom', status_name: 'awaiting review' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    // Both groups peak at 90 → alphabetical: Awaiting Review before Pending To Production.
    assert.equal(
      out.tasks_by_status,
      '**Awaiting Review**\n`[90%]` <u2|B>\n\n**Pending To Production**\n`[90%]` <u1|A>'
    );
  });

  test('includes closed tasks under Closed group at top when percentage is 100', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [],
      all_tasks: [
        { name: 'Done', url: 'u1', percentage: 100, status_type: 'closed', status_name: 'Closed' },
        { name: 'WIP', url: 'u2', percentage: 50, status_type: 'custom', status_name: 'in progress' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(
      out.tasks_by_status,
      '**Closed**\n`[100%]` <u1|Done>\n\n**In Progress**\n`[50%]` <u2|WIP>'
    );
  });

  test('skips tasks without a status_name', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [],
      all_tasks: [
        { name: 'A', url: 'u1', percentage: 60, status_type: 'custom', status_name: 'in progress' },
        { name: 'B', url: 'u2', percentage: 40, status_type: 'custom', status_name: null },
        { name: 'C', url: 'u3', percentage: 0, status_type: 'custom' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.tasks_by_status, '**In Progress**\n`[60%]` <u1|A>');
  });

  test('empty all_tasks renders empty string', () => {
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [], all_tasks: [] };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.tasks_by_status, '');
  });

  test('missing all_tasks key renders empty string (backwards-compat)', () => {
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [] };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.tasks_by_status, '');
  });

  test('case-insensitively merges status_name variants under one group', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [],
      all_tasks: [
        { name: 'A', url: 'u1', percentage: 80, status_type: 'custom', status_name: 'Internal QA' },
        { name: 'B', url: 'u2', percentage: 80, status_type: 'custom', status_name: 'internal qa' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    // Display label uses the first-seen original casing for the merged group.
    assert.equal(
      out.tasks_by_status,
      '**Internal QA**\n`[80%]` <u1|A>\n`[80%]` <u2|B>'
    );
  });
});

describe('daily-slack-render — tasks_by_status closed cap (--max-closed)', () => {
  function runWith(data, { closedLike, maxClosed } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'daily-slack-render-'));
    const dataPath = join(dir, 'data.json');
    writeFileSync(dataPath, JSON.stringify(data));
    const args = [SCRIPT, '--data', dataPath];
    if (closedLike !== undefined) {
      const closedPath = join(dir, 'closed-like.json');
      writeFileSync(closedPath, JSON.stringify(closedLike));
      args.push('--closed-like-statuses', closedPath);
    }
    if (maxClosed !== undefined) args.push('--max-closed', String(maxClosed));
    return spawnSync('node', args, { encoding: 'utf8' });
  }

  const closedTasks = (n) =>
    Array.from({ length: n }, (_, i) => ({
      name: `C${i}`,
      url: `u${i}`,
      percentage: 100,
      status_type: 'closed',
      status_name: 'Closed',
      date_closed: 1700000000000 + i * 86400000,
    }));

  test('caps the Closed group to the N most recent by date_closed (desc)', () => {
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [], all_tasks: closedTasks(5) };
    const out = JSON.parse(runWith(data, { maxClosed: 3 }).stdout);
    assert.equal(
      out.tasks_by_status,
      '**Closed**\n`[100%]` <u4|C4>\n`[100%]` <u3|C3>\n`[100%]` <u2|C2>'
    );
  });

  test('does not cap non-closed groups', () => {
    const tasks = ['O0', 'O1', 'O2', 'O3'].map((name, i) => ({
      name,
      url: `o${i}`,
      percentage: 0,
      status_type: 'open',
      status_name: 'open',
    }));
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [], all_tasks: tasks };
    const out = JSON.parse(runWith(data, { maxClosed: 3 }).stdout);
    assert.equal(
      out.tasks_by_status,
      '**Open**\n`[0%]` <o0|O0>\n`[0%]` <o1|O1>\n`[0%]` <o2|O2>\n`[0%]` <o3|O3>'
    );
  });

  test('absent --max-closed leaves the Closed group uncapped (back-compat)', () => {
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [], all_tasks: closedTasks(5) };
    const out = JSON.parse(runWith(data).stdout);
    const itemLines = out.tasks_by_status.split('\n').filter((l) => l.startsWith('`'));
    assert.equal(itemLines.length, 5);
  });

  test('caps closed-like custom-status groups too, most recent first', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [],
      all_tasks: [
        { name: 'P0', url: 'p0', percentage: 100, status_type: 'custom', status_name: 'pending to production', date_closed: 200 },
        { name: 'P1', url: 'p1', percentage: 100, status_type: 'custom', status_name: 'pending to production', date_closed: 300 },
        { name: 'P2', url: 'p2', percentage: 100, status_type: 'custom', status_name: 'pending to production', date_closed: 100 },
      ],
    };
    const out = JSON.parse(runWith(data, { closedLike: ['pending to production'], maxClosed: 2 }).stdout);
    assert.equal(
      out.tasks_by_status,
      '**Pending To Production**\n`[100%]` <p1|P1>\n`[100%]` <p0|P0>'
    );
  });

  test('sorts closed tasks with null date_closed last under the cap', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [],
      all_tasks: [
        { name: 'NoDate', url: 'u0', percentage: 100, status_type: 'closed', status_name: 'Closed', date_closed: null },
        { name: 'Older', url: 'u1', percentage: 100, status_type: 'closed', status_name: 'Closed', date_closed: 100 },
        { name: 'Newer', url: 'u2', percentage: 100, status_type: 'closed', status_name: 'Closed', date_closed: 200 },
      ],
    };
    const out = JSON.parse(runWith(data, { maxClosed: 2 }).stdout);
    assert.equal(
      out.tasks_by_status,
      '**Closed**\n`[100%]` <u2|Newer>\n`[100%]` <u1|Older>'
    );
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
