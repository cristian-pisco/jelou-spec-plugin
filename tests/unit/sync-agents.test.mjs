// tests/unit/sync-agents.test.mjs
//
// Run: `node --test tests/unit/sync-agents.test.mjs`
// Node 20+ required.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SYNC = new URL('../../bin/sync-agents.mjs', import.meta.url).pathname;

function setupWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'sync-agents-'));
  mkdirSync(join(root, 'agents'));
  mkdirSync(join(root, '.opencode/agents'), { recursive: true });
  return root;
}

function writeAgent(root, name, content) {
  writeFileSync(join(root, 'agents', name), content);
}

function runSync(root, ...args) {
  return spawnSync('node', [SYNC, ...args], { encoding: 'utf8', cwd: root });
}

describe('sync-agents — write mode', () => {
  test('regenerates .opencode/agents from agents/', () => {
    const root = setupWorkspace();
    writeAgent(
      root,
      'jlu-foo.md',
      `---\nname: jlu-foo\ndescription: Foo agent\ntools: Read\nmodel: sonnet\n---\n\nFoo body.\n`,
    );
    const result = runSync(root);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = readFileSync(join(root, '.opencode/agents/jlu-foo.md'), 'utf8');
    assert.match(out, /description: Foo agent\n/);
    assert.match(out, /mode: subagent\n/);
    assert.match(out, /Foo body\.\n/);
    assert.doesNotMatch(out, /name:/);
    assert.doesNotMatch(out, /tools:/);
    assert.doesNotMatch(out, /model:/);
  });

  test('overwrites stale .opencode/agents content', () => {
    const root = setupWorkspace();
    writeAgent(
      root,
      'jlu-foo.md',
      `---\nname: jlu-foo\ndescription: New\ntools: Read\nmodel: sonnet\n---\n\nNew body.\n`,
    );
    writeFileSync(
      join(root, '.opencode/agents/jlu-foo.md'),
      `---\ndescription: Old\nmode: subagent\n---\n\nOld body.\n`,
    );
    const result = runSync(root);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = readFileSync(join(root, '.opencode/agents/jlu-foo.md'), 'utf8');
    assert.match(out, /description: New/);
    assert.match(out, /New body/);
    assert.doesNotMatch(out, /Old body/);
  });
});

describe('sync-agents --check', () => {
  test('exits 0 when .opencode/agents is in sync', () => {
    const root = setupWorkspace();
    writeAgent(
      root,
      'jlu-foo.md',
      `---\nname: jlu-foo\ndescription: Foo\ntools: Read\nmodel: sonnet\n---\n\nBody.\n`,
    );
    runSync(root); // generate first
    const check = runSync(root, '--check');
    assert.equal(check.status, 0, `stderr: ${check.stderr}`);
  });

  test('exits 1 when .opencode/agents is stale', () => {
    const root = setupWorkspace();
    writeAgent(
      root,
      'jlu-foo.md',
      `---\nname: jlu-foo\ndescription: Updated\ntools: Read\nmodel: sonnet\n---\n\nNew body.\n`,
    );
    writeFileSync(
      join(root, '.opencode/agents/jlu-foo.md'),
      `---\ndescription: Stale\nmode: subagent\n---\n\nOld body.\n`,
    );
    const check = runSync(root, '--check');
    assert.equal(check.status, 1);
    assert.match(check.stdout + check.stderr, /jlu-foo\.md/);
    assert.match(check.stdout + check.stderr, /stale/);
  });

  test('exits 1 when .opencode/agents has orphan files', () => {
    const root = setupWorkspace();
    writeAgent(
      root,
      'jlu-foo.md',
      `---\nname: jlu-foo\ndescription: Foo\ntools: Read\nmodel: sonnet\n---\n\nBody.\n`,
    );
    runSync(root);
    writeFileSync(
      join(root, '.opencode/agents/jlu-orphan.md'),
      `---\ndescription: orphan\nmode: subagent\n---\n\nbody\n`,
    );
    const check = runSync(root, '--check');
    assert.equal(check.status, 1);
    assert.match(check.stdout + check.stderr, /orphan/);
  });

  test('exits 1 when .opencode/agents is missing the entire dir', () => {
    const root = setupWorkspace();
    writeAgent(
      root,
      'jlu-foo.md',
      `---\nname: jlu-foo\ndescription: Foo\ntools: Read\nmodel: sonnet\n---\n\nBody.\n`,
    );
    // delete the dest dir before --check
    spawnSync('rm', ['-rf', join(root, '.opencode/agents')]);
    const check = runSync(root, '--check');
    assert.equal(check.status, 1);
  });
});
