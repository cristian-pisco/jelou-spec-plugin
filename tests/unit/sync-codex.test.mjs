// tests/unit/sync-codex.test.mjs
//
// Run: `node --test tests/unit/sync-codex.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SYNC = new URL('../../bin/sync-codex.mjs', import.meta.url).pathname;

function setupWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'sync-codex-'));
  mkdirSync(join(root, 'agents'));
  mkdirSync(join(root, 'skills/foo'), { recursive: true });
  writeFileSync(
    join(root, 'agents', 'jlu-foo.md'),
    `---\nname: jlu-foo\ndescription: Foo agent\ntools: Read\nmodel: sonnet\n---\n\nFoo body.\n`,
  );
  writeFileSync(
    join(root, 'skills/foo', 'SKILL.md'),
    `---\nname: foo\ndescription: Foo skill. Triggers: "foo"\nargument-hint: "[x]"\nallowed-tools:\n  - Read\n---\n\nbody\n`,
  );
  return root;
}

function runSync(root, ...args) {
  return spawnSync('node', [SYNC, ...args], { encoding: 'utf8', cwd: root });
}

describe('sync-codex — write mode', () => {
  test('generates .codex/agents/*.toml and .codex/prompts/jlu-*.md', () => {
    const root = setupWorkspace();
    const result = runSync(root);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const toml = readFileSync(join(root, '.codex/agents/jlu-foo.toml'), 'utf8');
    assert.match(toml, /name = "jlu-foo"/);
    assert.match(toml, /developer_instructions = '''/);
    assert.match(toml, /Foo body\./);

    const prompt = readFileSync(join(root, '.codex/prompts/jlu-foo.md'), 'utf8');
    assert.match(prompt, /description: "Foo skill\."/);
    assert.match(prompt, /jelou\/workflows\/foo\.md/);
  });
});

describe('sync-codex --check', () => {
  test('exits 0 when the mirror is in sync', () => {
    const root = setupWorkspace();
    runSync(root);
    const check = runSync(root, '--check');
    assert.equal(check.status, 0, `stderr: ${check.stderr}`);
  });

  test('exits 1 when an agent toml is stale', () => {
    const root = setupWorkspace();
    runSync(root);
    writeFileSync(join(root, '.codex/agents/jlu-foo.toml'), 'name = "stale"\n');
    const check = runSync(root, '--check');
    assert.equal(check.status, 1);
    assert.match(check.stdout + check.stderr, /jlu-foo\.toml/);
    assert.match(check.stdout + check.stderr, /stale/);
  });

  test('exits 1 when a prompt is missing', () => {
    const root = setupWorkspace();
    runSync(root);
    mkdirSync(join(root, 'skills/bar'), { recursive: true });
    writeFileSync(
      join(root, 'skills/bar', 'SKILL.md'),
      `---\nname: bar\ndescription: Bar.\n---\n\nb\n`,
    );
    const check = runSync(root, '--check');
    assert.equal(check.status, 1);
    assert.match(check.stdout + check.stderr, /jlu-bar\.md/);
  });

  test('exits 1 on orphan files', () => {
    const root = setupWorkspace();
    runSync(root);
    writeFileSync(join(root, '.codex/prompts/jlu-orphan.md'), '---\n---\nx\n');
    const check = runSync(root, '--check');
    assert.equal(check.status, 1);
    assert.match(check.stdout + check.stderr, /orphan/);
  });
});
