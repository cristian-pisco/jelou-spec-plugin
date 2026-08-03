import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';

import {
  LIFECYCLE_STATES,
  PHASE_STATUSES,
  SETUP_MODES,
  OBSERVED_TOKEN_CLASSES,
  isPlaceholder,
  normalizeDate,
  parseStatus,
  parseServices,
  parseSprint,
  parseTitle,
  parsePullRequests,
  parsePhases,
  parseSetupMode,
  parseLifecycle,
  parseExternalRefs,
} from '../../bin/lib/task-index/extract.mjs';
import { resolveSpecWorkspace } from '../../bin/lib/task-index/workspace.mjs';
import { scanWorkspace, filterTasks, listTaskLocations, deriveTask } from '../../bin/lib/task-index/scan.mjs';
import {
  computeWidths,
  truncate,
  renderTable,
  renderPageFooter,
  renderCard,
  paginate,
  runPager,
} from '../../bin/lib/task-index/render.mjs';
import { shouldRunInteractive, resolveIdentifier } from '../../bin/task-index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SCRIPT = join(REPO, 'bin', 'task-index.mjs');
const LIST_SCRIPT = join(REPO, 'bin', 'list-tasks.mjs');
const FIXTURE_WS = join(REPO, 'tests', 'fixtures', 'task-index', 'workspace');
const HARDENING_WS = join(REPO, 'tests', 'fixtures', 'task-index', 'hardening');

function cli(args, options = {}) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', input: '', ...options });
}

function fixtureTasks() {
  return scanWorkspace(FIXTURE_WS).tasks;
}

function findTask(slug, date) {
  return fixtureTasks().find((t) => t.slug === slug && (!date || t.date === date));
}

function issuesFor(task, field) {
  return task.derivation_issues.filter((i) => i.field === field);
}

function readFixture(relative) {
  return readFileSync(join(FIXTURE_WS, 'specs', relative), 'utf8');
}

function syntheticWorkspace(count) {
  const root = mkdtempSync(join(tmpdir(), 'task-index-'));
  const ws = join(root, '.spec-workspace');
  for (let i = 1; i <= count; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((i % 12) + 1).padStart(2, '0');
    const slug = `synthetic-${String(i).padStart(3, '0')}`;
    const dir = join(ws, 'specs', `${day}-${month}-2026`, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'TASKS.md'), `# Task: ${slug}\n\n## Status: planned\n\n## Lifecycle\n- Sprint: 70\n`);
    writeFileSync(join(dir, 'SPEC.md'), `# Synthetic task ${i}\n`);
  }
  mkdirSync(join(ws, 'specs'), { recursive: true });
  return { root, ws };
}

function fakeOut(columns = 80) {
  const chunks = [];
  const stream = {
    columns,
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    on() {
      return stream;
    },
    off() {
      return stream;
    },
    text() {
      return chunks.join('');
    },
    frames: chunks,
  };
  return stream;
}

function fakeKeys() {
  const stream = new PassThrough();
  stream.rawModeCalls = [];
  stream.setRawMode = (value) => {
    stream.rawModeCalls.push(value);
    return stream;
  };
  return stream;
}

function keySequence(keys, sequence) {
  let i = 0;
  const step = () => {
    if (i >= sequence.length) return;
    keys.write(sequence[i++]);
    setImmediate(step);
  };
  setImmediate(step);
}

describe('task-index — allowlists', () => {
  test('LIFECYCLE_STATES matches jelou/references/lifecycle-states.md', () => {
    const doc = readFileSync(join(REPO, 'jelou', 'references', 'lifecycle-states.md'), 'utf8');
    const machine = doc.match(/^draft ->.*$/m);
    assert.ok(machine, 'the state machine line must exist in the reference');
    const declared = machine[0].split('->').map((s) => s.trim());
    assert.deepEqual([...LIFECYCLE_STATES], declared);
    assert.equal(LIFECYCLE_STATES.length, 8);
  });

  test('phase statuses never include "failed"', () => {
    assert.deepEqual([...PHASE_STATUSES], ['pending', 'in_progress', 'done', 'blocked']);
    assert.ok(!PHASE_STATUSES.includes('failed'));
  });

  test('observed token classes are the closed set of five', () => {
    assert.deepEqual([...OBSERVED_TOKEN_CLASSES], [
      'absent',
      'placeholder',
      'out_of_allowlist',
      'unparseable_date',
      'freeform_heading',
    ]);
  });
});

describe('task-index — normalizeDate', () => {
  test('DD-MM-YYYY becomes YYYY-MM-DD', () => {
    assert.equal(normalizeDate('30-06-2026'), '2026-06-30');
    assert.equal(normalizeDate('01-12-2025'), '2025-12-01');
  });

  test('already-ISO input is returned unchanged', () => {
    assert.equal(normalizeDate('2026-06-30'), '2026-06-30');
  });

  test('malformed input returns null', () => {
    assert.equal(normalizeDate('not-a-date'), null);
    assert.equal(normalizeDate(''), null);
    assert.equal(normalizeDate(undefined), null);
  });

  test('mixed DD-MM-YYYY dates sort correctly once normalized', () => {
    const raw = ['31-03-2026', '30-06-2026', '01-12-2025'];
    const iso = raw.map(normalizeDate).sort();
    assert.deepEqual(iso, ['2025-12-01', '2026-03-31', '2026-06-30']);
  });
});

describe('task-index — isPlaceholder', () => {
  test('parenthesised, em-dash, TBD and n/a are placeholders', () => {
    assert.ok(isPlaceholder('(not synced)'));
    assert.ok(isPlaceholder('(pending)'));
    assert.ok(isPlaceholder('—'));
    assert.ok(isPlaceholder('TBD'));
    assert.ok(isPlaceholder('tbd'));
    assert.ok(isPlaceholder('n/a'));
    assert.ok(isPlaceholder('N/A'));
  });

  test('real values are not placeholders', () => {
    assert.ok(!isPlaceholder('worktree'));
    assert.ok(!isPlaceholder('86c1abcde'));
    assert.ok(!isPlaceholder('diseño-service'));
  });
});

describe('task-index — parseStatus', () => {
  test('inline "## Status:" inside the allowlist is confident', () => {
    const r = parseStatus('# t\n\n## Status: implementing\n');
    assert.equal(r.value, 'implementing');
    assert.equal(r.confidence, 1);
    assert.deepEqual(r.issues, []);
  });

  test('the "- **Lifecycle**:" variant is the alternative grammar', () => {
    const r = parseStatus('## Status\n- **Lifecycle**: refining\n');
    assert.equal(r.value, 'refining');
    assert.equal(r.confidence, 1);
  });

  test('a value outside the allowlist becomes unknown with confidence 0', () => {
    const r = parseStatus('## Status: frobnicated\n');
    assert.equal(r.value, 'unknown');
    assert.equal(r.confidence, 0);
    assert.equal(r.issues[0].field, 'task.status');
    assert.equal(r.issues[0].observed_token_class, 'out_of_allowlist');
  });

  test('an absent status becomes unknown with an absent issue', () => {
    const r = parseStatus('# Task: bare\n');
    assert.equal(r.value, 'unknown');
    assert.equal(r.confidence, 0);
    assert.equal(r.issues[0].observed_token_class, 'absent');
  });

  test('a placeholder status becomes unknown with a placeholder issue', () => {
    const r = parseStatus('## Status: (pending)\n');
    assert.equal(r.value, 'unknown');
    assert.equal(r.confidence, 0);
    assert.equal(r.issues[0].observed_token_class, 'placeholder');
  });

  test('every one of the eight official states is accepted', () => {
    for (const state of LIFECYCLE_STATES) {
      const r = parseStatus(`## Status: ${state}\n`);
      assert.equal(r.value, state, state);
      assert.equal(r.confidence, 1, state);
    }
  });
});

describe('task-index — parseSetupMode', () => {
  test('"- Mode:" inside ## Branching is confident', () => {
    const r = parseSetupMode('## Branching\n- Mode: worktree\n');
    assert.equal(r.value, 'worktree');
    assert.equal(r.confidence, 1);
  });

  test('the bold marker variant is accepted', () => {
    const r = parseSetupMode('## Branching\n- **Mode**: branch\n');
    assert.equal(r.value, 'branch');
  });

  test('a placeholder mode is null with a placeholder issue', () => {
    const r = parseSetupMode('## Branching\n- Mode: —\n');
    assert.equal(r.value, null);
    assert.equal(r.confidence, 0);
    assert.equal(r.issues[0].field, 'task.setup_mode');
    assert.equal(r.issues[0].observed_token_class, 'placeholder');
  });

  test('a parenthesised mode is a placeholder, not a value', () => {
    const r = parseSetupMode('## Branching\n- Mode: (pending — chosen after spec approval)\n');
    assert.equal(r.value, null);
    assert.equal(r.issues[0].observed_token_class, 'placeholder');
  });

  test('an absent ## Branching section is null with an absent issue', () => {
    const r = parseSetupMode('## Status: planned\n');
    assert.equal(r.value, null);
    assert.equal(r.confidence, 0);
    assert.equal(r.issues[0].observed_token_class, 'absent');
  });

  test('a "- Mode:" outside ## Branching is not read', () => {
    const r = parseSetupMode('## Phases\n- Mode: worktree\n');
    assert.equal(r.value, null);
  });

  test('a branching mode with a trailing annotation still derives the mode', () => {
    assert.equal(parseSetupMode('## Branching\n- Mode: branch (in-place)\n').value, 'branch');
    assert.equal(parseSetupMode('## Branching\n- Mode: branch (greenfield repo, no remote yet)\n').value, 'branch');
    const changed = parseSetupMode('## Branching\n- Mode: worktree   (changed from branch on 2026-06-26)\n');
    assert.equal(changed.value, 'worktree');
    assert.equal(changed.confidence, 1);
    assert.deepEqual(changed.issues, []);
  });

  test('only branch and worktree are setup modes', () => {
    assert.deepEqual([...SETUP_MODES], ['branch', 'worktree']);
    const r = parseSetupMode('## Branching\n- Mode: horizontal (5 FR/NFR, 1 service)\n');
    assert.equal(r.value, null);
    assert.equal(r.issues[0].observed_token_class, 'out_of_allowlist');
  });

  test('a TDD strategy under ## Phases never reaches setup_mode when ## Branching has the real mode', () => {
    const text = [
      '## Branching',
      '- Mode: worktree',
      '',
      '## Phases',
      '- Mode: horizontal',
      '',
      '### Phase 01: X',
      '- Status: done',
      '',
    ].join('\n');
    const r = parseSetupMode(text);
    assert.equal(r.value, 'worktree');
    assert.deepEqual(r.issues, []);
  });

  test('section order does not matter — Phases before Branching gives the same answer', () => {
    const text = [
      '## Phases',
      '- Mode: horizontal',
      '',
      '### Phase 01: X',
      '- Status: done',
      '',
      '## Branching',
      '- Mode: worktree',
      '',
    ].join('\n');
    assert.equal(parseSetupMode(text).value, 'worktree');
  });

  test('a TDD strategy under ## Phases with no ## Branching section is null, never the strategy', () => {
    const r = parseSetupMode('## Phases\n- Mode: horizontal\n\n### Phase 01: X\n- Status: done\n');
    assert.equal(r.value, null);
    assert.equal(r.confidence, 0);
    assert.equal(r.issues[0].field, 'task.setup_mode');
    assert.equal(r.issues[0].observed_token_class, 'absent');
  });

  test('an annotated TDD strategy under ## Phases with no ## Branching stays ignored', () => {
    const r = parseSetupMode('## Phases\n- Mode: horizontal (5 FR/NFR, 1 service)\n');
    assert.equal(r.value, null);
    assert.equal(r.issues[0].observed_token_class, 'absent');
  });

  test('every TDD strategy observed in the corpus is rejected as a setup mode', () => {
    for (const strategy of ['horizontal', 'vertical', 'trivial', 'mechanical', 'inline', 'docs']) {
      assert.equal(parseSetupMode(`## Phases\n- Mode: ${strategy}\n`).value, null, strategy);
      assert.equal(parseSetupMode(`## Branching\n- Mode: ${strategy}\n`).value, null, strategy);
    }
  });
});

