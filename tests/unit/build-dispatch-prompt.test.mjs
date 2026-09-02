import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', '..', 'bin', 'build-dispatch-prompt.mjs');
const PLUGIN_ROOT = join(__dirname, '..', '..');

function runScript(args) {
  const result = spawnSync('node', [SCRIPT_PATH, ...args], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const PHASE_01 = `# Phase 01: Query contract
**Needs:** none

## Requirements (immutable)
<!-- Generated from PROPOSAL.md. Do not modify. -->
- FR-1: The endpoint accepts an optional search field.
- FR-2: The match is case insensitive.

## Acceptance (immutable — inlined from the source story)
- [success] A request with search returns only matching rows.
- [rejection @maxLength search] A search over 120 chars returns 422.

## Execution (mutable)
### Status: done

### Artifacts
- src/search/query.ts
- test/search/query.test.ts

### Deviations
None
`;

const PHASE_02 = `# Phase 02: Pagination

## Requirements (immutable)
- FR-3: The endpoint paginates with limit and offset.

## Acceptance (immutable)
- [boundary] offset beyond the last row returns an empty page.

## Execution (mutable)
### Status: done

### Artifacts
- src/search/paginate.ts

### Deviations
None
`;

const PHASE_03 = `# Phase 03: Response cache

## Requirements (immutable)
- FR-4: The paginated response is cached.

## Acceptance (immutable)
- [success] Two identical requests hit the database once.
- [realistic] A populated filter set still caches under one generation token.

## Execution (mutable)
### Status: pending

### Artifacts

### Deviations
`;

const PHASE_04_NO_ACCEPTANCE = `# Phase 04: Cache invalidation

## Requirements (immutable)
- FR-5: Writes invalidate the generation token.

## Execution (mutable)
### Status: pending

### Artifacts

### Deviations
`;

const TASKS_MD = `# Task: search-pagination

## Status: implementing

## Branching
- Primary branch: production/search-pagination
- Mode: worktree

## Worktrees
- payments-api: /repos/payments-api/.worktrees/search-pagination (Docker :3100)
- other-svc: /repos/other-svc/.worktrees/search-pagination
`;

function mkTaskDir(phasesByService = { 'payments-api': { '01-query-contract': PHASE_01 } }) {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-prompt-'));
  writeFileSync(join(root, 'TASKS.md'), TASKS_MD);
  writeFileSync(join(root, 'SPEC.md'), '# SPEC\n');
  writeFileSync(join(root, 'PROPOSAL.md'), '# PROPOSAL\n');
  for (const [service, phases] of Object.entries(phasesByService)) {
    const phasesDir = join(root, 'services', service, 'phases');
    mkdirSync(phasesDir, { recursive: true });
    writeFileSync(join(root, 'services', service, 'context.md'), '# CONTEXT\n');
    for (const [stem, content] of Object.entries(phases)) {
      writeFileSync(join(phasesDir, `${stem}.md`), content);
    }
  }
  return root;
}

function fullTaskDir() {
  return mkTaskDir({
    'payments-api': {
      '01-query-contract': PHASE_01,
      '02-pagination': PHASE_02,
      '03-response-cache': PHASE_03,
      '04-cache-invalidation': PHASE_04_NO_ACCEPTANCE,
    },
  });
}

function phasePath(root, stem, service = 'payments-api') {
  return join(root, 'services', service, 'phases', `${stem}.md`);
}

function headings(stdout) {
  return stdout.split('\n').filter((line) => line.startsWith('## ')).map((line) => line.slice(3));
}

function sectionBody(stdout, heading) {
  const lines = stdout.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
}

function buildFor(agent, extraArgs = []) {
  const root = fullTaskDir();
  const r = runScript([
    `--agent=${agent}`,
    `--task-dir=${root}`,
    '--service=payments-api',
    `--plugin-root=${PLUGIN_ROOT}`,
    ...extraArgs.map((a) => (typeof a === 'function' ? a(root) : a)),
  ]);
  return { root, ...r };
}

describe('build-dispatch-prompt — argument validation', () => {
  test('exits 2 when --agent is missing', () => {
    const root = mkTaskDir();
    const r = runScript([`--task-dir=${root}`, '--service=payments-api']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^ERROR: /);
    assert.match(r.stderr, /--agent required/);
  });

  test('exits 2 on an unknown agent type', () => {
    const root = mkTaskDir();
    const r = runScript(['--agent=not-a-real-agent', `--task-dir=${root}`, '--service=payments-api']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown --agent/);
  });

  test('exits 2 when --task-dir is missing', () => {
    const r = runScript(['--agent=git-agent', '--service=payments-api']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--task-dir required/);
  });

  test('exits 2 when --task-dir does not exist', () => {
    const r = runScript(['--agent=git-agent', '--task-dir=/nonexistent-dispatch-xyz', '--service=payments-api']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not found/);
  });

  test('exits 2 when --service is missing', () => {
    const root = mkTaskDir();
    const r = runScript(['--agent=git-agent', `--task-dir=${root}`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--service required/);
  });

  test('exits 2 when the service has no directory in the task', () => {
    const root = mkTaskDir();
    const r = runScript(['--agent=git-agent', `--task-dir=${root}`, '--service=ghost-svc']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /ghost-svc/);
  });

  test('exits 2 when tdd-cycle is dispatched without --phase-file', () => {
    const root = mkTaskDir();
    const r = runScript(['--agent=tdd-cycle', `--task-dir=${root}`, '--service=payments-api']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--phase-file required/);
  });

  test('exits 2 when the phase file does not exist', () => {
    const root = mkTaskDir();
    const r = runScript([
      '--agent=tdd-cycle',
      `--task-dir=${root}`,
      '--service=payments-api',
      '--phase-file=/nonexistent-phase.md',
    ]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /phase file not found/);
  });

  test('exits 2 when the notes file does not exist', () => {
    const root = mkTaskDir();
    const r = runScript([
      '--agent=git-agent',
      `--task-dir=${root}`,
      '--service=payments-api',
      '--notes-file=/nonexistent-notes.md',
    ]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /notes file not found/);
  });
});

describe('build-dispatch-prompt — sections per agent type', () => {
  test('tdd-cycle emits phase requirements, foundation, case matrix, constraints, procedure, return', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '03-response-cache')}`]);
    assert.equal(r.code, 0);
    assert.deepEqual(headings(r.stdout), [
      'CONTEXT',
      'PHASE 03 REQUIREMENTS (immutable)',
      'EXISTING FOUNDATION',
      'CASE MATRIX',
      'HARD CONSTRAINTS',
      'PROCEDURE',
      'RETURN',
    ]);
    assert.match(r.stdout, /^# DISPATCH: tdd-cycle — payments-api — phase 03$/m);
  });

  test('proposal-agent emits no phase sections', () => {
    const r = buildFor('proposal-agent');
    assert.equal(r.code, 0);
    assert.deepEqual(headings(r.stdout), ['CONTEXT', 'HARD CONSTRAINTS', 'PROCEDURE', 'RETURN']);
  });

  test('build-validator emits no phase sections', () => {
    const r = buildFor('build-validator');
    assert.equal(r.code, 0);
    assert.deepEqual(headings(r.stdout), ['CONTEXT', 'HARD CONSTRAINTS', 'PROCEDURE', 'RETURN']);
  });

  test('git-agent emits no phase sections and carries the task branch', () => {
    const r = buildFor('git-agent');
    assert.equal(r.code, 0);
    assert.deepEqual(headings(r.stdout), ['CONTEXT', 'HARD CONSTRAINTS', 'PROCEDURE', 'RETURN']);
    assert.match(sectionBody(r.stdout, 'CONTEXT'), /TASK_BRANCH: production\/search-pagination/);
  });

  test('git-agent ignores --phase-file entirely', () => {
    const r = buildFor('git-agent', [(root) => `--phase-file=${phasePath(root, '03-response-cache')}`]);
    assert.equal(r.code, 0);
    assert.deepEqual(headings(r.stdout), ['CONTEXT', 'HARD CONSTRAINTS', 'PROCEDURE', 'RETURN']);
    assert.equal(r.stdout.includes('PHASE_FILE:'), false);
  });

  test('test-writer without a phase file emits the four base sections and TEST_TIER 2', () => {
    const r = buildFor('test-writer');
    assert.equal(r.code, 0);
    assert.deepEqual(headings(r.stdout), ['CONTEXT', 'HARD CONSTRAINTS', 'PROCEDURE', 'RETURN']);
    assert.match(sectionBody(r.stdout, 'CONTEXT'), /TEST_TIER: 2/);
  });

  test('test-writer with a phase file gains the phase sections', () => {
    const r = buildFor('test-writer', [(root) => `--phase-file=${phasePath(root, '01-query-contract')}`]);
    assert.equal(r.code, 0);
    assert.deepEqual(headings(r.stdout), [
      'CONTEXT',
      'PHASE 01 REQUIREMENTS (immutable)',
      'EXISTING FOUNDATION',
      'CASE MATRIX',
      'HARD CONSTRAINTS',
      'PROCEDURE',
      'RETURN',
    ]);
  });

  test('implementer with a phase file gains the phase sections', () => {
    const r = buildFor('implementer', [(root) => `--phase-file=${phasePath(root, '02-pagination')}`]);
    assert.equal(r.code, 0);
    assert.deepEqual(headings(r.stdout), [
      'CONTEXT',
      'PHASE 02 REQUIREMENTS (immutable)',
      'EXISTING FOUNDATION',
      'CASE MATRIX',
      'HARD CONSTRAINTS',
      'PROCEDURE',
      'RETURN',
    ]);
  });

  test('every agent type exits 0 and emits the invariant trio of sections', () => {
    for (const agent of ['proposal-agent', 'test-writer', 'build-validator', 'git-agent', 'implementer']) {
      const r = buildFor(agent);
      assert.equal(r.code, 0, agent);
      assert.equal(r.stderr, '', agent);
      for (const heading of ['HARD CONSTRAINTS', 'PROCEDURE', 'RETURN']) {
        assert.ok(headings(r.stdout).includes(heading), `${agent} missing ${heading}`);
      }
    }
  });
});

describe('build-dispatch-prompt — CONTEXT', () => {
  test('resolves the service source path from the TASKS.md worktrees section', () => {
    const r = buildFor('implementer');
    const context = sectionBody(r.stdout, 'CONTEXT');
    assert.match(context, /SERVICE_SOURCE_PATH: \/repos\/payments-api\/\.worktrees\/search-pagination/);
    assert.equal(context.includes('Docker :3100'), false);
  });

  test('carries the task slug, spec, proposal and per-service context paths', () => {
    const r = buildFor('proposal-agent');
    const context = sectionBody(r.stdout, 'CONTEXT');
    assert.match(context, /TASK_SLUG: search-pagination/);
    assert.match(context, /SPEC: .*SPEC\.md/);
    assert.match(context, /PROPOSAL: .*PROPOSAL\.md/);
    assert.match(context, /TASK_CONTEXT: .*services\/payments-api\/context\.md/);
  });

  test('points at the subagent baseline under the resolved plugin root', () => {
    const r = buildFor('git-agent');
    assert.match(
      sectionBody(r.stdout, 'CONTEXT'),
      /SUBAGENT_BASELINE: .*\/jelou\/references\/subagent-base\.md/,
    );
  });

  test('report dir is phase-scoped when a phase file is given and final otherwise', () => {
    const withPhase = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '03-response-cache')}`]);
    assert.match(sectionBody(withPhase.stdout, 'CONTEXT'), /REPORT_DIR: .*phases\/03-reports/);
    const withoutPhase = buildFor('build-validator');
    assert.match(sectionBody(withoutPhase.stdout, 'CONTEXT'), /REPORT_DIR: .*phases\/final-reports/);
  });
});

