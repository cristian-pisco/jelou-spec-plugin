// tests/unit/stack-login-cookie.test.mjs
//
// Run: `node --test tests/unit/stack-login-cookie.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { loginForCookie } from '../../bin/lib/dev-orchestrator/stack/login-cookie.mjs';

const okBody = { status: 1, data: { user: { names: 'E2E' } } };

describe('loginForCookie', () => {
  test('returns the jelou_auth cookie value on a no-2FA login', async () => {
    const postJson = async () => ({ status: 200, json: okBody, setCookies: ['jelou_auth=abc123; Path=/; Max-Age=604800'] });
    const out = await loginForCookie({ loginUrl: 'http://x/login', verifyMfaUrl: 'http://x/mfa', cookieName: 'jelou_auth', email: 'e@x', password: 'p', postJson, readOtp: async () => null });
    assert.equal(out.status, 'ok');
    assert.equal(out.cookieValue, 'abc123');
  });

  test('rejects on bad credentials', async () => {
    const postJson = async () => ({ status: 401, json: { status: 0 }, setCookies: [] });
    const out = await loginForCookie({ loginUrl: 'http://x/login', verifyMfaUrl: 'http://x/mfa', cookieName: 'jelou_auth', email: 'e@x', password: 'bad', postJson, readOtp: async () => null });
    assert.equal(out.status, 'rejected');
  });

  test('completes the 2FA fallback using the injected OTP reader', async () => {
    let call = 0;
    const postJson = async () => {
      call += 1;
      if (call === 1) return { status: 200, json: { status: 1, data: { twoFaPending: true } }, setCookies: ['cookie-2fa=pending; Path=/'] };
      return { status: 200, json: okBody, setCookies: ['jelou_auth=zzz; Path=/; Max-Age=604800'] };
    };
    const out = await loginForCookie({ loginUrl: 'http://x/login', verifyMfaUrl: 'http://x/mfa', cookieName: 'jelou_auth', email: 'e@x', password: 'p', postJson, readOtp: async () => '123456' });
    assert.equal(out.status, 'ok');
    assert.equal(out.cookieValue, 'zzz');
  });
});