describe('task-index — parseTitle', () => {
  test('the first H1 of SPEC.md wins', () => {
    const r = parseTitle('# Añadir la puerta de autenticación\n\n# Second\n', 'slug');
    assert.equal(r.value, 'Añadir la puerta de autenticación');
    assert.equal(r.confidence, 1);
    assert.deepEqual(r.issues, []);
  });

  test('no SPEC.md falls back to the slug with confidence 0 and an issue', () => {
    const r = parseTitle(null, 'my-slug');
    assert.equal(r.value, 'my-slug');
    assert.equal(r.confidence, 0);
    assert.equal(r.issues[0].field, 'task.title');
    assert.equal(r.issues[0].observed_token_class, 'absent');
  });

  test('a SPEC.md without an H1 falls back to the slug with an issue', () => {
    const r = parseTitle('## Summary\n\nNo top-level heading here.\n', 'my-slug');
    assert.equal(r.value, 'my-slug');
    assert.equal(r.confidence, 0);
    assert.equal(r.issues.length, 1);
  });
});

describe('task-index — parseSprint', () => {
  test('reads the sprint marker', () => {
    assert.equal(parseSprint('## Lifecycle\n- Sprint: 65\n').value, '65');
    assert.equal(parseSprint('- **Sprint**: 3\n').value, '3');
  });

  test('a placeholder sprint is rejected', () => {
    const r = parseSprint('- Sprint: TBD\n');
    assert.equal(r.value, null);
    assert.equal(r.confidence, 0);
    assert.equal(r.issues[0].observed_token_class, 'placeholder');
  });

  test('an absent sprint is null without an issue', () => {
    const r = parseSprint('# nothing\n');
    assert.equal(r.value, null);
    assert.deepEqual(r.issues, []);
  });
});

describe('task-index — parseServices', () => {
  test('primary and affected carry their roles', () => {
    const r = parseServices('## Services\n- Primary: auth-service\n- Affected: reporting-service, gateway\n');
    assert.deepEqual(r.value, [
      { id: 'auth-service', role: 'primary' },
      { id: 'reporting-service', role: 'affected' },
      { id: 'gateway', role: 'affected' },
    ]);
    assert.deepEqual(r.ids, ['auth-service', 'reporting-service', 'gateway']);
  });

  test('a placeholder affected list yields only the primary and one issue', () => {
    const r = parseServices('## Services\n- Primary: auth-service\n- Affected: (pending)\n');
    assert.deepEqual(r.ids, ['auth-service']);
    assert.equal(r.issues[0].field, 'task_service');
    assert.equal(r.issues[0].observed_token_class, 'placeholder');
  });

  test('frontmatter affected_services are affected-role services', () => {
    const text = '---\naffected_services:\n  - id: billing-service\n    sub_state: planned\n  - id: postgres-adapter\n---\n\n# t\n';
    const r = parseServices(text);
    assert.deepEqual(r.ids, ['billing-service', 'postgres-adapter']);
    assert.ok(r.value.every((e) => e.role === 'affected'));
  });

  test('the template Service ID table is a source of affected services', () => {
    const text = '## Affected Services\n\n| Service ID | Sub-State | Branch |\n|-----------|-----------|--------|\n| memory-engine | done | spec/x |\n| memory-proxy | implementing | spec/x |\n';
    const r = parseServices(text);
    assert.deepEqual(r.ids, ['memory-engine', 'memory-proxy']);
  });

  test('a service listed as both primary and affected keeps the primary role only, with no defect', () => {
    const r = parseServices('## Services\n- Primary: design-service\n- Affected: design-service, morning-server\n');
    assert.deepEqual(r.value, [
      { id: 'design-service', role: 'primary' },
      { id: 'morning-server', role: 'affected' },
    ]);
    assert.deepEqual(r.ids, ['design-service', 'morning-server']);
    assert.deepEqual(r.issues, []);
  });

  test('no service ever appears twice, whatever the source', () => {
    const text = [
      '---',
      'affected_services:',
      '  - id: alpha',
      '  - id: beta',
      '---',
      '## Services',
      '- Primary: alpha',
      '- Affected: alpha, beta',
      '',
      '| Service ID | Sub-State | Branch |',
      '|-----------|-----------|--------|',
      '| alpha | done | x |',
      '| beta | done | x |',
      '',
    ].join('\n');
    const r = parseServices(text);
    assert.deepEqual(r.ids, ['alpha', 'beta']);
    assert.equal(new Set(r.ids).size, r.ids.length);
    assert.deepEqual(r.value.map((e) => e.role), ['primary', 'affected']);
  });

  test('no services at all is empty without an issue', () => {
    const r = parseServices('# t\n');
    assert.deepEqual(r.ids, []);
    assert.deepEqual(r.issues, []);
  });
});

describe('task-index — parsePullRequests', () => {
  test('parses owner, repository and number from GitHub PR URLs', () => {
    const r = parsePullRequests('- PR (a): https://github.com/ExampleOrg/design-service/pull/227\n');
    assert.deepEqual(r.value, [
      {
        url: 'https://github.com/ExampleOrg/design-service/pull/227',
        owner: 'ExampleOrg',
        repository: 'design-service',
        number: 227,
      },
    ]);
  });

  test('the same URL twice is one pull request', () => {
    const text = '- a: https://github.com/O/r/pull/1\n- b: https://github.com/O/r/pull/1\n';
    assert.equal(parsePullRequests(text).value.length, 1);
  });

  test('no PR URLs is an empty list', () => {
    assert.deepEqual(parsePullRequests('# t\n').value, []);
  });
});

describe('task-index — parseExternalRefs', () => {
  test('a real ClickUp id is captured with its URL', () => {
    const r = parseExternalRefs('- ClickUp: 86c1abcde\n');
    assert.equal(r.value.length, 1);
    assert.equal(r.value[0].system, 'clickup');
    assert.equal(r.value[0].ref_id, '86c1abcde');
    assert.equal(r.value[0].confidence, 1);
  });

  test('a ClickUp URL yields the task id', () => {
    const r = parseExternalRefs('- ClickUp: https://app.clickup.com/t/86c1abcde\n');
    assert.equal(r.value[0].ref_id, '86c1abcde');
    assert.equal(r.value[0].url, 'https://app.clickup.com/t/86c1abcde');
  });

  test('"ClickUp: (not synced)" is a placeholder, never a value', () => {
    const r = parseExternalRefs('- ClickUp: (not synced)\n');
    assert.deepEqual(r.value, []);
    assert.equal(r.issues[0].field, 'external_ref.clickup');
    assert.equal(r.issues[0].observed_token_class, 'placeholder');
  });

  test('GitHub PR URLs are never external refs', () => {
    const r = parseExternalRefs('- PR: https://github.com/ExampleOrg/repo/pull/7\n');
    assert.deepEqual(r.value, []);
  });

  test('an absent ClickUp reference is an absent issue', () => {
    const r = parseExternalRefs('# t\n');
    assert.deepEqual(r.value, []);
    assert.equal(r.issues[0].observed_token_class, 'absent');
  });
});

describe('task-index — parseLifecycle', () => {
  test('the five markers inside ## Lifecycle become transitions', () => {
    const text = [
      '## Lifecycle',
      '- Created: 2026-03-31T12:00:00-05:00',
      '- Planned: 2026-03-31T12:30:00-05:00',
      '- Implementing: 2026-03-31T17:00:00-05:00',
      '- Ready to publish: 2026-04-03T11:13:00-05:00',
      '- Closed: 2026-04-04T10:00:00Z',
      '',
    ].join('\n');
    const r = parseLifecycle(text);
    assert.deepEqual(r.value.map((t) => t.state), [
      'draft',
      'planned',
      'implementing',
      'ready_to_publish',
      'closed',
    ]);
    assert.ok(r.value.every((t) => t.confidence === 1));
    assert.equal(r.value[0].occurred_at, '2026-03-31T17:00:00.000Z');
  });

  test('a zone-less timestamp is read as UTC so the result is machine independent', () => {
    const r = parseLifecycle('## Lifecycle\n- Created: 2026-03-18T00:30:00\n');
    assert.equal(r.value[0].occurred_at, '2026-03-18T00:30:00.000Z');
  });

  test('a date-only timestamp normalises to midnight UTC', () => {
    const r = parseLifecycle('## Lifecycle\n- Planned: 2026-03-31\n');
    assert.equal(r.value[0].occurred_at, '2026-03-31T00:00:00.000Z');
  });

  test('an unparseable date keeps the transition at confidence 0.5 with an issue', () => {
    const r = parseLifecycle('## Lifecycle\n- Created: not-a-date\n');
    assert.equal(r.value[0].occurred_at, null);
    assert.equal(r.value[0].confidence, 0.5);
    assert.equal(r.issues[0].observed_token_class, 'unparseable_date');
  });

  test('markers outside ## Lifecycle are ignored', () => {
    const r = parseLifecycle('## Phases\n- Created: 2026-01-01\n');
    assert.deepEqual(r.value, []);
  });

  test('an absent ## Lifecycle section yields no transitions and no issue', () => {
    const r = parseLifecycle('# t\n');
    assert.deepEqual(r.value, []);
    assert.deepEqual(r.issues, []);
  });
});

describe('task-index — parsePhases (canonical table grammar)', () => {
  const table = [
    '## Phase Progress',
    '',
    '| # | Phase Name | Status | Started | Completed |',
    '|---|-----------|--------|---------|-----------|',
    '| 1 | Endpoint Implementation | done | 2026-03-18T00:30:00Z | 2026-03-18T00:45:00Z |',
    '| 2 | Proxy + Controller | blocked | 2026-03-18T00:45:00Z | — |',
    '| 3 | Tests + Cleanup | pending | — | — |',
    '',
    '## Per-Service Progress',
    '',
    '| Phase | Status | Tests | Notes |',
    '|-------|--------|-------|-------|',
    '| 1 | done | 10/10 | — |',
    '',
  ].join('\n');

  test('the canonical table is recognised and blocked is a valid status', () => {
    const r = parsePhases(table);
    assert.equal(r.grammar, 'table');
    assert.equal(r.value.length, 3);
    assert.deepEqual(r.value.map((p) => p.status), ['done', 'blocked', 'pending']);
    assert.ok(r.value.every((p) => p.classification === 'canonical'));
    assert.ok(r.value.every((p) => p.confidence === 1));
  });

  test('ordinal, phase_number and heading come from the row', () => {
    const [first, , third] = parsePhases(table).value;
    assert.deepEqual(
      { ordinal: first.ordinal, phase_number: first.phase_number, heading: first.heading },
      { ordinal: 1, phase_number: 1, heading: 'Endpoint Implementation' },
    );
    assert.equal(third.ordinal, 3);
  });

  test('the Per-Service Progress table is not read as phases', () => {
    assert.equal(parsePhases(table).value.length, 3);
  });

  test('"failed" in a canonical row is never accepted as a status', () => {
    const bad = table.replace('| done |', '| failed |');
    const r = parsePhases(bad);
    assert.equal(r.value[0].status, null);
    const issue = r.issues.find((i) => i.field === 'phase.status');
    assert.equal(issue.observed_token_class, 'out_of_allowlist');
  });

  test('the columns are located by header name, not by position', () => {
    const variant = [
      '## Phase Progress',
      '',
      '| NN | Phase | Service | Status | Commit |',
      '|----|-------|---------|--------|--------|',
      '| 01 | MCP capability preservation | harness | done | f39722a |',
      '| 02 | Widget-resource proxy endpoint | harness | blocked | bfe1c59 |',
      '',
    ].join('\n');
    const r = parsePhases(variant);
    assert.equal(r.grammar, 'table');
    assert.deepEqual(r.value.map((p) => [p.phase_number, p.heading, p.status]), [
      [1, 'MCP capability preservation', 'done'],
      [2, 'Widget-resource proxy endpoint', 'blocked'],
    ]);
  });

  test('a Phase Progress section without a Status column is not a table', () => {
    const r = parsePhases('## Phase Progress\n\n| # | Phase Name |\n|---|---|\n| 1 | X |\n');
    assert.equal(r.grammar, null);
  });

  test('an em-dash status cell is a placeholder, not a status', () => {
    const bad = table.replace('| pending |', '| — |');
    const r = parsePhases(bad);
    assert.equal(r.value[2].status, null);
    assert.ok(r.issues.some((i) => i.observed_token_class === 'placeholder'));
  });
});

