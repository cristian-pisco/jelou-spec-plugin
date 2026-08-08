import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const DOCTRINE = 'jelou/references/subagent-base.md';

const PROCESS_RUNNING_AGENTS = [
  'jlu-backend-e2e-runner',
  'jlu-build-validator',
  'jlu-conflict-resolver',
  'jlu-deps-validator',
  'jlu-dev-block-verifier',
  'jlu-implementer',
  'jlu-qa-agent',
  'jlu-refactor-agent',
  'jlu-resolve-pr-runner',
  'jlu-ship-runner',
  'jlu-tdd-cycle',
  'jlu-test-suite-runner',
  'jlu-test-writer',
  'jlu-ui-e2e-writer',
  'jlu-ui-fix-loop',
  'jlu-ui-qa-runner',
];

const SECTION_HEADING = /^## Waiting on Long Commands$/m;
const BLIND_WAIT_BAN = /never sleep a fixed duration/i;
const FOREGROUND_TIMEOUT = /foreground/i;
const BACKGROUND_NOTIFICATION = /run_in_background/;
const CONDITION_POLL = /until <condition>/;

const FIXED_SLEEP = /(?:^|[;&|`\s])sleep\s+\d+/;
const CONDITIONAL_CONTEXT = /\b(until|while|do)\b|never|forbidden|do not|blind/i;

const markdownFilesUnder = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
    .map((abs) => abs.slice(ROOT.length + 1));
};

describe('blind-wait ban — canonical doctrine', () => {
  test('subagent-base.md carries the Waiting on Long Commands section', () => {
    const src = read(DOCTRINE);
    assert.match(src, SECTION_HEADING, 'subagent-base.md must define the Waiting on Long Commands section');
    assert.match(src, BLIND_WAIT_BAN, 'subagent-base.md must ban fixed-duration sleeps outright');
  });

  test('the doctrine prescribes all three sanctioned waiting mechanisms', () => {
    const src = read(DOCTRINE);
    assert.match(src, FOREGROUND_TIMEOUT, 'must prescribe a foreground run with an explicit timeout');
    assert.match(src, BACKGROUND_NOTIFICATION, 'must prescribe run_in_background plus the completion notification');
    assert.match(src, CONDITION_POLL, 'must permit a bounded condition poll as the only legitimate sleep');
  });

  test('the doctrine states that what ends the wait is the deciding test', () => {
    assert.match(
      read(DOCTRINE),
      /what ends the wait/i,
      'the rule must discriminate by termination cause, or it would also ban readiness polling',
    );
  });
});

describe('blind-wait ban — every process-running agent inherits the doctrine', () => {
  test('the agent set is non-empty', () => {
    assert.ok(PROCESS_RUNNING_AGENTS.length > 0, 'PROCESS_RUNNING_AGENTS must not be empty');
  });

  for (const agent of PROCESS_RUNNING_AGENTS) {
    test(`agents/${agent}.md references subagent-base.md`, () => {
      const rel = join('agents', `${agent}.md`);
      assert.ok(existsSync(join(ROOT, rel)), `missing ${rel} — rename in PROCESS_RUNNING_AGENTS?`);
      assert.match(
        read(rel),
        /subagent-base\.md/,
        `${rel} must read jelou/references/subagent-base.md to inherit the blind-wait ban`,
      );
    });
  }
});

describe('blind-wait ban — no prompt prescribes a fixed-duration sleep', () => {
  const candidates = [...markdownFilesUnder('agents'), ...markdownFilesUnder('skills')];

  test('there are prompt files to scan', () => {
    assert.ok(candidates.length > 0, 'expected agent and skill prompts to scan');
  });

  for (const rel of candidates) {
    test(`${rel} has no blind wait`, () => {
      const offenders = read(rel)
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => FIXED_SLEEP.test(line) && !CONDITIONAL_CONTEXT.test(line))
        .map(({ line, number }) => `${rel}:${number}: ${line.trim()}`);

      assert.deepEqual(
        offenders,
        [],
        `fixed-duration sleep used as a completion proxy — use a foreground timeout, run_in_background, or a bounded condition poll`,
      );
    });
  }
});
