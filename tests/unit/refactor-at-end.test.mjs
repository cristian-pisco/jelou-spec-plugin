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
    assert.doesNotMatch(agent, /implementer's/);
  });

  test('reference doc points the Refactor step at 8a.3', () => {
    assert.match(ref, /Step 8a\.3/);
  });

  test('8a.3 is opt-in behind --refactor / JLU_REFACTOR=1', () => {
    const gate = wf.slice(wf.indexOf('### 8a.3'), wf.indexOf('### 8a.5'));
    assert.match(gate, /\*\*Opt-in gate/);
    assert.match(gate, /--refactor/);
    assert.match(gate, /JLU_REFACTOR=1/);
    assert.match(gate, /Refactor pass skipped — opt-in \(--refactor\)/);
    assert.match(gate, /Refactor Candidates/);
  });

  test('Step 1 argument parsing captures the --refactor flag', () => {
    assert.match(wf, /`--refactor` is captured for the Step 8a\.3 opt-in gate/);
  });

  test('all three skill argument surfaces expose --refactor', () => {
    assert.match(read('skills/execute-task/SKILL.md'), /--refactor/);
    assert.match(read('.opencode/commands/jlu-execute-task.md'), /--refactor/);
    assert.match(read('.codex/skills/jlu-execute-task/SKILL.md'), /--refactor/);
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
