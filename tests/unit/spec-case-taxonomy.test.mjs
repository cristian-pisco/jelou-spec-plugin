// tests/unit/spec-case-taxonomy.test.mjs
//
// Guards the SPEC-side and QA-side expression of the case matrix:
//  - SPEC Success Criteria carry a labeled [success|rejection|realistic|boundary]
//    taxonomy with a Case-Coverage self-check before status=planned, so the
//    input space is born in the spec rather than transcribed from happy-path prose.
//  - The Coverage-Breadth smells still exist as doctrine, and the only surviving
//    enforcement is the deterministic probe — the agent that used to apply them
//    (jlu-spec-reviewer) is retired.
//
// Run: `node --test tests/unit/spec-case-taxonomy.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
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

describe('user-story template — acceptance labels subset of taxonomy', () => {
  const TAXONOMY = new Set(['success', 'rejection', 'realistic', 'boundary']);

  test('every [label] bullet in user-story.md is within the taxonomy', () => {
    const t = read('jelou/templates/user-story.md');
    const labels = [...t.matchAll(/^\s*-\s*\[([a-z]+)\b/gm)].map((m) => m[1]);
    assert.ok(labels.length >= 1, 'template must ship labeled acceptance bullets');
    for (const label of labels) {
      assert.ok(TAXONOMY.has(label), `unknown acceptance label [${label}] in user-story.md`);
    }
    assert.ok(labels.includes('success'), 'template must include a [success] bullet');
  });

  test('user-story.md carries the story frontmatter fields', () => {
    const t = read('jelou/templates/user-story.md');
    for (const field of ['id:', 'services:', 'covers:']) {
      assert.match(t, new RegExp(`^${field}`, 'm'));
    }
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

  test('the catalog states plainly that it has no enforcer', () => {
    const c = read('jelou/references/qa-smell-catalog.md');
    assert.match(c, /no enforcer/i);
    assert.match(c, /retired/i);
    assert.ok(!existsSync(join(ROOT, 'agents', 'jlu-spec-reviewer.md')));
  });

  test('the deterministic breadth probe is the only surviving enforcement', () => {
    assert.ok(existsSync(join(ROOT, 'bin', 'probe-coverage-breadth.mjs')));
    const ship = read('jelou/workflows/ship.md');
    assert.match(ship, /probe-coverage-breadth\.mjs/);
    const runner = read('agents/jlu-test-suite-runner.md');
    assert.match(runner, /probe-coverage-breadth\.mjs/);
  });
});

describe('always-run-path enforcement (not just opt-in production-like)', () => {
  test('execute-task 8c records that the unconditional breadth FAIL is gone', () => {
    const wf = read('jelou/workflows/execute-task.md');
    assert.match(wf, /### 8c\..*RETIRED/);
    assert.match(wf, /unconditional whole-task FAIL on a validated field/);
  });

  test('ship keeps the always-run breadth auditor on the PR path', () => {
    const ship = read('jelou/workflows/ship.md');
    assert.match(ship, /always runs,\s*advisory/);
    assert.match(ship, /uncovered_dimensions/);
  });
});
