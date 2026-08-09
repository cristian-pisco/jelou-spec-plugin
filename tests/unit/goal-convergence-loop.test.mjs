import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const wf = read('jelou/workflows/goal.md');
const skill = read('skills/goal/SKILL.md');

describe('goal — Phase 0 goal matrix', () => {
  test('parses the inline matrix with the deterministic parser', () => {
    assert.match(wf, /parse-goal-matrix\.mjs/);
    assert.match(wf, /frontend \| backend \| fullstack \| unknown/);
  });

  test('interviews on ambiguity instead of guessing', () => {
    assert.match(wf, /never guess/i);
    assert.match(wf, /never drop an ambiguous objective/i);
    assert.match(wf, /AskUserQuestion/);
  });

  test('persists the resolved matrix to GOALS.md and resumes from it', () => {
    assert.match(wf, /GOALS\.md/);
    assert.match(wf, /resume/i);
    assert.match(wf, /only the non-green objectives|only the reds/i);
  });

  test('the matrix governs the verdict with SPEC.md as context', () => {
    assert.match(wf, /matrix governs the verdict/i);
    assert.match(wf, /`?SPEC\.md`? is CONTEXT/i);
    assert.match(wf, /never a second verdict source/i);
  });
});

describe('goal — objective→suite tagging contract', () => {
  test('UI specs are tagged @goal:G<id> and scoped via --grep', () => {
    assert.match(wf, /@goal:G<id>/);
    assert.match(wf, /--grep "@goal:G<id>"/);
  });

  test('backend E2E suites are tagged [G<id>] in the describe title', () => {
    assert.match(wf, /\[G<id>\]/);
    assert.match(wf, /describe\('\[G<id>\]/);
  });

  test('materialization is objective-driven and delegated with SPEC as context', () => {
    assert.match(wf, /Materialize objective E2E artifacts/i);
    assert.match(wf, /objective .*as the derivation target|objective as target/i);
    assert.match(wf, /`?\$TASK_DIR\/SPEC\.md`? as CONTEXT|`?SPEC\.md`? as context/i);
  });
});

describe('goal — convergence loop', () => {
  test('loops run → fix → re-run until green or the iteration cap', () => {
    assert.match(wf, /convergence loop/i);
    assert.match(wf, /MAX_ITERATIONS/);
    assert.match(wf, /--max-iterations=N/);
    assert.match(wf, /default `?3`?/i);
  });

  test('delegates backend fixes to jlu-implementer and UI fixes to the runner fix-loop', () => {
    assert.match(wf, /jlu-implementer/);
    assert.match(wf, /jlu-ui-fix-loop/);
    assert.match(wf, /orchestrator never fixes anything inline|never apply a fix inline/i);
  });

  test('never weakens assertions and never marks green without a passing re-run', () => {
    assert.match(wf, /never weaken an assertion/i);
    assert.match(wf, /never\s+(marks? an objective green|downgrade a red to green)\s+without a passing\s+re-run/i);
    assert.match(wf, /NEVER exceeds?\s+`?MAX_ITERATIONS`?/i);
  });

  test('exits CONVERGED (committing fixes via jlu-git-agent) or NOT-CONVERGED with evidence', () => {
    assert.match(wf, /CONVERGED/);
    assert.match(wf, /NOT-CONVERGED/);
    assert.match(wf, /jlu-git-agent/);
    assert.match(wf, /last failure evidence|failing test titles/i);
  });

  test('fullstack objectives require both sides green', () => {
    assert.match(wf, /green iff BOTH sides passed/i);
  });
});

describe('goal — video evidence', () => {
  test('frontend/fullstack objectives map to video artifacts via JLU_E2E_VIDEO', () => {
    assert.match(wf, /JLU_E2E_VIDEO/);
    assert.match(wf, /\*\.webm/);
    assert.match(wf, /pass AND fail/i);
  });

  test('a green frontend/fullstack objective without video is not reportable as green', () => {
    assert.match(wf, /NOT reportable as green/i);
    assert.match(wf, /use\.video/);
  });

  test('backend-only objectives require no video', () => {
    assert.match(wf, /Backend-only objectives require no video/i);
  });
});

describe('goal — verdict', () => {
  test('PASS requires every objective green plus video evidence', () => {
    assert.match(wf, /`?PASS`? is granted ONLY when EVERY objective in the matrix is\s+green/i);
    assert.match(wf, /video evidence/i);
    assert.match(wf, /100% of the matrix green/i);
  });

  test('a red objective at cap exhaustion yields FAIL / NOT-CONVERGED', () => {
    assert.match(wf, /`FAIL \/ NOT-CONVERGED`/);
    assert.match(wf, /iteration cap exhausted with red objectives/i);
  });

  test('the report includes a per-objective matrix table', () => {
    assert.match(wf, /goal matrix table/i);
    assert.match(wf, /iterations consumed/i);
  });
});

describe('goal — skill and runtime shells', () => {
  test('skills/goal/SKILL.md is the /jlu-goal orchestrator reading workflows/goal.md', () => {
    assert.match(skill, /name:\s*goal/);
    assert.match(skill, /\/jlu-goal/);
    assert.match(skill, /jelou\/workflows\/goal\.md/);
    assert.match(skill, /--max-iterations/);
  });

  test('the OpenCode command and Codex prompt for jlu-goal exist', () => {
    assert.ok(existsSync(join(ROOT, '.opencode/commands/jlu-goal.md')));
    assert.ok(existsSync(join(ROOT, '.codex/skills/jlu-goal/SKILL.md')));
    assert.match(read('.opencode/commands/jlu-goal.md'), /jelou\/workflows\/goal\.md/);
  });
});
