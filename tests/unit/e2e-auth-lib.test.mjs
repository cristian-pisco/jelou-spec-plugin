// tests/unit/e2e-auth-lib.test.mjs
//
// Run: `node --test tests/unit/e2e-auth-lib.test.mjs`
// Pure helpers behind bin/e2e-login.mjs, bin/e2e-session-probe.mjs and
// bin/detect-auth-collapse.mjs. The browser flows are acceptance-tested
// manually (design doc §Testing); everything decision-shaped is tested here.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

import {
  EXIT,
  parseFlatYaml,
  serializeFlatYaml,
  extractOtp,
  isLoggedOutUrl,
  classifyProbeOutcome,
  detectAuthCollapse,
  collectFailureMessages,
  waitForFile,
} from '../../bin/lib/e2e-auth.mjs';

describe('EXIT codes', () => {
  test('match the documented contract', () => {
    assert.deepEqual(EXIT, {
      OK: 0,
      AUTH_REJECTED: 41,
      OTP_TIMEOUT: 42,
      OTP_REJECTED: 43,
      LOGIN_FORM_NOT_FOUND: 44,
      SECRET_MISMATCH: 45,
      MONGO_UNREACHABLE: 46,
      CAPTCHA_BLOCKED: 47,
    });
  });
});

describe('parseFlatYaml / serializeFlatYaml', () => {
  test('parses flat key: value with comments and quotes', () => {
    const text = '# otp mail pattern\notp_from: "no-reply@jelou.ai"\notp_subject_regex: código|code\n\notp_code_regex: \'(\\d{6})\'\n';
    assert.deepEqual(parseFlatYaml(text), {
      otp_from: 'no-reply@jelou.ai',
      otp_subject_regex: 'código|code',
      otp_code_regex: '(\\d{6})',
    });
  });

  test('roundtrips through serialize', () => {
    const obj = { otp_from: 'a@b.c', otp_code_regex: '(\\d{6})' };
    assert.deepEqual(parseFlatYaml(serializeFlatYaml(obj)), obj);
  });

  test('tolerates garbage input', () => {
    assert.deepEqual(parseFlatYaml(null), {});
    assert.deepEqual(parseFlatYaml('no colon here'), {});
  });
});

describe('extractOtp', () => {
  test('default pattern finds a 6-digit code in mail text', () => {
    assert.equal(extractOtp('Tu código de acceso es 482913. Expira en 5 min.'), '482913');
  });

  test('custom regex takes the first capture group', () => {
    assert.equal(extractOtp('code: AB-7731', '([0-9]{4})'), '7731');
  });

  test('returns null when nothing matches or regex is invalid', () => {
    assert.equal(extractOtp('no digits here'), null);
    assert.equal(extractOtp('1234', '('), null);
    assert.equal(extractOtp('', undefined), null);
  });
});

describe('isLoggedOutUrl', () => {
  test('login/otp/verification segments are logged-out routes', () => {
    assert.equal(isLoggedOutUrl('http://x/login?next=%2F'), true);
    assert.equal(isLoggedOutUrl('http://x/otp'), true);
    assert.equal(isLoggedOutUrl('http://x/verification-code'), true);
  });

  test('post-login routes containing those words mid-segment are logged-in', () => {
    assert.equal(isLoggedOutUrl('http://x/auth-callback'), false);
    assert.equal(isLoggedOutUrl('http://x/settings/login-history'), false);
    assert.equal(isLoggedOutUrl('http://x/datum/databases'), false);
  });

  test('tolerates bare paths and garbage', () => {
    assert.equal(isLoggedOutUrl('/signin'), true);
    assert.equal(isLoggedOutUrl(null), false);
  });
});

describe('classifyProbeOutcome', () => {
  test('redirect to a login route is invalid', () => {
    assert.equal(classifyProbeOutcome({ finalUrl: 'http://127.0.0.1:5173/login?next=%2F', apiStatuses: [] }), 'invalid');
  });

  test('any 401 on boot calls is invalid', () => {
    assert.equal(classifyProbeOutcome({ finalUrl: 'http://127.0.0.1:5173/home', apiStatuses: [200, 401] }), 'invalid');
  });

  test('authenticated shell with clean calls is valid', () => {
    assert.equal(classifyProbeOutcome({ finalUrl: 'http://127.0.0.1:5173/datum/databases', apiStatuses: [200, 200] }), 'valid');
  });

  test('a route merely containing the word login mid-path does not trip it', () => {
    assert.equal(classifyProbeOutcome({ finalUrl: 'http://x/settings/login-history', apiStatuses: [] }), 'valid');
  });
});

