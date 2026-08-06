import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('refactor pass moved to end of task', () => {
  const wf = read('jelou/workflows/execute-task.md');
  const agent = read('agents/jlu-refactor-agent.md');
  const ref = read('jelou/references/tdd-cycle.md');

  test('execute-task has no per-phase 7g step', () => {
    assert.doesNotMatch(wf, /###\s*7g\./);
  });

  test('execute-task has the task-level pass between 8a and 8a.5', () => {
    assert.match(wf, /### 8a\.3 — Task-Level Refactor Pass \(once per service\)/);
    assert.ok(wf.indexOf('### 8a.3') > wf.indexOf('### 8a.'), '8a.3 must come after 8a');
    assert.ok(wf.indexOf('### 8a.3') < wf.indexOf('### 8a.5'), '8a.3 must come before 8a.5');
  });

  test('per-phase QA skip no longer depends on the refactor status', () => {
    assert.doesNotMatch(wf, /The refactor agent — if it ran/);
  });

  test('refactor agent is task-scoped', () => {
    assert.match(agent, /once per affected service/i);
    assert.doesNotMatch(agent, /Refactor Agent Report — Phase/);
  });

  test('reference doc points the Refactor step at 8a.3', () => {
    assert.match(ref, /Step 8a\.3/);
  });

  test('no stray 7g references remain', () => {
    for (const p of [
      'jelou/workflows/execute-task.md',
      'jelou/references/tdd-cycle.md',
      'agents/jlu-tdd-cycle.md',
      'agents/jlu-implementer.md',
      'agents/jlu-refactor-agent.md',
    ]) {
      assert.doesNotMatch(read(p), /7g/, `${p} still references 7g`);
    }
  });
});
