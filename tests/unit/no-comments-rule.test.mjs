// tests/unit/no-comments-rule.test.mjs
//
// Run: `node --test tests/unit/no-comments-rule.test.mjs`
//
// The "No line-by-line comments" doctrine must reach every subagent that writes
// production or test source, and must be stated identically across the runtime
// contracts (CLAUDE.md for Claude Code, AGENTS.md for Codex/OpenCode). The
// canonical text lives once in jelou/references/subagent-base.md; code-authoring
// agents inherit it by referencing that file. This suite is self-enforcing: a new
// code-writing agent that forgets the reference, or a contract that drops the
// rule, turns the suite red.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Agents that emit production or test SOURCE code (vs doc/spec/glossary authors,
// which also have Write but never produce code). Each must inherit the doctrine
// from subagent-base.md. Keep this list in sync when adding a code-writing agent.
const CODE_AUTHORING_AGENTS = [
  'jlu-build-validator',
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

describe('no-comments rule — runtime contract parity (CLAUDE.md ⇄ AGENTS.md)', () => {
  for (const contract of ['CLAUDE.md', 'AGENTS.md']) {
    test(`${contract} states the rule`, () => {
      const src = read(contract);
      assert.match(src, RULE_PHRASE, `${contract} must carry the No line-by-line comments rule`);
      assert.match(src, SELF_DOCUMENTING, `${contract} must prescribe self-documenting code`);
    });
  }
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

describe('no-comments rule — QA gate enforces it on the diff', () => {
  test('jlu-qa-agent.md flags narrating comments as FAIL', () => {
    const src = read('agents/jlu-qa-agent.md');
    assert.match(
      src,
      RULE_PHRASE,
      'jlu-qa-agent.md must keep the check that flags line-by-line comments as a FAIL',
    );
  });
});
