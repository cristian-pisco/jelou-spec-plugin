import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wf = readFileSync(join(ROOT, 'jelou/workflows/execute-task.md'), 'utf8');

const section = (startMarker, endMarker) => {
  const start = wf.indexOf(startMarker);
  assert.ok(start !== -1, `marker not found: ${startMarker}`);
  const end = wf.indexOf(endMarker, start);
  assert.ok(end !== -1, `end marker not found: ${endMarker}`);
  return wf.slice(start, end);
};

describe('Steps 1-3 read task state from task-index.mjs, not from TASKS.md', () => {
  const steps123 = section('## Step 1 — Resolve Task', '## Step 3b —');

  test('Step 1 resolves the task with one task-index invocation', () => {
    assert.match(steps123, /task-index\.mjs get "\$IDENT" --json/);
    assert.match(steps123, /task-index\.mjs list --json/);
    assert.match(steps123, /never\s+searches `<WORKSPACE_PATH>\/specs\/` across date folders/);
  });

  test('every Step 2 variable is a field of the same JSON, not a hand parse', () => {
    for (const field of ['\\.slug', '\\.root_path', '\\.status', '\\.services\\[\\]\\.id', '\\.phases', '\\.setup_mode']) {
      assert.match(steps123, new RegExp(field), `TASK_JSON.${field} must feed a stored variable`);
    }
    assert.match(steps123, /TASK_SLUG/);
    assert.match(steps123, /TASK_DIR/);
    assert.match(steps123, /CURRENT_STATUS/);
    assert.match(steps123, /AFFECTED_SERVICES/);
    assert.match(steps123, /PHASE_STATE/);
    assert.match(steps123, /SETUP_MODE/);
  });

  test('the not-found, ambiguous and no-workspace exits are all handled', () => {
    assert.match(steps123, /no spec workspace/);
    assert.match(steps123, /No task found\. Run `\/jlu-new-task`\s+first\./);
    assert.match(steps123, /matches several date folders/);
  });

  test('the stop gates and the branching mode survive the rewire', () => {
    assert.match(steps123, /`draft` or `refining`/);
    assert.match(steps123, /`closed` or `cancelled`/);
    assert.match(steps123, /## Branching → Mode/);
    assert.match(steps123, /`null` means `worktree`/);
  });

  test('Step 3 keeps the ready_to_publish autochain branch and the in_progress reset', () => {
    assert.match(steps123, /status is `ready_to_publish`/);
    assert.match(steps123, /go straight to \*\*Step 9\.5\*\*/);
    assert.match(steps123, /`status` is `in_progress`/);
    assert.match(steps123, /back to `pending`/);
    assert.match(steps123, /RESUME_FROM/);
  });

  test('Step 3 derives RESUME_FROM from PHASE_STATE instead of re-reading TASKS.md', () => {
    assert.match(steps123, /read the mid-execution state off `PHASE_STATE`/);
    assert.match(steps123, /do NOT re-read\n?\s*`TASKS\.md`/);
  });
});

describe('every subagent dispatch prompt comes from build-dispatch-prompt.mjs', () => {
  const s2c = section('### 2c. Dispatch prompts', '---\n\n## Step 3');

  test('2c names the script, its agents and its flags', () => {
    assert.match(s2c, /build-dispatch-prompt\.mjs/);
    assert.match(s2c, /--agent=<proposal-agent\|tdd-cycle\|test-writer\|build-validator\|implementer>/);
    assert.match(s2c, /--task-dir=/);
    assert.match(s2c, /--service=/);
    assert.match(s2c, /--phase-file=/);
    assert.match(s2c, /--notes-file=/);
  });

  test('2c forbids restating what the script emits', () => {
    assert.match(s2c, /The orchestrator does not compose agent prompts/);
    assert.match(s2c, /Never restate a section the script emits/);
    assert.match(s2c, /## HARD CONSTRAINTS/);
  });

  test('2c bounds the notes-file escape hatch', () => {
    assert.match(s2c, /only escape hatch/);
    assert.match(s2c, /Never\s*requirements, acceptance, constraints, procedure or return format/);
  });

  test('2c closes the branch-mode SERVICE_SOURCE_PATH gap', () => {
    assert.match(s2c, /Known gap — `SERVICE_SOURCE_PATH` is not always derivable/);
    assert.match(s2c, /`SETUP_MODE = branch`/);
    assert.match(s2c, /SERVICE_SOURCE_PATH: <SERVICE_SOURCE_PATH\[service-id\]>/);
    assert.match(s2c, /`proposal-agent` is exempt/);
  });

  test('each dispatch site defers to 2c and none composes a prompt inline', () => {
    for (const [label, body] of Object.entries({
      '4b': section('### 4b. Global Strategy Pass', '### 4c.'),
      '4c': section('### 4c. Local Detail Pass', '### 4d.'),
      '7d': section('### 7d. TDD Cycle', '### 7e —'),
      '8a': section('### 8a. Write Tier 2 Integration Tests', '### 8a.3'),
      '8a.5': section('### 8a.5 — Build Validation', '### 8b.'),
      '8b.5': section('#### 8b.5 — Handle failures', '#### 8b.6'),
    })) {
      assert.match(body, /§2c/, `Step ${label} must build its prompt per §2c`);
    }
  });

  test('7d hands the phase file to the script and restates nothing', () => {
    const s7d = section('### 7d. TDD Cycle', '### 7e —');
    assert.match(s7d, /--agent=tdd-cycle/);
    assert.match(s7d, /--phase-file="<PHASE_FILE>"/);
    assert.match(s7d, /Nothing above is restated here or in the dispatch/);
    assert.doesNotMatch(s7d, /- \*\*Input\*\*:/);
  });
});

describe('Step 8e delegates the UI split and covers all three writer modes', () => {
  const s8e = section('### Step 8e — Materialize the UI E2E suite', '### Step 8f');

  test('the UI/backend split is classify-task-scope.mjs, not restated prose', () => {
    assert.match(s8e, /classify-task-scope\.mjs/);
    assert.match(s8e, /The UI\/backend split is not restated here/);
    assert.match(s8e, /ui_services/);
    assert.match(s8e, /backend_services/);
    assert.match(s8e, /warnings/);
  });

  test('all three jlu-ui-e2e-writer modes have a branch, including normal', () => {
    for (const mode of ['bootstrap', 'derive-from-spec', 'normal']) {
      assert.match(s8e, new RegExp(`\`${mode}\``), `MODE=${mode} has no branch in 8e`);
    }
    assert.match(s8e, /holds no `\*\.spec\.ts`/);
    assert.match(s8e, /already present for <UI_SERVICE_ID> — skipping/);
  });

  test('bootstrap is autonomous — caveat, never a prompt', () => {
    assert.match(s8e, /`bootstrap` is dispatched without asking/);
    assert.match(s8e, /SHIP_CAVEATS/);
    assert.doesNotMatch(s8e, /AskUserQuestion/);
    assert.doesNotMatch(s8e, /obtaining the user's confirmation, so/);
  });

  test('the writer agent no longer claims a universal confirmation gate', () => {
    const agent = readFileSync(join(ROOT, 'agents/jlu-ui-e2e-writer.md'), 'utf8');
    assert.doesNotMatch(agent, /orchestrator only dispatches this mode after obtaining the user's confirmation/);
    assert.doesNotMatch(agent, /the orchestrator has already obtained user confirmation/);
    assert.match(agent, /you do not prompt — you scaffold/);
    assert.match(agent, /Never prompt for confirmation/);
  });
});
