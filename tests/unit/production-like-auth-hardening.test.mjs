// tests/unit/production-like-auth-hardening.test.mjs
//
// Hardens the auth/boot path against the remaining failure modes from the datum-legacy saga:
//  A. A captcha/Turnstile on a LOOPBACK target is a misconfiguration (the local frontend is
//     calling a prod backend), NOT a reason to capture a prod session — capturing one is what
//     poisoned the next run with an undecryptable cookie.
//  B. A persisted session whose jelou_auth cookie can't be decrypted with the LOCAL
//     COOKIE_SECRET is a foreign/prod-captured artifact → discard it, force a fresh local login.
//  C. On ready_timeout, boot surfaces the launch-log crash reason so a dependency that died on a
//     missing local-only env var is diagnosable, not opaque.
//
// Run: `node --test tests/unit/production-like-auth-hardening.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const uiwf = read('jelou/workflows/ui-qa-run.md');
const env = read('jelou/references/env-lifecycle.md');
const fixtures = read('jelou/references/auth-fixtures.md');

describe('auth gate — captcha on a loopback target is a misconfiguration, not a capture trigger', () => {
  test('the captcha/Turnstile branch ties a loopback target to a misconfiguration', () => {
    assert.match(uiwf, /captcha\/Turnstile[\s\S]{0,500}loopback/i);
    assert.match(uiwf, /loopback[\s\S]{0,400}(misconfiguration|prod\/remote backend|capture)/i);
  });

  test('a loopback captcha diagnoses a frontend pointing at a prod/remote backend', () => {
    assert.match(uiwf, /NX_REACT_APP/);
    assert.match(uiwf, /(prod|remote)[\s\S]{0,60}backend|backend[\s\S]{0,60}(prod|remote)/i);
  });

  test('consumer prod-capture is reserved for a genuinely remote E2E_BASE_URL', () => {
    assert.match(uiwf, /remote[\s\S]{0,80}capture|capture[\s\S]{0,80}remote/i);
  });
});

describe('auth gate — discards a foreign/undecryptable persisted session', () => {
  test('a cookie undecryptable with the local COOKIE_SECRET is foreign and discarded', () => {
    assert.match(fixtures, /decrypt/i);
    assert.match(fixtures, /foreign|prod-captured/i);
    assert.match(fixtures, /discard|regenerate|fresh local login|treat (it )?as invalid/i);
  });
});

describe('boot — surfaces the crash reason on ready_timeout', () => {
  test('ready_timeout prints the launch-log tail so missing-env crashes are diagnosable', () => {
    const i = env.indexOf('ready_timeout');
    assert.ok(i > -1, 'ready_timeout present');
    assert.match(env, /launch-?<?service>?\.log|log tail|tail .*log/i);
    assert.match(env, /missing|required|env var|crash/i);
  });
});
