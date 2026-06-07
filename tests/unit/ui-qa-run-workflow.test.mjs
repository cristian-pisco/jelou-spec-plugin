// tests/unit/ui-qa-run-workflow.test.mjs
//
// Structural assertions for the E2E env-opt-in + Playwright-bootstrap contract
// across jelou/workflows/ui-qa-run.md, agents/jlu-ui-e2e-writer.md, and
// jelou/references/e2e-environment.md. These guard against silent regressions
// where someone removes the .env.e2e enforcement, the anti-prod gate, the
// bootstrap mode, or the BLOCKED failure rows.
//
// Run: `node --test tests/unit/ui-qa-run-workflow.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('ui-qa-run.md — env opt-in', () => {
  const wf = read('jelou/workflows/ui-qa-run.md');

  test('documents the --allow-prod-target flag', () => {
    assert.match(wf, /--allow-prod-target/);
  });

  test('requires .env.e2e to declare E2E_BASE_URL', () => {
    assert.match(wf, /\.env\.e2e missing/);
    assert.match(wf, /E2E_BASE_URL=/);
  });

  test('calls classify-e2e-target before running Playwright', () => {
    assert.match(wf, /classify-e2e-target\.mjs/);
    assert.match(wf, /points at production/);
  });
});

describe('ui-qa-run.md — bootstrap gate', () => {
  const wf = read('jelou/workflows/ui-qa-run.md');

  test('has a Playwright infrastructure check', () => {
    assert.match(wf, /Playwright infrastructure check/i);
  });

  test('dispatches the writer in MODE=bootstrap on accept', () => {
    assert.match(wf, /MODE=bootstrap/);
  });

  test('declining the bootstrap blocks (E2E mandatory)', () => {
    assert.match(wf, /Playwright infra required[\s\S]{0,120}mandatory for frontend/i);
  });
});

describe('ui-qa-run.md — failure modes', () => {
  const wf = read('jelou/workflows/ui-qa-run.md');

  test('table includes the new BLOCKED rows', () => {
    assert.match(wf, /\.env\.e2e` missing/);
    assert.match(wf, /points at prod/i);
    assert.match(wf, /declined bootstrap/i);
    assert.match(wf, /install failed/i);
  });
});

describe('e2e-environment.md — contract', () => {
  const ref = read('jelou/references/e2e-environment.md');

  test('mandates E2E_BASE_URL be declared in .env.e2e', () => {
    assert.match(ref, /\.env\.e2e/);
    assert.match(ref, /E2E_BASE_URL[\s\S]{0,200}\.env\.e2e/);
  });

  test('documents safe-vs-prod target classification', () => {
    assert.match(ref, /classify-e2e-target/);
    assert.match(ref, /default-deny/i);
  });
});

describe('jlu-ui-e2e-writer.md — bootstrap mode', () => {
  const agent = read('agents/jlu-ui-e2e-writer.md');

  test('documents MODE=bootstrap', () => {
    assert.match(agent, /bootstrap/);
    assert.match(agent, /playwright\.config\.ts/);
  });

  test('scaffolds into a dedicated tests/e2e dir (no Vitest collision)', () => {
    assert.match(agent, /tests\/e2e/);
  });
});

// Regressions found investigating the 2026-06-07 run (session 091e82e4): the
// suite ran with on-first-retry + ad-hoc retries (doubling failing-test time),
// the fix-loop agent was never dispatched (40+ min of unbounded inline
// debugging), the 15-min breaker existed only as prose, and a full .env Read
// poisoned the context into an API Usage Policy kill.
describe('ui-qa-run.md — trace and reporter hygiene', () => {
  const wf = read('jelou/workflows/ui-qa-run.md');

  test('records traces on first failure, not on retry', () => {
    assert.match(wf, /--trace=retain-on-failure/);
    assert.doesNotMatch(wf, /--trace=on-first-retry/);
  });

  test('keeps stderr out of the JSON reporter output', () => {
    assert.match(wf, /2> "\$TASK_DIR\/services\/\$UI_SERVICE\/e2e\/run\.stderr"/);
    assert.doesNotMatch(wf, /run\.json" 2>&1/);
  });

  test('forbids printing env-file contents into the conversation', () => {
    assert.match(wf, /Env hygiene/);
    assert.match(wf, /grep -qE '\^VAR='/);
  });
});

describe('ui-qa-run.md — fix-loop bounds are enforced, not prose', () => {
  const wf = read('jelou/workflows/ui-qa-run.md');

  test('arms a bash deadline and dispatch cap', () => {
    assert.match(wf, /FIX_DEADLINE=\$\(\( \$\(date \+%s\) \+ 900 \)\)/);
    assert.match(wf, /MAX_FIX_DISPATCHES=10/);
    assert.match(wf, /CIRCUIT_BREAKER/);
  });

  test('mandates fixes via the fix-loop agent, never inline', () => {
    assert.match(wf, /MUST NOT edit source or test files inline/);
  });

  test('re-runs only the failing spec per fix; full suite once at the end', () => {
    assert.match(wf, /re-run ONLY the failing spec file/);
    assert.match(wf, /full suite exactly once/);
  });

  test('failure table includes the circuit-breaker row', () => {
    assert.match(wf, /Fix budget exhausted/);
  });
});

describe('jlu-ui-e2e-writer.md — EXPECT contract', () => {
  const agent = read('agents/jlu-ui-e2e-writer.md');
  const wf = read('jelou/workflows/ui-qa-run.md');

  test('writer documents EXPECT=red vs EXPECT=live', () => {
    assert.match(agent, /<EXPECT>/);
    assert.match(agent, /EXPECT=live/);
  });

  test('EXPECT=live skips the RED-verification run, verifies collection instead', () => {
    assert.match(agent, /EXPECT=red only.*Verify the test FAILS/s);
    assert.match(agent, /--list/);
  });

  test('ui-qa-run dispatches the writer with EXPECT=live (post-deploy)', () => {
    assert.match(wf, /MODE=bootstrap` and `EXPECT=live/);
    assert.match(wf, /MODE=derive-from-spec` and `EXPECT=live/);
  });

  test('scaffolded config records traces on failure without retries', () => {
    assert.match(agent, /trace: 'retain-on-failure'/);
    assert.doesNotMatch(agent, /trace: 'on-first-retry'/);
  });
});
