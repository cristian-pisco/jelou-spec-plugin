// tests/unit/codex-prompt.test.mjs
//
// Run: `node --test tests/unit/codex-prompt.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanDescription, renderCodexPrompt } from '../../bin/lib/codex-prompt.mjs';

describe('cleanDescription', () => {
  test('drops the Triggers tail', () => {
    const out = cleanDescription('Curate the glossary. Triggers: "glossary", "ubiquitous language".');
    assert.equal(out, 'Curate the glossary.');
  });

  test('strips wrapping quotes and unescapes internal ones', () => {
    const out = cleanDescription('"Judge an idea against the repo, e.g. \\"council\\""');
    assert.equal(out, 'Judge an idea against the repo, e.g. "council"');
  });

  test('collapses whitespace', () => {
    assert.equal(cleanDescription('a\n  b   c'), 'a b c');
  });
});

describe('renderCodexPrompt', () => {
  const fm = {
    name: 'new-task',
    description: '"Use when starting new work — creates a task. Triggers: \\"new task\\""',
    'argument-hint': '"[task description]"',
  };

  test('emits YAML-safe frontmatter with cleaned description + argument-hint', () => {
    const out = renderCodexPrompt('new-task', fm);
    assert.match(out, /^---\n/);
    assert.match(out, /description: "Use when starting new work — creates a task\."/);
    assert.match(out, /argument-hint: "\[task description\]"/);
  });

  test('references the skill workflow path and $ARGUMENTS', () => {
    const out = renderCodexPrompt('new-task', fm);
    assert.match(out, /jelou\/workflows\/new-task\.md/);
    assert.match(out, /\$ARGUMENTS/);
  });

  test('encodes the Codex runtime contract (question/task, jlu- prefix)', () => {
    const out = renderCodexPrompt('new-task', fm);
    assert.match(out, /Runtime contract \(Codex\)/);
    assert.match(out, /`question` →/);
    assert.match(out, /`task` →/);
    assert.match(out, /max_depth = 1/);
    assert.match(out, /`jlu-` prefix/);
  });

  test('omits argument-hint line when absent', () => {
    const out = renderCodexPrompt('report-task', { description: 'Show status.' });
    assert.doesNotMatch(out, /argument-hint:/);
  });

  test('throws without a skill name', () => {
    assert.throws(() => renderCodexPrompt('', {}), /skill name/);
  });
});