describe('task-index — parsePhases (header grammar)', () => {
  const headers = [
    '## Phases',
    '',
    '### Phase 01: Añadir tipos de acción',
    '- Status: done',
    '- Service: design-service',
    '',
    '### Phase 02: Integración',
    '- Status: in_progress',
    '',
    '### Extensión 1 — reproducción del problema',
    '- Notes: freeform',
    '',
    '### Phase 03: Regresión',
    '',
    '## Testing',
    '',
    '### Integration Tests',
    '- all green',
    '',
  ].join('\n');

  test('### Phase N headers are canonical phases with accented headings preserved', () => {
    const r = parsePhases(headers);
    assert.equal(r.grammar, 'headers');
    assert.equal(r.value[0].heading, 'Añadir tipos de acción');
    assert.equal(r.value[0].phase_number, 1);
    assert.equal(r.value[0].status, 'done');
    assert.equal(r.value[0].confidence, 1);
    assert.equal(r.value[1].status, 'in_progress');
  });

  test('any other ### under ## Phases is freeform at confidence 0.3', () => {
    const r = parsePhases(headers);
    const freeform = r.value.find((p) => p.classification === 'freeform');
    assert.equal(freeform.heading, 'Extensión 1 — reproducción del problema');
    assert.equal(freeform.confidence, 0.3);
    assert.equal(freeform.status, null);
    assert.equal(freeform.phase_number, null);
    assert.ok(r.issues.some((i) => i.observed_token_class === 'freeform_heading'));
  });

  test('### headings outside ## Phases are not phases', () => {
    const r = parsePhases(headers);
    assert.ok(!r.value.some((p) => p.heading === 'Integration Tests'));
  });

  test('a phase header with no status line has a null status and an absent issue', () => {
    const r = parsePhases(headers);
    const last = r.value.find((p) => p.phase_number === 3);
    assert.equal(last.status, null);
    assert.ok(r.issues.some((i) => i.field === 'phase.status' && i.observed_token_class === 'absent'));
  });

  test('a status line carrying trailing prose is out of the allowlist', () => {
    const r = parsePhases('## Phases\n\n### Phase 01: X\n- Status: done (v2 — 2026-06-28)\n');
    assert.equal(r.value[0].status, null);
    assert.ok(r.issues.some((i) => i.observed_token_class === 'out_of_allowlist'));
  });

  test('ordinals are contiguous regardless of the phase numbers written', () => {
    const r = parsePhases(headers);
    assert.deepEqual(r.value.map((p) => p.ordinal), [1, 2, 3, 4]);
  });

  test('no phases section at all is an empty list without issues', () => {
    const r = parsePhases('# t\n\n## Status: planned\n');
    assert.deepEqual(r.value, []);
    assert.deepEqual(r.issues, []);
    assert.equal(r.grammar, null);
  });
});

describe('task-index — derivation issues never copy file text', () => {
  test('every issue carries only field, token class and expected grammar', () => {
    for (const task of fixtureTasks()) {
      for (const issue of task.derivation_issues) {
        assert.deepEqual(Object.keys(issue).sort(), ['expected_grammar', 'field', 'observed_token_class']);
        assert.ok(OBSERVED_TOKEN_CLASSES.includes(issue.observed_token_class), issue.observed_token_class);
        assert.equal(typeof issue.field, 'string');
        assert.ok(issue.field.length > 0);
      }
    }
  });

  test('the ClickUp placeholder issue does not contain the offending line', () => {
    const task = findTask('header-phases-accented');
    const source = readFixture('31-03-2026/header-phases-accented/TASKS.md');
    assert.ok(source.includes('ClickUp: (not synced)'));
    const issue = issuesFor(task, 'external_ref.clickup')[0];
    assert.equal(issue.observed_token_class, 'placeholder');
    assert.ok(!issue.expected_grammar.includes('not synced'));
    assert.equal(JSON.stringify(issue).includes('not synced'), false);
  });
});

