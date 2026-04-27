// tests/unit/daily-slack-scan-urls.test.mjs
//
// Run: `node --test tests/unit/daily-slack-scan-urls.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-scan-urls.mjs', import.meta.url).pathname;

function setup(body, allowlist) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-scan-'));
  const bodyPath = join(dir, 'body.md');
  const allowPath = join(dir, 'allow.txt');
  writeFileSync(bodyPath, body);
  writeFileSync(allowPath, allowlist.join('\n') + '\n');
  return { bodyPath, allowPath };
}

function run({ bodyPath, allowPath }) {
  return spawnSync('node', [SCRIPT, '--body', bodyPath, '--allowlist', allowPath], { encoding: 'utf8' });
}

describe('daily-slack-scan-urls — happy path', () => {
  test('exits 0 when every clickup URL is in the allowlist', () => {
    const body = '[90%] Task A\nhttps://app.clickup.com/t/abc123\n\n[100%] Task B\nhttps://app.clickup.com/t/def456';
    const allow = ['https://app.clickup.com/t/abc123', 'https://app.clickup.com/t/def456'];
    const r = run(setup(body, allow));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  test('exits 0 when body has no clickup URLs', () => {
    const body = 'Plain text with no links.';
    const r = run(setup(body, []));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });
});

describe('daily-slack-scan-urls — violation', () => {
  test('exits 1 and prints the unknown URL when one is not in allowlist', () => {
    const body = 'Look at https://app.clickup.com/t/UNKNOWN here.';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown clickup url: https:\/\/app\.clickup\.com\/t\/UNKNOWN/);
  });
});

describe('daily-slack-scan-urls — normalization', () => {
  test('strips trailing punctuation before allowlist check', () => {
    const body = 'See https://app.clickup.com/t/abc123).';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  test('strips query string before allowlist check', () => {
    const body = 'See https://app.clickup.com/t/abc123?ref=email';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  test('catches URL among many valid ones', () => {
    const body = 'A https://app.clickup.com/t/abc123 B https://app.clickup.com/t/EVIL C https://app.clickup.com/t/def456';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123', 'https://app.clickup.com/t/def456']));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown clickup url: https:\/\/app\.clickup\.com\/t\/EVIL/);
  });
});
