// tests/unit/env-files.test.mjs
//
// The boot/auth path injects env by PARSING .env files, never bash-sourcing them — a real
// .env routinely has an unquoted value with shell-special chars that breaks `. ./.env` and
// trips the guard-env-reads hook. These tests pin the parser's robustness and the overlay
// order that makes `.env.e2e` win over `.env`.
//
// Run: `node --test tests/unit/env-files.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv, loadEnvFiles, applyEnvFiles, mergedEnv } from '../../bin/lib/env-files.mjs';

describe('parseEnv — robust to bash-hostile values', () => {
  test('takes everything after the first = (unquoted shell-special chars are harmless)', () => {
    const e = parseEnv('KEY=foo bar&baz;qux\nURL=https://api.apps.jelou.ai/api?x=1&y=2');
    assert.equal(e.KEY, 'foo bar&baz;qux');
    assert.equal(e.URL, 'https://api.apps.jelou.ai/api?x=1&y=2');
  });

  test('strips a single layer of matching surrounding quotes', () => {
    const e = parseEnv(`A="quoted value"\nB='single quoted'\nC=unquoted`);
    assert.equal(e.A, 'quoted value');
    assert.equal(e.B, 'single quoted');
    assert.equal(e.C, 'unquoted');
  });

  test('unescapes \\n only inside double quotes', () => {
    const e = parseEnv('A="line1\\nline2"\nB=\'line1\\nline2\'');
    assert.equal(e.A, 'line1\nline2');
    assert.equal(e.B, 'line1\\nline2');
  });

  test('ignores comments, blanks, and honors an export prefix', () => {
    const e = parseEnv('# comment\n\n   # indented comment\nexport FOO=bar\n   export BAZ=qux');
    assert.equal(e.FOO, 'bar');
    assert.equal(e.BAZ, 'qux');
    assert.equal('# comment' in e, false);
  });

  test('skips lines without a key or with an invalid identifier', () => {
    const e = parseEnv('=novalue\n123KEY=x\nGOOD_KEY=y\nno-equals-here');
    assert.equal(e.GOOD_KEY, 'y');
    assert.equal('123KEY' in e, false);
    assert.equal(Object.keys(e).length, 1);
  });
});

describe('loadEnvFiles / applyEnvFiles — overlay order', () => {
  let dir;
  test('setup', () => {
    dir = mkdtempSync(join(tmpdir(), 'jlu-envfiles-'));
    writeFileSync(join(dir, '.env'), 'BASE=https://api.apps.jelou.ai/api\nONLY_IN_ENV=1\nWEIRD=a b&c\n');
    writeFileSync(join(dir, '.env.e2e'), 'BASE=http://localhost:8484/api\nONLY_IN_E2E=2\n');
  });

  test('.env.e2e overrides .env; both contribute their own keys', () => {
    const e = loadEnvFiles(dir);
    assert.equal(e.BASE, 'http://localhost:8484/api');
    assert.equal(e.ONLY_IN_ENV, '1');
    assert.equal(e.ONLY_IN_E2E, '2');
    assert.equal(e.WEIRD, 'a b&c');
  });

  test('a missing file is skipped, not fatal', () => {
    const e = loadEnvFiles(dir, ['.env', '.does-not-exist', '.env.e2e']);
    assert.equal(e.BASE, 'http://localhost:8484/api');
  });

  test('applyEnvFiles sets file keys onto a target and leaves unrelated keys intact', () => {
    const target = { UI_WORKTREE: '/x', BASE: 'inherited-should-be-overridden' };
    applyEnvFiles(target, dir);
    assert.equal(target.BASE, 'http://localhost:8484/api');
    assert.equal(target.UI_WORKTREE, '/x');
    assert.equal(target.ONLY_IN_E2E, '2');
  });

  test('mergedEnv layers the overlay over process.env', () => {
    const m = mergedEnv(dir);
    assert.equal(m.BASE, 'http://localhost:8484/api');
    assert.equal(m.PATH, process.env.PATH);
  });

  test('teardown', () => {
    rmSync(dir, { recursive: true, force: true });
  });
});
