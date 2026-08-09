import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeSourceMode, sourceModeChoices } from '../../bin/lib/dev-orchestrator/source-mode.mjs';

describe('normalizeSourceMode — main', () => {
  test('returns the normalized main source mode', () => {
    assert.equal(normalizeSourceMode('main', { hasActiveTask: true }), 'main');
  });
});

describe('normalizeSourceMode — task-aware', () => {
  test('returns the normalized task-aware source mode when a task is active', () => {
    assert.equal(normalizeSourceMode('task-aware', { hasActiveTask: true }), 'task-aware');
  });
});

describe('sourceModeChoices — active task', () => {
  test('offers main and task-aware modes when a task is active', () => {
    assert.deepEqual(sourceModeChoices({ hasActiveTask: true }), [
      { value: 'main', label: 'main' },
      { value: 'task-aware', label: 'task-aware' },
    ]);
  });
});

describe('sourceModeChoices — no active task', () => {
  test('keeps main selectable and explains why task-aware is unavailable', () => {
    assert.deepEqual(sourceModeChoices({ hasActiveTask: false }), [
      { value: 'main', label: 'main' },
      {
        value: 'task-aware',
        label: 'task-aware',
        disabled: true,
        reason: 'No active task is available',
      },
    ]);
  });
});

describe('normalizeSourceMode — rejection and boundary cases', () => {
  test('rejects an unsupported source mode', () => {
    assert.throws(
      () => normalizeSourceMode('worktree', { hasActiveTask: true }),
      /unsupported source mode.*worktree.*main.*task-aware/i,
    );
  });

  test('rejects task-aware mode when no task is active', () => {
    assert.throws(
      () => normalizeSourceMode('task-aware', { hasActiveTask: false }),
      /task-aware.*no active task/i,
    );
  });

  test('accepts main mode when no task is active', () => {
    assert.equal(normalizeSourceMode('main', { hasActiveTask: false }), 'main');
  });
});
