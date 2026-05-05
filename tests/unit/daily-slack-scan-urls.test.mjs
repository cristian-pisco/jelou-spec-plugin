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

describe('daily-slack-scan-urls — Slack hyperlink format', () => {
  test('exits 0 when URL is wrapped in <url|text> (Slack mrkdwn-flavored hyperlink)', () => {
    const body = '`[100%]` <https://app.clickup.com/t/abc123|Marketplace - HTTP 500 (TypeORM CASE WHEN alias)>';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  test('exits 0 when URL is wrapped in ~~<url|text>~~ (full-line strikethrough)', () => {
    const body = '~~`[2026-04-27]` <https://app.clickup.com/t/abc123|Done thing>~~';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  test('catches an unknown URL inside <url|text>', () => {
    const body = 'See <https://app.clickup.com/t/EVIL|some name>';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown clickup url: https:\/\/app\.clickup\.com\/t\/EVIL/);
  });
});

describe('daily-slack-scan-urls — protocol + fragment normalization', () => {
  test('http body URL matches https allowlist entry', () => {
    const body = 'See http://app.clickup.com/t/abc123';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  test('fragment-bearing URL matches plain allowlist entry', () => {
    const body = 'See https://app.clickup.com/t/abc123#comment-7';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });
});

describe('daily-slack-scan-urls — IO and usage errors', () => {
  test('exits 2 with usage message when no args', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /error: --body <path> and --allowlist <path> are required/);
  });

  test('exits 2 with cannot-read message when body file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daily-slack-scan-'));
    const allowPath = join(dir, 'allow.txt');
    writeFileSync(allowPath, '');
    const r = spawnSync('node', [SCRIPT, '--body', join(dir, 'nonexistent.md'), '--allowlist', allowPath], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot read body file/);
  });
});
