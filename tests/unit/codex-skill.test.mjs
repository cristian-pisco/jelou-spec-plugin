// tests/unit/codex-skill.test.mjs
//
// Run: `node --test tests/unit/codex-skill.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { renderCodexSkill, fullDescription } from '../../bin/lib/codex-skill.mjs';

describe('fullDescription', () => {
  test('unescapes quotes and normalizes whitespace but keeps Triggers', () => {
    const out = fullDescription('"Do the thing.  Triggers: \\"go\\", \\"run\\""');
    assert.equal(out, 'Do the thing. Triggers: "go", "run"');
  });
});

describe('renderCodexSkill', () => {
  const skill = renderCodexSkill('new-task', {
    description: 'Start work. Triggers: "new task"',
    'argument-hint': '[desc]',
  });

  test('frontmatter has jlu-prefixed name', () => {
    assert.match(skill, /^---\nname: jlu-new-task\n/);
  });

  test('description keeps the Triggers clause for implicit invocation', () => {
    assert.match(skill, /description: ".*Triggers: .*"/);
  });

  test('carries argument-hint when present', () => {
    assert.match(skill, /argument-hint: "\[desc\]"/);
  });

  test('body resolves the shared workflow global-first', () => {
    assert.match(skill, /\$CODEX_HOME\/jelou\/workflows\/new-task\.md/);
    assert.match(skill, /jelou\/workflows\/new-task\.md` \(project-local fallback\)/);
  });

  test('body carries the Codex runtime contract', () => {
    assert.match(skill, /Runtime contract \(Codex\)/);
    assert.match(skill, /no structured question tool/);
  });

  test('throws without a skill name', () => {
    assert.throws(() => renderCodexSkill(''), /requires a skill name/);
  });
});
