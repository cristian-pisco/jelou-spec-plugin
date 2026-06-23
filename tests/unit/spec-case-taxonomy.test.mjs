// tests/unit/spec-case-taxonomy.test.mjs
//
// Guards the SPEC-side and QA-side expression of the case matrix:
//  - SPEC Success Criteria carry a labeled [success|rejection|realistic|boundary]
//    taxonomy with a Case-Coverage self-check before status=planned, so the
//    input space is born in the spec rather than transcribed from happy-path prose.
//  - The QA gate gained Coverage-Breadth smells + a contract-derived rejection
//    review, and the spec-reviewer downgrades a happy-path-only requirement.
//
// Run: `node --test tests/unit/spec-case-taxonomy.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const LABEL_SCHEME = /\[success\|rejection\|realistic\|boundary\]/;

describe('SPEC Success Criteria taxonomy', () => {
  test('new-task.md ships the labeled taxonomy + Case-Coverage self-check', () => {
    const wf = read('jelou/workflows/new-task.md');
    assert.match(wf, LABEL_SCHEME);
    assert.match(wf, /Case-Coverage self-check/);
  });

  test('jlu-spec-interviewer.md mirrors the taxonomy + self-check item', () => {
    const a = read('agents/jlu-spec-interviewer.md');
    assert.match(a, LABEL_SCHEME);
    assert.match(a, /Case taxonomy is complete/);
  });

  test('spec.md generic template carries the taxonomy stub', () => {
    assert.match(read('jelou/templates/spec.md'), LABEL_SCHEME);
  });

  test('rest-api.md turns FR-7/SC-1 into a rejection-space obligation', () => {
    const t = read('jelou/templates/spec-templates/rest-api.md');
    assert.match(t, /SC-1 \[rejection\]/);
    assert.match(t, /SC-5 \[realistic\]/);
    assert.match(t, /cross-field reference/);
  });
});

describe('QA gate — breadth-aware coverage', () => {
  test('qa-smell-catalog.md adds the Coverage-Breadth Smells', () => {
    const c = read('jelou/references/qa-smell-catalog.md');
    assert.match(c, /Coverage-Breadth Smells/);
    assert.match(c, /Happy-path-only coverage/);
    assert.match(c, /Empty-collection-only fixtures/);
    assert.match(c, /payload realism/);
  });

  test('jlu-qa-agent.md derives the rejection space from the contract', () => {
    const a = read('agents/jlu-qa-agent.md');
    assert.match(a, /[Dd]erive the rejection space from the contract/);
    assert.match(a, /Coverage-Breadth Smells/);
  });

  test('jlu-spec-reviewer.md downgrades + tags a happy-path-only requirement', () => {
    const a = read('agents/jlu-spec-reviewer.md');
    assert.match(a, /backed only by a single happy-path test is PARTIALLY_COVERED/);
    assert.match(a, /PARTIALLY_COVERED \(breadth\)/);
  });
});

describe('always-run-path enforcement (not just opt-in production-like)', () => {
  test('execute-task 8c reinforces the breadth FAIL rule when 7h is skipped', () => {
    const wf = read('jelou/workflows/execute-task.md');
    assert.match(wf, /coverage-breadth review/i);
    assert.match(wf, /must fire at 8c/);
  });

  test('ship gate prompts on a breadth gap instead of waving it through', () => {
    assert.match(read('jelou/workflows/ship.md'), /PARTIALLY_COVERED \(breadth\)/);
  });
});
