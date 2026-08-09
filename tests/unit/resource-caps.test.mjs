// tests/unit/resource-caps.test.mjs
//
// Run: `node --test tests/unit/resource-caps.test.mjs`
// Node 20+ required.
//
// Guards the test-execution resource policy. Uncapped test runs spawn one
// worker per CPU core (21 on a 22-thread machine), exhaust RAM, and freeze
// the host hard enough to need a forced power-off — this has happened on
// real runs. Any edit that drops a worker cap or re-introduces a bare
// full-suite invocation must fail here.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (relPath) => readFileSync(join(ROOT, relPath), 'utf8');

const POLICY_SECTION = 'Test Execution Resource Limits';

describe('subagent-base — canonical resource policy', () => {
  const base = read('jelou/references/subagent-base.md');

  test('declares the policy section', () => {
    assert.match(base, new RegExp(`^## ${POLICY_SECTION}$`, 'm'));
  });

  test('caps jest workers and prefers runInBand for single files', () => {
    assert.match(base, /--maxWorkers=2/);
    assert.match(base, /--runInBand/);
  });

  test('caps vitest threads with an explicit minThreads floor', () => {
    assert.match(base, /--poolOptions\.threads\.minThreads=1/);
    assert.match(base, /--poolOptions\.threads\.maxThreads=2/);
  });

  test('caps playwright workers', () => {
    assert.match(base, /--workers=1/);
  });

  test('forbids the bare package test script and the npm flag-swallow form', () => {
    assert.match(base, /Never invoke the package test script bare/);
    assert.match(base, /npm test --no-coverage/);
  });

  test('forbids watch mode, coverage, and concurrent heavy processes', () => {
    assert.match(base, /Never watch mode/);
    assert.match(base, /Never coverage/);
    assert.match(base, /One heavy process at a time/);
  });

  test('requires re-capping inherited commands', () => {
    assert.match(base, /Inherited commands inherit no safety/);
  });

  test('caps Testcontainers E2E to the WORKERS policy with mandatory teardown', () => {
    assert.match(base, /Testcontainers E2E/i);
    assert.match(base, /concurrency = WORKERS/);
    assert.match(base, /one dependency set at a time/i);
    assert.match(base, /teardown .*before the next service/i);
    assert.match(base, /no orphaned containers/i);
  });
});

describe('test-running agents — reference the policy and carry caps', () => {
  const cappedAgents = [
    'agents/jlu-implementer.md',
    'agents/jlu-test-writer.md',
    'agents/jlu-tdd-cycle.md',
    'agents/jlu-refactor-agent.md',
    'agents/jlu-resolve-pr-runner.md',
    'agents/jlu-dev-block-verifier.md',
  ];

  for (const agentPath of cappedAgents) {
    test(`${agentPath} cites the policy section and a jest cap`, () => {
      const content = read(agentPath);
      assert.match(
        content,
        new RegExp(POLICY_SECTION),
        `${agentPath} must point at subagent-base.md "${POLICY_SECTION}"`,
      );
      assert.match(
        content,
        /--maxWorkers=2|--runInBand/,
        `${agentPath} must show a capped command form`,
      );
    });
  }

  test('implementer forbids the exact invocation that froze machines', () => {
    const implementer = read('agents/jlu-implementer.md');
    assert.match(implementer, /Forbidden: bare `npm test`/);
    assert.match(implementer, /npm test --no-coverage/);
  });

  test('ui-e2e-writer verifies specs with --workers=1', () => {
    const writer = read('agents/jlu-ui-e2e-writer.md');
    assert.match(writer, /npx playwright test <file> --reporter=list --workers=1/);
  });

  test('ui-e2e-writer scaffolds a serial playwright config', () => {
    const writer = read('agents/jlu-ui-e2e-writer.md');
    assert.match(writer, /fullyParallel: false/);
    assert.match(writer, /workers: 1/);
  });

  test('codebase analyzer documents capped filtering commands', () => {
    const analyzer = read('agents/jlu-codebase-analyzer-operational.md');
    assert.match(analyzer, /--maxWorkers=2/);
    assert.match(analyzer, /worker cap appended/);
  });
});