describe('detectAuthCollapse', () => {
  test('3 consecutive 401-shaped failures collapse', () => {
    assert.equal(detectAuthCollapse([
      'expect(received).toBe(expected) 401',
      'Error: Unauthorized',
      'datum-legacy list response must be 200 ... Received: 401',
    ]), true);
  });

  test('interleaved non-auth failures reset the streak', () => {
    assert.equal(detectAuthCollapse([
      'Received: 401',
      'locator.click: timeout',
      'Received: 401',
      'Received: 401',
    ]), false);
  });

  test('empty input never collapses', () => {
    assert.equal(detectAuthCollapse([]), false);
  });
});

describe('collectFailureMessages', () => {
  test('walks nested playwright JSON suites and keeps only failures', () => {
    const report = {
      suites: [{
        specs: [{ tests: [{ results: [{ status: 'passed' }] }] }],
        suites: [{
          specs: [{
            tests: [{
              results: [
                { status: 'failed', error: { message: 'Received: 401' } },
                { status: 'timedOut', error: { message: 'locator timeout' } },
              ],
            }],
          }],
        }],
      }],
    };
    assert.deepEqual(collectFailureMessages(report), ['Received: 401', 'locator timeout']);
  });

  test('tolerates a malformed report', () => {
    assert.deepEqual(collectFailureMessages({}), []);
    assert.deepEqual(collectFailureMessages(null), []);
  });
});

describe('waitForFile', () => {
  test('returns trimmed content and removes the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-auth-'));
    const p = join(dir, 'otp');
    setTimeout(() => writeFileSync(p, '  482913\n'), 150);
    assert.equal(await waitForFile(p, 3000, 50), '482913');
    assert.equal(existsSync(p), false);
  });

  test('times out with null when the file never appears', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-auth-'));
    assert.equal(await waitForFile(join(dir, 'never'), 300, 50), null);
  });
});

describe('e2e-session-probe CLI', () => {
  test('exits 2 with a clear error when env is missing', () => {
    const r = spawnSync('node', [join(ROOT, 'bin', 'e2e-session-probe.mjs')], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /E2E_BASE_URL and UI_WORKTREE are required/);
  });

  test('prints invalid (exit 1) when no storage state exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const r = spawnSync('node', [join(ROOT, 'bin', 'e2e-session-probe.mjs')], {
      env: { PATH: process.env.PATH, E2E_BASE_URL: 'http://127.0.0.1:1', UI_WORKTREE: dir, E2E_STORAGE_STATE: join(dir, 'missing.json') },
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^invalid/);
  });
});

describe('e2e-login CLI', () => {
  test('exits 2 naming the first missing env var', () => {
    const r = spawnSync('node', [join(ROOT, 'bin', 'e2e-login.mjs')], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /login: missing E2E_BASE_URL/);
  });
});

describe('detect-auth-collapse CLI', () => {
  test('prints auth_collapse for a 401-saturated report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'collapse-'));
    const report = {
      suites: [{
        specs: [{
          tests: [{
            results: [
              { status: 'failed', error: { message: 'Received: 401' } },
              { status: 'failed', error: { message: 'Unauthorized' } },
              { status: 'failed', error: { message: '401 on /datum-legacy' } },
            ],
          }],
        }],
      }],
    };
    const p = join(dir, 'run.json');
    writeFileSync(p, JSON.stringify(report));
    const r = spawnSync('node', [join(ROOT, 'bin', 'detect-auth-collapse.mjs'), p], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^auth_collapse/);
  });

  test('prints ok for a mixed report and exits 2 on unreadable input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'collapse-'));
    const p = join(dir, 'run.json');
    writeFileSync(p, JSON.stringify({ suites: [] }));
    const ok = spawnSync('node', [join(ROOT, 'bin', 'detect-auth-collapse.mjs'), p], { encoding: 'utf8' });
    assert.match(ok.stdout, /^ok/);
    const bad = spawnSync('node', [join(ROOT, 'bin', 'detect-auth-collapse.mjs'), join(dir, 'nope.json')], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
  });
});
