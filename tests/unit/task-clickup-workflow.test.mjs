// tests/unit/task-clickup-workflow.test.mjs
//
// Structural assertions for jelou/workflows/task-clickup.md and the OKR /
// story-points reference docs. These guard against silent regressions where
// someone deletes a critical instruction (e.g., the time_estimate-in-create
// rule, the OKR block, or the CUE framework reference). The workflow itself
// is LLM-executed, so we cannot test runtime behavior — but we can test that
// the prompt contract stays intact.
//
// Run: `node --test tests/unit/task-clickup-workflow.test.mjs`

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

describe('task-clickup workflow — Step 4 OKR + CUE wiring', () => {
  const wf = read('jelou/workflows/task-clickup.md');

  test('Step 4a references the OKR mapping doc', () => {
    assert.match(wf, /Step 4a — Select OKR/);
    assert.match(wf, /jelou\/references\/okr-mapping\.md/);
  });

  test('Step 4b references the Story Points doc and the CUE framework', () => {
    assert.match(wf, /Step 4b — Story Points/);
    assert.match(wf, /jelou\/references\/story-points-estimation\.md/);
    assert.match(wf, /CUE framework/);
    assert.match(wf, /AI-first/);
  });

  test('Step 4b explicitly says N files/PRs/repos must NOT inflate SP', () => {
    assert.match(wf, /N \(file ?\/ ?PR ?\/ ?repo count\) inflate SP|N \(files ?\/ ?PRs ?\/ ?repos\) does not inflate SP|N \(file\/PR\/repo count\) (must )?not inflate SP|Do not let N/);
  });

  test('Step 4b instructs to abort with DIVIDIR for SP >= 13', () => {
    assert.match(wf, /13\/21|DIVIDIR before syncing|DIVIDIR/);
  });

  test('Step 4c contains the SP→ms calibration table', () => {
    assert.match(wf, /28,800,000/);
    assert.match(wf, /57,600,000/);
    assert.match(wf, /144,000,000/);
  });
});

describe('task-clickup workflow — Step 5 time_estimate + OKR injection', () => {
  const wf = read('jelou/workflows/task-clickup.md');

  test('5a appends OKR block to markdown_description', () => {
    assert.match(wf, /5a\.\s+Build markdown_description/);
    assert.match(wf, /OKR block from Step 4a/);
  });

  test('5b passes time_estimate directly in the create call', () => {
    assert.match(wf, /5b\.\s+Create/);
    assert.match(wf, /time_estimate.*directly in the create call/);
    assert.match(wf, /clickup_create_task[\s\S]{0,400}time_estimate:/);
  });

  test('5b warns against the trailing-only update pattern', () => {
    assert.match(wf, /Do NOT use a follow-up `clickup_update_task` only to set\s+the estimate/);
    assert.match(wf, /"1m" default/);
  });

  test('5d defines a verification protocol with fallback', () => {
    assert.match(wf, /5d\.\s+Verify time_estimate landed/);
    assert.match(wf, /clickup_get_task/);
    assert.match(wf, /60000/);
    assert.match(wf, /fallback/i);
    assert.match(wf, /syncHistory\.details/);
  });

  test('subtasks (Step 7b) also pass time_estimate in create + verify', () => {
    assert.match(wf, /Pass `time_estimate` \*\*in the same create call/);
    assert.match(wf, /Verify\*\* `time_estimate` on every subtask/);
  });
});

describe('task-clickup workflow — Rules section', () => {
  const wf = read('jelou/workflows/task-clickup.md');

  test('Rules forbid trailing-only time_estimate updates', () => {
    assert.match(wf, /never as a\s+trailing-only update/);
  });

  test('Rules require OKR in macro task description', () => {
    assert.match(wf, /OKR is mandatory/);
  });

  test('Rules require CUE + AI-first SP methodology', () => {
    assert.match(wf, /CUE \+ AI-first framework/);
  });
});

describe('OKR reference doc', () => {
  const okr = read('jelou/references/okr-mapping.md');

  test('lists all five 2026 objectives', () => {
    for (const obj of [
      'Objetivo 1',
      'Objetivo 2',
      'Objetivo 3',
      'Objetivo 4',
      'Objetivo 5',
    ]) {
      assert.match(okr, new RegExp(obj));
    }
  });

  test('includes the quick-pick table by task type', () => {
    assert.match(okr, /Selección rápida por tipo de tarea/);
    assert.match(okr, /Bug fix \/ Incident response/);
    assert.match(okr, /AI tooling \/ Dev productivity/);
  });

  test('shows the exact embedding format', () => {
    assert.match(okr, /## OKR\s+\*\*KR <number>\*\* — <KR description>/);
  });
});

describe('Story Points reference doc', () => {
  const sp = read('jelou/references/story-points-estimation.md');

  test('describes the CUE framework explicitly', () => {
    assert.match(sp, /Framework CUE/);
    assert.match(sp, /Complejidad/);
    assert.match(sp, /Uncertidumbre/);
    assert.match(sp, /Esfuerzo/);
  });

  test('flags the AI-first adjustment as mandatory', () => {
    assert.match(sp, /Ajuste AI-first \(regla obligatoria\)/);
    assert.match(sp, /N archivos \/ N PRs \/ N repos no infla SP/);
  });

  test('publishes the SP → ms mapping consumed by Step 4c', () => {
    assert.match(sp, /28,800,000/);
    assert.match(sp, /57,600,000/);
    assert.match(sp, /86,400,000/);
    assert.match(sp, /144,000,000/);
    assert.match(sp, /230,400,000/);
  });

  test('asserts Sprint Points = Story Points invariant', () => {
    assert.match(sp, /Sprint-Points = Story-Points/);
  });
});
