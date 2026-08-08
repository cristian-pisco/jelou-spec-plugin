import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const agent = readFileSync(join(ROOT, 'agents/jlu-proposal-agent.md'), 'utf8');

describe('proposal-agent — deterministic execution-strategy rule', () => {
  test('the unsure-means-sequential rule is gone', () => {
    assert.doesNotMatch(agent, /If unsure, write `?sequential`?/);
  });

  test('per-service-parallel is emitted iff both signals hold', () => {
    assert.match(agent, /IF AND ONLY IF/);
    assert.match(agent, /no phase's `- \*\*Dependencies\*\*:` entry references a phase of another service/);
    assert.match(agent, /`Dependency Order` column/);
    assert.match(agent, /after <service>/);
  });

  test('ambiguity or an after-service row degrades to sequential', () => {
    assert.match(agent, /absent or ambiguous[^\n]*degrades the strategy to `sequential`/);
    assert.match(agent, /Any `after <service>` entry/);
  });

  test('the pre-submit coherence check asserts agreement between strategy and both signals', () => {
    assert.match(agent, /`Execution Strategy` AGREES with both signals/);
  });

  test('the planner is named as the independent enforcement with a downgrade reason', () => {
    assert.match(agent, /plan-phase-waves\.mjs` independently downgrades `per-service-parallel` to `sequential`/);
    assert.match(agent, /downgrade_reason/);
  });
});