describe('task-index — resolveSpecWorkspace', () => {
  test('reads the workspace path from a .spec-workspace.json pointer', () => {
    const { root, ws } = syntheticWorkspace(1);
    const project = mkdtempSync(join(tmpdir(), 'task-index-proj-'));
    writeFileSync(join(project, '.spec-workspace.json'), JSON.stringify({ workspace: ws }));
    assert.equal(resolveSpecWorkspace(project), ws);
    rmSync(root, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  test('walks up to find a .spec-workspace/ directory containing specs/', () => {
    const { root, ws } = syntheticWorkspace(1);
    const nested = join(dirname(ws), 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    assert.equal(resolveSpecWorkspace(nested), ws);
    rmSync(root, { recursive: true, force: true });
  });

  test('returns null when no workspace exists', () => {
    const lonely = mkdtempSync(join(tmpdir(), 'task-index-none-'));
    assert.equal(resolveSpecWorkspace(lonely), null);
    rmSync(lonely, { recursive: true, force: true });
  });

  test('a malformed pointer falls through to directory probing', () => {
    const { root, ws } = syntheticWorkspace(1);
    writeFileSync(join(dirname(ws), '.spec-workspace.json'), 'not json at all');
    assert.equal(resolveSpecWorkspace(dirname(ws)), ws);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('task-index — scanWorkspace', () => {
  test('finds every fixture task and orders them date DESC, slug ASC by ISO date', () => {
    const keys = fixtureTasks().map((t) => t.task_key);
    assert.deepEqual(keys, [
      '2026-07-12/shared-slug',
      '2026-06-30/freeform-phases',
      '2026-06-30/no-h1-spec',
      '2026-06-02/invented-status',
      '2026-05-11/shared-slug',
      '2026-05-04/state-closed',
      '2026-05-04/state-done',
      '2026-05-04/state-draft',
      '2026-05-04/state-implementing',
      '2026-05-04/state-planned',
      '2026-05-04/state-ready-to-publish',
      '2026-05-04/state-refining',
      '2026-05-04/state-validating',
      '2026-03-31/header-phases-accented',
      '2026-03-16/canonical-table-blocked',
      '2025-12-01/lifecycle-variant',
      '2025-11-01/branching-and-phases-modes',
    ]);
  });

  test('the dual-Mode fixture takes its setup mode from ## Branching, not from ## Phases', () => {
    const task = findTask('branching-and-phases-modes');
    assert.equal(task.setup_mode, 'worktree');
    assert.equal(task.setup_mode_confidence, 1);
    assert.deepEqual(issuesFor(task, 'task.setup_mode'), []);
    assert.deepEqual(task.services, [
      { id: 'pricing-service', role: 'primary' },
      { id: 'ledger-service', role: 'affected' },
    ]);
    assert.deepEqual(issuesFor(task, 'task_service'), []);
    assert.deepEqual(task.phases.map((p) => p.status), ['done', 'in_progress']);
  });

  test('the on-disk DD-MM-YYYY date is preserved alongside the ISO date', () => {
    const task = findTask('lifecycle-variant');
    assert.equal(task.date, '2025-12-01');
    assert.equal(task.date_on_disk, '01-12-2025');
    assert.equal(task.root_path, join('specs', '01-12-2025', 'lifecycle-variant'));
  });

  test('the canonical-table fixture derives the table grammar end to end', () => {
    const task = findTask('canonical-table-blocked');
    assert.equal(task.status, 'implementing');
    assert.equal(task.setup_mode, 'worktree');
    assert.equal(task.sprint, '58');
    assert.equal(task.title, 'User memory endpoints: get, find, set');
    assert.equal(task.title_confidence, 1);
    assert.deepEqual(task.phases.map((p) => p.status), ['done', 'done', 'blocked', 'pending']);
    assert.deepEqual(task.service_ids, ['memory-engine', 'memory-proxy']);
    assert.deepEqual(task.external_refs.map((r) => r.ref_id), ['86c1abcde']);
    assert.equal(task.pull_requests.length, 2);
  });

  test('the header-grammar fixture keeps accents and never repeats a service', () => {
    const task = findTask('header-phases-accented');
    assert.equal(task.title, 'Creación de habilidades vía diseño conversacional');
    assert.equal(task.phases[0].heading, 'Añadir tipos de acción y esqueleto');
    assert.deepEqual(task.service_ids, ['diseño-service', 'mañana-server']);
    assert.deepEqual(task.services, [
      { id: 'diseño-service', role: 'primary' },
      { id: 'mañana-server', role: 'affected' },
    ]);
    assert.deepEqual(issuesFor(task, 'task_service'), []);
    assert.equal(task.pull_requests.length, 2);
  });

  test('the "- **Lifecycle**:" fixture derives status, sprint and services', () => {
    const task = findTask('lifecycle-variant');
    assert.equal(task.status, 'refining');
    assert.equal(task.sprint, '3');
    assert.deepEqual(task.service_ids, ['billing-service', 'postgres-adapter']);
    assert.equal(task.setup_mode, null);
    assert.equal(task.setup_mode_confidence, 0);
  });

  test('each of the eight lifecycle states is derived at confidence 1', () => {
    for (const state of LIFECYCLE_STATES) {
      const slug = `state-${state.replace(/_/g, '-')}`;
      const task = findTask(slug);
      assert.ok(task, slug);
      assert.equal(task.status, state, slug);
      assert.equal(task.status_confidence, 1, slug);
    }
  });

  test('an invented state lands on unknown with an out_of_allowlist issue', () => {
    const task = findTask('invented-status');
    assert.equal(task.status, 'unknown');
    assert.equal(task.status_confidence, 0);
    assert.equal(issuesFor(task, 'task.status')[0].observed_token_class, 'out_of_allowlist');
  });

  test('a task with no SPEC.md falls back to the slug and has no spec provenance', () => {
    const task = findTask('freeform-phases');
    assert.equal(task.title, 'freeform-phases');
    assert.equal(task.title_confidence, 0);
    assert.equal(task.sources.spec, null);
    assert.equal(issuesFor(task, 'task.title')[0].observed_token_class, 'absent');
  });

  test('a SPEC.md with no H1 falls back to the slug but keeps its provenance', () => {
    const task = findTask('no-h1-spec');
    assert.equal(task.title, 'no-h1-spec');
    assert.equal(task.title_confidence, 0);
    assert.equal(task.sources.spec.path, join('specs', '30-06-2026', 'no-h1-spec', 'SPEC.md'));
    assert.equal(issuesFor(task, 'task.title').length, 1);
  });

  test('provenance carries the relative path and the sha256 of each source file', () => {
    const task = findTask('canonical-table-blocked');
    const raw = readFixture('16-03-2026/canonical-table-blocked/TASKS.md');
    assert.equal(task.sources.tasks.path, join('specs', '16-03-2026', 'canonical-table-blocked', 'TASKS.md'));
    assert.equal(task.sources.tasks.sha256, createHash('sha256').update(raw).digest('hex'));
  });

  test('the freeform fixture records the freeform heading and both placeholders', () => {
    const task = findTask('freeform-phases');
    assert.equal(task.phases.filter((p) => p.classification === 'freeform').length, 1);
    assert.equal(task.setup_mode, null);
    assert.equal(issuesFor(task, 'task.setup_mode')[0].observed_token_class, 'placeholder');
    assert.equal(issuesFor(task, 'task_service')[0].observed_token_class, 'placeholder');
  });

  test('a directory without TASKS.md is not a task', () => {
    const { root, ws } = syntheticWorkspace(2);
    mkdirSync(join(ws, 'specs', '01-02-2026', 'just-a-folder'), { recursive: true });
    writeFileSync(join(ws, 'specs', '01-02-2026', 'just-a-folder', 'SPEC.md'), '# Stray\n');
    assert.ok(!scanWorkspace(ws).tasks.some((t) => t.slug === 'just-a-folder'));
    rmSync(root, { recursive: true, force: true });
  });

  test('a missing specs/ directory yields no tasks instead of throwing', () => {
    const lonely = mkdtempSync(join(tmpdir(), 'task-index-bare-'));
    assert.deepEqual(scanWorkspace(lonely).tasks, []);
    rmSync(lonely, { recursive: true, force: true });
  });
});

describe('task-index — filterTasks', () => {
  const all = () => fixtureTasks();

  test('--status keeps only matching tasks', () => {
    const rows = filterTasks(all(), { status: 'closed' });
    assert.deepEqual(rows.map((t) => t.task_key), ['2026-05-11/shared-slug', '2026-05-04/state-closed']);
  });

  test('--sprint matches the derived sprint', () => {
    const rows = filterTasks(all(), { sprint: '65' });
    assert.deepEqual(rows.map((t) => t.slug), ['freeform-phases', 'no-h1-spec', 'header-phases-accented']);
  });

  test('--service returns a task once even when the service is primary and affected', () => {
    const rows = filterTasks(all(), { service: 'diseño-service' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].slug, 'header-phases-accented');
  });

  test('--service matches an affected-only service', () => {
    const rows = filterTasks(all(), { service: 'reporting-service' });
    assert.deepEqual(rows.map((t) => t.task_key), ['2026-07-12/shared-slug', '2026-06-30/no-h1-spec']);
  });

  test('--since is inclusive on the ISO date', () => {
    const rows = filterTasks(all(), { since: '2026-06-30' });
    assert.deepEqual(rows.map((t) => t.task_key), [
      '2026-07-12/shared-slug',
      '2026-06-30/freeform-phases',
      '2026-06-30/no-h1-spec',
    ]);
  });

  test('--since accepts the DD-MM-YYYY form too', () => {
    assert.equal(filterTasks(all(), { since: '30-06-2026' }).length, 3);
  });

  test('filters combine', () => {
    const rows = filterTasks(all(), { sprint: '65', status: 'done' });
    assert.deepEqual(rows.map((t) => t.slug), ['no-h1-spec']);
  });

  test('no filters is the identity', () => {
    assert.equal(filterTasks(all(), {}).length, all().length);
  });
});

describe('task-index — render widths', () => {
  test('the whole table fits in an 80 column terminal', () => {
    const w = computeWidths(80);
    assert.ok(w.total <= 80, `total ${w.total}`);
    assert.equal(w.date, 10);
    assert.equal(w.status, 16);
    assert.equal(w.sprint, 6);
    assert.equal(w.prs, 4);
  });

  test('the flexible columns grow with the terminal instead of being hardcoded', () => {
    const narrow = computeWidths(80);
    const wide = computeWidths(160);
    assert.ok(wide.slug > narrow.slug);
    assert.ok(wide.title > narrow.title);
    assert.ok(wide.total <= 160);
  });

  test('services never exceeds its 24 column cap', () => {
    assert.ok(computeWidths(400).services <= 24);
  });

  test('a missing terminal width defaults to 80', () => {
    assert.deepEqual(computeWidths(undefined), computeWidths(80));
    assert.deepEqual(computeWidths(0), computeWidths(80));
  });

  test('no rendered line wraps at 80 columns', () => {
    const out = renderTable(fixtureTasks(), 80);
    for (const line of out.split('\n')) {
      assert.ok([...line].length <= 80, `line too wide (${[...line].length}): ${line}`);
    }
  });

  test('truncation marks the cut with an ellipsis at the end', () => {
    assert.equal(truncate('abcdefghij', 5), 'abcd…');
    assert.equal(truncate('abc', 5), 'abc');
  });

  test('services overflow collapses into a +N counter', () => {
    const row = renderTable(
      [
        {
          date: '2026-06-30',
          slug: 's',
          title: 't',
          status: 'planned',
          sprint: '1',
          service_ids: ['alpha-service', 'beta-service', 'gamma-service', 'delta-service'],
          pull_requests: [],
        },
      ],
      80,
    );
    assert.match(row, /\+\d/);
  });

  test('the PRs column is a count, not a list', () => {
    const out = renderTable([findTask('canonical-table-blocked')], 120);
    assert.ok(!out.includes('github.com'));
    assert.match(out, /\s2\s*$/m);
  });
});

describe('task-index — pagination', () => {
  test('page 2 of 20 over 98 rows is rows 21 to 40', () => {
    const rows = Array.from({ length: 98 }, (_, i) => ({ n: i + 1 }));
    const page = paginate(rows, 2, 20);
    assert.equal(page.rows.length, 20);
    assert.equal(page.rows[0].n, 21);
    assert.equal(page.rows[19].n, 40);
    assert.equal(page.pages, 5);
    assert.equal(page.total, 98);
  });

  test('a page beyond the end is empty but still reports the total', () => {
    const rows = Array.from({ length: 98 }, (_, i) => ({ n: i + 1 }));
    const page = paginate(rows, 99, 20);
    assert.deepEqual(page.rows, []);
    assert.equal(page.total, 98);
    assert.equal(page.pages, 5);
  });

  test('an empty result set is one empty page', () => {
    const page = paginate([], 1, 20);
    assert.deepEqual(page.rows, []);
    assert.equal(page.pages, 1);
  });

  test('the footer reports page, total pages and task count in Spanish', () => {
    assert.equal(renderPageFooter({ page: 3, pages: 5, total: 98 }), 'página 3/5 · 98 tareas');
  });
});

describe('task-index — interactive pager', () => {
  const rows = () => Array.from({ length: 98 }, (_, i) => ({
    date: '2026-06-30',
    slug: `s-${i}`,
    title: `t ${i}`,
    status: 'planned',
    sprint: '1',
    service_ids: [],
    pull_requests: [],
  }));

  test('n, n, p, g5, q walks pages 1, 2, 3, 2, 5 and exits cleanly', async () => {
    const out = fakeOut(100);
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out, keys, pageSize: 20 });
    keySequence(keys, ['n', 'n', 'p', 'g', '5', 'q']);
    const result = await done;
    assert.deepEqual(result.visited, [1, 2, 3, 2, 5]);
    assert.equal(result.reason, 'quit');
  });

  test('raw mode is enabled on entry and restored on exit', async () => {
    const out = fakeOut();
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out, keys, pageSize: 20 });
    keySequence(keys, ['q']);
    await done;
    assert.deepEqual(keys.rawModeCalls, [true, false]);
  });

  test('stdin EOF is treated as q', async () => {
    const out = fakeOut();
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out, keys, pageSize: 20 });
    setImmediate(() => keys.end());
    const result = await done;
    assert.equal(result.reason, 'eof');
    assert.deepEqual(keys.rawModeCalls, [true, false]);
  });

  test('Ctrl-D quits and restores raw mode', async () => {
    const out = fakeOut();
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out, keys, pageSize: 20 });
    keySequence(keys, ['\x04']);
    const result = await done;
    assert.equal(result.reason, 'eof');
    assert.deepEqual(keys.rawModeCalls, [true, false]);
  });

  test('Ctrl-C quits and restores raw mode', async () => {
    const out = fakeOut();
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out, keys, pageSize: 20 });
    keySequence(keys, ['\x03']);
    const result = await done;
    assert.equal(result.reason, 'interrupt');
    assert.deepEqual(keys.rawModeCalls, [true, false]);
  });

  test('SIGINT restores raw mode and unwinds the loop', async () => {
    const out = fakeOut();
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out, keys, pageSize: 20 });
    setImmediate(() => process.emit('SIGINT'));
    const result = await done;
    assert.equal(result.reason, 'signal');
    assert.deepEqual(keys.rawModeCalls, [true, false]);
  });

  test('SIGTERM restores raw mode and unwinds the loop', async () => {
    const out = fakeOut();
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out, keys, pageSize: 20 });
    setImmediate(() => process.emit('SIGTERM'));
    const result = await done;
    assert.equal(result.reason, 'signal');
    assert.deepEqual(keys.rawModeCalls, [true, false]);
  });

  test('the pager leaves no SIGINT or SIGTERM listener behind', async () => {
    const before = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out: fakeOut(), keys, pageSize: 20 });
    keySequence(keys, ['q']);
    await done;
    assert.equal(process.listenerCount('SIGINT') + process.listenerCount('SIGTERM'), before);
  });

  test('unknown keys are ignored without breaking the loop', async () => {
    const out = fakeOut();
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out, keys, pageSize: 20 });
    keySequence(keys, ['z', '?', '\x1b[A', 'n', 'q']);
    const result = await done;
    assert.deepEqual(result.visited, [1, 2]);
    assert.equal(result.reason, 'quit');
  });

  test('n at the last page and p at the first page are no-ops', async () => {
    const out = fakeOut();
    const keys = fakeKeys();
    const done = runPager({ rows: rows().slice(0, 10), out, keys, pageSize: 20 });
    keySequence(keys, ['n', 'p', 'q']);
    const result = await done;
    assert.deepEqual(result.visited, [1]);
  });

  test('a resize redraws the current page at the new width', async () => {
    const chunks = [];
    let resizeHandler = null;
    const out = {
      columns: 80,
      write(chunk) {
        chunks.push(String(chunk));
        return true;
      },
      on(event, handler) {
        if (event === 'resize') resizeHandler = handler;
        return out;
      },
      off() {
        return out;
      },
    };
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out, keys, pageSize: 20 });
    const firstFrames = chunks.length;
    out.columns = 140;
    assert.equal(typeof resizeHandler, 'function');
    resizeHandler();
    const afterResize = chunks.length;
    keySequence(keys, ['q']);
    const result = await done;
    assert.ok(afterResize > firstFrames);
    assert.deepEqual(result.visited, [1, 1]);
    const widest = Math.max(...chunks.join('\n').split('\n').map((l) => [...l].length));
    assert.ok(widest > 80 && widest <= 140, `widest ${widest}`);
  });

  test('a goto beyond the last page clamps instead of throwing', async () => {
    const out = fakeOut();
    const keys = fakeKeys();
    const done = runPager({ rows: rows(), out, keys, pageSize: 20 });
    keySequence(keys, ['g', '9', '9', '\r', 'q']);
    const result = await done;
    assert.deepEqual(result.visited, [1, 5]);
  });
});

