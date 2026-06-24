// tests/unit/api-login-lib.test.mjs
//
// Run: `node --test tests/unit/api-login-lib.test.mjs`
// Pure helpers behind bin/e2e-login-local.mjs (deterministic API login) and
// bin/e2e-ensure-account.mjs (B: no-MFA account guard). The network/file IO is
// acceptance-tested live; everything decision-shaped is tested here.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  COOKIE_NAME,
  loginUrl,
  verifyMfaUrl,
  mfaRedisKey,
  classifyLogin,
  extractAuthCookie,
  cookieHeaderFromSetCookies,
  buildStorageState,
  buildEnsureAccountSql,
} from '../../bin/lib/api-login.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SUCCESS = {
  status: 1,
  message: ['Logged in successfully.'],
  data: { token: 'jwt', tokenType: 'Bearer', user: { id: 7126, names: 'E2E Enterprise', sessionId: 99, lang: 'es' } },
};
const MFA_PENDING = {
  status: 1,
  message: ['Two Factor Authentication Required'],
  data: { twoFaPending: true, sessionType: '2FA_PENDING', sentCodeTo: 5 },
};
const REJECTED = { status: 0, message: ['Invalid credentials'], statusMessage: 'FAILED' };

describe('url + key builders', () => {
  test('loginUrl/verifyMfaUrl append onto the /api base and strip trailing slashes', () => {
    assert.equal(loginUrl('http://localhost:8484/api'), 'http://localhost:8484/api/v1/auth/login');
    assert.equal(loginUrl('http://localhost:8484/api/'), 'http://localhost:8484/api/v1/auth/login');
    assert.equal(verifyMfaUrl('http://localhost:8484/api'), 'http://localhost:8484/api/v1/auth/login/verify_mfa');
  });

  test('mfaRedisKey is keyed by email', () => {
    assert.equal(mfaRedisKey('cristian.pisco+e2e@jelou.ai'), 'mfa-code-cristian.pisco+e2e@jelou.ai');
  });
});

describe('classifyLogin', () => {
  test('success envelope with a user is ok', () => {
    const r = classifyLogin(200, SUCCESS);
    assert.equal(r.outcome, 'ok');
    assert.equal(r.user.id, 7126);
  });

  test('twoFaPending is mfa even though it is also status:1', () => {
    assert.equal(classifyLogin(200, MFA_PENDING).outcome, 'mfa');
  });

  test('a 200 with status:1 but no user is not ok', () => {
    assert.equal(classifyLogin(200, { status: 1, data: {} }).outcome, 'rejected');
  });

  test('401 / failed envelope / garbage are rejected', () => {
    assert.equal(classifyLogin(401, REJECTED).outcome, 'rejected');
    assert.equal(classifyLogin(200, REJECTED).outcome, 'rejected');
    assert.equal(classifyLogin(500, null).outcome, 'rejected');
  });
});

describe('extractAuthCookie', () => {
  const setCookies = [
    'someTracker=1; Path=/',
    'jelou_auth=s%3Aabc.def; Path=/; HttpOnly; SameSite=None; Max-Age=86400',
  ];

  test('finds jelou_auth among multiple Set-Cookie headers and maps None->Lax', () => {
    const c = extractAuthCookie(setCookies, { domain: 'localhost' });
    assert.equal(c.name, COOKIE_NAME);
    assert.equal(c.value, 's%3Aabc.def');
    assert.equal(c.domain, 'localhost');
    assert.equal(c.path, '/');
    assert.equal(c.httpOnly, true);
    assert.equal(c.secure, false);
    assert.equal(c.sameSite, 'Lax');
    assert.equal(c.expires, -1);
  });

  test('computes expires from Max-Age when a clock is provided', () => {
    const c = extractAuthCookie(setCookies, { nowSeconds: 1000 });
    assert.equal(c.expires, 1000 + 86400);
  });

  test('keeps SameSite=Strict and a single header string', () => {
    const c = extractAuthCookie('jelou_auth=v; Path=/p; Secure; SameSite=Strict');
    assert.equal(c.sameSite, 'Strict');
    assert.equal(c.secure, true);
    assert.equal(c.path, '/p');
    assert.equal(c.httpOnly, false);
  });

  test('returns null when jelou_auth is absent or value empty', () => {
    assert.equal(extractAuthCookie(['x=1', 'jelou_auth=; Path=/']), null);
    assert.equal(extractAuthCookie([]), null);
    assert.equal(extractAuthCookie(null), null);
  });
});

describe('cookieHeaderFromSetCookies', () => {
  test('serializes name=value pairs for the verify_mfa hop', () => {
    assert.equal(
      cookieHeaderFromSetCookies(['jelou_auth=pending; HttpOnly', 'csrf=abc; Path=/']),
      'jelou_auth=pending; csrf=abc',
    );
  });

  test('tolerates empty input', () => {
    assert.equal(cookieHeaderFromSetCookies(null), '');
  });
});

describe('buildStorageState', () => {
  const cookie = { name: COOKIE_NAME, value: 'v', domain: 'localhost', path: '/' };

  test('carries the cookie and always sets isLogin, plus best-effort hints', () => {
    const s = buildStorageState(cookie, SUCCESS.data.user, { origin: 'http://localhost:5173' });
    assert.deepEqual(s.cookies, [cookie]);
    assert.equal(s.origins[0].origin, 'http://localhost:5173');
    const ls = Object.fromEntries(s.origins[0].localStorage.map((e) => [e.name, e.value]));
    assert.deepEqual(ls, { isLogin: 'true', session: '99', user: 'E2E Enterprise', lang: 'es' });
  });

  test('omits absent hints but still sets isLogin', () => {
    const s = buildStorageState(cookie, {}, { origin: 'http://localhost:5173' });
    assert.deepEqual(s.origins[0].localStorage, [{ name: 'isLogin', value: 'true' }]);
  });

  test('no cookie or no origin yields empty arrays', () => {
    assert.deepEqual(buildStorageState(null, {}, {}), { cookies: [], origins: [] });
  });
});

describe('buildEnsureAccountSql', () => {
  test('verifies the email and clears any per-user 2FA row, escaping the email', () => {
    const sql = buildEnsureAccountSql("a'b@jelou.ai");
    assert.match(sql, /UPDATE chatbot\.users SET emailVerified = 1 WHERE email = 'a\\'b@jelou\.ai';/);
    assert.match(sql, /DELETE t FROM chatbot\.user_two_fa t JOIN chatbot\.users u ON u\.id = t\.userId WHERE u\.email = 'a\\'b@jelou\.ai';/);
  });
});

describe('CLI guards', () => {
  test('e2e-login-local exits 2 naming a missing env var', () => {
    const r = spawnSync('node', [join(ROOT, 'bin', 'e2e-login-local.mjs')], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /login-local: missing/);
  });

  test('e2e-ensure-account exits 2 when the target email is missing', () => {
    const r = spawnSync('node', [join(ROOT, 'bin', 'e2e-ensure-account.mjs')], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ensure-account: missing/);
  });
});
