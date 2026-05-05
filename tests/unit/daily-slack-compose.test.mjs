// tests/unit/daily-slack-compose.test.mjs
//
// Run: `node --test tests/unit/daily-slack-compose.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-compose.mjs', import.meta.url).pathname;

function setup({ template, render, manual }) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-compose-'));
  const templatePath = join(dir, 'template.md');
  const renderPath = join(dir, 'render.json');
  const manualPath = join(dir, 'manual.json');
  writeFileSync(templatePath, template);
  writeFileSync(renderPath, JSON.stringify(render));
  writeFileSync(manualPath, JSON.stringify(manual));
  return { templatePath, renderPath, manualPath };
}

function run({ templatePath, renderPath, manualPath }) {
  return spawnSync(
    'node',
    [SCRIPT, '--template', templatePath, '--render', renderPath, '--manual', manualPath],
    { encoding: 'utf8' }
  );
}

describe('daily-slack-compose — happy path', () => {
  test('substitutes all placeholders and prints composed body to stdout', () => {
    const paths = setup({
      template: '*Energy*\n\n{{energy}}\n\n*Achieved*\n\n{{achieved_goals}}',
      render: { achieved_goals: '`[90%]` <https://x|A>', not_achieved_goals: '', short_term_goals: '' },
      manual: { energy: ':large_yellow_square:' },
    });
    const r = run(paths);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(
      r.stdout,
      '*Energy*\n\n:large_yellow_square:\n\n*Achieved*\n\n`[90%]` <https://x|A>'
    );
  });
});

describe('daily-slack-compose — Slack mrkdwn preservation (regression for the rewrite bug)', () => {
  test('preserves inline-code backticks around percentages literally', () => {
    const paths = setup({
      template: '{{achieved_goals}}',
      render: { achieved_goals: '`[90%]` <https://x|A>\n`[100%]` <https://y|B>', not_achieved_goals: '', short_term_goals: '' },
      manual: {},
    });
    const r = run(paths);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '`[90%]` <https://x|A>\n`[100%]` <https://y|B>');
  });

  test('preserves <url|text> hyperlink syntax literally without rewriting to plain url', () => {
    const paths = setup({
      template: '{{short_term_goals}}',
      render: {
        achieved_goals: '',
        not_achieved_goals: '',
        short_term_goals: '`[2026-04-30]` <https://app.clickup.com/t/abc|Task name>',
      },
      manual: {},
    });
    const r = run(paths);
    assert.equal(r.stdout, '`[2026-04-30]` <https://app.clickup.com/t/abc|Task name>');
  });

  test('preserves tilde strikethrough wrapped around hyperlink literally', () => {
    const paths = setup({
      template: '{{short_term_goals}}',
      render: {
        achieved_goals: '',
        not_achieved_goals: '',
        short_term_goals: '`[2026-04-27]` ~<https://x|Closed task>~',
      },
      manual: {},
    });
    const r = run(paths);
    assert.equal(r.stdout, '`[2026-04-27]` ~<https://x|Closed task>~');
  });
});

describe('daily-slack-compose — manual fields edge cases', () => {
  test('handles multi-line manual values', () => {
    const paths = setup({
      template: '*Meetings*\n\n{{meetings}}',
      render: { achieved_goals: '', not_achieved_goals: '', short_term_goals: '' },
      manual: { meetings: ':repeat: Daily\n:repeat: 1:1' },
    });
    const r = run(paths);
    assert.equal(r.stdout, '*Meetings*\n\n:repeat: Daily\n:repeat: 1:1');
  });

  test('replaces every occurrence of a placeholder, not just the first', () => {
    const paths = setup({
      template: '{{x}} and {{x}}',
      render: { achieved_goals: '', not_achieved_goals: '', short_term_goals: '' },
      manual: { x: 'value' },
    });
    const r = run(paths);
    assert.equal(r.stdout, 'value and value');
  });

  test('treats empty render values as empty-string substitution', () => {
    const paths = setup({
      template: 'before {{achieved_goals}} after',
      render: { achieved_goals: '', not_achieved_goals: '', short_term_goals: '' },
      manual: {},
    });
    const r = run(paths);
    assert.equal(r.stdout, 'before  after');
  });

  test('leaves unknown placeholders untouched (no silent blanking)', () => {
    const paths = setup({
      template: 'present={{achieved_goals}} unknown={{nope}}',
      render: { achieved_goals: 'X', not_achieved_goals: '', short_term_goals: '' },
      manual: {},
    });
    const r = run(paths);
    assert.equal(r.stdout, 'present=X unknown={{nope}}');
  });

  test('substitutes manual values containing characters that look like regex/template metas literally', () => {
    const paths = setup({
      template: '{{note}}',
      render: { achieved_goals: '', not_achieved_goals: '', short_term_goals: '' },
      manual: { note: '$1 \\n {{nested}} *bold*' },
    });
    const r = run(paths);
    assert.equal(r.stdout, '$1 \\n {{nested}} *bold*');
  });
});

describe('daily-slack-compose — IO and validation errors', () => {
  test('exits 2 when --template is missing', () => {
    const r = spawnSync('node', [SCRIPT, '--render', '/x', '--manual', '/y'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--template/);
  });

  test('exits 2 when --render is missing', () => {
    const r = spawnSync('node', [SCRIPT, '--template', '/x', '--manual', '/y'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--render/);
  });

  test('exits 2 when --manual is missing', () => {
    const r = spawnSync('node', [SCRIPT, '--template', '/x', '--render', '/y'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--manual/);
  });

  test('exits 2 when --render points to non-JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daily-slack-compose-'));
    const tpath = join(dir, 't.md');
    const rpath = join(dir, 'r.json');
    const mpath = join(dir, 'm.json');
    writeFileSync(tpath, 'x');
    writeFileSync(rpath, '{ not valid');
    writeFileSync(mpath, '{}');
    const r = spawnSync(
      'node',
      [SCRIPT, '--template', tpath, '--render', rpath, '--manual', mpath],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--render is not valid JSON/);
  });
});
