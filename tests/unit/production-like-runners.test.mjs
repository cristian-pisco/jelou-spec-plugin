// tests/unit/production-like-runners.test.mjs
//
// Guards the subagent-first production-like runner agents:
//  - the three runners exist with correct frontmatter,
//  - runner subagents carry NO AskUserQuestion (they return NEEDS_CONTEXT instead),
//  - jlu-ui-qa-runner carries Agent (to dispatch the fix-loop).
//
// Run: `node --test tests/unit/production-like-runners.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const frontmatter = (md) => md.split('---')[1] || '';

describe('jlu-test-suite-runner', () => {
  const md = read('agents/jlu-test-suite-runner.md');
  test('declares name, sonnet model, and the runner tools', () => {
    const fm = frontmatter(md);
    assert.match(fm, /name:\s*jlu-test-suite-runner/);
    assert.match(fm, /model:\s*sonnet/);
    assert.match(fm, /tools:.*\bBash\b/);
  });
  test('carries NO AskUserQuestion (returns NEEDS_CONTEXT instead)', () => {
    assert.doesNotMatch(frontmatter(md), /AskUserQuestion/);
    assert.match(md, /NEEDS_CONTEXT/);
  });
  test('runs the suite against the booted stack and never boots/teardowns', () => {
    assert.match(md, /test-suite/);
    assert.match(md, /booted stack|already booted|do NOT boot|never boot/i);
    assert.match(md, /breadth|probe-coverage-breadth/i);
  });
  test('returns a structured verdict and never authors tests', () => {
    assert.match(md, /STATUS: (PASS|FAIL)/);
    assert.match(md, /never author|do NOT author|does not author/i);
  });
});

describe('jlu-backend-e2e-runner', () => {
  const md = read('agents/jlu-backend-e2e-runner.md');
  test('declares name, sonnet model, Bash tool, no AskUserQuestion', () => {
    const fm = frontmatter(md);
    assert.match(fm, /name:\s*jlu-backend-e2e-runner/);
    assert.match(fm, /model:\s*sonnet/);
    assert.match(fm, /tools:.*\bBash\b/);
    assert.doesNotMatch(fm, /AskUserQuestion/);
  });
  test('runs Testcontainers deps-only E2E and reports a missing suite', () => {
    assert.match(md, /Testcontainers/);
    assert.match(md, /dependenc(y|ies) only|deps-only/i);
    assert.match(md, /test\/e2e\/\*\*|\*\.e2e-spec\.ts/);
    assert.match(md, /NO_E2E_SUITE/);
  });
  test('never authors and never boots host app services', () => {
    assert.match(md, /never author|do NOT author/i);
    assert.match(md, /tear (it |them )?down|teardown .*before the next|no orphan/i);
  });
});
