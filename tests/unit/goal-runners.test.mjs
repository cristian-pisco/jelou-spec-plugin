// tests/unit/goal-runners.test.mjs
//
// Guards the subagent-first production-like runner agents:
//  - the three runners exist with correct frontmatter,
//  - runner subagents carry NO AskUserQuestion (they return NEEDS_CONTEXT instead),
//  - jlu-ui-qa-runner carries Agent (to dispatch the fix-loop).
//
// Run: `node --test tests/unit/goal-runners.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
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

describe('jlu-ui-qa-runner', () => {
  const md = read('agents/jlu-ui-qa-runner.md');
  test('declares name, sonnet model, carries Agent but NOT AskUserQuestion', () => {
    const fm = frontmatter(md);
    assert.match(fm, /name:\s*jlu-ui-qa-runner/);
    assert.match(fm, /model:\s*sonnet/);
    assert.match(fm, /tools:.*\bAgent\b/);
    assert.doesNotMatch(fm, /AskUserQuestion/);
  });
  test('assumes a valid session (no auth gate) and never boots', () => {
    assert.match(md, /valid session|session .*already|skip .*auth|no auth gate/i);
    assert.match(md, /do NOT boot|never boot|orchestrator .*boot/i);
  });
  test('runs Playwright, owns the bounded fix-loop, returns breadth + needs_context', () => {
    assert.match(md, /Playwright/);
    assert.match(md, /jlu-ui-fix-loop/);
    assert.match(md, /minimal[- ]input|ui_breadth_gaps/i);
    assert.match(md, /NEEDS_CONTEXT/);
  });

  test('carries the execution body self-contained — no pointer to a retired workflow', () => {
    assert.doesNotMatch(md, /ui-qa-run\.md/);
    assert.doesNotMatch(md, /ui-qa-cleanup/);
    assert.doesNotMatch(md, /step 1[4-8][a-z']?\b/);
    assert.match(md, /npx playwright test/);
    assert.match(md, /--trace=retain-on-failure/);
    assert.match(md, /extract-trace\.mjs/);
    assert.match(md, /MAX_FIX_DISPATCHES=10/);
    assert.match(md, /FIX_DEADLINE/);
    assert.match(md, /no_tests_collected/);
  });

  test('every reference it points at exists on disk', () => {
    for (const ref of md.match(/jelou\/references\/[a-z0-9-]+\.md/g) ?? []) {
      assert.ok(existsSync(join(ROOT, ref)), `${ref} referenced by jlu-ui-qa-runner.md does not exist`);
    }
  });
});

describe('goal.md — the jlu-ui-qa-runner dispatch contract', () => {
  const wf = read('jelou/workflows/goal.md');

  test('names every required runner input', () => {
    for (const input of [
      'TASK_DIR', 'UI_SERVICE_ID', 'UI_SERVICE_WORKTREE', 'PLUGIN_ROOT',
      'WORKERS', 'PLAYWRIGHT_CONFIG', 'ALLOW_PROD_TARGET', 'ALLOW_TEST_EDITS',
      'GREP', 'USER_FEEDBACK',
    ]) {
      assert.match(wf, new RegExp(`\\b${input}\\b`), `goal.md must pass ${input} to jlu-ui-qa-runner`);
    }
  });

  test('handles all four runner STATUS outcomes', () => {
    const i = wf.indexOf('Runner output contract');
    assert.ok(i > -1, 'goal.md must document the runner output contract');
    const region = wf.slice(i, i + 1800);
    assert.match(region, /PASS/);
    assert.match(region, /FAIL/);
    assert.match(region, /BLOCKED/);
    assert.match(region, /NEEDS_CONTEXT/);
    assert.match(region, /AskUserQuestion/);
    assert.match(region, /jlu-ui-e2e-writer/);
  });

  test('cites no retired workflow file', () => {
    assert.doesNotMatch(wf, /ui-qa-run\.md/);
    assert.doesNotMatch(wf, /ui-qa-cleanup\.md/);
  });
});