describe('task-index — renderCard', () => {
  const card = (slug) => renderCard(findTask(slug));

  test('the card is headed by the stable date/slug key', () => {
    assert.match(card('canonical-table-blocked'), /^2026-03-16\/canonical-table-blocked$/m);
  });

  test('it shows title, status, setup mode, sprint, path, services, PRs and phases', () => {
    const out = card('canonical-table-blocked');
    assert.match(out, /título\s+User memory endpoints: get, find, set/);
    assert.match(out, /status\s+implementing/);
    assert.match(out, /setup mode\s+worktree/);
    assert.match(out, /sprint\s+58/);
    assert.match(out, /ruta\s+specs[/\\]16-03-2026[/\\]canonical-table-blocked/);
    assert.match(out, /servicios\s+memory-engine \(affected\)/);
    assert.match(out, /ExampleOrg\/memory-engine#1841/);
    assert.match(out, /blocked/);
    assert.match(out, /ClickUp\s+86c1abcde/);
  });

  test('lifecycle transitions are listed with their ISO timestamp', () => {
    const out = card('canonical-table-blocked');
    assert.match(out, /lifecycle\s+draft\s+2026-03-16T09:00:00\.000Z/);
    assert.match(out, /implementing\s+2026-03-18T00:30:00\.000Z/);
  });

  test('a confidence below 1.0 is shown and a confidence of 1.0 is not', () => {
    const out = card('invented-status');
    assert.match(out, /status\s+unknown\s+\(0\.0\)/);
    assert.match(out, /título\s+Invented status value\s*$/m);
  });

  test('the defectos block lists that task derivation issues', () => {
    const out = card('header-phases-accented');
    assert.match(out, /defectos/);
    assert.match(out, /external_ref\.clickup — placeholder/);
  });

  test('a freeform phase is marked as freeform in the card', () => {
    assert.match(card('freeform-phases'), /freeform/);
  });

  test('a card never contains a numeric internal id', () => {
    for (const task of fixtureTasks()) {
      const out = renderCard(task);
      assert.ok(!/\bid\s*[:=]\s*\d+/.test(out), out);
    }
  });
});

describe('task-index — CLI list', () => {
  test('list --json is an array of tasks and a strict superset of list-tasks --json', () => {
    const mine = cli(['list', '--workspace', FIXTURE_WS, '--json']);
    assert.equal(mine.status, 0, mine.stderr);
    const theirs = spawnSync('node', [LIST_SCRIPT, '--workspace', FIXTURE_WS, '--json'], { encoding: 'utf8' });
    assert.equal(theirs.status, 0, theirs.stderr);

    const rows = JSON.parse(mine.stdout);
    const legacy = JSON.parse(theirs.stdout);
    assert.ok(Array.isArray(rows));
    const byKey = new Map(rows.map((r) => [`${r.date}/${r.slug}`, r]));
    for (const old of legacy) {
      const row = byKey.get(`${old.date}/${old.slug}`);
      assert.ok(row, `${old.date}/${old.slug} missing from task-index list`);
      for (const field of ['slug', 'date', 'title', 'status', 'sprint', 'services']) {
        assert.deepEqual(row[field], old[field], `${field} of ${old.slug}`);
      }
    }
  });

  test('list --json exposes date_iso alongside the on-disk date', () => {
    const r = cli(['list', '--workspace', FIXTURE_WS, '--json']);
    const rows = JSON.parse(r.stdout);
    const row = rows.find((t) => t.slug === 'lifecycle-variant');
    assert.equal(row.date, '01-12-2025');
    assert.equal(row.date_iso, '2025-12-01');
  });

  test('list orders by ISO date descending, not by day of month', () => {
    const r = cli(['list', '--workspace', FIXTURE_WS, '--json']);
    const keys = JSON.parse(r.stdout).map((t) => `${t.date_iso}/${t.slug}`);
    assert.equal(keys[0], '2026-07-12/shared-slug');
    assert.equal(keys[keys.length - 1], '2025-11-01/branching-and-phases-modes');
    const iso = keys.map((k) => k.split('/')[0]);
    assert.deepEqual(iso, [...iso].sort().reverse());
  });

  test('list renders a table by default', () => {
    const r = cli(['list', '--workspace', FIXTURE_WS]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^fecha\s+slug\s+título\s+status\s+sprint\s+servicios\s+PRs$/m);
    assert.match(r.stdout, /^2026-03-16 canonical-ta/m);
    assert.match(r.stdout, /página 1\/1 · 17 tareas/);
  });

  test('list --page 2 --page-size 5 returns the right window and the next-page command', () => {
    const r = cli(['list', '--workspace', FIXTURE_WS, '--page', '2', '--page-size', '5']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /página 2\/4 · 17 tareas/);
    assert.match(r.stdout, /--page 3 --page-size 5/);
    assert.match(r.stdout, /state-closed/);
    assert.ok(!r.stdout.includes('shared-slug'));
  });

  test('the next-page command preserves the filters that were passed', () => {
    const r = cli(['list', '--workspace', FIXTURE_WS, '--status', 'planned', '--page', '1', '--page-size', '1']);
    assert.match(r.stdout, /--status planned/);
    assert.match(r.stdout, /--page 2 --page-size 1/);
  });

  test('the last page prints no next-page command', () => {
    const r = cli(['list', '--workspace', FIXTURE_WS, '--page', '4', '--page-size', '5']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/--page 5/.test(r.stdout));
  });

  test('list --page 99 is an empty page with exit 0', () => {
    const r = cli(['list', '--workspace', FIXTURE_WS, '--page', '99']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /17 tareas/);
    const rows = JSON.parse(cli(['list', '--workspace', FIXTURE_WS, '--page', '99', '--json']).stdout);
    assert.deepEqual(rows, []);
  });

  test('list --page-size 20 --page 2 over 98 synthetic tasks returns rows 21 to 40', () => {
    const { root, ws } = syntheticWorkspace(98);
    const all = JSON.parse(cli(['list', '--workspace', ws, '--json']).stdout);
    assert.equal(all.length, 98);
    const page = JSON.parse(cli(['list', '--workspace', ws, '--json', '--page', '2', '--page-size', '20']).stdout);
    assert.equal(page.length, 20);
    assert.deepEqual(page.map((t) => t.slug), all.slice(20, 40).map((t) => t.slug));
    rmSync(root, { recursive: true, force: true });
  });

  test('list --status filters', () => {
    const rows = JSON.parse(cli(['list', '--workspace', FIXTURE_WS, '--json', '--status', 'closed']).stdout);
    assert.deepEqual(rows.map((t) => t.slug), ['shared-slug', 'state-closed']);
  });

  test('list --sprint filters', () => {
    const rows = JSON.parse(cli(['list', '--workspace', FIXTURE_WS, '--json', '--sprint', '3']).stdout);
    assert.deepEqual(rows.map((t) => t.slug), ['lifecycle-variant']);
  });

  test('list --service returns a task once even when it is primary and affected', () => {
    const rows = JSON.parse(cli(['list', '--workspace', FIXTURE_WS, '--json', '--service', 'diseño-service']).stdout);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].slug, 'header-phases-accented');
  });

  test('list --since filters by ISO date', () => {
    const rows = JSON.parse(cli(['list', '--workspace', FIXTURE_WS, '--json', '--since', '2026-07-01']).stdout);
    assert.deepEqual(rows.map((t) => t.slug), ['shared-slug']);
  });

  test('list writes nothing to stderr on the happy path', () => {
    const r = cli(['list', '--workspace', FIXTURE_WS]);
    assert.equal(r.stderr, '');
  });

  test('list --json never leaks a numeric internal id', () => {
    const rows = JSON.parse(cli(['list', '--workspace', FIXTURE_WS, '--json']).stdout);
    for (const row of rows) {
      assert.ok(!('id' in row));
      assert.ok(!('task_id' in row));
      assert.ok(!('rowid' in row));
    }
  });
});

describe('task-index — CLI get', () => {
  test('get by bare slug prints the card', () => {
    const r = cli(['get', 'canonical-table-blocked', '--workspace', FIXTURE_WS]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2026-03-16\/canonical-table-blocked/);
  });

  test('get by the full date-iso/slug key resolves the same task', () => {
    const bare = cli(['get', 'canonical-table-blocked', '--workspace', FIXTURE_WS]).stdout;
    const keyed = cli(['get', '2026-03-16/canonical-table-blocked', '--workspace', FIXTURE_WS]).stdout;
    assert.equal(keyed, bare);
  });

  test('get by the on-disk DD-MM-YYYY key also resolves', () => {
    const r = cli(['get', '16-03-2026/canonical-table-blocked', '--workspace', FIXTURE_WS]);
    assert.equal(r.status, 0, r.stderr);
  });

  test('an ambiguous slug exits 7 and lists the candidates', () => {
    const r = cli(['get', 'shared-slug', '--workspace', FIXTURE_WS]);
    assert.equal(r.status, 7);
    assert.match(r.stderr, /2026-07-12\/shared-slug/);
    assert.match(r.stderr, /2026-05-11\/shared-slug/);
  });

  test('an ambiguous slug disambiguates with the date key', () => {
    const r = cli(['get', '2026-05-11/shared-slug', '--workspace', FIXTURE_WS, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).status, 'closed');
  });

  test('an unknown slug exits 6', () => {
    const r = cli(['get', 'does-not-exist', '--workspace', FIXTURE_WS]);
    assert.equal(r.status, 6);
    assert.match(r.stderr, /does-not-exist/);
  });

  test('a numeric identifier is never accepted as a task id', () => {
    const r = cli(['get', '1', '--workspace', FIXTURE_WS]);
    assert.equal(r.status, 6);
  });

  test('get --json carries per-field provenance with path and sha256', () => {
    const r = cli(['get', 'canonical-table-blocked', '--workspace', FIXTURE_WS, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const task = JSON.parse(r.stdout);
    const raw = readFixture('16-03-2026/canonical-table-blocked/TASKS.md');
    const spec = readFixture('16-03-2026/canonical-table-blocked/SPEC.md');
    assert.equal(task.provenance.title.path, join('specs', '16-03-2026', 'canonical-table-blocked', 'SPEC.md'));
    assert.equal(task.provenance.title.sha256, createHash('sha256').update(spec).digest('hex'));
    for (const field of ['status', 'setup_mode', 'sprint', 'services', 'pull_requests', 'phases', 'lifecycle', 'external_refs']) {
      assert.equal(task.provenance[field].path, join('specs', '16-03-2026', 'canonical-table-blocked', 'TASKS.md'), field);
      assert.equal(task.provenance[field].sha256, createHash('sha256').update(raw).digest('hex'), field);
    }
  });

  test('a missing SPEC.md gives title a null provenance and a derivation issue', () => {
    const r = cli(['get', 'freeform-phases', '--workspace', FIXTURE_WS, '--json']);
    const task = JSON.parse(r.stdout);
    assert.equal(task.provenance.title, null);
    assert.ok(task.derivation_issues.some((i) => i.field === 'task.title' && i.observed_token_class === 'absent'));
  });

  test('get --json never exposes a numeric internal id', () => {
    for (const slug of ['canonical-table-blocked', 'header-phases-accented', 'lifecycle-variant']) {
      const task = JSON.parse(cli(['get', slug, '--workspace', FIXTURE_WS, '--json']).stdout);
      const forbidden = ['id', 'task_id', 'source_file_id', 'rowid', 'phase_id'];
      const walk = (node) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
          if (forbidden.includes(key)) {
            assert.equal(typeof value, 'string', `${slug}: numeric ${key} leaked`);
          }
          walk(value);
        }
      };
      assert.ok(!('id' in task));
      walk(task);
    }
  });

  test('get --json reports every derived collection', () => {
    const task = JSON.parse(cli(['get', 'header-phases-accented', '--workspace', FIXTURE_WS, '--json']).stdout);
    assert.equal(task.task_key, '2026-03-31/header-phases-accented');
    assert.equal(task.phases.length, 4);
    assert.equal(task.lifecycle.length, 4);
    assert.equal(task.pull_requests.length, 2);
    assert.deepEqual(task.services.map((s) => s.role), ['primary', 'affected']);
  });
});

