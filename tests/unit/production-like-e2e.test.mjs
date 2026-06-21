// tests/unit/production-like-e2e.test.mjs
//
// Guards the production-like true-E2E behavior:
//  - a backend E2E phase (Testcontainers, deps-only, serial via WORKERS),
//  - run-existing / delegate-missing authoring via jlu-test-writer,
//  - frontend health-check reuse-or-reboot before Playwright.
//
// Run: `node --test tests/unit/production-like-e2e.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const wf = read('jelou/workflows/production-like.md');

describe('production-like — backend E2E phase', () => {
  test('declares a backend E2E phase using Testcontainers dependencies only', () => {
    assert.match(wf, /backend E2E/i);
    assert.match(wf, /Testcontainers/);
    assert.match(wf, /dependenc(y|ies) only|only .*dependenc/i);
    assert.match(wf, /test\/e2e\/\*\*|\*\.e2e-spec\.ts/);
  });

  test('runs E2E serially via WORKERS and delegates missing suites to jlu-test-writer', () => {
    assert.match(wf, /WORKERS/);
    assert.match(wf, /jlu-test-writer/);
    assert.match(wf, /--allow-test-edits/);
  });

  test('keeps /jlu-test-suite as a separate preserved phase', () => {
    assert.match(wf, /\/jlu-test-suite/);
  });
});

describe('production-like — frontend reuse', () => {
  test('health-checks backends and reuses healthy ones without teardown', () => {
    assert.match(wf, /health-check|readiness probe/i);
    assert.match(wf, /reuse/i);
    assert.match(wf, /not? .*teardown|never tear|skip .*teardown/i);
  });

  test('re-boots unhealthy/absent backends with per-run isolation', () => {
    assert.match(wf, /per-run/);
    assert.match(wf, /re-?boot|boot fresh/i);
  });
});

describe('e2e-environment — backend E2E deps model', () => {
  test('documents Testcontainers dependencies-only for backend E2E', () => {
    const env = read('jelou/references/e2e-environment.md');
    assert.match(env, /backend E2E/i);
    assert.match(env, /Testcontainers/);
    assert.match(env, /dependenc(y|ies) only|service on the host/i);
  });
});

describe('production-like — subagent-first orchestration', () => {
  test('materializes the UI suite before computing the boot order', () => {
    assert.match(wf, /Materialize UI E2E artifacts/i);
    const matIdx = wf.search(/Materialize UI E2E artifacts/i);
    const bootOrderIdx = wf.search(/Compute the Service Boot Order/);
    assert.ok(matIdx > -1 && bootOrderIdx > -1 && matIdx < bootOrderIdx,
      'materialize step must appear before the boot-order computation');
  });
  test('dispatches the runner subagents instead of executing inline', () => {
    assert.match(wf, /jlu-test-suite-runner/);
    assert.match(wf, /jlu-backend-e2e-runner/);
    assert.match(wf, /jlu-ui-qa-runner/);
  });
  test('hoists the auth gate into the orchestrator before the UI runner', () => {
    assert.match(wf, /auth gate/i);
    assert.match(wf, /storageState|cookie-guard|provision/i);
  });
  test('forbids inline authoring and fabricated scope questions', () => {
    assert.match(wf, /prodlike-\*?\.spec\.ts|prodlike-/);
    assert.match(wf, /never author|does not author|MUST NOT author/i);
    assert.match(wf, /unconditional|never ask .*scope|no .*deferred-manual|Phase-10/i);
  });
});
