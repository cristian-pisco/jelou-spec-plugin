// tests/unit/plan-phase-waves.test.mjs
//
// Tests for bin/plan-phase-waves.mjs — the deterministic wave planner used by
// execute-task.md Step 7.0. Verifies sequential vs per-service-parallel,
// chunking by PHASE_PARALLELISM, and edge cases (empty lanes, single service).
//
// Run: `node --test tests/unit/plan-phase-waves.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', '..', 'bin', 'plan-phase-waves.mjs');

function runScript(args, env = {}) {
  const result = spawnSync('node', [SCRIPT_PATH, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    // leave null on parse failure
  }
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed,
  };
}

function mkTaskDir(services) {
  const root = mkdtempSync(join(tmpdir(), 'plan-waves-'));
  for (const [svc, phases] of Object.entries(services)) {
    const phasesDir = join(root, 'services', svc, 'phases');
    mkdirSync(phasesDir, { recursive: true });
    for (const phaseName of phases) {
      writeFileSync(join(phasesDir, `${phaseName}.md`), `# ${phaseName}\n`);
    }
  }
  return root;
}

function mkTaskDirWithNeeds(services) {
  const root = mkdtempSync(join(tmpdir(), 'plan-waves-needs-'));
  for (const [svc, phases] of Object.entries(services)) {
    const phasesDir = join(root, 'services', svc, 'phases');
    mkdirSync(phasesDir, { recursive: true });
    for (const [phaseName, needs] of Object.entries(phases)) {
      const line = needs === undefined ? '' : `\n**Needs:** ${needs}`;
      writeFileSync(join(phasesDir, `${phaseName}.md`), `# ${phaseName}${line}\n`);
    }
  }
  return root;
}