describe('task-index — CLI contract', () => {
  test('an unresolvable workspace exits 2 and says what it looked for', () => {
    const lonely = mkdtempSync(join(tmpdir(), 'task-index-cli-none-'));
    const r = cli(['list', '--cwd', lonely]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\.spec-workspace\.json/);
    assert.match(r.stderr, /specs/);
    assert.match(r.stderr, new RegExp(lonely.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    rmSync(lonely, { recursive: true, force: true });
  });

  test('an unknown subcommand exits 64 with a usage line', () => {
    const r = cli(['rebuild', '--workspace', FIXTURE_WS]);
    assert.equal(r.status, 64);
    assert.match(r.stderr, /usage/i);
  });

  test('exit 2 is reserved for an unresolvable workspace, not for misuse', () => {
    assert.equal(cli(['rebuild', '--workspace', FIXTURE_WS]).status, 64);
    assert.equal(cli(['list', '--nope', 'x', '--workspace', FIXTURE_WS]).status, 64);
    assert.equal(cli(['list', '--since', 'yesterday', '--workspace', FIXTURE_WS]).status, 64);
  });

  test('only list and get are offered', () => {
    const help = cli(['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /^\s+list\b/m);
    assert.match(help.stdout, /^\s+get\b/m);
    for (const retired of ['rebuild', 'hygiene', 'paths', 'task-index task']) {
      assert.ok(!help.stdout.includes(retired), retired);
    }
  });

  test('every retired subcommand is rejected', () => {
    for (const retired of ['rebuild', 'status', 'prs', 'hygiene', 'paths', 'task']) {
      const r = cli([retired, '--workspace', FIXTURE_WS]);
      assert.notEqual(r.status, 0, retired);
      assert.match(r.stderr, /usage/i, retired);
    }
  });

  test('get without an identifier exits non-zero with a usage line', () => {
    const r = cli(['get', '--workspace', FIXTURE_WS]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /usage/i);
  });

  test('the source never imports the dev-orchestrator resolveWorkspace', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    assert.ok(!source.includes('dev-orchestrator'));
    assert.match(source, /resolveSpecWorkspace/);
  });

  test('no module under bin/lib/task-index imports node:sqlite', () => {
    for (const file of ['extract.mjs', 'workspace.mjs', 'scan.mjs', 'render.mjs']) {
      const source = readFileSync(join(REPO, 'bin', 'lib', 'task-index', file), 'utf8');
      assert.ok(!source.includes('node:sqlite'), file);
    }
    assert.ok(!readFileSync(SCRIPT, 'utf8').includes('node:sqlite'));
  });
});

describe('task-index — interactive gating', () => {
  test('interactive only when both streams are TTYs and neither --json nor --page was passed', () => {
    assert.equal(shouldRunInteractive({ stdoutIsTTY: true, stdinIsTTY: true, json: false, pageGiven: false }), true);
  });

  test('a piped stdin under a TTY stdout stays non-interactive', () => {
    assert.equal(shouldRunInteractive({ stdoutIsTTY: true, stdinIsTTY: false, json: false, pageGiven: false }), false);
  });

  test('a piped stdout stays non-interactive', () => {
    assert.equal(shouldRunInteractive({ stdoutIsTTY: false, stdinIsTTY: true, json: false, pageGiven: false }), false);
  });

  test('--json never goes interactive even on a full TTY', () => {
    assert.equal(shouldRunInteractive({ stdoutIsTTY: true, stdinIsTTY: true, json: true, pageGiven: false }), false);
  });

  test('--page never goes interactive even on a full TTY', () => {
    assert.equal(shouldRunInteractive({ stdoutIsTTY: true, stdinIsTTY: true, json: false, pageGiven: true }), false);
  });

  test('list with a piped stdin terminates instead of waiting for a key', () => {
    const r = cli(['list', '--workspace', FIXTURE_WS], { timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.signal, null);
  });
});

describe('task-index — identifier resolution', () => {
  const rows = () => fixtureTasks();

  test('a bare slug resolves when unique', () => {
    const r = resolveIdentifier(rows(), 'canonical-table-blocked');
    assert.equal(r.status, 'found');
    assert.equal(r.task.task_key, '2026-03-16/canonical-table-blocked');
  });

  test('a bare slug that appears under two dates is ambiguous', () => {
    const r = resolveIdentifier(rows(), 'shared-slug');
    assert.equal(r.status, 'ambiguous');
    assert.deepEqual(r.candidates, ['2026-07-12/shared-slug', '2026-05-11/shared-slug']);
  });

  test('an ISO key resolves exactly one task', () => {
    const r = resolveIdentifier(rows(), '2026-07-12/shared-slug');
    assert.equal(r.status, 'found');
    assert.equal(r.task.status, 'validating');
  });

  test('an unknown identifier is not found', () => {
    assert.equal(resolveIdentifier(rows(), 'nope').status, 'not_found');
  });

  test('a numeric identifier is not found rather than treated as a row id', () => {
    for (const numeric of ['1', '42', '0']) {
      assert.equal(resolveIdentifier(rows(), numeric).status, 'not_found', numeric);
    }
  });

  test('adding an older task does not change what a slug resolves to', () => {
    const { root, ws } = syntheticWorkspace(3);
    const before = resolveIdentifier(scanWorkspace(ws).tasks, 'synthetic-002').task.task_key;
    const older = join(ws, 'specs', '01-01-2020', 'ancient');
    mkdirSync(older, { recursive: true });
    writeFileSync(join(older, 'TASKS.md'), '# Task: ancient\n\n## Status: closed\n');
    const after = resolveIdentifier(scanWorkspace(ws).tasks, 'synthetic-002').task.task_key;
    assert.equal(after, before);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('task-index — no persistence in phase 1', () => {
  test('running list twice writes no state anywhere under the workspace', () => {
    const { root, ws } = syntheticWorkspace(3);
    cli(['list', '--workspace', ws, '--json']);
    cli(['list', '--workspace', ws, '--json']);
    assert.equal(scanWorkspace(ws).tasks.length, 3);
    const created = readdirSync(root, { recursive: true }).map(String);
    assert.deepEqual(created.filter((f) => /\.sqlite|\.lock|task-index/.test(f)), []);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('task-index — parseStatus (## Metadata table grammar)', () => {
  const metadata = [
    '# Task: t',
    '',
    '## Metadata',
    '',
    '| Field | Value |',
    '|-------|-------|',
    '| **Slug** | full-unit-integration-testing-testcontainer |',
    '| **Created** | 16-03-2026 |',
    '| **Status** | closed |',
    '| **Sprint** | 16-03-2026 |',
    '',
  ].join('\n');

  test('a bold Status row in the metadata table is the third status grammar', () => {
    const r = parseStatus(metadata);
    assert.equal(r.value, 'closed');
    assert.equal(r.confidence, 1);
    assert.deepEqual(r.issues, []);
  });

  test('the unbolded row form is accepted too', () => {
    assert.equal(parseStatus('## Metadata\n\n| Status | implementing |\n').value, 'implementing');
  });

  test('the table form gets the same allowlist validation as the marker forms', () => {
    const r = parseStatus(metadata.replace('| closed |', '| frobnicated |'));
    assert.equal(r.value, 'unknown');
    assert.equal(r.confidence, 0);
    assert.equal(r.issues[0].observed_token_class, 'out_of_allowlist');
  });

  test('a placeholder in the table row is rejected as a placeholder', () => {
    const r = parseStatus(metadata.replace('| closed |', '| (pending) |'));
    assert.equal(r.value, 'unknown');
    assert.equal(r.issues[0].observed_token_class, 'placeholder');
  });

  test('a Status column header is never mistaken for the task status', () => {
    const text = [
      '## Phase Progress',
      '',
      '| # | Phase Name | Status | Started |',
      '|---|-----------|--------|---------|',
      '| 1 | X | done | — |',
      '',
    ].join('\n');
    const r = parseStatus(text);
    assert.equal(r.value, 'unknown');
    assert.equal(r.issues[0].observed_token_class, 'absent');
  });

  test('a Status row outside a table is not read as a table row', () => {
    assert.equal(parseStatus('Lorem | **Status** | closed | ipsum\n').value, 'unknown');
  });

  test('the inline marker still wins over the metadata table', () => {
    const both = `## Status: planned\n\n${metadata}`;
    assert.equal(parseStatus(both).value, 'planned');
  });
});

describe('task-index — parsePhases never loses a section in silence', () => {
  test('a phase table under ## Phases is recognised, not dropped', () => {
    const text = [
      '## Phases',
      '',
      '| NN | Name | Service | Status | Commit |',
      '|----|------|---------|--------|--------|',
      '| 01 | Endpoint implementation | memory-engine | done | f39722a |',
      '| 02 | Proxy + controller | memory-proxy | blocked | bfe1c59 |',
      '',
    ].join('\n');
    const r = parsePhases(text);
    assert.equal(r.grammar, 'table');
    assert.deepEqual(r.value.map((p) => [p.phase_number, p.heading, p.status]), [
      [1, 'Endpoint implementation', 'done'],
      [2, 'Proxy + controller', 'blocked'],
    ]);
  });

  test('a ## Phases section that no grammar matches records a derivation issue', () => {
    const r = parsePhases('## Phases\n- Implementación aplicada directamente en la rama `production/x`.\n');
    assert.deepEqual(r.value, []);
    assert.equal(r.grammar, null);
    assert.equal(r.issues.length, 1);
    assert.equal(r.issues[0].field, 'phase');
    assert.equal(r.issues[0].observed_token_class, 'out_of_allowlist');
  });

  test('a placeholder ## Phases section records a placeholder issue', () => {
    const r = parsePhases('## Phases\n(pending — will be generated by /jlu-execute-task)\n');
    assert.deepEqual(r.value, []);
    assert.equal(r.issues[0].field, 'phase');
    assert.equal(r.issues[0].observed_token_class, 'placeholder');
  });

  test('an unreadable ## Phase Progress table is a defect, not silence', () => {
    const r = parsePhases('## Phase Progress\n\n| # | Phase Name |\n|---|---|\n| 1 | X |\n');
    assert.equal(r.grammar, null);
    assert.equal(r.issues.length, 1);
    assert.equal(r.issues[0].field, 'phase');
  });

  test('no phase section at all stays silent, because nothing was lost', () => {
    const r = parsePhases('# t\n\n## Status: planned\n');
    assert.deepEqual(r.value, []);
    assert.deepEqual(r.issues, []);
  });

  test('the issue never carries the offending line', () => {
    const r = parsePhases('## Phases\n- Implementación aplicada en `production/secret-branch-name`.\n');
    assert.equal(JSON.stringify(r.issues).includes('secret-branch-name'), false);
  });
});

describe('task-index — parsePhases (bullet-list grammar)', () => {
  const bullets = [
    '## Phases',
    'Execution strategy: sequential (single service) · PHASE_PARALLELISM=1',
    '',
    '- [x] Phase 01 — per-origin-tiered-timeouts (FR-1, FR-8) — vertical — status: done · commit d0cfd69 · 79 tests',
    '- [x] Phase 02: HTTP client extension + DB migration — done (commit: 58e11d8, 24 tests)',
    '- Phase 03 (api-gateway-service): done — Load shedding under pressure',
    '- Phase 04 — Cross-cutting polish — `api-gateway-service` — pending',
    '- [x] Phase 05: agent-harness-service operator PAT storage',
    '- Style fix: Prettier formatting — done (commit: a6a39be)',
    '',
  ].join('\n');

  test('bullet phases are a named grammar of their own', () => {
    assert.equal(parsePhases(bullets).grammar, 'bullets');
  });

  test('every bullet shape observed in the corpus yields its ordinal and heading', () => {
    const r = parsePhases(bullets);
    assert.deepEqual(r.value.map((p) => [p.ordinal, p.phase_number, p.heading]), [
      [1, 1, 'per-origin-tiered-timeouts (FR-1, FR-8)'],
      [2, 2, 'HTTP client extension + DB migration'],
      [3, 3, 'Load shedding under pressure'],
      [4, 4, 'Cross-cutting polish'],
      [5, 5, 'agent-harness-service operator PAT storage'],
    ]);
  });

  test('the status is read where it is stated and left null where it is not', () => {
    const r = parsePhases(bullets);
    assert.deepEqual(r.value.map((p) => p.status), ['done', 'done', 'done', 'pending', null]);
    assert.ok(r.issues.some((i) => i.field === 'phase.status' && i.observed_token_class === 'absent'));
  });

  test('a bullet phase carries its own confidence, below a canonical one', () => {
    const r = parsePhases(bullets);
    assert.ok(r.value.every((p) => p.confidence === 0.8));
    assert.ok(r.value.every((p) => p.classification === 'canonical'));
  });

  test('a checkbox is never read as a status', () => {
    const r = parsePhases('## Phases\n- [x] Phase 01: api-gateway trusted api-key route\n');
    assert.equal(r.value[0].status, null);
    assert.equal(r.issues[0].observed_token_class, 'absent');
  });

  test('a bullet that is not a phase is not a phase', () => {
    const r = parsePhases(bullets);
    assert.ok(!r.value.some((p) => p.heading.includes('Prettier')));
  });

  test('indented metadata bullets under a phase are never phases', () => {
    const text = [
      '## Phases',
      '- Phase 01 (orchestrator-service): done — Backend flag and conditional identity validation',
      '  - Commit: 7a39f2b',
      '  - Tests: 106/106 passing',
      '- Phase 02 (jelou-apps): done — Frontend handler split',
      '  - Commits: 0f254b2a2',
      '',
    ].join('\n');
    const r = parsePhases(text);
    assert.equal(r.value.length, 2);
    assert.deepEqual(r.value.map((p) => p.heading), [
      'Backend flag and conditional identity validation',
      'Frontend handler split',
    ]);
  });

  test('an out-of-allowlist bullet status is a defect, never a value', () => {
    const r = parsePhases('## Phases\n- Phase 01: X — status: failed\n');
    assert.equal(r.value[0].status, null);
    assert.ok(r.issues.some((i) => i.observed_token_class === 'out_of_allowlist'));
  });

  test('header phases win over bullets when both are present', () => {
    const text = '## Phases\n- Phase 01: bullet form\n\n### Phase 01: header form\n- Status: done\n';
    const r = parsePhases(text);
    assert.equal(r.grammar, 'headers');
    assert.equal(r.value[0].heading, 'header form');
  });
});

describe('task-index — parsePhases (phase-number heading relaxation)', () => {
  function phase(heading, body = '') {
    return parsePhases(`## Phases\n\n### ${heading}\n${body}\n`).value[0];
  }

  test('a service qualifier between the number and the name stays canonical', () => {
    const p = phase('Phase 01 (agent-harness-service): Sliding-window context fix', '- Status: done');
    assert.equal(p.classification, 'canonical');
    assert.equal(p.phase_number, 1);
    assert.equal(p.heading, 'Sliding-window context fix');
    assert.equal(p.confidence, 1);
    assert.equal(p.status, 'done');
  });

  test('an em dash instead of a colon stays canonical', () => {
    const p = phase('Phase 1 — Initial TLS + cluster support (DONE, retroactive)');
    assert.equal(p.classification, 'canonical');
    assert.equal(p.phase_number, 1);
    assert.equal(p.heading, 'Initial TLS + cluster support (DONE, retroactive)');
  });

  test('a parenthetical that is itself a phase reference is a qualifier, not the name', () => {
    const p = phase('Phase 16 (Phase 3.1): Engine stream realtime channel');
    assert.equal(p.phase_number, 16);
    assert.equal(p.heading, 'Engine stream realtime channel');
  });

  test('the Spanish spelling is accepted', () => {
    assert.equal(phase('Fase 02 — Corregir el cálculo').phase_number, 2);
  });

  test('a service-name heading is still freeform at confidence 0.3', () => {
    for (const heading of ['jelou-apps', 'workflows-service', 'workflow-engine-service']) {
      const p = phase(heading);
      assert.equal(p.classification, 'freeform', heading);
      assert.equal(p.confidence, 0.3, heading);
      assert.equal(p.phase_number, null, heading);
    }
  });

  test('a wave scheme is still freeform', () => {
    for (const heading of [
      'Exec Wave 1 (concurrent) — DONE',
      'Exec Wave 5 (added v4 — 2026-07-21) — Features D + E',
    ]) {
      const p = phase(heading);
      assert.equal(p.classification, 'freeform', heading);
      assert.equal(p.confidence, 0.3, heading);
    }
  });

  test('headings that only mention a phase are still freeform', () => {
    for (const heading of [
      'Out-of-pipeline: FR-7 — draft_testers flag verification',
      'Post-implementation: Package rename + biome',
      'Extensión 1 — reproducción del problema',
      'Phases overview',
      'Phase without a number',
    ]) {
      assert.equal(phase(heading).classification, 'freeform', heading);
    }
  });

  test('a sub-lettered phase number is not claimed as an integer phase', () => {
    for (const heading of ['Phase 03a: New proxy modules', 'Phase 03b: New proxy module — ai-functions']) {
      const p = phase(heading);
      assert.equal(p.classification, 'freeform', heading);
      assert.equal(p.phase_number, null, heading);
    }
  });

  test('a bare phase number with no name is not claimed as canonical', () => {
    assert.equal(phase('Phase 05').classification, 'freeform');
  });

  test('every freeform heading still raises its own derivation issue', () => {
    const r = parsePhases('## Phases\n\n### jelou-apps\n\n### Exec Wave 1\n');
    assert.equal(r.issues.filter((i) => i.observed_token_class === 'freeform_heading').length, 2);
  });
});

describe('task-index — parseServices (annotated ids)', () => {
  test('a trailing parenthetical annotation is not part of the id', () => {
    const r = parseServices('- Affected: mcp-playground (added v2), dashboard-server (review-only)\n');
    assert.deepEqual(r.ids, ['mcp-playground', 'dashboard-server']);
    assert.deepEqual(r.issues, []);
  });

  test('a comma inside an annotation never splits the list', () => {
    const r = parseServices(
      '- Affected: workflow-engine-service, jelou-apps (marketplace-apps contingent on Phase 1, jelou-api contingent on Phase 1)\n',
    );
    assert.deepEqual(r.ids, ['workflow-engine-service', 'jelou-apps']);
  });

  test('the longest real annotation in the corpus yields four clean ids', () => {
    const line =
      '- Affected: agent-harness-service, jelou-apps, api-gateway-service, jelou-ai-assistant (added v5 — FR-22 read-only `/mcp`; v10 — Agent v2 workflow tester [harness FR-27, jelou-apps FR-28], loading indicator [FR-31], activity trace [FR-32], harness FR-33 conditional)\n';
    const r = parseServices(line);
    assert.deepEqual(r.ids, ['agent-harness-service', 'jelou-apps', 'api-gateway-service', 'jelou-ai-assistant']);
  });

  test('a bracketed annotation is stripped like a parenthesised one', () => {
    assert.deepEqual(parseServices('- Affected: jelou-apps [FR-28]\n').ids, ['jelou-apps']);
  });

  test('a semicolon separates ids outside brackets', () => {
    assert.deepEqual(parseServices('- Affected: alpha-service; beta-service\n').ids, ['alpha-service', 'beta-service']);
  });

  test('the Service ID table cell drops its role annotation', () => {
    const text = [
      '## Affected Services',
      '',
      '| Service ID | Sub-State | Branch |',
      '|-----------|-----------|--------|',
      '| workflow-engine-service (primary) | implementing | spec/x |',
      '| jelou-apps | planned | spec/x |',
      '',
    ].join('\n');
    assert.deepEqual(parseServices(text).ids, ['workflow-engine-service', 'jelou-apps']);
  });

  test('the primary marker is annotated-stripped too', () => {
    assert.deepEqual(parseServices('- Primary: workflow-engine-service (primary)\n').value, [
      { id: 'workflow-engine-service', role: 'primary' },
    ]);
  });

  test('what is left after stripping must be a slug or it is a defect, not an id', () => {
    const r = parseServices('- Affected: loading indicator [FR-31], jelou-apps\n');
    assert.deepEqual(r.ids, ['jelou-apps']);
    assert.equal(r.issues.length, 1);
    assert.equal(r.issues[0].field, 'task_service');
    assert.equal(r.issues[0].observed_token_class, 'out_of_allowlist');
  });

  test('the defect never carries the offending prose', () => {
    const r = parseServices('- Affected: loading indicator for the secret feature\n');
    assert.equal(JSON.stringify(r.issues).includes('secret feature'), false);
  });

  test('a services section that yields no id at all is a defect', () => {
    const r = parseServices('## Services\n- Primary:  \n- To be decided after the interview\n');
    assert.deepEqual(r.ids, []);
    assert.equal(r.issues.length, 1);
    assert.equal(r.issues[0].field, 'task_service');
  });

  test('no services section at all stays silent', () => {
    const r = parseServices('# t\n\n## Status: planned\n');
    assert.deepEqual(r.ids, []);
    assert.deepEqual(r.issues, []);
  });

  test('accented ids survive slug validation', () => {
    assert.deepEqual(parseServices('- Primary: diseño-service\n- Affected: mañana-server\n').ids, [
      'diseño-service',
      'mañana-server',
    ]);
  });
});

describe('task-index — parseLifecycle never loses a section in silence', () => {
  test('a ## Lifecycle section with no recognisable marker records a defect', () => {
    const r = parseLifecycle('## Lifecycle\n- Sprint: 65\n- Owner: someone\n');
    assert.deepEqual(r.value, []);
    assert.equal(r.issues.length, 1);
    assert.equal(r.issues[0].field, 'lifecycle_transition');
    assert.equal(r.issues[0].observed_token_class, 'absent');
  });

  test('an absent ## Lifecycle section stays silent', () => {
    assert.deepEqual(parseLifecycle('# t\n').issues, []);
  });

  test('one recognised marker is enough to keep the section silent', () => {
    const r = parseLifecycle('## Lifecycle\n- Created: 2026-03-31\n- Sprint: 65\n');
    assert.equal(r.value.length, 1);
    assert.deepEqual(r.issues, []);
  });
});

describe('task-index — parseExternalRefs (scope and token)', () => {
  test('a team-scoped ClickUp URL yields the task id, not the team id', () => {
    const r = parseExternalRefs('- ClickUp: https://app.clickup.com/t/12931537/86e2dnvcf\n');
    assert.equal(r.value[0].ref_id, '86e2dnvcf');
    assert.equal(r.value[0].url, 'https://app.clickup.com/t/12931537/86e2dnvcf');
  });

  test('a marker followed by prose keeps the id and drops the prose', () => {
    const r = parseExternalRefs('- ClickUp: 86e239xy2 (DBA - Revisión saturación bases de datos)\n');
    assert.equal(r.value.length, 1);
    assert.equal(r.value[0].ref_id, '86e239xy2');
    assert.equal(r.value[0].url, 'https://app.clickup.com/t/86e239xy2');
  });

  test('an id wrapped in its own URL as prose still resolves to the id', () => {
    const r = parseExternalRefs('- ClickUp: 86e1mm51z (https://app.clickup.com/t/86e1mm51z)\n');
    assert.equal(r.value[0].ref_id, '86e1mm51z');
  });

  test('the ## External Links section wins over a Timeline mention', () => {
    const text = [
      '## External Links',
      '- ClickUp: 86e2fnwqt',
      '',
      '## Timeline',
      '',
      '| When | What | Where |',
      '|------|------|-------|',
      '| 2026-03-18T00:30:00Z | ClickUp linked | ClickUp: 99999999 |',
      '',
    ].join('\n');
    assert.equal(parseExternalRefs(text).value[0].ref_id, '86e2fnwqt');
  });

  test('a Timeline mention alone is still read when there is no External Links section', () => {
    assert.equal(parseExternalRefs('## Timeline\n- linked ClickUp: 86e2fnwqt today\n').value[0].ref_id, '86e2fnwqt');
  });

  test('a placeholder is a placeholder however it is punctuated', () => {
    for (const token of ['(pending)', '(pending),', '(not synced)', '(not synced).']) {
      const r = parseExternalRefs(`## External Links\n- ClickUp: ${token}\n`);
      assert.deepEqual(r.value, [], token);
      assert.equal(r.issues[0].observed_token_class, 'placeholder', token);
    }
  });

  test('an External Links section with no ClickUp marker is an absent issue', () => {
    const r = parseExternalRefs('## External Links\n- PR: https://github.com/O/r/pull/1\n');
    assert.deepEqual(r.value, []);
    assert.equal(r.issues[0].observed_token_class, 'absent');
  });
});

describe('task-index — get reads one task, not the workspace', () => {
  function brokenSibling(count) {
    const { root, ws } = syntheticWorkspace(count);
    const broken = join(ws, 'specs', '01-01-2020', 'unreadable-task');
    mkdirSync(join(broken, 'TASKS.md'), { recursive: true });
    return { root, ws };
  }

  test('listTaskLocations names every task without parsing any file', () => {
    const { root, ws } = syntheticWorkspace(4);
    const locations = listTaskLocations(ws);
    assert.equal(locations.length, 4);
    for (const location of locations) {
      assert.deepEqual(Object.keys(location).sort(), ['date', 'date_on_disk', 'slug', 'task_key']);
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('deriveTask returns the same record the full scan would', () => {
    const { root, ws } = syntheticWorkspace(3);
    const scanned = scanWorkspace(ws).tasks.find((t) => t.slug === 'synthetic-002');
    const scoped = deriveTask(ws, scanned.date_on_disk, scanned.slug);
    assert.deepEqual(scoped, scanned);
    rmSync(root, { recursive: true, force: true });
  });

  test('get on the fixture workspace matches the full-scan record exactly', () => {
    const scanned = findTask('canonical-table-blocked');
    const scoped = deriveTask(FIXTURE_WS, scanned.date_on_disk, scanned.slug);
    assert.deepEqual(scoped, scanned);
  });

  test('get succeeds even when a sibling task is unreadable, because it is never read', () => {
    const { root, ws } = brokenSibling(3);
    const r = cli(['get', 'synthetic-002', '--workspace', ws, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).slug, 'synthetic-002');
    rmSync(root, { recursive: true, force: true });
  });

  test('list over the same workspace does read it, and reports the IO error', () => {
    const { root, ws } = brokenSibling(3);
    const r = cli(['list', '--workspace', ws, '--json']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot read/);
    rmSync(root, { recursive: true, force: true });
  });

  test('an unreadable task is still an IO error when it is the one asked for', () => {
    const { root, ws } = brokenSibling(3);
    const r = cli(['get', 'unreadable-task', '--workspace', ws]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot read/);
    rmSync(root, { recursive: true, force: true });
  });

  test('ambiguity is still detected from the directory listing alone', () => {
    const { root, ws } = brokenSibling(3);
    mkdirSync(join(ws, 'specs', '02-02-2021', 'synthetic-002'), { recursive: true });
    writeFileSync(join(ws, 'specs', '02-02-2021', 'synthetic-002', 'TASKS.md'), '## Status: closed\n');
    const r = cli(['get', 'synthetic-002', '--workspace', ws]);
    assert.equal(r.status, 7);
    assert.match(r.stderr, /2021-02-02\/synthetic-002/);
    rmSync(root, { recursive: true, force: true });
  });

  test('an unknown slug still exits 6 without reading anything', () => {
    const { root, ws } = brokenSibling(3);
    const r = cli(['get', 'nope', '--workspace', ws]);
    assert.equal(r.status, 6);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('task-index — hardening fixtures end to end', () => {
  const tasks = () => scanWorkspace(HARDENING_WS).tasks;
  const task = (slug) => tasks().find((t) => t.slug === slug);

  test('the metadata-table task derives its status, its services and its phases', () => {
    const t = task('metadata-table-schema');
    assert.equal(t.status, 'closed');
    assert.equal(t.status_confidence, 1);
    assert.deepEqual(issuesFor(t, 'task.status'), []);
    assert.deepEqual(t.service_ids, ['memory-engine', 'memory-proxy']);
    assert.equal(t.phase_grammar, 'table');
    assert.equal(t.phases.length, 3);
    assert.equal(t.external_refs[0].ref_id, '86e2dnvcf');
  });

  test('the bullet-list task derives five phases at the bullet confidence', () => {
    const t = task('bullet-phase-list');
    assert.equal(t.phase_grammar, 'bullets');
    assert.equal(t.phases.length, 5);
    assert.ok(t.phases.every((p) => p.confidence === 0.8));
  });

  test('a pending phase section is reported as a placeholder, not as zero phases in silence', () => {
    const t = task('phases-pending');
    assert.deepEqual(t.phases, []);
    assert.equal(t.phase_grammar, null);
    assert.equal(issuesFor(t, 'phase')[0].observed_token_class, 'placeholder');
  });

  test('a prose phase section is reported as unparseable, not as zero phases in silence', () => {
    const t = task('phases-prose');
    assert.deepEqual(t.phases, []);
    assert.equal(issuesFor(t, 'phase')[0].observed_token_class, 'out_of_allowlist');
    assert.equal(t.external_refs[0].ref_id, '86e239xy2');
  });

  test('qualified phase headings are recovered and the four non-phases stay freeform', () => {
    const t = task('qualified-phase-headings');
    const canonical = t.phases.filter((p) => p.classification === 'canonical');
    const freeform = t.phases.filter((p) => p.classification === 'freeform');
    assert.deepEqual(canonical.map((p) => p.phase_number), [1, 2, 3, 16]);
    assert.deepEqual(freeform.map((p) => p.heading), [
      'jelou-apps',
      'Exec Wave 1 (concurrent) — DONE',
      'Phase 03a: New proxy modules — payments + beta-jelouapi',
      'Out-of-pipeline: FR-7 — draft_testers flag verification',
    ]);
    assert.equal(issuesFor(t, 'phase').length, 4);
  });

  test('the annotated-services task carries four slug ids and no prose', () => {
    const t = task('annotated-services');
    assert.deepEqual(t.service_ids, [
      'agent-harness-service',
      'jelou-apps',
      'api-gateway-service',
      'jelou-ai-assistant',
    ]);
    assert.deepEqual(issuesFor(t, 'task_service'), []);
  });

  test('no task in the hardening workspace reports zero phases without saying why', () => {
    for (const t of tasks()) {
      if (t.phases.length) continue;
      assert.ok(issuesFor(t, 'phase').length > 0, t.task_key);
    }
  });

  test('every derivation issue stays a structured fact, never a copied line', () => {
    for (const t of tasks()) {
      for (const issue of t.derivation_issues) {
        assert.deepEqual(Object.keys(issue).sort(), ['expected_grammar', 'field', 'observed_token_class']);
        assert.ok(OBSERVED_TOKEN_CLASSES.includes(issue.observed_token_class), issue.observed_token_class);
      }
    }
  });

  test('--service now matches a task whose id carried an annotation', () => {
    const rows = filterTasks(tasks(), { service: 'jelou-ai-assistant' });
    assert.deepEqual(rows.map((t) => t.slug), ['annotated-services']);
  });

  test('the CLI renders every hardening task without a crash', () => {
    const r = cli(['list', '--workspace', HARDENING_WS, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).length, 6);
  });
});

describe('task-index — the relaxed heading never over-claims', () => {
  const classify = (heading) => parsePhases(`## Phases\n\n### ${heading}\n`).value[0].classification;

  test('a phase number needs a separator before the name to be canonical', () => {
    assert.equal(classify('Phase 1 and 2: combined work'), 'freeform');
    assert.equal(classify('Phase 1 overview of the work'), 'freeform');
    assert.equal(classify('Phase 1: real name'), 'canonical');
  });

  test('a bullet phase needs the same separator', () => {
    assert.equal(parsePhases('## Phases\n- Phase 1 and 2 combined\n').grammar, null);
    assert.equal(parsePhases('## Phases\n- Phase 1: real name\n').grammar, 'bullets');
  });
});

describe('task-index — stdout survives a real pipe', () => {
  const PIPE_BUFFER = 64 * 1024;
  const WIDE_COUNT = 900;
  const PHASE_COUNT = 1500;

  function wideWorkspace() {
    const root = mkdtempSync(join(tmpdir(), 'task-index-wide-'));
    const ws = join(root, '.spec-workspace');
    for (let i = 1; i <= WIDE_COUNT; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      const month = String((i % 12) + 1).padStart(2, '0');
      const slug = `wide-${String(i).padStart(4, '0')}`;
      const dir = join(ws, 'specs', `${day}-${month}-2026`, slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'TASKS.md'),
        [
          `# Task: ${slug}`,
          '',
          '## Status: planned',
          '',
          '## Branching',
          '- Mode: worktree',
          '',
          '## Services',
          '- Primary: jelou-api',
          '- Affected: chatbot-server, workflows-server',
          '',
          '## Phases',
          '',
          '| # | Phase Name | Status |',
          '|---|------------|--------|',
          '| 1 | Primera fase de derivación | done |',
          '| 2 | Segunda fase de derivación | pending |',
          '',
        ].join('\n'),
      );
      writeFileSync(join(dir, 'SPEC.md'), `# Derivación de estado y trazabilidad ${i}\n`);
    }
    return { root, ws };
  }

  function manyPhasesWorkspace() {
    const root = mkdtempSync(join(tmpdir(), 'task-index-phases-'));
    const ws = join(root, '.spec-workspace');
    const dir = join(ws, 'specs', '15-06-2026', 'many-phases');
    mkdirSync(dir, { recursive: true });
    const rows = [];
    for (let i = 1; i <= PHASE_COUNT; i++) rows.push(`| ${i} | Fase de derivación número ${i} | done |`);
    writeFileSync(
      join(dir, 'TASKS.md'),
      [
        '# Task: many-phases',
        '',
        '## Status: planned',
        '',
        '## Phases',
        '',
        '| # | Phase Name | Status |',
        '|---|------------|--------|',
        ...rows,
        '',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'SPEC.md'), '# Una tarea con muchísimas fases\n');
    return { root, ws };
  }

  function pipedCli(args) {
    return spawnSync('bash', ['-c', 'set -o pipefail; "$0" "$@" | cat', process.execPath, SCRIPT, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  function earlyCloseCli(args) {
    return spawnSync('bash', ['-c', '"$0" "$@" | head -c 100', process.execPath, SCRIPT, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  function assertPipeIsLossless(args, outgrowsBuffer = true) {
    const direct = cli(args);
    assert.equal(direct.status, 0, direct.stderr);
    const size = Buffer.byteLength(direct.stdout);
    if (outgrowsBuffer) {
      assert.ok(size > PIPE_BUFFER + 1024, `the fixture must outgrow one pipe buffer, got ${size} bytes`);
    }
    const piped = pipedCli(args);
    assert.equal(piped.status, 0, piped.stderr);
    assert.equal(Buffer.byteLength(piped.stdout), size);
    return piped.stdout;
  }

  test('list --json delivers every row through a pipe, not the first 64 KiB', () => {
    const { root, ws } = wideWorkspace();
    const out = assertPipeIsLossless(['list', '--workspace', ws, '--json']);
    assert.equal(JSON.parse(out).length, WIDE_COUNT);
    rmSync(root, { recursive: true, force: true });
  });

  test('the list table survives a pipe once it outgrows the pipe buffer', () => {
    const { root, ws } = wideWorkspace();
    const out = assertPipeIsLossless(['list', '--workspace', ws, '--page', '1', '--page-size', String(WIDE_COUNT)]);
    assert.match(out, new RegExp(`${WIDE_COUNT} tareas`));
    rmSync(root, { recursive: true, force: true });
  });

  test('get --json survives a pipe when one task carries enough phases', () => {
    const { root, ws } = manyPhasesWorkspace();
    const out = assertPipeIsLossless(['get', 'many-phases', '--workspace', ws, '--json']);
    assert.equal(JSON.parse(out).phases.length, PHASE_COUNT);
    rmSync(root, { recursive: true, force: true });
  });

  test('the get card survives a pipe when one task carries enough phases', () => {
    const { root, ws } = manyPhasesWorkspace();
    const out = assertPipeIsLossless(['get', 'many-phases', '--workspace', ws]);
    assert.match(out, new RegExp(`Fase de derivación número ${PHASE_COUNT}`));
    rmSync(root, { recursive: true, force: true });
  });

  test('a consumer that closes the pipe early gets no stack trace and no error output', () => {
    const { root, ws } = wideWorkspace();
    for (const args of [
      ['list', '--workspace', ws, '--json'],
      ['list', '--workspace', ws, '--page', '1', '--page-size', String(WIDE_COUNT)],
    ]) {
      const r = earlyCloseCli(args);
      assert.equal(r.stderr, '', `expected silence on stderr, got: ${r.stderr}`);
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('a small payload still round-trips through a pipe byte for byte', () => {
    assertPipeIsLossless(['list', '--workspace', FIXTURE_WS, '--json'], false);
    assertPipeIsLossless(['get', 'freeform-phases', '--workspace', FIXTURE_WS, '--json'], false);
    assertPipeIsLossless(['get', 'freeform-phases', '--workspace', FIXTURE_WS], false);
  });

  test('the success path never calls process.exit, which would discard a queued write', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const entry = source.slice(source.indexOf('async function main('));

    assert.match(entry, /process\.exitCode = code/);
    assert.doesNotMatch(
      entry,
      /process\.exit\(/,
      'a payload under the stdout highWaterMark leaves write() returning true with bytes still queued in libuv; process.exit() on that path truncates stdout',
    );
  });
});

describe('task-index — decorated phase statuses strip leading decoration only', () => {
  const tableWith = (cell) =>
    parsePhases(['## Phase Progress', '', '| # | Phase Name | Status |', '|---|------------|--------|', `| 1 | Alpha | ${cell} |`, ''].join('\n'));

  const headerWith = (cell) => parsePhases(`## Phases\n\n### Phase 1: Alpha\n- Status: ${cell}\n`);

  const statusIssues = (result) => result.issues.filter((i) => i.field === 'phase.status');

  test('a leading emoji is decoration: the table cell still derives its status', () => {
    for (const cell of ['✅ done', '🟡 in_progress', '⏳ pending', '🚫 blocked']) {
      const r = tableWith(cell);
      assert.equal(r.value[0].status, cell.split(' ')[1], cell);
      assert.deepEqual(statusIssues(r), [], cell);
    }
  });

  test('a leading emoji is decoration on a header status line too', () => {
    const r = headerWith('✅ done');
    assert.equal(r.value[0].status, 'done');
    assert.deepEqual(statusIssues(r), []);
  });

  test('other leading non-letters are decoration as well', () => {
    for (const cell of ['- done', '· done', '✔ done', '**done', '1. done', '[ ] done']) {
      const r = tableWith(cell);
      assert.equal(r.value[0].status, 'done', cell);
      assert.deepEqual(statusIssues(r), [], cell);
    }
  });

  test('stripping decoration never opens a back door for trailing prose', () => {
    for (const cell of ['✅ done (v10 — FR-27)', '✅ done — shipped', '✅ done v2', '✅ Done', '[x] done']) {
      const r = tableWith(cell);
      assert.equal(r.value[0].status, null, cell);
      assert.deepEqual(
        statusIssues(r).map((i) => i.observed_token_class),
        ['out_of_allowlist'],
        cell,
      );
    }
  });

  test('a cell that is only decoration is never a status', () => {
    for (const cell of ['—', '✅', '·', '- ', '**', '···']) {
      const r = tableWith(cell);
      assert.equal(r.value[0].status, null, cell);
      const classes = statusIssues(r).map((i) => i.observed_token_class);
      assert.equal(classes.length, 1, cell);
      assert.ok(['absent', 'placeholder'].includes(classes[0]), `${cell} -> ${classes[0]}`);
    }
  });

  test('a parenthesised placeholder stays a placeholder, not out of the allowlist', () => {
    const r = tableWith('(pendiente)');
    assert.equal(r.value[0].status, null);
    assert.deepEqual(statusIssues(r).map((i) => i.observed_token_class), ['placeholder']);
  });
});
