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
const ship = read('jelou/workflows/ship.md');
const runnerAgent = read('agents/jlu-resolve-pr-runner.md');

const slice = (md, startHeader, endHeader) => {
  const start = md.indexOf(startHeader);
  assert.notEqual(start, -1, `missing section header: ${startHeader}`);
  const end = md.indexOf(endHeader, start + startHeader.length);
  assert.notEqual(end, -1, `missing terminator header: ${endHeader}`);
  return md.slice(start, end);
};

const step95 = slice(executeTask, '## Step 9.5 — Auto-chain', '## Step 10 — Failure Path');
const step8c = slice(executeTask, '### 8c. Comprehensive QA', '### 8d.');
const step9 = slice(executeTask, '## Step 9 — Success Path', '## Step 9.5 — Auto-chain');

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

  test('autochain ships default-on with the opt-out documented', () => {
    const template = JSON.parse(read('jelou/config/settings.json'));
    assert.equal(template.autochain, true);
    const recipe = read('jelou/references/autochain-handoff.md');
    assert.match(recipe, /default `true`/);
    assert.match(recipe, /standing kill-switch/);
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
    assert.match(step95, /Runs ONLY from the Step 9 success path/);
    assert.match(step95, /a PR is only ever opened on a green gate/);
  });

  test('the never-ask invariant lives inside Step 9.5, not only in the resume branch', () => {
    assert.match(step95, /\*\*Never ask the user to confirm shipping\*\*/);
    assert.match(step95, /standing authorization to ship/);
    assert.match(step95, /Want me to run `\/jlu-ship`\s*now\?/);
    assert.match(step95, /closed list in §5/);
  });

  test('Step 9.5 names the non-stops explicitly', () => {
    assert.match(step95, /is \*\*not\*\* a stop/);
    assert.match(step95, /inherently post-merge/);
    assert.match(step95, /overstate what was verified/);
    assert.match(step95, /SHIP_CAVEATS/);
  });

  test('Step 9 prints the manual /jlu-ship line only when the chain is off', () => {
    assert.match(step9, /\*\*Chain on\*\* \(`true`\)/);
    assert.match(step9, /\*\*Chain off\*\*/);
    assert.match(step9, /Do \*\*not\*\* print a `\/jlu-ship` line/);
  });

  test('flag resolution goes through jlu-settings with per-invocation opt-out', () => {
    assert.match(executeTask, /bin\/jlu-settings\.mjs get autochain/);
    assert.match(executeTask, /--no-autochain/);
  });

  test('ship runs inline in autonomous mode, gates auto-resolving', () => {
    assert.match(executeTask, /jelou\/workflows\/ship\.md/);
    assert.match(step95, /\*\*`<AUTONOMOUS> = yes`\*\*/);
    assert.match(step95, /none of them\s*asks/);
    assert.match(step95, /Ship's gate list is closed/);
  });

  test('a blocked service breaks task-green and gets no resolve-pr runner', () => {
    assert.match(step95, /\*\*Blocked services\.\*\*/);
    assert.match(step95, /"verdict": "BLOCKED"/);
    assert.match(step95, /NOT dispatch a resolve-pr runner/);
    assert.match(step95, /AND no service\s*`blocked` at ship/);
    assert.match(step95, /never fold them into\s*`skipped`/);
  });

  test('runners dispatch sequentially with mode-aware cwd and staging worktree', () => {
    assert.match(executeTask, /jlu-resolve-pr-runner/);
    assert.match(executeTask, /\*\*sequentially, concurrency 1\*\*/);
    assert.match(executeTask, /Mode: worktree → `<service-repo>\/\.worktrees\/<TASK_SLUG>`/);
    assert.match(executeTask, /<EPHEMERAL_BRANCH>/);
    assert.match(executeTask, /staging\/<TASK_SLUG>/);
  });

  test('task-green is the AND of every runner verdict', () => {
    assert.match(executeTask, /\*\*Task-green = AND of every runner verdict being `GREEN`, AND no service\s*`blocked` at ship\.\*\*/);
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

  test('ready_to_publish resume routes to Step 9.5 without a ship gate', () => {
    assert.match(executeTask, /\*\*Already-complete resume \(status is `ready_to_publish`\)\.\*\*/);
    assert.match(executeTask, /skip Steps 3b–9 entirely and go straight to \*\*Step 9\.5\*\*/);
    assert.match(executeTask, /\*\*Never ask the user to confirm shipping\*\*/);
    assert.match(executeTask, /Resolved not `true` → the chain is opt-out/);
  });
});

describe('advisory findings never stop the chain', () => {
  test('8c triages QA findings into blocking vs advisory', () => {
    assert.match(step8c, /Finding classification — advisory vs blocking/);
    assert.match(step8c, /A QA agent cannot create a gate/);
    assert.match(step8c, /requires\s*a smoke test/);
    assert.match(step8c, /NEVER blocks Step 9 or Step 9\.5/);
    assert.match(step8c, /\*\*Store\*\*: `SHIP_CAVEATS`/);
  });

  test('the QA agent emits advisory rows and cannot create a merge gate', () => {
    const qa = read('agents/jlu-qa-agent.md');
    assert.match(qa, /### Advisory \/ Not Verifiable Here/);
    assert.match(qa, /become the orchestrator's\s*`SHIP_CAVEATS`/);
    assert.match(qa, /You cannot create a merge gate/);
    assert.match(qa, /never phrased as\s*"must be verified before merge"/);
  });

  test('an ignored E2E suite path resolves without a question', () => {
    assert.match(executeTask, /### Step 8g — Ignored suite path/);
    assert.match(executeTask, /git check-ignore -v <suite-path>/);
    assert.match(executeTask, /local, uncommitted\*\* rule/);
    assert.match(executeTask, /committed repo rule\*\*/);
    assert.match(executeTask, /disclosure, not a\s*stop, and never a question/);
  });

  test('ship renders the caveats in both PR bodies and never drops them', () => {
    assert.match(ship, /\*\*Caller inputs \(optional\)\.\*\*/);
    assert.match(ship, /### Not verified by this PR/);
    assert.match(ship, /Never silently drop a caveat/);
    assert.match(ship, /never let a caveat become a reason to\s*skip PR creation/);
    assert.match(ship, /append the same `### Not verified by this PR`/);
    assert.match(ship, /never insert an extra "shall I open the PR\?"/);
  });

  test('9.5b hands the caveats and the autonomous flag to ship', () => {
    assert.match(step95, /Hand ship two inputs: the `SHIP_CAVEATS` list/);
    assert.match(step95, /8c\/8e\/8f\/8g/);
  });

  test('the recipe carries a closed list of legitimate stops', () => {
    const recipe = read('jelou/references/autochain-handoff.md');
    assert.match(recipe, /## 5\. What may stop the chain — closed list/);
    assert.match(recipe, /The resolved flag IS the authorization/);
    assert.match(recipe, /unattended is the configured mode, not an anomaly/);
    assert.match(recipe, /Nothing else stops it/);
    assert.match(recipe, /\*\*unspecified condition\*\*/);
    assert.match(recipe, /that sentence is the defect/);
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
    assert.match(recipe, /\*\*Died after ship\*\*/);
    assert.match(recipe, /\*\*Died before ship\*\*/);
    assert.match(recipe, /the\s+chain never asks whether to ship/);
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
