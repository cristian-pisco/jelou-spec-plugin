import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('post-format re-run is gated on changed_by_format', () => {
  const wf = read('jelou/workflows/execute-task.md');

  test('workflow consults changed_by_format before re-running', () => {
    assert.match(wf, /changed_by_format=0/);
    assert.match(wf, /changed_by_format>0/);
  });

  test('the unconditional ok-means-re-run wording is gone', () => {
    assert.doesNotMatch(wf, /exactly as before \(`status=ok` → re-run/);
  });

  test('skip is logged', () => {
    assert.match(wf, /Green re-run skipped/);
  });
});

describe('tdd-cycle final verification single-file skip', () => {
  const agent = read('agents/jlu-tdd-cycle.md');

  test('agent has the single-file skip with a strict no-edits-after condition', () => {
    assert.match(agent, /Single-file skip/);
    assert.match(agent, /edited\s+ANYTHING after the last GREEN run/);
  });

  test('a fix during the final anti-pattern check voids the skip', () => {
    assert.match(agent, /fix during the final anti-pattern check[\s\S]*?re-run/i);
  });

  test('checklist accepts the skip as a valid final state', () => {
    assert.match(agent, /or the single-file skip applied/);
  });
});
