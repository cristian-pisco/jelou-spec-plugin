// tests/unit/e2e-testcontainers-carveout.test.mjs
//
// Guards the single path-scoped carve-out of the global Testcontainers ban:
// allowed ONLY in test/e2e/** or *.e2e-spec.ts, executed ONLY by goal.
//
// Run: `node --test tests/unit/e2e-testcontainers-carveout.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const E2E_PATH = /test\/e2e\/\*\*|\*\.e2e-spec\.ts/;

describe('Testcontainers carve-out — E2E path is the only exception', () => {
  test('the ban is canonical in tdd-cycle.md and declares itself unenforced', () => {
    const tdd = read('jelou/references/tdd-cycle.md');
    assert.match(tdd, /### Test Tier Compliance \(canonical Docker\/Testcontainers ban\)/);
    assert.match(tdd, /\*\*The ban is currently unenforced\.\*\*/);
    assert.match(tdd, /self-compliance by the agents that author tests/);
    assert.match(tdd, E2E_PATH);
    assert.match(tdd, /\/jlu-goal/);
    assert.ok(!existsSync(join(ROOT, 'agents', 'jlu-spec-reviewer.md')));
  });

  test('test-writer allows Testcontainers only in the E2E path', () => {
    const tw = read('agents/jlu-test-writer.md');
    assert.match(tw, E2E_PATH);
    assert.match(tw, /Testcontainers .*only .*E2E path|E2E path .*Testcontainers/i);
    assert.match(tw, /never in Tier 1\/2|not in Tier 1\/2/i);
  });

  test('subagent-base scopes the ban to non-E2E paths', () => {
    const base = read('jelou/references/subagent-base.md');
    assert.match(base, E2E_PATH);
    assert.match(base, /\/jlu-goal/);
  });

  test('tdd-cycle notes the E2E exception', () => {
    const tdd = read('jelou/references/tdd-cycle.md');
    assert.match(tdd, E2E_PATH);
    assert.match(tdd, /\/jlu-goal/);
  });

  test('execute-task neither authors nor runs the backend E2E suite (goal owns both)', () => {
    const wf = read('jelou/workflows/execute-task.md');
    const start = wf.indexOf('### Step 8f');
    assert.ok(start >= 0, 'execute-task.md must define a "### Step 8f" section');
    const end = wf.indexOf('## Step 9', start);
    const s8f = wf.slice(start, end > start ? end : wf.length);
    assert.match(s8f, /RETIRED/);
    assert.match(s8f, E2E_PATH);
    assert.match(s8f, /no longer dispatches `jlu-test-writer`/);
    assert.match(s8f, /\/jlu-goal/);
  });
});
