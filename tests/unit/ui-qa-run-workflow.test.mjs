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
