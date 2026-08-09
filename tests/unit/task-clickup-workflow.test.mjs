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
});

describe('task-clickup workflow — Step 5 macro task + OKR injection', () => {
  const wf = read('jelou/workflows/task-clickup.md');

  test('5a appends OKR block to markdown_description', () => {
    assert.match(wf, /5a\.\s+Build markdown_description/);
    assert.match(wf, /OKR block from Step 4a/);
  });

  test('5b create call resolves assignees and passes a flat ID-string array', () => {
    assert.match(wf, /5b\.\s+Create/);
    assert.match(wf, /clickup_resolve_assignees\(assignees:/);
    assert.match(
      wf,
      /clickup_create_task\([\s\S]{0,600}assignees: \["<user-id-str>"\]/
    );
  });

  test('5b create call passes custom_fields and a priority enum, not 1-4', () => {
    assert.match(
      wf,
      /clickup_create_task\([\s\S]{0,700}priority: "<urgent\|high\|normal\|low>"/
    );
    assert.match(wf, /clickup_create_task\([\s\S]{0,900}custom_fields:/);
    assert.doesNotMatch(wf, /priority: <1-4>/);
  });

  test('no ClickUp call ever passes points — not an MCP parameter', () => {
    assert.doesNotMatch(wf, /^\s*points:/m);
    assert.match(wf, /Never pass `points`/);
    assert.match(wf, /Sprint Points \/ Story Points are NOT writable/);
  });

  test('5d verifies dates and Cliente landed', () => {
    assert.match(wf, /5d\.\s+Verify dates and Cliente landed/);
    assert.match(wf, /clickup_get_task/);
    assert.match(wf, /returned\.start_date/);
    assert.match(wf, /Cliente/);
    assert.match(wf, /syncHistory\.details/);
  });
});

describe('task-clickup workflow — no work hours, no subtasks', () => {
  const wf = read('jelou/workflows/task-clickup.md');

  test('workflow never passes time_estimate to a ClickUp call', () => {
    assert.doesNotMatch(wf, /time_estimate:/);
    assert.doesNotMatch(wf, /time_estimate_ms/);
  });

  test('Rules explicitly forbid setting time_estimate / work hours', () => {
    assert.match(wf, /Never set `time_estimate` \(work hours\)/);
  });

  test('workflow does not create subtasks or derive user stories', () => {
    assert.doesNotMatch(wf, /parent:/);
    assert.doesNotMatch(wf, /uh\//);
    assert.match(wf, /Only the macro task is created — no subtasks/);
  });
});

describe('task-clickup workflow — Rules section', () => {
  const wf = read('jelou/workflows/task-clickup.md');

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
    assert.match(wf, /\*\*Cliente\*\*[\s\S]{0,120}Required — never skip/);
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

  test('Rules section forbids auto-setting human-curated date fields', () => {
    assert.match(wf, /Fecha límite modificada/);
    assert.match(wf, /Fecha de entrega al Cliente/);
    assert.match(wf, /Never auto-set human-curated fields|NEVER.*human-only|owned by people, not the workflow/);
  });

  test('Rules require OKR in both description and the OKR (Tech) custom field', () => {
    assert.match(wf, /OKR is mandatory\*\* in \*\*both\*\* the macro task description \*\*and\*\* the\s+`OKR \(Tech\)` custom field/);
  });
});

describe('task-clickup workflow — task dates + required Cliente', () => {
  const wf = read('jelou/workflows/task-clickup.md');

  test('Step 4e defines built-in start_date/due_date derivation', () => {
    assert.match(wf, /Step 4e — Task dates/);
    assert.match(wf, /start_date`\*\* = today/);
    assert.match(wf, /due_date`\*\* = last day of the destination sprint/);
    assert.match(wf, /date -d 'today 00:00' \+%F/);
    assert.doesNotMatch(wf, /\+%s%3N/);
  });

  test('Step 4e keeps built-in dates distinct from human-curated custom fields', () => {
    assert.match(wf, /distinct from the\s+human-curated custom date fields/);
  });

  test('create + update calls pass start_date and due_date as YYYY-MM-DD strings', () => {
    assert.match(
      wf,
      /clickup_create_task\([\s\S]{0,600}start_date: "<YYYY-MM-DD[\s\S]{0,120}due_date: "<YYYY-MM-DD/
    );
    assert.match(
      wf,
      /clickup_update_task\([\s\S]{0,600}start_date: "<YYYY-MM-DD[\s\S]{0,140}due_date: "<YYYY-MM-DD/
    );
  });

  test('dates are never sent as epoch ms and never carry *_date_time booleans', () => {
    assert.doesNotMatch(wf, /^\s*(start|due)_date_time: /m);
    assert.doesNotMatch(wf, /(start|due)_date: <ms-from-step-4e>/);
    assert.match(wf, /They are \*\*NOT\*\* Unix\s+milliseconds/);
  });

  test('Step 7 persists start_date_ms/due_date_ms and explains reads come back as ms', () => {
    assert.match(wf, /"start_date_ms":\s*"<milliseconds>"/);
    assert.match(wf, /"due_date_ms":\s*"<milliseconds>"/);
    assert.match(wf, /`clickup_get_task` returns `start_date` \/\s+`due_date` as epoch-millisecond strings/);
  });

  test('Rules mark start_date/due_date and Cliente as REQUIRED', () => {
    assert.match(wf, /`start_date` and `due_date` are REQUIRED/);
    assert.match(wf, /Cliente is REQUIRED — never skip it/);
  });

  test('Step 3 mapping table marks Cliente as required (not opt-in)', () => {
    assert.match(wf, /Client \| Cliente \| drop_down \| yes \|/);
  });
});

describe('task-clickup workflow — MCP tool contract (not the REST API)', () => {
  const wf = read('jelou/workflows/task-clickup.md');

  test('5e declares custom_fields values are strings and warns off the REST shapes', () => {
    assert.match(wf, /5e\.\s+Custom-field value encodings \(MCP tool contract\)/);
    assert.match(wf, /`custom_fields\[\]\.value` property is declared as\s+`type: "string"`/);
    assert.match(wf, /"fix" this table back to the REST shapes/);
    assert.match(wf, /which is NOT the raw\s+>?\s*REST API's/);
  });

  test('5e table documents the per-type string encodings', () => {
    assert.match(wf, /the number \*\*as a string\*\*/);
    assert.match(wf, /`'true'` \/ `'false'`/);
    assert.match(wf, /JSON \*\*array string\*\* of option UUIDs/);
    assert.match(wf, /JSON \*\*object string\*\* with add\/rem arrays/);
    assert.match(wf, /`progress` \| JSON object string with `current`/);
  });

  test('5e no longer documents native JSON custom-field values', () => {
    assert.doesNotMatch(wf, /\| `checkbox` \| boolean \|/);
    assert.doesNotMatch(wf, /\| `labels` \| array of strings/);
    assert.doesNotMatch(wf, /"value": \{ "add": \["<user-id-str>"\], "rem": \[\] \}/);
  });

  test('5e example payload encodes every value as a string', () => {
    assert.match(wf, /"value": "\[\\"<team-label-uuid>\\"\]"/);
    assert.match(wf, /"value": "\{\\"add\\":\[\\"<user-id-str>\\"\],\\"rem\\":\[\]\}"/);
    assert.match(wf, /"value": "<sprint-number-as-string>"/);
  });

  test('update uses the same flat assignees array as create, not {add, rem}', () => {
    assert.match(
      wf,
      /clickup_update_task\([\s\S]{0,700}assignees: \["<user-id-str>"\],\s+# flat array, same as Create/
    );
    assert.doesNotMatch(wf, /assignees: \{ "add":/);
    assert.match(wf, /Update takes the same shapes as Create on this MCP server/);
  });

  test('Step 3 discovers custom fields via clickup_get_custom_fields, not clickup_get_list', () => {
    assert.match(wf, /Use `clickup_get_custom_fields` with `list_id:/);
    assert.match(wf, /it does \*\*not\*\* return custom field definitions/);
  });

  test('Rules pin the MCP schema as the authority over the REST docs', () => {
    assert.match(wf, /Payload shapes follow the MCP tool schemas, not the ClickUp REST docs/);
    assert.match(wf, /If a ClickUp REST doc disagrees, the tool schema wins/);
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

  test('no longer maps SP to work-hour time estimates', () => {
    assert.doesNotMatch(sp, /time_estimate/);
    assert.doesNotMatch(sp, /28,800,000/);
  });

  test('asserts Sprint Points = Story Points invariant', () => {
    assert.match(sp, /Sprint-Points = Story-Points/);
  });
});
