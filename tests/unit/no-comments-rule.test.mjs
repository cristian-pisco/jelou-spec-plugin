import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const CODE_AUTHORING_AGENTS = [
  'jlu-build-validator',
  'jlu-conflict-resolver',
  'jlu-implementer',
  'jlu-refactor-agent',
  'jlu-tdd-cycle',
  'jlu-test-writer',
  'jlu-ui-e2e-writer',
  'jlu-ui-fix-loop',
];

const RULE_PHRASE = /no line-by-line comments/i;
const SELF_DOCUMENTING = /self-documenting/i;

describe('no-comments rule — canonical doctrine', () => {
  test('subagent-base.md carries the rule', () => {
    const src = read('jelou/references/subagent-base.md');
    assert.match(src, RULE_PHRASE, 'subagent-base.md must state the No line-by-line comments rule');
    assert.match(src, SELF_DOCUMENTING, 'subagent-base.md must prescribe self-documenting code');
  });
});

describe('no-comments rule — every code-authoring agent inherits the doctrine', () => {
  test('the agent set is non-empty', () => {
    assert.ok(CODE_AUTHORING_AGENTS.length > 0, 'CODE_AUTHORING_AGENTS must not be empty');
  });

  for (const agent of CODE_AUTHORING_AGENTS) {
    test(`agents/${agent}.md references subagent-base.md`, () => {
      const p = join(ROOT, 'agents', `${agent}.md`);
      assert.ok(existsSync(p), `missing agents/${agent}.md — rename in CODE_AUTHORING_AGENTS?`);
      assert.match(
        readFileSync(p, 'utf8'),
        /subagent-base\.md/,
        `agents/${agent}.md must read jelou/references/subagent-base.md to inherit the no-comments rule`,
      );
    });
  }
});

describe('no-comments rule — no QA gate enforces it on the diff', () => {
  test('the retired QA agent is gone from every runtime', () => {
    for (const rel of [
      'agents/jlu-spec-reviewer.md',
      '.opencode/agents/jlu-spec-reviewer.md',
      '.codex/agents/jlu-spec-reviewer.toml',
    ]) {
      assert.ok(!existsSync(join(ROOT, rel)), `${rel} must not exist — the agent is retired`);
    }
  });

  test('the doctrine survives its enforcer — only the authors carry it now', () => {
    assert.match(read('jelou/references/subagent-base.md'), RULE_PHRASE);
    const executeTask = read('jelou/workflows/execute-task.md');
    assert.match(executeTask, /### 8c\..*RETIRED/);
    assert.match(executeTask, /The no-comments rule/);
    assert.match(executeTask, /No agent re-reads the diff to catch a\s*comment that slipped through/);
  });
});
