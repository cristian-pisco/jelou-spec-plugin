import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const wf = read('jelou/workflows/goal.md');
const runner = read('agents/jlu-backend-e2e-runner.md');
const exec = read('jelou/workflows/execute-task.md');
const tpl = read('jelou/templates/services-yaml.md');

describe('goal — backend E2E is mandatory and non-bypassable', () => {
  test('forbids skipping / N/A / not-applicable on the backend E2E phase', () => {
    assert.match(wf, /mandatory[^.\n]*never bypassable|non-bypassable/i);
    assert.match(wf, /may\s+not\b|MUST NOT|may not skip|never/i);
    assert.match(wf, /report it as `?N\/A`?|`N\/A` \/ `?skipped`?|N\/A` \/ "?not applicable/i);
  });

  test('forbids the orchestrator short-circuiting the dispatch with its own file search', () => {
    assert.match(wf, /MUST NOT substitute its own `?find`?\/?g?l?o?b? *check to short-circuit|short-circuit the dispatch/i);
    assert.match(wf, /MUST dispatch the runner/i);
  });

  test('forbids crediting the Phase 3 integration run as the E2E phase', () => {
    assert.match(wf, /credit the Phase 3[\s\S]{0,40}integration run/i);
    assert.match(wf, /recognition is by (that|the) declared glob, never by[\s\S]{0,20}narrative/i);
  });

  test('NO_E2E_SUITE authoring is mandatory, not discretionary', () => {
    assert.match(wf, /authoring is \*?\*?MANDATORY, not discretionary/i);
    assert.match(wf, /jlu-test-writer/);
    assert.match(wf, /re-dispatch the runner \*?\*?once/i);
    assert.match(wf, /may\s+NOT skip authoring/i);
  });

  test('an unsatisfied E2E phase forces FAIL, never a silent PASS', () => {
    assert.match(wf, /UNSATISFIED/);
    assert.match(wf, /forces the overall verdict to NOT be `?PASS`?|makes the overall verdict `?FAIL`?/i);
  });
});

describe('goal — verdict cannot launder a bypass into PASS', () => {
  test('PASS requires an actual E2E runner PASS for every backend and UI service', () => {
    assert.match(wf, /`?PASS`? is granted ONLY when EVERY objective in the matrix is[\s\S]{0,300}every backend service ended in an[\s\S]{0,40}actual[\s\S]{0,20}backend-E2E runner\s+`?PASS`?/i);
    assert.match(wf, /every UI service ended in an actual UI-E2E runner\s+`?PASS`?/i);
  });

  test('a missing / skipped / N/A E2E phase is never a PASS', () => {
    assert.match(wf, /missing, skipped, or `?N\/A`? E2E phase is NEVER a\s+`?PASS`?/i);
    assert.match(wf, /no\s+verdict path where a bypassed E2E\b[\s\S]{0,40}yields `?PASS`?/i);
  });
});

describe('goal — deterministic glob recognition (services.yaml e2e.globs)', () => {
  test('resolves the E2E discovery glob from services.yaml and passes it as E2E_GLOBS', () => {
    assert.match(wf, /e2e\.globs/);
    assert.match(wf, /E2E_GLOBS/);
    assert.match(wf, /default[\s\S]{0,40}test\/e2e\/\*\*\/\*\.e2e-spec\.ts/);
  });

  test('the only sanctioned recognition of a non-default convention is the declared glob', () => {
    assert.match(wf, /\*\.integration-spec\.ts/);
    assert.match(wf, /declared glob, never by[\s\S]{0,20}narrative/i);
  });
});

describe('jlu-backend-e2e-runner — accepts E2E_GLOBS, never emits N/A', () => {
  test('discovers by E2E_GLOBS with the dedicated-suite default', () => {
    assert.match(runner, /E2E_GLOBS/);
    assert.match(runner, /Discover E2E suites by the globs in `?E2E_GLOBS`?/i);
    assert.match(runner, /test\/e2e\/\*\*/);
  });

  test('NO_E2E_SUITE is not a waiver and the runner never emits N/A/skipped', () => {
    assert.match(runner, /NOT a\s*\n?\s*waiver|This is NOT a waiver/i);
    assert.match(runner, /never emit `?N\/A`? \/ `?skipped`?/i);
    assert.match(runner, /mandatory/i);
  });
});

describe('execute-task Step 8f — glob-aware coverage, no duplicate tree', () => {
  test('the coverage check uses the declared E2E glob(s)', () => {
    assert.match(exec, /declared E2E glob\(s\)[\s\S]{0,40}e2e\.globs/i);
  });

  test('an integration-convention repo is satisfied by its TDD-authored spec', () => {
    assert.match(exec, /\*\.integration-spec\.ts.{0,3}convention/);
    assert.match(exec, /do not author[\s\S]{0,20}duplicate parallel tree/i);
  });
});

describe('services.yaml template — documents e2e.globs', () => {
  test('the schema and field table describe e2e.globs', () => {
    assert.match(tpl, /e2e\.globs/);
    assert.match(tpl, /test\/e2e\/\*\*\/\*\.e2e-spec\.ts/);
    assert.match(tpl, /ONLY sanctioned way to recognize a non-default convention/i);
  });
});
