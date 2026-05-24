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
import { tmpdir } from 'node:os';
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
