import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPT_PATH = join(ROOT, 'bin', 'phase-state.mjs');

const TABLE_TASKS = `# TASKS: demo

## Phase Progress

| # | Phase Name | Status | Started | Completed |
|---|-----------|--------|---------|-----------|
| 1 | Alpha | pending | — | — |
| 2 | Beta | pending | — | — |

## Timeline
`;

const HEADER_TASKS = `# TASKS: demo

## Phases

### Phase 1: Alpha
- Status: pending

### Phase 2: Beta
- Status: pending

## Timeline
`;

const PHASE_FILE = `# Phase 01: Alpha

## Requirements (immutable)
- FR-1: do the thing

## Execution (mutable)

### Status: pending

### Artifacts
`;

function parseOutput(stdout) {
  const out = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: parseOutput(result.stdout),
  };
}

function setupTask(tasksMd = TABLE_TASKS) {
  const dir = mkdtempSync(join(tmpdir(), 'phase-state-'));
  writeFileSync(join(dir, 'TASKS.md'), tasksMd);
  const phasesDir = join(dir, 'services', 'api', 'phases');
  mkdirSync(phasesDir, { recursive: true });
  writeFileSync(join(phasesDir, '01-alpha.md'), PHASE_FILE);
  return { dir, phaseFile: join(phasesDir, '01-alpha.md') };
}

function readTasks(dir) {
  return readFileSync(join(dir, 'TASKS.md'), 'utf8');
}

function base(dir, event) {
  return [`--event=${event}`, `--task-dir=${dir}`, '--service=api', '--phase=01'];
}

