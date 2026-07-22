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
    assert.match(executeTask, /--no-autochain/);
  });

  test('ship runs inline with its gates intact', () => {
    assert.match(executeTask, /jelou\/workflows\/ship\.md/);
    assert.match(executeTask, /if ship stops on a gate, the\s*chain stops with it/);
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
    assert.match(executeTask, /task-clickup workflow's UPDATE path inline/);
    assert.match(executeTask, /`jlu-pm-agent` is DEPRECATED/);
    assert.match(executeTask, /notifyOs/);
  });

  test('PR set filters ship rows to open created/existing PRs', () => {
    assert.match(executeTask, /`Action ∈ \{created, existing\}` AND `State = OPEN`/);
    assert.match(executeTask, /`State = MERGED` PR is trivially green/);
  });

  test('ship inline snapshots and restores the workflow span variables', () => {
    assert.match(executeTask, /EXEC_SPAN_ID=\$WORKFLOW_SPAN_ID/);
    assert.match(executeTask, /WORKFLOW_SPAN_ID=\$EXEC_SPAN_ID/);
  });

  test('chain progress persists to AUTOCHAIN.json with a re-entry path', () => {
    assert.match(executeTask, /<TASK_DIR>\/AUTOCHAIN\.json/);
    assert.match(executeTask, /\*\*Re-entry\.\*\*/);
    assert.match(executeTask, /dispatch runners only for PRs whose `verdict` is not\s*`GREEN`/);
    assert.match(executeTask, /"fixShas"/);
    assert.match(read('agents/jlu-resolve-pr-runner.md'), /FIX_SHAS/);
  });

  test('chain tokens are stripped before content parsing in every entry', () => {
    const recipe2 = read('jelou/references/autochain-handoff.md');
    assert.match(recipe2, /chain tokens, not content/);
    assert.match(newTask, /stripping the chain tokens per autochain-handoff\.md/);
    assert.match(refineTask, /stripping the chain tokens per autochain-handoff\.md/);
  });

  test('orchestrator backstops leftover ephemeral worktrees after every dispatch', () => {
    assert.match(executeTask, /\*\*worktree backstop\*\*/);
    assert.match(executeTask, /<TASK_SLUG>-resolve-tmp/);
  });

  test('staging runners cherry-pick production fixes, never author direct commits', () => {
    assert.match(executeTask, /<CHERRY_PICK_SHAS>/);
    assert.match(executeTask, /production PR first, then that service's staging PR/);
  });

  test('span outcome is blocked for any non-green verdict', () => {
    assert.match(executeTask, /`blocked`\s*otherwise \(any `NOT_GREEN` or `BLOCKED` verdict/);
  });

  test('step 1 strips clickup and flag tokens before slug resolution', () => {
    assert.match(executeTask, /first\s*non-flag, non-ClickUp token is the `task-slug`/);
  });
});

describe('interview chain entries', () => {
  const recipe = read('jelou/references/autochain-handoff.md');

  test('shared recipe carries the canonical mechanics exactly once', () => {
    assert.match(recipe, /app\.clickup\.com\/t\/<id>/);
    assert.match(recipe, /bin\/jlu-settings\.mjs get autochain/);
    assert.match(recipe, /`--no-autochain` argument always wins/);
    assert.match(recipe, /\*\*NEVER a subagent dispatch\*\*/);
    assert.match(recipe, /jelou\/workflows\/execute-task\.md/);
    assert.match(recipe, /never a stop/);
    assert.match(recipe, /\*\*Hard-stop demotion:\*\*/);
    assert.match(recipe, /close the caller's own workflow span/);
    assert.match(recipe, /## 4\. Resume after a dead session/);
    assert.match(recipe, /AUTOCHAIN\.json/);
  });

  test('all three workflows defer to the shared recipe', () => {
    for (const [name, workflow] of [['new-task', newTask], ['refine-task', refineTask], ['execute-task', executeTask]]) {
      assert.match(workflow, /jelou\/references\/autochain-handoff\.md/, name);
    }
  });

  test('new-task creates or binds ClickUp at SPEC approval', () => {
    assert.match(newTask, /\*\*ClickUp sync & auto-chain handoff \(after the spec reaches `planned`\):\*\*/);
    assert.match(newTask, /CREATE\s*path/);
    assert.match(newTask, /sprint board for the whole implementation/);
  });

  test('refine-task hands off only when execution is needed', () => {
    assert.match(refineTask, /an already-aligned refinement has\s*nothing to execute and the chain does not fire/);
    assert.match(refineTask, /UPDATE path/);
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
    assert.match(runnerAgent, /<TASK_SLUG>-resolve-tmp/);
    assert.match(runnerAgent, /origin\/<EPHEMERAL_BRANCH>/);
  });

  test('runner enforces staging cherry-pick discipline', () => {
    assert.match(runnerAgent, /<CHERRY_PICK_SHAS>/);
    assert.match(runnerAgent, /never author direct commits on\s*a staging branch/);
  });

  test('runner never merges and never force-pushes', () => {
    assert.match(runnerAgent, /Never merge the PR/);
    assert.match(runnerAgent, /never force-pushes|never force-push/);
  });
});
