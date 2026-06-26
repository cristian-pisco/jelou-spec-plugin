// tests/unit/backend-e2e-authoring.test.mjs
//
// Guards the backend-E2E *authoring* doctrine — the missing companion to the
// backend-E2E *runner*. A backend E2E must assert the persistence side effects of
// a write (the row landed in the DB, the cache key was populated/invalidated), not
// just the HTTP 2xx. And backend E2E gets the same shift-left parity as UI E2E:
// authored from SPEC.md at execute-task time, pre-deploy, committed — but still RUN
// only by /jlu-production-like.
//
// Run: `node --test tests/unit/backend-e2e-authoring.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const E2E_PATH = /test\/e2e\/\*\*|\*\.e2e-spec\.ts/;
const DOC = 'backend-e2e-authoring.md';

describe('backend-e2e-authoring reference — the assertion doctrine', () => {
  const doc = read('jelou/references/backend-e2e-authoring.md');

  test('exists and scopes itself to the backend E2E path', () => {
    assert.match(doc, /backend E2E/i);
    assert.match(doc, E2E_PATH);
  });

  test('mandates asserting DB persistence via read-back, not just the HTTP response', () => {
    assert.match(doc, /read the entity back/i);
    assert.match(doc, /not (just|only) the (2xx|status|HTTP response)|beyond the (2xx|status|HTTP response)/i);
  });

  test('has a dedicated read-endpoint (GET) section, not only mutating methods', () => {
    assert.match(doc, /Read endpoints? \(`?GET`?\)/i);
    // a GET E2E asserts the response is sourced from the real datastore...
    assert.match(doc, /sourced from the real datastore|seed.*GET.*assert/is);
    // ...and exercises filter/pagination/sort against real rows + authz scoping.
    assert.match(doc, /filter|pagination|sort/i);
    assert.match(doc, /authoriz\w+ scoping|only the rows|entitled/i);
  });

  test('mandates asserting cache side effects via imperative populate + invalidate checks', () => {
    assert.match(doc, /cache key holds the new\s+value/i);
    assert.match(doc, /stale key is gone/i);
  });

  test('forbids mocking the repository/cache inside an E2E (named anti-pattern)', () => {
    assert.match(doc, /Mocking the repository, the cache, or the DB/i);
  });

  test('points at the case-matrix for inputs (inputs vs side-effects split)', () => {
    assert.match(doc, /case[- ]matrix/i);
  });
});

describe('jlu-test-writer — applies the doctrine when authoring backend E2E', () => {
  const tw = read('agents/jlu-test-writer.md');
  test('references backend-e2e-authoring.md from the E2E authoring path', () => {
    assert.match(tw, new RegExp(DOC));
    assert.match(tw, E2E_PATH);
  });
});

describe('production-like — routes E2E authoring with the doctrine', () => {
  const wf = read('jelou/workflows/production-like.md');
  test('Phase 3.5 / breadth routing names the doctrine when delegating to jlu-test-writer', () => {
    assert.match(wf, new RegExp(DOC));
    assert.match(wf, /jlu-test-writer/);
  });
});

describe('execute-task — shift-left backend E2E authoring (parity with UI 8e)', () => {
  const wf = read('jelou/workflows/execute-task.md');
  // Slice the Step 8f section so assertions pin the step itself — not tokens
  // (SPEC.md, commit, production-like, "authors only") that recur throughout the
  // workflow and would keep the suite green even if Step 8f were gutted.
  const start = wf.indexOf('### Step 8f');
  const end = start >= 0 ? wf.indexOf('## Step 9', start) : -1;
  const s8f = start >= 0 ? wf.slice(start, end > start ? end : wf.length) : '';

  test('the Step 8f section exists', () => {
    assert.ok(start >= 0, 'execute-task.md must contain a "### Step 8f" section');
  });

  test('Step 8f authors the backend E2E suite from SPEC.md via the doctrine', () => {
    assert.match(s8f, /backend E2E/i);
    assert.match(s8f, /SPEC\.md/);
    assert.match(s8f, new RegExp(DOC));
  });

  test('Step 8f authors only — does NOT run Testcontainers (production-like stays the only runner)', () => {
    assert.match(s8f, /authors? only|does NOT run|never run/i);
    assert.match(s8f, /production-like/);
  });

  test('Step 8f detects backend services and commits the generated suite', () => {
    assert.match(s8f, /backend service/i);
    assert.match(s8f, /commit/i);
  });
});
