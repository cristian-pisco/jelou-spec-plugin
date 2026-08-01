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

  test('unwraps single-quoted scalars and unescapes single quotes', () => {
    assert.equal(fullDescription("'It\\'s ready'"), "It's ready");
  });

  test('collapses newlines from folded YAML into single spaces', () => {
    assert.equal(fullDescription('Line one\n  line two'), 'Line one line two');
  });

  test('returns an empty string for a missing description', () => {
    assert.equal(fullDescription(undefined), '');
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

  test('body falls back to the plugin root for marketplace installs', () => {
    assert.match(skill, /<plugin-root>\/jelou\/workflows\/new-task\.md/);
    assert.match(skill, /<plugin-root>\/\.codex\/skills\/jlu-new-task\/SKILL\.md/);
    assert.match(skill, /three directories above this SKILL\.md/);
  });

  test('body reports all three paths when none resolves', () => {
    assert.match(skill, /report all three checked paths/);
  });

  test('body carries the Codex runtime contract', () => {
    assert.match(skill, /Runtime contract \(Codex\)/);
    assert.match(skill, /no structured question tool/);
  });

  test('throws without a skill name', () => {
    assert.throws(() => renderCodexSkill(''), /requires a skill name/);
  });
});

describe('renderCodexSkill — frontmatter edge cases', () => {
  test('falls back to a generated description when none is declared', () => {
    const skill = renderCodexSkill('logs', {});
    assert.match(skill, /description: "Run the jlu-logs workflow"/);
  });

  test('omits argument-hint when the canonical skill declares none', () => {
    const skill = renderCodexSkill('logs', { description: 'Tail service logs.' });
    assert.ok(!/argument-hint:/.test(skill));
  });

  test('omits argument-hint when it is declared empty', () => {
    const skill = renderCodexSkill('logs', { description: 'Tail.', 'argument-hint': '""' });
    assert.ok(!/argument-hint:/.test(skill));
  });

  test('escapes embedded quotes into a parseable YAML scalar', () => {
    const skill = renderCodexSkill('ship', { description: 'Ship it. Triggers: "ship"' });
    const line = skill.split('\n').find((l) => l.startsWith('description: '));
    assert.equal(JSON.parse(line.slice('description: '.length)), 'Ship it. Triggers: "ship"');
  });

  test('renders the frontmatter block before the body', () => {
    const skill = renderCodexSkill('ship', { description: 'Ship.' });
    const [, frontmatter] = skill.split('---\n');
    assert.match(frontmatter, /^name: jlu-ship\n/);
  });
});