describe('spec-reviewer — retired, so it cannot re-run anything', () => {
  test('no runtime still carries the agent', () => {
    for (const rel of [
      'agents/jlu-spec-reviewer.md',
      '.opencode/agents/jlu-spec-reviewer.md',
      '.codex/agents/jlu-spec-reviewer.toml',
    ]) {
      assert.ok(!existsSync(join(ROOT, rel)), `${rel} must not exist — the agent is retired`);
    }
  });

  test('the single remaining test execution in execute-task is the capped Step 8b run', () => {
    const executeTask = read('jelou/workflows/execute-task.md');
    assert.match(executeTask, /### 8c\..*RETIRED/);
    assert.match(executeTask, /\*\*Affected-test execution\*\* — Step 8b, unchanged/);
  });
});

describe('orchestrator workflows — capped invocations stay capped', () => {
  test('execute-task Step 8b keeps fixed worker caps with the fan-out conditional', () => {
    const executeTask = read('jelou/workflows/execute-task.md');
    assert.match(executeTask, /resolve-affected-tests\.mjs/);
    assert.match(executeTask, /--workers=<1 when TASK_FANOUT_CAP > 1, else 2>/);
    assert.match(executeTask, /`TASK_FANOUT_CAP = 1` → `--workers=2`/);
    assert.match(executeTask, /`TASK_FANOUT_CAP > 1` → `--workers=1`/);
    assert.match(executeTask, /never invokes the bare full-suite command/);
    assert.match(executeTask, /never runs a bare full suite/);
  });

  test('test-suite workflow keeps workers=1 and the RAM gate', () => {
    const testSuite = read('jelou/workflows/test-suite.md');
    assert.match(testSuite, /--runInBand/);
    assert.match(
      testSuite,
      /--poolOptions\.threads\.minThreads=1 --poolOptions\.threads\.maxThreads=1/,
    );
    assert.match(testSuite, /MemAvailable/);
  });

  test('the UI E2E runner keeps the worker default on every Playwright invocation', () => {
    const runner = read('agents/jlu-ui-qa-runner.md');
    const invocations = runner.match(/npx playwright test[\s\S]*?\n\n/g) ?? [];
    assert.ok(invocations.length >= 2, 'expected the suite run and the per-spec re-run');
    for (const invocation of invocations) {
      assert.match(invocation, /--workers=\$\{WORKERS:-1\}/);
    }
  });

  test('env-lifecycle carries the canonical CPU cap and RAM gate', () => {
    const envLifecycle = read('jelou/references/env-lifecycle.md');
    assert.match(envLifecycle, /MAX_WORKERS_BY_CPU=\$\(\( CPU_CORES \/ 2 \)\)/);
    assert.match(envLifecycle, /"\$MAX_WORKERS_BY_CPU" -gt 4/);
    assert.match(envLifecycle, /MemAvailable/);
    assert.match(envLifecycle, /REQUIRED_MB=/);
  });
});

describe('references — no stale full-suite guidance', () => {
  test('tdd-cycle reference no longer claims the full suite runs at Step 8', () => {
    const tddCycle = read('jelou/references/tdd-cycle.md');
    assert.doesNotMatch(tddCycle, /only time the full test suite executes/);
    assert.match(tddCycle, /Affected tests only/);
  });

  test('parallel-dispatch tightens caps to one worker under fan-out', () => {
    const parallelDispatch = read('jelou/references/parallel-dispatch.md');
    assert.match(parallelDispatch, /tighten its test runs to ONE worker/);
    assert.match(parallelDispatch, /planner-resolved `auto`/);
    assert.match(parallelDispatch, /[Ss]equential is still the outcome when the resolved cap is 1/);
    assert.doesNotMatch(parallelDispatch, /Default local behavior is sequential/);
  });
});