describe('build-dispatch-prompt — HARD CONSTRAINTS invariance', () => {
  test('is byte-identical across two different phases of the same service', () => {
    const root = fullTaskDir();
    const args = (stem) => [
      '--agent=tdd-cycle',
      `--task-dir=${root}`,
      '--service=payments-api',
      `--plugin-root=${PLUGIN_ROOT}`,
      `--phase-file=${phasePath(root, stem)}`,
    ];
    const first = runScript(args('01-query-contract'));
    const third = runScript(args('03-response-cache'));
    assert.equal(first.code, 0);
    assert.equal(third.code, 0);
    const a = sectionBody(first.stdout, 'HARD CONSTRAINTS');
    const b = sectionBody(third.stdout, 'HARD CONSTRAINTS');
    assert.ok(a.length > 0);
    assert.equal(a === b, true);
  });

  test('is byte-identical across two different tasks for the same agent type', () => {
    const a = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '01-query-contract')}`]);
    const b = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '02-pagination')}`]);
    assert.equal(
      sectionBody(a.stdout, 'HARD CONSTRAINTS') === sectionBody(b.stdout, 'HARD CONSTRAINTS'),
      true,
    );
  });

  test('carries no task, service or phase interpolation at all', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '03-response-cache')}`]);
    const constraints = sectionBody(r.stdout, 'HARD CONSTRAINTS');
    assert.equal(constraints.includes('payments-api'), false);
    assert.equal(constraints.includes('search-pagination'), false);
    assert.equal(constraints.includes('/tmp'), false);
    assert.equal(constraints.includes('Phase 03'), false);
  });

  test('shares the baseline rules across agent types and adds agent-specific ones', () => {
    const tdd = sectionBody(buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '01-query-contract')}`]).stdout, 'HARD CONSTRAINTS');
    const writer = sectionBody(buildFor('test-writer').stdout, 'HARD CONSTRAINTS');
    assert.match(tdd, /SUBAGENT_BASELINE/);
    assert.match(writer, /SUBAGENT_BASELINE/);
    assert.match(tdd, /RED before GREEN/);
    assert.match(writer, /You author tests only/);
    assert.equal(writer.includes('RED before GREEN'), false);
  });
});

