import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const ship = read('jelou/workflows/ship.md');
const runner = read('agents/jlu-ship-runner.md');

describe('ship fans out one runner per service', () => {
  test('the runner exists on all three runtimes', () => {
    for (const rel of [
      'agents/jlu-ship-runner.md',
      '.opencode/agents/jlu-ship-runner.md',
      '.codex/agents/jlu-ship-runner.toml',
    ]) {
      assert.ok(existsSync(join(ROOT, rel)), `missing ${rel}`);
    }
  });

  test('Step 3 dispatches the runner instead of looping inline', () => {
    assert.match(ship, /## Step 3 — Fan Out Per Service \(one runner each\)/);
    assert.match(ship, /dispatch `jlu-ship-runner`/);
    assert.match(ship, /you never run Steps 4–7 yourself/);
  });

  test('fan-out is sequential — a parallel build is the freeze condition', () => {
    assert.match(ship, /\*\*Sequentially, concurrency 1\.\*\*/);
    assert.match(ship, /machine-freeze condition/);
    assert.match(ship, /Never fan these out in parallel/);
    assert.match(ship, /context isolation/);
  });

  test('gates are brokered by the orchestrator, never asked by the runner', () => {
    assert.match(ship, /Brokering `NEEDS_DECISION`/);
    assert.match(ship, /reaches nobody/);
    assert.match(ship, /re-dispatch the same runner/);
    assert.match(ship, /Steps 4b–7 are the runner's body/);
    assert.match(runner, /Every `question` resolves without the user/);
    assert.match(runner, /no `AskUserQuestion`, no plain-text question/);
  });

  test('a caveat never suppresses a PR at either level', () => {
    assert.match(ship, /Never invent a\s*confirmation of your own around the fan-out/);
    assert.match(runner, /Skip PR creation because something is unverified/);
    assert.match(runner, /never a reason to withhold the PR/);
  });

  test('runner declares the inputs it cannot derive and owns nested dispatches', () => {
    assert.match(runner, /^## Inputs \(provided by orchestrator\)$/m);
    assert.match(runner, /<PLUGIN_ROOT>/);
    assert.match(runner, /<SETUP_MODE>/);
    assert.match(runner, /<SHIP_CAVEATS>/);
    assert.match(runner, /<DECISION>/);
    for (const nested of ['jlu-deps-validator', 'jlu-build-validator', 'jlu-git-agent']) {
      assert.match(runner, new RegExp(`\`${nested}\``), `runner must own ${nested}`);
    }
  });

  test('runner returns rows and stays out of caller-owned work', () => {
    assert.match(runner, /STATUS: DONE rows=<json>/);
    assert.match(runner, /STATUS: NEEDS_DECISION gate=/);
    assert.match(runner, /STATUS: BLOCKED reason=/);
    assert.match(runner, /Cross-reference PRs, update TASKS\.md/);
    assert.match(runner, /Merge a PR, force-push/);
    assert.match(runner, /spec-compliance review or the coverage-breadth probe/);
  });

  test('a blocked runner does not abort the remaining services', () => {
    assert.match(ship, /never aborts the remaining ones/);
  });

  test('autonomous mode is a caller input with a documented default per gate', () => {
    assert.match(ship, /## Autonomous mode — how every gate resolves/);
    assert.match(ship, /`<AUTONOMOUS>` is a caller input, `no` unless/);
    assert.match(ship, /In autonomous mode no gate asks/);
    for (const site of ['Step 2', '2b decision gate \\(items 6a \\/ 6b\\)', '2b step 6b \\(the auditor\\)', '4b\\.1', '4b\\.2', 'Step 5', '5b', '6 \\/ 6b', '7b', '6 \\/ 7e']) {
      assert.match(ship, new RegExp(`\\| ${site} \\|`), `gate table is missing site ${site}`);
    }
    assert.match(ship, /Rows at Step 2 and 2b resolve in the orchestrator/);
  });

  test('only build failure and git escalation block; the rest proceed', () => {
    assert.match(ship, /Build FAIL after 5 auto-fix rounds \| 4b\.2 \| \*\*Block this service\.\*\*/);
    assert.match(ship, /git-agent escalation \| Step 5 \| \*\*Block this service\*\*/);
    assert.match(ship, /the one gate whose autonomous default is a stop rather than a proceed/);
    assert.match(ship, /Autonomous → take option 1 once automatically/);
    assert.match(ship, /Autonomous → option 1 \(create a new PR\)/);
  });

  test('blocked and skipped stay distinct end to end', () => {
    assert.match(ship, /\*\*`blocked` is not `skipped`\.\*\*/);
    assert.match(ship, /"created" \| "existing" \| "skipped" \| "blocked"/);
    assert.match(ship, /### Blocked/);
    assert.match(ship, /never present a partial ship as done/);
    assert.match(runner, /Never report a `blocked`\s*service as `skipped`/);
  });

  test('autonomous mode never rewrites the task contract or ships a red build', () => {
    assert.match(ship, /Autonomous mode never does two things/);
    assert.match(ship, /Never flip `Dual PR: no` in TASKS\.md/);
    assert.match(ship, /Do NOT choose "B"/);
  });

  test('the runner resolves gates itself when autonomous and never prompts either way', () => {
    assert.match(runner, /<AUTONOMOUS>/);
    assert.match(runner, /never return `NEEDS_DECISION`/);
    assert.match(runner, /ever, in either\s*mode/);
    assert.match(ship, /a runner never returns `NEEDS_DECISION` at all/);
    assert.match(ship, /do NOT ask the user \(nobody is watching a\s*chain\)/);
  });

  test('a depth-1 runtime drops the nesting, never the fan-out', () => {
    assert.match(ship, /\*\*Depth-limited runtimes\.\*\*/);
    assert.match(ship, /agents\.max_depth = 1/);
    assert.match(ship, /Never resolve it the other way/);
    assert.match(runner, /agents\.max_depth = 1/);
    assert.match(runner, /inline in your own session/);
  });
});
