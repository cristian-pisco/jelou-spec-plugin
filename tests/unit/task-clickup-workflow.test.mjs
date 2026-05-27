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

describe('task-clickup workflow — extended field coverage', () => {
  const wf = read('jelou/workflows/task-clickup.md');

  test('Step 3 mapping table includes the extended ClickUp fields', () => {
    assert.match(wf, /OKR \(Tech\)\s*\|\s*labels/);
    assert.match(wf, /Estado del diseño\s*\|\s*drop_down/);
    assert.match(wf, /Proyecto\s*\|\s*drop_down/);
    assert.match(wf, /QA Asignado\s*\|\s*users/);
    assert.match(wf, /Cliente\s*\|\s*drop_down/);
  });

  test('Step 4d documents inference for OKR (Tech), Estado del diseño, Proyecto, QA Asignado, Cliente', () => {
    assert.match(wf, /\*\*OKR \(Tech\)\*\*[\s\S]{0,400}KR-code prefix/);
    assert.match(wf, /\*\*Estado del diseño\*\*[\s\S]{0,300}Solicitado/);
    assert.match(wf, /\*\*Proyecto\*\*[\s\S]{0,400}affected services/);
    assert.match(wf, /\*\*QA Asignado\*\*[\s\S]{0,200}Opt-in/);
    assert.match(wf, /\*\*Cliente\*\*[\s\S]{0,200}Opt-in/);
  });

  test('Step 5e example payload includes the OKR (Tech) labels field and the extended fields', () => {
    assert.match(wf, /<okr-tech-field-id>/);
    assert.match(wf, /<okr-option-uuid-matching-KR-code>/);
    assert.match(wf, /<qa-asignado-field-id>/);
    assert.match(wf, /<estado-del-diseno-field-id>/);
    assert.match(wf, /<proyecto-field-id>/);
    assert.match(wf, /<cliente-field-id>/);
  });

  test('Step 8 field_mappings persists the extended fields and the OKR option map', () => {
    assert.match(wf, /"OKR \(Tech\)":\s*"<field-id>"/);
    assert.match(wf, /"Estado del diseño":\s*"<field-id>"/);
    assert.match(wf, /"Proyecto":\s*"<field-id>"/);
    assert.match(wf, /"QA Asignado":\s*"<field-id>"/);
    assert.match(wf, /"Cliente":\s*"<field-id>"/);
    assert.match(wf, /"okr_option_map":/);
  });

  test('subtasks inherit the extended custom-field set', () => {
    assert.match(wf, /Subtasks inherit ALL parent custom fields[\s\S]{0,400}OKR \(Tech\)/);
    assert.match(wf, /Subtasks inherit ALL parent custom fields[\s\S]{0,400}Estado del diseño/);
    assert.match(wf, /Subtasks inherit ALL parent custom fields[\s\S]{0,400}Proyecto/);
    assert.match(wf, /Subtasks inherit ALL parent custom fields[\s\S]{0,400}QA Asignado/);
    assert.match(wf, /Subtasks inherit ALL parent custom fields[\s\S]{0,400}Cliente/);
  });

  test('Rules section forbids auto-setting human-curated date fields', () => {
    assert.match(wf, /Fecha límite modificada/);
    assert.match(wf, /Fecha de entrega al Cliente/);
    assert.match(wf, /Never auto-set human-curated fields|NEVER.*human-only|owned by people, not the workflow/);
  });

  test('Rules require OKR in both description and the OKR (Tech) custom field', () => {
    assert.match(wf, /OKR is mandatory\*\* in \*\*both\*\* the macro task description \*\*and\*\* the\s+`OKR \(Tech\)` custom field/);
  });
});

describe('OKR reference doc — OKR (Tech) custom-field instructions', () => {
  const okr = read('jelou/references/okr-mapping.md');

  test('removes the false claim that the list has no OKR field', () => {
    assert.doesNotMatch(okr, /the list does not have an OKR field/);
  });

  test('documents the dual write (description + custom field)', () => {
    assert.match(okr, /The `OKR \(Tech\)` custom field \(type `labels`\)/);
    assert.match(okr, /markdown_description/);
  });

  test('explains option resolution by KR-code prefix', () => {
    assert.match(okr, /OKR \(Tech\) custom field — option resolution/);
    assert.match(okr, /KR-code prefix|starts with the selected KR code/);
    assert.match(okr, /single-element array/);
    assert.match(okr, /do \*\*not\*\* hardcode|Never invent a UUID/);
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