describe('phase-state.mjs — start event', () => {
  test('writes in_progress to the phase file and both TASKS.md grammars', () => {
    const { dir, phaseFile } = setupTask();
    try {
      const r = run([...base(dir, 'start'), '--phase-title=Alpha', '--started-at=2026-01-01T00:00:00Z']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.parsed.status, 'ok');
      assert.equal(r.parsed.phase_status, 'in_progress');
      assert.equal(r.parsed.started_at, '2026-01-01T00:00:00Z');
      assert.equal(r.parsed.grammar, 'table+headers');
      assert.equal(r.parsed.phase_file, phaseFile);

      assert.match(readFileSync(phaseFile, 'utf8'), /^### Status: in_progress$/m);
      const tasks = readTasks(dir);
      assert.match(tasks, /\| 1 \| Alpha \| in_progress \| 2026-01-01T00:00:00Z \| — \|/);
      assert.match(tasks, /### Phase 01: Alpha\n- Status: in_progress\n- Started: 2026-01-01T00:00:00Z/);
      assert.match(tasks, /\| 2 \| Beta \| pending \|/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('derives the phase file from --service and --phase', () => {
    const { dir, phaseFile } = setupTask();
    try {
      const r = run(base(dir, 'start'));
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.parsed.phase_file, phaseFile);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('emits no span and never touches the trace layer without span flags', () => {
    const { dir } = setupTask();
    const traceFile = join(dir, 'spans.jsonl');
    try {
      const r = run(base(dir, 'start'), { TRACE_FILE: traceFile });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.parsed.span_id, undefined);
      assert.equal(existsSync(traceFile), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('phase-state.mjs — end event', () => {
  test('writes status, tests, commit, completion, artifacts and deviations', () => {
    const { dir, phaseFile } = setupTask();
    try {
      run([...base(dir, 'start'), '--started-at=2026-01-01T00:00:00Z']);
      const r = run([
        ...base(dir, 'end'),
        '--tests-passed=12',
        '--tests-total=12',
        '--commit-sha=abc1234',
        '--artifacts=src/a.ts, test/a.spec.ts',
        '--deviations=used an existing helper',
        '--completed-at=2026-01-01T01:00:00Z',
      ]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.parsed.phase_status, 'done');
      assert.equal(r.parsed.commit, 'abc1234');

      assert.match(readFileSync(phaseFile, 'utf8'), /^### Status: done$/m);
      const tasks = readTasks(dir);
      assert.match(tasks, /- Status: done/);
      assert.match(tasks, /- Tests: 12\/12 passing/);
      assert.match(tasks, /- Commit: abc1234/);
      assert.match(tasks, /- Completed: 2026-01-01T01:00:00Z/);
      assert.match(tasks, /- Artifacts: src\/a\.ts, test\/a\.spec\.ts/);
      assert.match(tasks, /- Deviations: used an existing helper/);
      assert.match(tasks, /- Started: 2026-01-01T00:00:00Z/);
      assert.match(tasks, /\| 1 \| Alpha \| done \| 2026-01-01T00:00:00Z \| 2026-01-01T01:00:00Z \|/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--no-diff records "(no diff)" for a finalize-phase.sh no_changes abort', () => {
    const { dir } = setupTask();
    try {
      const r = run([...base(dir, 'end'), '--no-diff', '--completed-at=2026-01-01T01:00:00Z']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.parsed.commit, '(no diff)');
      assert.match(readTasks(dir), /- Commit: \(no diff\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects --commit-sha together with --no-diff', () => {
    const { dir } = setupTask();
    try {
      const r = run([...base(dir, 'end'), '--no-diff', '--commit-sha=abc1234']);
      assert.equal(r.code, 1);
      assert.equal(r.parsed.status, 'abort');
      assert.equal(r.parsed.reason, 'conflicting_commit_inputs');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts blocked as an end status and rejects unknown ones', () => {
    const { dir } = setupTask();
    try {
      const ok = run([...base(dir, 'end'), '--status=blocked', '--no-diff']);
      assert.equal(ok.code, 0, ok.stderr);
      assert.equal(ok.parsed.phase_status, 'blocked');
      assert.match(readTasks(dir), /- Status: blocked/);

      const bad = run([...base(dir, 'end'), '--status=green']);
      assert.equal(bad.code, 1);
      assert.equal(bad.parsed.reason, 'invalid_status');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('phase-state.mjs — resume path (Step 3 reads PHASE_STATE from TASKS.md)', () => {
  test('task-index parses the table grammar it wrote', async () => {
    const { dir } = setupTask();
    try {
      run([...base(dir, 'start')]);
      run([...base(dir, 'end'), '--commit-sha=abc1234']);
      const { parsePhases } = await import(join(ROOT, 'bin', 'lib', 'task-index', 'extract.mjs'));
      const parsed = parsePhases(readTasks(dir));
      assert.equal(parsed.grammar, 'table');
      assert.deepEqual(
        parsed.value.map((p) => [p.phase_number, p.heading, p.status]),
        [[1, 'Alpha', 'done'], [2, 'Beta', 'pending']],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('task-index parses the headers grammar it wrote', async () => {
    const { dir } = setupTask(HEADER_TASKS);
    try {
      const start = run([...base(dir, 'start')]);
      assert.equal(start.parsed.grammar, 'headers');
      run([...base(dir, 'end'), '--tests-passed=3', '--tests-total=3', '--no-diff']);
      const { parsePhases } = await import(join(ROOT, 'bin', 'lib', 'task-index', 'extract.mjs'));
      const parsed = parsePhases(readTasks(dir));
      assert.equal(parsed.grammar, 'headers');
      assert.deepEqual(
        parsed.value.map((p) => [p.phase_number, p.heading, p.status]),
        [[1, 'Alpha', 'done'], [2, 'Beta', 'pending']],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a phase absent from TASKS.md gets a parseable entry created', async () => {
    const { dir } = setupTask('# TASKS: demo\n\n## Timeline\n');
    try {
      const r = run([...base(dir, 'start'), '--phase-title=Alpha']);
      assert.equal(r.code, 0, r.stderr);
      const { parsePhases } = await import(join(ROOT, 'bin', 'lib', 'task-index', 'extract.mjs'));
      const parsed = parsePhases(readTasks(dir));
      assert.deepEqual(
        parsed.value.map((p) => [p.phase_number, p.heading, p.status]),
        [[1, 'Alpha', 'in_progress']],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('phase-state.mjs — phase span (only with span flags)', () => {
  test('opens and closes the phase span in-process', () => {
    const { dir } = setupTask();
    const traceFile = join(dir, 'spans.jsonl');
    try {
      const start = run(
        [...base(dir, 'start'), '--span-parent=WF1', '--span-trace=TR1', '--task-slug=demo'],
        { TRACE_FILE: traceFile },
      );
      assert.equal(start.code, 0, start.stderr);
      assert.match(start.parsed.span_id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
      assert.equal(start.parsed.trace_id, 'TR1');

      const end = run(
        [
          ...base(dir, 'end'),
          '--commit-sha=abc1234',
          `--span=${start.parsed.span_id}`,
          '--span-status=ok',
          '--span-success=pass@1',
          '--span-attempts=1',
        ],
        { TRACE_FILE: traceFile },
      );
      assert.equal(end.code, 0, end.stderr);
      assert.equal(end.parsed.span_closed, 'true');

      const events = readFileSync(traceFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(events.length, 2);
      assert.equal(events[0].event_kind, 'span_start');
      assert.equal(events[0].name, 'phase');
      assert.equal(events[0].parent_span_id, 'WF1');
      assert.equal(events[0].task_slug, 'demo');
      assert.equal(events[1].event_kind, 'span_end');
      assert.equal(events[1].span_id, start.parsed.span_id);
      assert.equal(events[1].trace_id, 'TR1');
      assert.equal(events[1].status, 'ok');
      assert.equal(events[1].attrs.success, 'pass@1');
      assert.equal(events[1].attrs.attempts_to_green, 1);
      assert.equal(typeof events[1].duration_ms, 'number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('defaults the span status from the phase status', () => {
    const { dir } = setupTask();
    const traceFile = join(dir, 'spans.jsonl');
    try {
      const start = run([...base(dir, 'start'), '--span-parent=WF1', '--span-trace=TR1'], { TRACE_FILE: traceFile });
      run(
        [...base(dir, 'end'), '--status=blocked', '--no-diff', `--span=${start.parsed.span_id}`],
        { TRACE_FILE: traceFile },
      );
      const events = readFileSync(traceFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(events[1].status, 'blocked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('phase-state.mjs — input validation', () => {
  test('aborts on an unknown event', () => {
    const { dir } = setupTask();
    try {
      const r = run(['--event=middle', `--task-dir=${dir}`, '--phase=01', '--service=api']);
      assert.equal(r.code, 1);
      assert.equal(r.parsed.reason, 'invalid_event');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('aborts when TASKS.md is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phase-state-'));
    try {
      const r = run(['--event=start', `--task-dir=${dir}`, '--phase=01', '--service=api']);
      assert.equal(r.code, 1);
      assert.equal(r.parsed.reason, 'tasks_md_missing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('aborts when the phase file cannot be resolved', () => {
    const { dir } = setupTask();
    try {
      const r = run(['--event=start', `--task-dir=${dir}`, '--phase=07', '--service=api']);
      assert.equal(r.code, 1);
      assert.equal(r.parsed.reason, 'phase_file_missing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('aborts when neither --service nor --phase-file is given', () => {
    const { dir } = setupTask();
    try {
      const r = run(['--event=start', `--task-dir=${dir}`, '--phase=01']);
      assert.equal(r.code, 1);
      assert.equal(r.parsed.reason, 'missing_service');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
