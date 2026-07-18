// tests/unit/stack-auth-urls.test.mjs
//
// Run: `node --test tests/unit/stack-auth-urls.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveAuthUrls } from '../../bin/lib/dev-orchestrator/stack/auth-urls.mjs';

describe('resolveAuthUrls', () => {
  const auth = {
    cookieName: 'jelou_auth',
    dashboardService: 'dashboard-server',
    loginPath: '/api/v1/auth/login',
    verifyMfaPath: '/api/v1/auth/login/verify_mfa',
    verify: [{ service: 'jelou-api', path: '/v1/company' }, { service: 'dashboard-server', path: '/api/v1/auth/me' }]
  };
  const hostByService = { 'dashboard-server': 18484, 'jelou-api': 18383 };

  test('resolves login, verify_mfa and verify URLs to task host ports', () => {
    const out = resolveAuthUrls({ auth, hostByService });
    assert.equal(out.cookieName, 'jelou_auth');
    assert.equal(out.loginUrl, 'http://localhost:18484/api/v1/auth/login');
    assert.equal(out.verifyMfaUrl, 'http://localhost:18484/api/v1/auth/login/verify_mfa');
    assert.deepEqual(out.verifyUrls, ['http://localhost:18383/v1/company', 'http://localhost:18484/api/v1/auth/me']);
  });
});
