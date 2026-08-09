// tests/unit/classify-e2e-target.test.mjs
//
// Tests for bin/classify-e2e-target.mjs — the default-deny URL classifier used
// by agents/jlu-ui-qa-runner.md step 1 to refuse production E2E targets.
//
// Run: `node --test tests/unit/classify-e2e-target.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTarget } from '../../bin/classify-e2e-target.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', '..', 'bin', 'classify-e2e-target.mjs');

describe('classify-e2e-target — classifyTarget()', () => {
  const cases = [
    ['http://localhost:3000', 'safe'],
    ['http://127.0.0.1:8080', 'safe'],
    ['http://[::1]:3000', 'safe'],
    ['https://app.local', 'safe'],
    ['https://staging.jelou.ai', 'safe'],
    ['https://app-dev.jelou.ai', 'safe'],
    ['https://sandbox.jelou.ai', 'safe'],
    ['https://qa.jelou.ai', 'safe'],
    ['https://my-test.jelou.ai', 'safe'],
    ['https://apps.jelou.ai', 'prod'],
    ['https://workflows.jelou.ai', 'prod'],
    ['https://latest.jelou.ai', 'prod'],
    ['not-a-url', 'prod'],
    ['', 'prod'],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.equal(classifyTarget(input), expected);
    });
  }
  test('null/undefined -> prod (fail-safe)', () => {
    assert.equal(classifyTarget(null), 'prod');
    assert.equal(classifyTarget(undefined), 'prod');
  });
});

describe('classify-e2e-target — CLI', () => {
  function run(arg) {
    const r = spawnSync('node', [SCRIPT, arg], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim() };
  }
  test('prints safe and exits 0 for localhost', () => {
    const r = run('http://localhost:3000');
    assert.equal(r.code, 0);
    assert.equal(r.out, 'safe');
  });
  test('prints prod and exits 0 for a production host', () => {
    const r = run('https://apps.jelou.ai');
    assert.equal(r.code, 0);
    assert.equal(r.out, 'prod');
  });
  test('--version prints a version and exits 0', () => {
    const r = run('--version');
    assert.equal(r.code, 0);
    assert.match(r.out, /^\d+\.\d+\.\d+$/);
  });
});

describe('classify-e2e-target — CLI self-loads E2E_BASE_URL from UI_WORKTREE when no arg', () => {
  function runNoArg(envExtra) {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8', env: { ...process.env, ...envExtra } });
    return { code: r.status, out: r.stdout.trim() };
  }
  test('reads E2E_BASE_URL from the worktree .env.e2e overlay and classifies it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'classify-'));
    writeFileSync(join(dir, '.env.e2e'), 'E2E_BASE_URL=http://localhost:5173\n');
    const r = runNoArg({ UI_WORKTREE: dir });
    assert.equal(r.code, 0);
    assert.equal(r.out, 'safe');
  });
  test('no arg and no UI_WORKTREE stays fail-safe (prod)', () => {
    const r = runNoArg({ UI_WORKTREE: '' });
    assert.equal(r.out, 'prod');
  });
});