describe('build-dispatch-prompt — EXISTING FOUNDATION', () => {
  test('is explicitly empty for the first phase', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '01-query-contract')}`]);
    const body = sectionBody(r.stdout, 'EXISTING FOUNDATION');
    assert.equal(body, 'None — this is the first phase of payments-api in this task.');
  });

  test('accumulates every preceding phase for phase 03', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '03-response-cache')}`]);
    const body = sectionBody(r.stdout, 'EXISTING FOUNDATION');
    assert.match(body, /### Phase 01: Query contract/);
    assert.match(body, /### Phase 02: Pagination/);
    assert.equal(body.includes('Phase 03'), false);
    assert.match(body, /src\/search\/query\.ts/);
    assert.match(body, /src\/search\/paginate\.ts/);
  });

  test('reports each preceding phase status and covered requirement ids', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '03-response-cache')}`]);
    const body = sectionBody(r.stdout, 'EXISTING FOUNDATION');
    assert.match(body, /- Status: done/);
    assert.match(body, /- Covered: FR-1, FR-2/);
    assert.match(body, /- Covered: FR-3/);
  });

  test('grows monotonically from phase 02 to phase 03', () => {
    const second = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '02-pagination')}`]);
    const third = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '03-response-cache')}`]);
    const secondBody = sectionBody(second.stdout, 'EXISTING FOUNDATION');
    const thirdBody = sectionBody(third.stdout, 'EXISTING FOUNDATION');
    assert.equal(secondBody.includes('### Phase 02'), false);
    assert.ok(thirdBody.length > secondBody.length);
  });
});

describe('build-dispatch-prompt — CASE MATRIX', () => {
  test('reproduces the acceptance bullets of the phase file', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '01-query-contract')}`]);
    const body = sectionBody(r.stdout, 'CASE MATRIX');
    assert.match(body, /\[success\] A request with search returns only matching rows\./);
    assert.match(body, /\[rejection @maxLength search\] A search over 120 chars returns 422\./);
  });

  test('is omitted when the phase file has no Acceptance section', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '04-cache-invalidation')}`]);
    assert.equal(r.code, 0);
    assert.equal(headings(r.stdout).includes('CASE MATRIX'), false);
    assert.deepEqual(headings(r.stdout), [
      'CONTEXT',
      'PHASE 04 REQUIREMENTS (immutable)',
      'EXISTING FOUNDATION',
      'HARD CONSTRAINTS',
      'PROCEDURE',
      'RETURN',
    ]);
  });
});

describe('build-dispatch-prompt — PHASE REQUIREMENTS', () => {
  test('reproduces the requirements and strips the generator comment', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '01-query-contract')}`]);
    const body = sectionBody(r.stdout, 'PHASE 01 REQUIREMENTS (immutable)');
    assert.match(body, /FR-1: The endpoint accepts an optional search field\./);
    assert.match(body, /FR-2: The match is case insensitive\./);
    assert.equal(body.includes('Generated from PROPOSAL.md'), false);
  });

  test('parses the phase id from the filename stem the way plan-phase-waves does', () => {
    const root = mkTaskDir({ 'payments-api': { '03a-hotfix-slice': PHASE_03 } });
    const r = runScript([
      '--agent=tdd-cycle',
      `--task-dir=${root}`,
      '--service=payments-api',
      `--plugin-root=${PLUGIN_ROOT}`,
      `--phase-file=${phasePath(root, '03a-hotfix-slice')}`,
    ]);
    assert.equal(r.code, 0);
    assert.ok(headings(r.stdout).includes('PHASE 03a REQUIREMENTS (immutable)'));
    assert.match(r.stdout, /REPORT_DIR: .*phases\/03a-reports/);
  });
});

