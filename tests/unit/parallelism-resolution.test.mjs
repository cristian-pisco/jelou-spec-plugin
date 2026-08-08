import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wf = readFileSync(join(ROOT, 'jelou/workflows/execute-task.md'), 'utf8');

const RESOLUTION_ANCHOR =
  /--phase-parallelism|plan-phase-waves|planner|chosen_cap|auto_cap|TASK_FANOUT_CAP/;

const section = (startMarker, endMarker) => {
  const start = wf.indexOf(startMarker);
  const end = wf.indexOf(endMarker, start);
  assert.ok(start !== -1, `marker not found: ${startMarker}`);
  assert.ok(end !== -1, `end marker not found: ${endMarker}`);
  return wf.slice(start, end);
};

describe('parallelism resolution — the orchestrator never resolves auto itself', () => {
  test('every PHASE_PARALLELISM occurrence resolves to the planner or to TASK_FANOUT_CAP', () => {
    const offenders = wf
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => line.includes('PHASE_PARALLELISM'))
      .filter(({ line }) => !RESOLUTION_ANCHOR.test(line))
      .map(({ line, number }) => `execute-task.md:${number}: ${line.trim()}`);

    assert.deepEqual(
      offenders,
      [],
      'PHASE_PARALLELISM may only appear where it hands off to the planner (bin/plan-phase-waves.mjs, chosen_cap/auto_cap) or resolves to TASK_FANOUT_CAP',
    );
  });

  test('zero comparisons against the raw string auto', () => {
    assert.doesNotMatch(wf, /PHASE_PARALLELISM`?\s*(===?|!==?)\s*`?["']?auto/i);
    assert.doesNotMatch(wf, /if\s+`?PHASE_PARALLELISM`?\s+(is|==|equals)\s+`?["']?auto/i);
    assert.doesNotMatch(wf, /when\s+`?PHASE_PARALLELISM`?\s+(is|==|equals)\s+`?["']?auto/i);
  });

  test('zero orchestrator-side numeric comparisons of PHASE_PARALLELISM', () => {
    assert.doesNotMatch(wf, /PHASE_PARALLELISM`?\s*(>=?|<=?|===?)\s*`?\d/);
    assert.doesNotMatch(wf, /PHASE_PARALLELISM = P\b/);
    assert.doesNotMatch(wf, /Clamp to `?1\.\.N/);
  });

  test('the cap formula lives only in the planner — never restated in the workflow', () => {
    assert.doesNotMatch(wf, /availableParallelism/);
    assert.doesNotMatch(wf, /floor\(/);
    assert.match(wf, /--emit-cap-only --limit=/);
  });

  test('Step 4c computes TASK_FANOUT_CAP at the first point of use', () => {
    const s4c = section('### 4c. Local Detail Pass', '### 4d.');
    assert.match(s4c, /first point of use/);
    assert.match(s4c, /--emit-cap-only --limit=<N_affected_services>/);
    assert.match(s4c, /TASK_FANOUT_CAP/);
  });

  test('Step 6.4 defaults to auto, references the planner invariant, and never restates the formula', () => {
    const s64 = section('4. **Set local CPU safety throttles', '## Step 7 — Execute Phases');
    assert.match(s64, /default `auto`/);
    assert.match(s64, /at-most-one-phase-per-service-per-chunk/);
    assert.match(s64, /reduce-only/);
    assert.match(s64, /TASK_FANOUT_CAP/);
  });

  test('every orchestrator fan-out comparison uses TASK_FANOUT_CAP', () => {
    const fanOutSections = {
      '7d': section('### 7d. TDD Cycle', '### 7e'),
      '8a.3': section('### 8a.3 — Task-Level Refactor Pass', '### 8a.5'),
      '8a.5': section('### 8a.5 — Build Validation', '### 8b.'),
      '8b.4': section('#### 8b.4 — Dispatch', '#### 8b.5'),
    };
    for (const [step, body] of Object.entries(fanOutSections)) {
      assert.match(body, /TASK_FANOUT_CAP/, `Step ${step} must compare TASK_FANOUT_CAP`);
      assert.ok(!body.includes('PHASE_PARALLELISM >'), `Step ${step} still compares PHASE_PARALLELISM`);
    }
  });

  test('8b drops to one test worker under fan-out', () => {
    const s8b3 = section('#### 8b.3 — Build the affected-tests command', '#### 8b.4');
    assert.match(s8b3, /`TASK_FANOUT_CAP > 1`: drop every command to \*\*1 worker\*\*/);
    assert.match(s8b3, /--maxWorkers=1/);
    assert.match(s8b3, /--poolOptions\.threads\.maxThreads=1/);
    assert.match(s8b3, /2 × cap/);
  });

  test('the Step 7 dispatch wrapper carries the measurement attrs', () => {
    assert.match(wf, /--phase-parallelism "\$WAVE_CHOSEN_CAP"/);
    assert.match(wf, /--wave-index "\$WAVE_INDEX"/);
    assert.match(wf, /--wave-width "\$WAVE_WIDTH"/);
  });

  test('the 8b affected-tests run is span-wrapped', () => {
    const s8b4 = section('#### 8b.4 — Dispatch', '#### 8b.5');
    assert.match(s8b4, /--name affected_tests/);
    assert.match(s8b4, /--phase-parallelism "\$TASK_FANOUT_CAP"/);
  });

  test('the wave-plan JSON contract exposes the resolved caps', () => {
    assert.match(wf, /"auto_cap": <N>/);
    assert.match(wf, /"chosen_cap": <N>/);
    assert.match(wf, /downgrade_reason/);
  });
});
