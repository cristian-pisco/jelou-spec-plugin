// tests/unit/execute-task-ui-e2e.test.mjs
//
// Guards the shift-left: execute-task authors the UI E2E suite from SPEC.md
// after the frontend phase reaches GREEN, pre-deploy, committed.
//
// Run: `node --test tests/unit/execute-task-ui-e2e.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wf = readFileSync(join(ROOT, 'jelou/workflows/execute-task.md'), 'utf8');

describe('execute-task — shift-left UI E2E authoring', () => {
  test('detects UI services by stack', () => {
    assert.match(wf, /react|nextjs|vue|angular|svelte/);
    assert.match(wf, /UI service|frontend service/i);
  });
  test('authors the suite from SPEC.md via jlu-ui-e2e-writer post-GREEN', () => {
    assert.match(wf, /jlu-ui-e2e-writer/);
    assert.match(wf, /derive-from-spec|MODE=bootstrap/);
    assert.match(wf, /EXPECT=red/);
    assert.match(wf, /SPEC\.md/);
  });
  test('authors pre-deploy (does not run Playwright) and commits the artifacts', () => {
    assert.match(wf, /does not run|never run.*Playwright|pre-deploy|do NOT run the suite/i);
    assert.match(wf, /commit/i);
    assert.match(wf, /user-flow\.md/);
  });
});