describe('build-dispatch-prompt — ORCHESTRATOR NOTES', () => {
  test('appends the notes file content as the final section', () => {
    const root = fullTaskDir();
    const notesPath = join(root, 'notes.md');
    writeFileSync(notesPath, 'Retry 2 of 5. Previous run left src/search/query.ts half-written.\n');
    const r = runScript([
      '--agent=tdd-cycle',
      `--task-dir=${root}`,
      '--service=payments-api',
      `--plugin-root=${PLUGIN_ROOT}`,
      `--phase-file=${phasePath(root, '01-query-contract')}`,
      `--notes-file=${notesPath}`,
    ]);
    assert.equal(r.code, 0);
    assert.equal(headings(r.stdout).at(-1), 'ORCHESTRATOR NOTES');
    assert.equal(
      sectionBody(r.stdout, 'ORCHESTRATOR NOTES'),
      'Retry 2 of 5. Previous run left src/search/query.ts half-written.',
    );
  });

  test('omits the section entirely when no notes file is passed', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '01-query-contract')}`]);
    assert.equal(r.stdout.includes('ORCHESTRATOR NOTES'), false);
  });

  test('omits the section when the notes file is empty', () => {
    const root = fullTaskDir();
    const notesPath = join(root, 'empty-notes.md');
    writeFileSync(notesPath, '\n\n');
    const r = runScript([
      '--agent=git-agent',
      `--task-dir=${root}`,
      '--service=payments-api',
      `--plugin-root=${PLUGIN_ROOT}`,
      `--notes-file=${notesPath}`,
    ]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.includes('ORCHESTRATOR NOTES'), false);
  });
});

describe('build-dispatch-prompt — determinism', () => {
  test('repeated invocations with the same inputs are byte-identical', () => {
    const root = fullTaskDir();
    const args = [
      '--agent=tdd-cycle',
      `--task-dir=${root}`,
      '--service=payments-api',
      `--plugin-root=${PLUGIN_ROOT}`,
      `--phase-file=${phasePath(root, '03-response-cache')}`,
    ];
    const first = runScript(args);
    const second = runScript(args);
    assert.equal(first.code, 0);
    assert.equal(first.stdout === second.stdout, true);
    assert.equal(first.stdout.length > 0, true);
  });

  test('stdout carries the prompt only and stderr stays empty on success', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '01-query-contract')}`]);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /^# DISPATCH: /);
    assert.equal(r.stdout.endsWith('\n'), true);
  });

  test('output contains no timestamp-looking token', () => {
    const r = buildFor('tdd-cycle', [(root) => `--phase-file=${phasePath(root, '03-response-cache')}`]);
    assert.equal(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r.stdout), false);
  });
});

