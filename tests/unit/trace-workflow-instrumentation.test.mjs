// tests/unit/trace-workflow-instrumentation.test.mjs
//
// Structural assertions for the trace instrumentation added in Phase 2.
//
// Run: `node --test tests/unit/trace-workflow-instrumentation.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('execute-task workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/execute-task.md');

  test('Step 0.5 runs trace-reconcile.mjs', () => {
    assert.match(wf, /Step 0\.5[\s\S]*?trace-reconcile\.mjs/i,
      'Step 0.5 must invoke bin/trace-reconcile.mjs');
  });

  test('opens workflow-level span with --name execute_task', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name execute_task/,
      'workflow span must be opened with --name execute_task');
  });

  test('captures WORKFLOW_SPAN_ID and WORKFLOW_TRACE_ID', () => {
    assert.match(wf, /WORKFLOW_SPAN_ID/);
    assert.match(wf, /WORKFLOW_TRACE_ID/);
  });

  test('per-phase span opened with --name phase', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name phase/);
    assert.match(wf, /PHASE_SPAN_ID/);
  });

  test('per-agent-dispatch span opened with --name agent_dispatch', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name agent_dispatch/);
    assert.match(wf, /--agent /);
    assert.match(wf, /DISPATCH_SPAN_ID/);
  });

  test('close calls exist for dispatch + phase + workflow', () => {
    const closeCount = (wf.match(/trace-end-span\.mjs/g) || []).length;
    assert.ok(closeCount >= 3,
      `expected >=3 trace-end-span.mjs calls (dispatch + phase + workflow), got ${closeCount}`);
  });

  test('dispatch end passes report-derived attrs (retries, outcome, diff-size, error-sig)', () => {
    assert.match(wf, /trace-end-span\.mjs[\s\S]*?--status/);
    assert.match(wf, /AGENT_RETRIES|--retries/);
    assert.match(wf, /ERROR_SIG|--error-sig/);
    assert.match(wf, /DIFF_SIZE_LOC|--diff-size/);
  });

  test('TRACE_DISABLED tolerance is documented', () => {
    assert.match(wf, /TRACE_DISABLED|empty span_id|tolerate empty/i);
  });
});

describe('new-task workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/new-task.md');

  test('opens workflow-level span with --name new_task', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name new_task/,
      'workflow span open required');
  });

  test('closes the workflow span with trace-end-span.mjs', () => {
    assert.match(wf, /trace-end-span\.mjs/,
      'workflow span close required');
  });

  test('captures WORKFLOW_SPAN_ID', () => {
    assert.match(wf, /WORKFLOW_SPAN_ID/,
      'span_id capture required for end-span pairing');
  });
});

describe('refine-task workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/refine-task.md');

  test('Step 0.5 runs trace-reconcile.mjs', () => {
    assert.match(wf, /trace-reconcile\.mjs/);
  });

  test('opens workflow-level span with --name refine_task', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name refine_task/);
  });

  test('closes the workflow span', () => {
    assert.match(wf, /trace-end-span\.mjs/);
  });

  test('captures WORKFLOW_SPAN_ID', () => {
    assert.match(wf, /WORKFLOW_SPAN_ID/);
  });
});

describe('ship workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/ship.md');

  test('Step 0.5 runs trace-reconcile.mjs', () => {
    assert.match(wf, /trace-reconcile\.mjs/);
  });

  test('opens workflow-level span with --name ship', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name ship/);
  });

  test('closes the workflow span', () => {
    assert.match(wf, /trace-end-span\.mjs/);
  });
});

describe('report-task workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/report-task.md');

  test('opens workflow-level span with --name report_task', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name report_task/);
  });

  test('closes the workflow span', () => {
    assert.match(wf, /trace-end-span\.mjs/);
  });
});

describe('close-task workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/close-task.md');

  test('opens workflow-level span with --name close_task', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name close_task/);
  });

  test('closes the workflow span', () => {
    assert.match(wf, /trace-end-span\.mjs/);
  });

  test('snapshots the task trace to TASK_DIR before final closure', () => {
    assert.match(wf, /_traces\/snapshot\.jsonl/);
    assert.match(wf, /task_slug/);
  });
});

describe('suggester wired into Step 0.5 of heavy workflows (Phase 3)', () => {
  const heavy = ['execute-task', 'refine-task', 'ship'];
  for (const name of heavy) {
    test(`${name} invokes bin/trace-suggest.mjs after reconcile`, () => {
      const wf = read(`jelou/workflows/${name}.md`);
      assert.match(wf, /trace-suggest\.mjs/,
        `${name} must invoke bin/trace-suggest.mjs after reconcile`);
    });

    test(`${name} documents y/n approval + suggestion-history.jsonl`, () => {
      const wf = read(`jelou/workflows/${name}.md`);
      assert.match(wf, /suggestion-history\.jsonl|y\/n approval/);
    });
  }
});
