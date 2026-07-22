import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const executeTask = read('jelou/workflows/execute-task.md');
const newTask = read('jelou/workflows/new-task.md');
const refineTask = read('jelou/workflows/refine-task.md');
const runnerAgent = read('agents/jlu-resolve-pr-runner.md');

describe('autochain surfaces', () => {
  test('settings helper, template, runner agent, and mirrors exist', () => {
    for (const rel of [
      'bin/jlu-settings.mjs',
      'jelou/config/settings.json',
      'agents/jlu-resolve-pr-runner.md',
      '.opencode/agents/jlu-resolve-pr-runner.md',
      '.codex/agents/jlu-resolve-pr-runner.toml',
    ]) {
      assert.ok(existsSync(join(ROOT, rel)), `missing ${rel}`);
    }
  });

  test('autochain ships default-off', () => {
    const template = JSON.parse(read('jelou/config/settings.json'));
    assert.equal(template.autochain, false);
  });

  test('skills expose the clickup reference and opt-out arguments', () => {
    for (const rel of [
      'skills/new-task/SKILL.md',
      'skills/refine-task/SKILL.md',
      'skills/execute-task/SKILL.md',
    ]) {
      const skill = read(rel);
      assert.match(skill, /clickup-url\|id/, rel);
      assert.match(skill, /--no-autochain/, rel);
    }
  });

  test('refine-task skill can dispatch subagents', () => {
    assert.match(read('skills/refine-task/SKILL.md'), /^  - Agent$/m);
  });
});

describe('execute-task auto-chain (Step 9.5)', () => {
  test('chain fires only from the success path green-gate', () => {
    assert.match(executeTask, /## Step 9\.5 — Auto-chain \(ship → PRs green\)/);
    assert.match(executeTask, /Runs ONLY from the Step 9 success path/);
    assert.match(executeTask, /never opens an unattended PR/);
  });

  test('flag resolution goes through jlu-settings with per-invocation opt-out', () => {
    assert.match(executeTask, /bin\/jlu-settings\.mjs get autochain/);
    assert.match(executeTask, /`--no-autochain` argument always wins/);
  });

  test('ship runs inline with its gates intact', () => {
    assert.match(executeTask, /jelou\/workflows\/ship\.md/);
    assert.match(executeTask, /if ship stops\s*on a gate, the chain stops with it/);
  });

  test('runners dispatch sequentially with mode-aware cwd and staging worktree', () => {
    assert.match(executeTask, /jlu-resolve-pr-runner/);
    assert.match(executeTask, /\*\*sequentially, concurrency 1\*\*/);
    assert.match(executeTask, /Mode: worktree → `<service-repo>\/\.worktrees\/<TASK_SLUG>`/);
    assert.match(executeTask, /<EPHEMERAL_BRANCH>/);
    assert.match(executeTask, /staging\/<TASK_SLUG>/);
  });

  test('task-green is the AND of every runner verdict', () => {
    assert.match(executeTask, /\*\*Task-green = AND of every runner verdict being `GREEN`\.\*\*/);
  });

  test('clickup steps are non-blocking and the chain notifies at the end', () => {
    assert.match(executeTask, /failure is a\s*WARN, never a stop/);
    assert.match(executeTask, /jlu-pm-agent/);
    assert.match(executeTask, /notifyOs/);
  });
});

describe('interview chain entries', () => {
  test('new-task creates or binds ClickUp at SPEC approval', () => {
    assert.match(newTask, /\*\*ClickUp sync & auto-chain handoff \(after the spec reaches `planned`\):\*\*/);
    assert.match(newTask, /app\.clickup\.com\/t\/<id>/);
    assert.match(newTask, /CREATE path/);
    assert.match(newTask, /never blocks the chain/);
  });

  test('new-task hands off inline, never via subagent', () => {
    assert.match(newTask, /bin\/jlu-settings\.mjs get autochain/);
    assert.match(newTask, /NEVER a subagent dispatch/);
    assert.match(newTask, /jelou\/workflows\/execute-task\.md/);
  });

  test('refine-task hands off inline only when execution is needed', () => {
    assert.match(refineTask, /bin\/jlu-settings\.mjs get autochain/);
    assert.match(refineTask, /NEVER a subagent dispatch/);
    assert.match(refineTask, /an already-aligned refinement has nothing to\s*execute and the chain does not fire/);
  });
});

describe('resolve-pr runner contract', () => {
  test('runner is autonomous-only and returns the verdict envelope', () => {
    assert.match(runnerAgent, /--autonomous/);
    assert.match(runnerAgent, /never wait\s*for input/);
    assert.match(runnerAgent, /VERDICT: GREEN \| NOT_GREEN \| BLOCKED/);
  });

  test('runner owns ephemeral staging worktrees end to end', () => {
    assert.match(runnerAgent, /<EPHEMERAL_BRANCH>/);
    assert.match(runnerAgent, /worktree add/);
    assert.match(runnerAgent, /ALWAYS remove it/);
  });

  test('runner never merges and never force-pushes', () => {
    assert.match(runnerAgent, /Never merge the PR/);
    assert.match(runnerAgent, /never force-pushes|never force-push/);
  });
});