describe('build-dispatch-prompt — generated codebase docs never reach the prompt', () => {
  test('no CODEBASE_DOCS row and no SERVICE DOCS section, even when codebase/ exists', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dispatch-workspace-'));
    const root = join(workspace, 'specs', '2026-08-08', 'search-endpoint');
    mkdirSync(join(root, 'services', 'payments-api', 'phases'), { recursive: true });
    writeFileSync(join(root, 'services', 'payments-api', 'phases', '02-pagination.md'), PHASE_02);
    const codebase = join(workspace, 'services', 'payments-api', 'codebase');
    mkdirSync(codebase, { recursive: true });
    writeFileSync(join(codebase, 'CONVENTIONS.md'), 'Use repositories, never raw SQL.\n');
    const phaseFile = join(root, 'services', 'payments-api', 'phases', '02-pagination.md');

    const r = runScript(['--agent=tdd-cycle', `--task-dir=${root}`, '--service=payments-api', `--phase-file=${phaseFile}`]);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /^- CODEBASE_DOCS:/m);
    assert.ok(!headings(r.stdout).includes('SERVICE DOCS'));
    assert.doesNotMatch(r.stdout, /never raw SQL/);
  });

  test('--docs-file is gone: the flag is ignored, not honoured', () => {
    const root = fullTaskDir();
    const docs = join(root, 'doc-cache.md');
    writeFileSync(docs, '## Conventions\nUse repositories, never raw SQL.\n');
    const r = runScript([
      '--agent=tdd-cycle', `--task-dir=${root}`, '--service=payments-api',
      `--phase-file=${phasePath(root, '02-pagination')}`, `--docs-file=${docs}`,
    ]);
    assert.equal(r.code, 0);
    assert.ok(!headings(r.stdout).includes('SERVICE DOCS'));
    assert.doesNotMatch(r.stdout, /never raw SQL/);
  });

  test('a stale --docs-file pointing at a missing file no longer exits 2', () => {
    const root = fullTaskDir();
    const r = runScript([
      '--agent=tdd-cycle', `--task-dir=${root}`, '--service=payments-api',
      `--phase-file=${phasePath(root, '02-pagination')}`, '--docs-file=/nonexistent/x.md',
    ]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!headings(r.stdout).includes('SERVICE DOCS'));
  });

  test('the tdd-cycle and proposal procedures no longer point agents at CODEBASE_DOCS', () => {
    const root = fullTaskDir();
    const phaseArgs = { 'tdd-cycle': [`--phase-file=${phasePath(root, '02-pagination')}`] };
    for (const agent of ['tdd-cycle', 'proposal-agent', 'build-validator']) {
      const r = runScript([`--agent=${agent}`, `--task-dir=${root}`, '--service=payments-api', ...(phaseArgs[agent] || [])]);
      assert.equal(r.code, 0, r.stderr);
      assert.doesNotMatch(r.stdout, /CODEBASE_DOCS/, `${agent} still references CODEBASE_DOCS`);
    }
  });
});
