// tests/unit/agent-frontmatter.test.mjs
//
// Run: `node --test tests/unit/agent-frontmatter.test.mjs`
// Node 20+ required.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  transformFrontmatter,
  parseAgentFile,
  renderOpencodeAgent,
} from '../../bin/lib/agent-frontmatter.mjs';

describe('transformFrontmatter — Claude Code → OpenCode', () => {
  test('drops name, tools, model; keeps description; adds mode', () => {
    const input = {
      name: 'jlu-implementer',
      description: 'Makes tests green with minimum code',
      tools: 'Read, Write, Bash',
      model: 'sonnet',
    };
    const out = transformFrontmatter(input);
    assert.deepEqual(out, {
      description: 'Makes tests green with minimum code',
      mode: 'subagent',
    });
  });

  test('strips wrapping quotes from description', () => {
    const out = transformFrontmatter({ description: '"quoted desc"' });
    assert.equal(out.description, 'quoted desc');
  });

  test('preserves description with internal quotes', () => {
    const out = transformFrontmatter({ description: 'He said "hi"' });
    assert.equal(out.description, 'He said "hi"');
  });

  test('omits description when missing', () => {
    const out = transformFrontmatter({ name: 'foo' });
    assert.equal(out.description, undefined);
    assert.equal(out.mode, 'subagent');
  });
});

describe('parseAgentFile — splits frontmatter and body', () => {
  test('parses standard frontmatter + body', () => {
    const raw = `---\nname: foo\ndescription: bar\n---\n\nBody here.\n`;
    const { frontmatter, body } = parseAgentFile(raw);
    assert.equal(frontmatter.name, 'foo');
    assert.equal(frontmatter.description, 'bar');
    assert.equal(body, '\nBody here.\n');
  });

  test('throws on missing frontmatter', () => {
    assert.throws(() => parseAgentFile('No frontmatter here'), /frontmatter/i);
  });

  test('handles multi-line body with code fences', () => {
    const raw = `---\nname: x\n---\n\nIntro.\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n\nOutro.\n`;
    const { body } = parseAgentFile(raw);
    assert.match(body, /const a = 1/);
    assert.match(body, /Outro/);
  });
});

describe('renderOpencodeAgent — round-trip', () => {
  test('produces valid OpenCode-shaped agent file', () => {
    const raw = `---\nname: jlu-test\ndescription: Test agent\ntools: Read\nmodel: sonnet\n---\n\nBody.\n`;
    const out = renderOpencodeAgent(raw);
    assert.equal(out, '---\ndescription: Test agent\nmode: subagent\n---\n\nBody.\n');
  });

  test('preserves multi-line body verbatim', () => {
    const raw = `---\nname: x\ndescription: x\ntools: Read\nmodel: sonnet\n---\n\nLine 1.\n\nLine 2.\n\n## Heading\n\nLine 3.\n`;
    const out = renderOpencodeAgent(raw);
    assert.match(out, /Line 1\.\n\nLine 2\./);
    assert.match(out, /## Heading\n\nLine 3/);
  });
});