describe('plan-phase-waves — validation', () => {
  test('errors when task-dir is missing', () => {
    const r = runScript([]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /task-dir/);
  });

  test('errors when task-dir does not exist', () => {
    const r = runScript(['--task-dir=/nonexistent-xyz']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not found/);
  });

  test('errors on unknown strategy', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-x'] });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=lol']);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /unknown strategy/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('errors when no phase files found', () => {
    const root = mkdtempSync(join(tmpdir(), 'plan-waves-empty-'));
    mkdirSync(join(root, 'services'), { recursive: true });
    try {
      const r = runScript([`--task-dir=${root}`]);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /no phase files/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('plan-phase-waves — sequential', () => {
  test('one phase per wave, services alphabetical, phases lex within service', () => {
    const dir = mkTaskDir({
      'svc-b': ['02-bar', '01-foo'],
      'svc-a': ['03-baz', '01-alpha'],
    });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=sequential']);
      assert.equal(r.code, 0);
      assert.equal(r.parsed.strategy, 'sequential');
      assert.equal(r.parsed.waves.length, 4);
      assert.deepEqual(
        r.parsed.waves.map(w => `${w[0].service}:${w[0].phase}`),
        ['svc-a:01', 'svc-a:03', 'svc-b:01', 'svc-b:02']
      );
      assert.match(r.parsed.summary, /Sequential.*4 phases.*2 service/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('phase parallelism is ignored in sequential mode', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a', '02-b'] });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=seq', '--phase-parallelism=10']);
      assert.equal(r.code, 0);
      assert.equal(r.parsed.waves.length, 2);
      assert.equal(r.parsed.waves[0].length, 1);
      assert.equal(r.parsed.waves[1].length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('plan-phase-waves — per-service-parallel', () => {
  test('zips lanes by index — 2 services, same length', () => {
    const dir = mkTaskDir({
      'svc-a': ['01-a', '02-a'],
      'svc-b': ['01-b', '02-b'],
    });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=per-service-parallel', '--phase-parallelism=2']);
      assert.equal(r.code, 0);
      assert.equal(r.parsed.strategy, 'per-service-parallel');
      assert.equal(r.parsed.waves.length, 2);
      assert.equal(r.parsed.waves[0].length, 2);
      assert.equal(r.parsed.waves[1].length, 2);
      assert.deepEqual(
        r.parsed.waves[0].map(p => `${p.service}:${p.phase}`).sort(),
        ['svc-a:01', 'svc-b:01']
      );
      assert.deepEqual(
        r.parsed.waves[1].map(p => `${p.service}:${p.phase}`).sort(),
        ['svc-a:02', 'svc-b:02']
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('uneven lanes — short lane finishes in early waves', () => {
    const dir = mkTaskDir({
      'svc-a': ['01-a', '02-a', '03-a', '04-a'],
      'svc-b': ['01-b', '02-b'],
    });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=2']);
      assert.equal(r.parsed.waves.length, 4);
      assert.equal(r.parsed.waves[0].length, 2); // svc-a:01 + svc-b:01
      assert.equal(r.parsed.waves[1].length, 2); // svc-a:02 + svc-b:02
      assert.equal(r.parsed.waves[2].length, 1); // svc-a:03 only
      assert.equal(r.parsed.waves[3].length, 1); // svc-a:04 only
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('chunks wave when PHASE_PARALLELISM < services in wave', () => {
    const dir = mkTaskDir({
      'svc-a': ['01-a'],
      'svc-b': ['01-b'],
      'svc-c': ['01-c'],
    });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=2']);
      // 3 services would naively be 1 wave of 3; chunked to PARALLELISM=2 → 2 waves [2, 1].
      assert.equal(r.parsed.waves.length, 2);
      assert.equal(r.parsed.waves[0].length, 2);
      assert.equal(r.parsed.waves[1].length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PHASE_PARALLELISM=1 serializes everything (still per-service ordering)', () => {
    const dir = mkTaskDir({
      'svc-a': ['01-a', '02-a'],
      'svc-b': ['01-b', '02-b'],
    });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=1']);
      assert.equal(r.parsed.waves.length, 4); // each wave has exactly 1 phase
      for (const w of r.parsed.waves) assert.equal(w.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('single service — psp behaves like sequential within that service', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a', '02-a', '03-a'] });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=4']);
      assert.equal(r.parsed.waves.length, 3);
      for (const w of r.parsed.waves) assert.equal(w.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lanes object reflects per-service phase listing', () => {
    const dir = mkTaskDir({
      'svc-a': ['01-x', '02-y'],
      'svc-b': ['01-z'],
    });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=psp']);
      assert.equal(Object.keys(r.parsed.lanes).length, 2);
      assert.equal(r.parsed.lanes['svc-a'].length, 2);
      assert.equal(r.parsed.lanes['svc-b'].length, 1);
      assert.equal(r.parsed.lanes['svc-a'][0].phase, '01');
      assert.match(r.parsed.lanes['svc-a'][0].phase_file, /01-x\.md$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('plan-phase-waves — phase id parsing', () => {
  test('extracts NN<letter> suffix from filenames like 03a-foo.md', () => {
    const dir = mkTaskDir({
      'svc-a': ['03a-something', '03b-other', '04-finale'],
    });
    try {
      const r = runScript([`--task-dir=${dir}`]);
      const phases = r.parsed.waves.map(w => w[0].phase);
      assert.deepEqual(phases, ['03a', '03b', '04']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('intra-service needs', () => {
  test('two independent phases in one service serialize even at cap 2 (per-service-parallel)', () => {
    const dir = mkTaskDirWithNeeds({
      'svc-a': { '01-base': 'none', '02-x': '01', '03-y': '01' },
    });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=per-service-parallel', '--phase-parallelism=2']);
      assert.equal(r.code, 0);
      assert.equal(r.parsed.waves.length, 3);
      for (const w of r.parsed.waves) assert.equal(w.length, 1);
      assert.deepEqual(r.parsed.waves.map((w) => w[0].phase), ['01', '02', '03']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cap 1 re-serializes a shared level (dormant)', () => {
    const dir = mkTaskDirWithNeeds({
      'svc-a': { '01-base': 'none', '02-x': '01', '03-y': '01' },
    });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=per-service-parallel', '--phase-parallelism=1']);
      assert.equal(r.code, 0);
      assert.equal(r.parsed.waves.length, 3);
      assert.deepEqual(r.parsed.waves.map((w) => w[0].phase), ['01', '02', '03']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('sequential serializes a shared level within a single service even at cap 2', () => {
    const dir = mkTaskDirWithNeeds({
      'svc-a': { '01-base': 'none', '02-x': '01', '03-y': '01' },
    });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=sequential', '--phase-parallelism=2']);
      assert.equal(r.code, 0);
      assert.equal(r.parsed.waves.length, 3);
      for (const w of r.parsed.waves) assert.equal(w.length, 1);
      assert.deepEqual(r.parsed.waves.map((w) => w[0].phase), ['01', '02', '03']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a **Needs:** given as a phase filename stem resolves to its id', () => {
    const dir = mkTaskDirWithNeeds({
      'svc-a': { '01-base': 'none', '02-x': '01-base', '03-y': '02-x.md' },
    });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=sequential', '--phase-parallelism=2']);
      assert.equal(r.code, 0, `expected ok, got: ${r.stderr}`);
      assert.deepEqual(r.parsed.waves.map((w) => w[0].phase), ['01', '02', '03']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no **Needs:** lines → identical to today (backward compat)', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a', '02-a', '03-a'] });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=per-service-parallel', '--phase-parallelism=2']);
      assert.equal(r.code, 0);
      assert.deepEqual(
        r.parsed.waves.map((w) => w.map((p) => `${p.service}:${p.phase}`)),
        [['svc-a:01'], ['svc-a:02'], ['svc-a:03']],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an empty **Needs:** line does not read into following lines', () => {
    const root = mkdtempSync(join(tmpdir(), 'plan-waves-empty-'));
    const phasesDir = join(root, 'services', 'svc-a', 'phases');
    mkdirSync(phasesDir, { recursive: true });
    writeFileSync(join(phasesDir, '01-base.md'), '# 01-base\n**Needs:** none\n');
    writeFileSync(join(phasesDir, '02-x.md'), '# 02-x\n**Needs:**\n\n## Requirements (immutable)\n- FR-1: a thing\n');
    try {
      const r = runScript([`--task-dir=${root}`, '--strategy=sequential']);
      assert.equal(r.code, 0);
      assert.equal(r.parsed.waves.length, 2);
      assert.deepEqual(r.parsed.waves.map((w) => w[0].phase), ['01', '02']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a **Needs:** reference to a non-existent phase exits 3', () => {
    const dir = mkTaskDirWithNeeds({ 'svc-a': { '01-base': 'none', '02-x': '99' } });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=sequential']);
      assert.equal(r.code, 3);
      assert.match(r.stderr, /phase '02' needs '99' which is not a phase/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a dependency cycle exits 3', () => {
    const dir = mkTaskDirWithNeeds({ 'svc-a': { '01-base': 'none', '02-x': '03', '03-y': '02' } });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=sequential']);
      assert.equal(r.code, 3);
      assert.match(r.stderr, /dependency cycle/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const NO_CAP_ENV = { JLU_PHASE_PARALLELISM: '', PLAN_PHASE_PARALLELISM: '' };
const machineFloor = Math.max(Math.floor(availableParallelism() / 4), 1);

function mkMixedWaveDir() {
  return mkTaskDirWithNeeds({
    'svc-a': { '01-a': 'none', '02-a': 'none' },
    'svc-b': { '01-b': 'none' },
  });
}

describe('service-aware chunker', () => {
  test('mixed wave [A1,A2,B1] at cap 2 chunks to [[A1,B1],[A2]]', () => {
    const dir = mkMixedWaveDir();
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=2'], NO_CAP_ENV);
      assert.equal(r.code, 0);
      assert.deepEqual(
        r.parsed.waves.map((w) => w.map((p) => `${p.service}:${p.phase}`)),
        [['svc-a:01', 'svc-b:01'], ['svc-a:02']],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('manual cap above cross-service width never co-schedules same-service phases', () => {
    const dir = mkMixedWaveDir();
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=8'], NO_CAP_ENV);
      assert.equal(r.code, 0);
      assert.deepEqual(
        r.parsed.waves.map((w) => w.map((p) => `${p.service}:${p.phase}`)),
        [['svc-a:01', 'svc-b:01'], ['svc-a:02']],
      );
      for (const w of r.parsed.waves) {
        const distinct = new Set(w.map((p) => p.service));
        assert.equal(distinct.size, w.length);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('auto cap resolution', () => {
  test('--phase-parallelism=auto clamps floor(availableParallelism/4) to cross-service width', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a'], 'svc-b': ['01-b'] });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=auto'], NO_CAP_ENV);
      assert.equal(r.code, 0);
      const expected = Math.min(machineFloor, 2);
      assert.equal(r.parsed.auto_cap, expected);
      assert.equal(r.parsed.chosen_cap, expected);
      assert.equal(r.parsed.phase_parallelism, expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('JLU_PHASE_PARALLELISM reduces the auto cap', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a'], 'svc-b': ['01-b'] });
    try {
      const r = runScript(
        [`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=auto'],
        { ...NO_CAP_ENV, JLU_PHASE_PARALLELISM: '1' },
      );
      assert.equal(r.code, 0);
      assert.equal(r.parsed.chosen_cap, 1);
      assert.equal(r.parsed.auto_cap, Math.min(machineFloor, 2));
      for (const w of r.parsed.waves) assert.equal(w.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('JLU_PHASE_PARALLELISM can never raise the cap above auto', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a'], 'svc-b': ['01-b'] });
    try {
      const r = runScript(
        [`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=auto'],
        { ...NO_CAP_ENV, JLU_PHASE_PARALLELISM: '999' },
      );
      assert.equal(r.code, 0);
      assert.equal(r.parsed.chosen_cap, r.parsed.auto_cap);
      assert.ok(r.parsed.chosen_cap <= 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PLAN_PHASE_PARALLELISM no longer raises the default cap', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a'], 'svc-b': ['01-b'] });
    try {
      const r = runScript(
        [`--task-dir=${dir}`, '--strategy=psp'],
        { ...NO_CAP_ENV, PLAN_PHASE_PARALLELISM: '8' },
      );
      assert.equal(r.code, 0);
      assert.equal(r.parsed.chosen_cap, 1);
      assert.equal(r.parsed.waves.length, 2);
      for (const w of r.parsed.waves) assert.equal(w.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PLAN_PHASE_PARALLELISM can never raise the cap above auto', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a'], 'svc-b': ['01-b'] });
    try {
      const r = runScript(
        [`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=auto'],
        { ...NO_CAP_ENV, PLAN_PHASE_PARALLELISM: '999' },
      );
      assert.equal(r.code, 0);
      assert.equal(r.parsed.chosen_cap, r.parsed.auto_cap);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('env ceiling also reduces a manual numeric cap', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a'], 'svc-b': ['01-b'] });
    try {
      const r = runScript(
        [`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=2'],
        { ...NO_CAP_ENV, JLU_PHASE_PARALLELISM: '1' },
      );
      assert.equal(r.code, 0);
      assert.equal(r.parsed.chosen_cap, 1);
      for (const w of r.parsed.waves) assert.equal(w.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('--emit-cap-only', () => {
  test('prints the clamped cap without requiring a task dir', () => {
    const r = runScript(['--emit-cap-only', '--limit=3'], NO_CAP_ENV);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), String(Math.min(machineFloor, 3)));
  });

  test('JLU_PHASE_PARALLELISM is reduce-only in cap-only mode', () => {
    const reduced = runScript(['--emit-cap-only', '--limit=8'], { ...NO_CAP_ENV, JLU_PHASE_PARALLELISM: '1' });
    assert.equal(reduced.code, 0);
    assert.equal(reduced.stdout.trim(), '1');
    const raised = runScript(['--emit-cap-only', '--limit=8'], { ...NO_CAP_ENV, JLU_PHASE_PARALLELISM: '999' });
    assert.equal(raised.code, 0);
    assert.equal(raised.stdout.trim(), String(Math.min(machineFloor, 8)));
  });

  test('--limit=1 always prints 1', () => {
    const r = runScript(['--emit-cap-only', '--limit=1'], { ...NO_CAP_ENV, JLU_PHASE_PARALLELISM: '999' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), '1');
  });

  test('requires a positive integer --limit', () => {
    const r = runScript(['--emit-cap-only'], NO_CAP_ENV);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--limit must be a positive integer/);
  });
});

describe('strategy downgrade on Dependency Order', () => {
  const PROPOSAL_WITH_ORDER = [
    '# Proposal — Sample',
    '',
    '## Affected Services',
    '| Service | Role | Dependency Order |',
    '|---------|------|-----------------|',
    '| svc-a | Primary | 1 (first) |',
    '| svc-b | Consumer | 2 (after svc-a) |',
    '',
    '## Execution Strategy',
    '`per-service-parallel`',
    '',
  ].join('\n');

  const PROPOSAL_UNIFORM = [
    '# Proposal — Sample',
    '',
    '## Affected Services',
    '| Service | Role | Dependency Order |',
    '|---------|------|-----------------|',
    '| svc-a | Primary | 1 (parallel) |',
    '| svc-b | Consumer | 1 (parallel) |',
    '',
    '## Execution Strategy',
    '`per-service-parallel`',
    '',
  ].join('\n');

  test('per-service-parallel downgrades to sequential when the table declares after <service>', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a'], 'svc-b': ['01-b'] });
    writeFileSync(join(dir, 'PROPOSAL.md'), PROPOSAL_WITH_ORDER);
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=per-service-parallel', '--phase-parallelism=2'], NO_CAP_ENV);
      assert.equal(r.code, 0);
      assert.equal(r.parsed.strategy, 'sequential');
      assert.match(r.parsed.downgrade_reason, /after svc-a/);
      assert.match(r.stderr, /WARN/);
      assert.equal(r.parsed.waves.length, 2);
      for (const w of r.parsed.waves) assert.equal(w.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('uniform Dependency Order keeps per-service-parallel with no downgrade_reason', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a'], 'svc-b': ['01-b'] });
    writeFileSync(join(dir, 'PROPOSAL.md'), PROPOSAL_UNIFORM);
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=per-service-parallel', '--phase-parallelism=2'], NO_CAP_ENV);
      assert.equal(r.code, 0);
      assert.equal(r.parsed.strategy, 'per-service-parallel');
      assert.equal(r.parsed.downgrade_reason, undefined);
      assert.equal(r.parsed.waves.length, 1);
      assert.equal(r.parsed.waves[0].length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missing PROPOSAL.md never downgrades', () => {
    const dir = mkTaskDir({ 'svc-a': ['01-a'], 'svc-b': ['01-b'] });
    try {
      const r = runScript([`--task-dir=${dir}`, '--strategy=per-service-parallel', '--phase-parallelism=2'], NO_CAP_ENV);
      assert.equal(r.code, 0);
      assert.equal(r.parsed.strategy, 'per-service-parallel');
      assert.equal(r.parsed.downgrade_reason, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CRITICAL regression — auto with W=1 matches the sequential status quo', () => {
  test('strategy=sequential under auto yields chosen_cap=1 and byte-identical waves', () => {
    const dir = mkTaskDirWithNeeds({
      'svc-a': { '01-base': 'none', '02-x': '01', '03-y': '01' },
    });
    try {
      const baseline = runScript([`--task-dir=${dir}`, '--strategy=sequential'], NO_CAP_ENV);
      const auto = runScript([`--task-dir=${dir}`, '--strategy=sequential', '--phase-parallelism=auto'], NO_CAP_ENV);
      assert.equal(auto.code, 0);
      assert.equal(auto.parsed.chosen_cap, 1);
      assert.equal(JSON.stringify(auto.parsed.waves), JSON.stringify(baseline.parsed.waves));
      assert.deepEqual(
        auto.parsed.waves.map((w) => w.map((p) => `${p.service}:${p.phase}`)),
        [['svc-a:01'], ['svc-a:02'], ['svc-a:03']],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('strategy=per-service-parallel with a single service under auto yields chosen_cap=1 and byte-identical waves', () => {
    const dir = mkTaskDirWithNeeds({
      'svc-a': { '01-base': 'none', '02-x': '01', '03-y': '01' },
    });
    try {
      const baseline = runScript([`--task-dir=${dir}`, '--strategy=psp'], NO_CAP_ENV);
      const auto = runScript([`--task-dir=${dir}`, '--strategy=psp', '--phase-parallelism=auto'], NO_CAP_ENV);
      assert.equal(auto.code, 0);
      assert.equal(auto.parsed.chosen_cap, 1);
      assert.equal(auto.parsed.auto_cap, 1);
      assert.equal(JSON.stringify(auto.parsed.waves), JSON.stringify(baseline.parsed.waves));
      assert.deepEqual(
        auto.parsed.waves.map((w) => w.map((p) => `${p.service}:${p.phase}`)),
        [['svc-a:01'], ['svc-a:02'], ['svc-a:03']],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
