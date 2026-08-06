import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('doctrine consolidation — anti-patterns replace the per-cycle checklist', () => {
  const principles = read('jelou/references/tdd-principles.md');

  test('principles §8 is Anti-Patterns and the checklist is gone', () => {
    assert.match(principles, /## 8\. Anti-Patterns/);
    assert.doesNotMatch(principles, /per-cycle checklist/i);
  });

  test('principles name the three anti-patterns', () => {
    assert.match(principles, /Implementation-coupled/);
    assert.match(principles, /Tautological/);
    assert.match(principles, /Horizontal slicing/);
  });

  test('principles §1 takes refactoring out of the loop', () => {
    assert.match(principles, /Refactoring is not part of the loop/);
    assert.doesNotMatch(principles, /REFACTOR/);
  });

  test('principles §3 pins the batching exception', () => {
    assert.match(principles, /One deliberate exception[\s\S]*?batched into a single RED→GREEN cycle/);
  });

  test('agents cite §8 Anti-Patterns, not the checklist', () => {
    for (const a of ['jlu-qa-agent', 'jlu-test-writer', 'jlu-implementer', 'jlu-tdd-cycle']) {
      const body = read(`agents/${a}.md`);
      assert.match(body, /§8 Anti-Patterns/, `${a} must cite §8 Anti-Patterns`);
      assert.doesNotMatch(body, /per-cycle checklist/i, `${a} still cites the checklist`);
    }
  });

  test('tdd-cycle agent replaced the 10-item per-slice checklist', () => {
    const agent = read('agents/jlu-tdd-cycle.md');
    assert.doesNotMatch(agent, /per-slice checklist/i);
    assert.match(agent, /Anti-Pattern Check/);
  });
});
