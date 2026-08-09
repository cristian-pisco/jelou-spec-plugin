import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { establishAuthenticatedSession, verifyProtectedSession } from '../../bin/lib/dev-orchestrator/stack/auth-session.mjs';
import { readAuthCookie, writeAuthCookie } from '../../bin/lib/dev-orchestrator/stack/auth-cookie-state.mjs';

const cookie = {
  name: 'jelou_auth',
  value: 'genuine-session',
  domain: 'localhost',
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: false,
  sameSite: 'Lax',
};

describe('protected local session verification', () => {
  test('authenticates every protected API and a jelou-apps route outside login', async () => {
    let injectedForApp = false;
    let finalUrl = 'about:blank';
    let closed = false;
    const request = async (url, options) => ({
      status: options.headers.cookie === 'jelou_auth=genuine-session' && url.startsWith('http://localhost:') ? 200 : 401,
    });
    const createBrowserContext = async () => ({
      async addCookies(cookies) {
        injectedForApp = cookies.length === 1
          && cookies[0].name === 'jelou_auth'
          && cookies[0].value === 'genuine-session'
          && cookies[0].url === 'http://localhost:15175';
      },
      async newPage() {
        return {
          async goto(url) {
            finalUrl = injectedForApp ? url : 'http://localhost:15175/login';
          },
          url() {
            return finalUrl;
          },
        };
      },
      async close() {
        closed = true;
      },
    });

    const result = await verifyProtectedSession({
      cookie,
      verifyUrls: [
        'http://localhost:18383/v1/company',
        'http://localhost:18484/api/v1/auth/me',
      ],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, { request, createBrowserContext });

    assert.deepEqual(result, {
      status: 'valid',
      apiStatuses: [200, 200],
      finalUrl: 'http://localhost:15175/home',
    });
    assert.equal(closed, true);
  });

  test('preserves the genuine dashboard cookie security attributes in the browser context', async () => {
    let finalUrl = 'http://localhost:15175/login';
    const result = await verifyProtectedSession({
      cookie,
      verifyUrls: ['http://localhost:18383/v1/company'],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      request: async () => ({ status: 200 }),
      createBrowserContext: async () => ({
        async addCookies(cookies) {
          const injected = cookies[0];
          if (injected.httpOnly === true
            && injected.secure === false
            && injected.sameSite === 'Lax'
            && injected.expires === -1) {
            finalUrl = 'http://localhost:15175/home';
          }
        },
        async newPage() {
          return { async goto() {}, url: () => finalUrl };
        },
        async close() {},
      }),
    });

    assert.equal(result.status, 'valid');
  });

  test('refuses browser injection when a protected API rejects the cookie', async () => {
    const result = await verifyProtectedSession({
      cookie,
      verifyUrls: ['http://localhost:18383/v1/company'],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      request: async () => ({ status: 401 }),
      createBrowserContext: async () => {
        throw new Error('browser context must not be created for a rejected cookie');
      },
    });

    assert.deepEqual(result, {
      status: 'invalid',
      reason: 'api-rejected',
      apiStatuses: [401],
      finalUrl: null,
    });
  });

  test('refuses a protected API redirect without following it to a public page', async () => {
    const result = await verifyProtectedSession({
      cookie,
      verifyUrls: ['http://localhost:18383/v1/company'],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      request: async (_url, options) => ({ status: options.redirect === 'manual' ? 302 : 200 }),
      createBrowserContext: async () => {
        throw new Error('browser context must not be created for a redirect');
      },
    });

    assert.deepEqual(result, {
      status: 'invalid',
      reason: 'api-rejected',
      apiStatuses: [302],
      finalUrl: null,
    });
  });

  test('refuses a browser session redirected to login', async () => {
    let closed = false;
    const result = await verifyProtectedSession({
      cookie,
      verifyUrls: ['http://localhost:18383/v1/company'],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      request: async () => ({ status: 200 }),
      createBrowserContext: async () => ({
        async addCookies() {},
        async newPage() {
          return {
            async goto() {},
            url: () => 'http://localhost:15175/login?next=%2Fhome',
          };
        },
        async close() {
          closed = true;
        },
      }),
    });

    assert.deepEqual(result, {
      status: 'invalid',
      reason: 'browser-redirected-to-login',
      apiStatuses: [200],
      finalUrl: 'http://localhost:15175/login?next=%2Fhome',
    });
    assert.equal(closed, true);
  });
});

describe('authorized local session verification', () => {
  const identityUrl = 'http://localhost:18484/api/v1/auth/me';
  const verifyUrls = ['http://localhost:18383/v1/company', identityUrl];

  const requestReturning = (permissions) => async (url) => ({
    status: 200,
    json: async () => (url === identityUrl ? { data: { User: { permissions } } } : {}),
  });

  test('accepts a session whose identity endpoint carries at least one permission', async () => {
    const result = await verifyProtectedSession({
      cookie,
      verifyUrls,
      identityUrl,
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      request: requestReturning(['brain:view_brain']),
      createBrowserContext: async () => ({
        async addCookies() {},
        async newPage() {
          return { async goto() {}, url: () => 'http://localhost:15175/home' };
        },
        async close() {},
      }),
    });

    assert.equal(result.status, 'valid');
    assert.equal(result.permissionCount, 1);
  });

  test('refuses a permission-less session before opening the browser', async () => {
    const result = await verifyProtectedSession({
      cookie,
      verifyUrls,
      identityUrl,
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      request: requestReturning([]),
      createBrowserContext: async () => {
        throw new Error('a permission-less session must not be injected');
      },
    });

    assert.deepEqual(result, {
      status: 'invalid',
      reason: 'no-permissions',
      apiStatuses: [200, 200],
      finalUrl: null,
      permissionCount: 0,
    });
  });

  test('refuses a session whose identity payload exposes no permission set', async () => {
    const result = await verifyProtectedSession({
      cookie,
      verifyUrls,
      identityUrl,
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      request: async () => ({ status: 200, json: async () => ({ data: {} }) }),
      createBrowserContext: async () => {
        throw new Error('an unreadable identity payload must not be injected');
      },
    });

    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'identity-unreadable');
  });
});

describe('authenticated local session lifecycle', () => {
  test('reuses a valid stored cookie without keyring or dashboard login', async (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-session-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const stateOptions = { workspaceId: 'workspace-a', slug: 'task-a', baseDir };
    writeAuthCookie(stateOptions, cookie);

    const result = await establishAuthenticatedSession({
      stateOptions,
      profile: { user: { email: 'local@example.test' }, keyringIdentity: 'jlu-local-auth:workspace-a:task-a' },
      login: {
        loginUrl: 'http://localhost:18484/api/v1/auth/login',
        verifyMfaUrl: 'http://localhost:18484/api/v1/auth/login/verify_mfa',
        cookieName: 'jelou_auth',
      },
      verifyUrls: ['http://localhost:18383/v1/company'],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      keyring: { read: () => { throw new Error('keyring must not be read'); } },
      postJson: async () => { throw new Error('dashboard login must not run'); },
      readOtp: async () => null,
      request: async () => ({ status: 200 }),
      createBrowserContext: async () => ({
        async addCookies() {},
        async newPage() {
          return { async goto() {}, url: () => 'http://localhost:15175/home' };
        },
        async close() {},
      }),
    });

    assert.deepEqual(result, {
      status: 'authenticated',
      source: 'stored',
      apiStatuses: [200],
      finalUrl: 'http://localhost:15175/home',
    });
  });

  test('refreshes an expired stored cookie exactly once through its keyring profile', async (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-session-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const stateOptions = { workspaceId: 'workspace-a', slug: 'task-a', baseDir };
    writeAuthCookie(stateOptions, { ...cookie, value: 'expired-session' });
    let keyringReads = 0;
    let loginRequests = 0;
    let injectedValue = null;

    const result = await establishAuthenticatedSession({
      stateOptions,
      profile: { user: { email: 'local@example.test' }, keyringIdentity: 'jlu-local-auth:workspace-a:task-a' },
      login: {
        loginUrl: 'http://localhost:18484/api/v1/auth/login',
        verifyMfaUrl: 'http://localhost:18484/api/v1/auth/login/verify_mfa',
        cookieName: 'jelou_auth',
      },
      verifyUrls: ['http://localhost:18383/v1/company'],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      keyring: {
        read() {
          keyringReads += 1;
          return 'keyring-password';
        },
      },
      async postJson() {
        loginRequests += 1;
        return {
          status: 200,
          json: { status: 1, data: { user: { names: 'Local Developer' } } },
          setCookies: ['jelou_auth=fresh-session; Path=/; HttpOnly; SameSite=Lax'],
        };
      },
      readOtp: async () => null,
      request: async (_url, options) => ({ status: options.headers.cookie === 'jelou_auth=fresh-session' ? 200 : 401 }),
      createBrowserContext: async () => ({
        async addCookies(cookies) {
          injectedValue = cookies[0].value;
        },
        async newPage() {
          return { async goto() {}, url: () => injectedValue === 'fresh-session' ? 'http://localhost:15175/home' : 'http://localhost:15175/login' };
        },
        async close() {},
      }),
    });

    assert.deepEqual(result, {
      status: 'authenticated',
      source: 'refreshed',
      apiStatuses: [200],
      finalUrl: 'http://localhost:15175/home',
    });
    assert.equal(keyringReads, 1);
    assert.equal(loginRequests, 1);
    assert.equal(readAuthCookie(stateOptions).value, 'fresh-session');
  });

  test('creates the first session from the task keyring profile', async (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-session-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const stateOptions = { workspaceId: 'workspace-a', slug: 'task-a', baseDir };
    let injectedValue = null;

    const result = await establishAuthenticatedSession({
      stateOptions,
      profile: { user: { email: 'local@example.test' }, keyringIdentity: 'jlu-local-auth:workspace-a:task-a' },
      login: {
        loginUrl: 'http://localhost:18484/api/v1/auth/login',
        verifyMfaUrl: 'http://localhost:18484/api/v1/auth/login/verify_mfa',
        cookieName: 'jelou_auth',
      },
      verifyUrls: ['http://localhost:18383/v1/company'],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      keyring: { read: () => 'keyring-password' },
      postJson: async () => ({
        status: 200,
        json: { status: 1, data: { user: { names: 'Local Developer' } } },
        setCookies: ['jelou_auth=first-session; Path=/; HttpOnly; SameSite=Lax'],
      }),
      readOtp: async () => null,
      request: async (_url, options) => ({ status: options.headers.cookie === 'jelou_auth=first-session' ? 200 : 401 }),
      createBrowserContext: async () => ({
        async addCookies(cookies) {
          injectedValue = cookies[0].value;
        },
        async newPage() {
          return { async goto() {}, url: () => injectedValue === 'first-session' ? 'http://localhost:15175/home' : 'http://localhost:15175/login' };
        },
        async close() {},
      }),
    });

    assert.deepEqual(result, {
      status: 'authenticated',
      source: 'login',
      apiStatuses: [200],
      finalUrl: 'http://localhost:15175/home',
    });
    assert.equal(readAuthCookie(stateOptions).value, 'first-session');
  });

  test('returns one actionable failure after invalid credentials without injecting the stale cookie', async (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-session-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const stateOptions = { workspaceId: 'workspace-a', slug: 'task-a', baseDir };
    writeAuthCookie(stateOptions, { ...cookie, value: 'expired-session' });
    let keyringReads = 0;
    let loginRequests = 0;

    await assert.rejects(
      () => establishAuthenticatedSession({
        stateOptions,
        profile: { user: { email: 'local@example.test' }, keyringIdentity: 'jlu-local-auth:workspace-a:task-a' },
        login: {
          loginUrl: 'http://localhost:18484/api/v1/auth/login',
          verifyMfaUrl: 'http://localhost:18484/api/v1/auth/login/verify_mfa',
          cookieName: 'jelou_auth',
        },
        verifyUrls: ['http://localhost:18383/v1/company'],
        appUrl: 'http://localhost:15175/',
        protectedPath: '/home',
      }, {
        keyring: {
          read() {
            keyringReads += 1;
            return 'keyring-password';
          },
        },
        postJson: async () => {
          loginRequests += 1;
          return { status: 401, json: { status: 0 }, setCookies: [] };
        },
        readOtp: async () => null,
        request: async () => ({ status: 401 }),
        createBrowserContext: async () => {
          throw new Error('stale cookie must not be injected');
        },
      }),
      (error) => {
        assert.match(error.message, /authentication failed after one keyring-backed login.*--reconfigure/i);
        assert.doesNotMatch(error.message, /keyring-password|expired-session/);
        return true;
      },
    );

    assert.equal(keyringReads, 1);
    assert.equal(loginRequests, 1);
    assert.equal(readAuthCookie(stateOptions), null);
  });

  test('returns one actionable failure when the dashboard omits jelou_auth', async (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-session-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const stateOptions = { workspaceId: 'workspace-a', slug: 'task-a', baseDir };
    let loginRequests = 0;

    await assert.rejects(
      () => establishAuthenticatedSession({
        stateOptions,
        profile: { user: { email: 'local@example.test' }, keyringIdentity: 'jlu-local-auth:workspace-a:task-a' },
        login: {
          loginUrl: 'http://localhost:18484/api/v1/auth/login',
          verifyMfaUrl: 'http://localhost:18484/api/v1/auth/login/verify_mfa',
          cookieName: 'jelou_auth',
        },
        verifyUrls: ['http://localhost:18383/v1/company'],
        appUrl: 'http://localhost:15175/',
        protectedPath: '/home',
      }, {
        keyring: { read: () => 'keyring-password' },
        postJson: async () => {
          loginRequests += 1;
          return {
            status: 200,
            json: { status: 1, data: { user: { names: 'Local Developer' } } },
            setCookies: [],
          };
        },
        readOtp: async () => null,
        request: async () => { throw new Error('missing cookie must not be probed'); },
        createBrowserContext: async () => { throw new Error('missing cookie must not be injected'); },
      }),
      /authentication failed after one keyring-backed login.*--reconfigure/i,
    );

    assert.equal(loginRequests, 1);
    assert.equal(readAuthCookie(stateOptions), null);
  });

  test('returns one actionable failure when the single refreshed cookie is rejected', async (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-session-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const stateOptions = { workspaceId: 'workspace-a', slug: 'task-a', baseDir };
    writeAuthCookie(stateOptions, { ...cookie, value: 'expired-session' });
    let loginRequests = 0;

    await assert.rejects(
      () => establishAuthenticatedSession({
        stateOptions,
        profile: { user: { email: 'local@example.test' }, keyringIdentity: 'jlu-local-auth:workspace-a:task-a' },
        login: {
          loginUrl: 'http://localhost:18484/api/v1/auth/login',
          verifyMfaUrl: 'http://localhost:18484/api/v1/auth/login/verify_mfa',
          cookieName: 'jelou_auth',
        },
        verifyUrls: ['http://localhost:18383/v1/company'],
        appUrl: 'http://localhost:15175/',
        protectedPath: '/home',
      }, {
        keyring: { read: () => 'keyring-password' },
        postJson: async () => {
          loginRequests += 1;
          return {
            status: 200,
            json: { status: 1, data: { user: { names: 'Local Developer' } } },
            setCookies: ['jelou_auth=rejected-session; Path=/; HttpOnly; SameSite=Lax'],
          };
        },
        readOtp: async () => null,
        request: async () => ({ status: 401 }),
        createBrowserContext: async () => { throw new Error('rejected cookie must not be injected'); },
      }),
      /authentication failed after one keyring-backed login.*--reconfigure/i,
    );

    assert.equal(loginRequests, 1);
    assert.equal(readAuthCookie(stateOptions), null);
  });

  test('emits login and browser lifecycle outcomes without secret values', async (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-session-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const events = [];

    await establishAuthenticatedSession({
      stateOptions: { workspaceId: 'workspace-a', slug: 'task-a', baseDir },
      profile: { user: { email: 'local@example.test' }, keyringIdentity: 'jlu-local-auth:workspace-a:task-a' },
      login: {
        loginUrl: 'http://localhost:18484/api/v1/auth/login',
        verifyMfaUrl: 'http://localhost:18484/api/v1/auth/login/verify_mfa',
        cookieName: 'jelou_auth',
      },
      verifyUrls: ['http://localhost:18383/v1/company'],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      keyring: { read: () => 'phase06-password-canary' },
      postJson: async () => ({
        status: 200,
        json: { status: 1, data: { user: { names: 'Local Developer' } } },
        setCookies: ['jelou_auth=phase06-cookie-canary; Path=/; HttpOnly; SameSite=Lax'],
      }),
      readOtp: async () => null,
      request: async () => ({ status: 200 }),
      createBrowserContext: async () => ({
        async addCookies() {},
        async newPage() {
          return { async goto() {}, url: () => 'http://localhost:15175/home' };
        },
        async close() {},
      }),
      onLifecycle: (event) => events.push(event),
    });

    assert.deepEqual(events, [
      { stage: 'login', outcome: 'started' },
      { stage: 'login', outcome: 'succeeded', source: 'login' },
      { stage: 'browser_verification', outcome: 'started' },
      { stage: 'browser_verification', outcome: 'succeeded' },
    ]);
    assert.doesNotMatch(JSON.stringify(events), /phase06-password-canary|phase06-cookie-canary/);
  });

  test('emits a failed login lifecycle outcome for rejected credentials', async (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-session-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const events = [];

    await assert.rejects(() => establishAuthenticatedSession({
      stateOptions: { workspaceId: 'workspace-a', slug: 'task-a', baseDir },
      profile: { user: { email: 'local@example.test' }, keyringIdentity: 'jlu-local-auth:workspace-a:task-a' },
      login: {
        loginUrl: 'http://localhost:18484/api/v1/auth/login',
        verifyMfaUrl: 'http://localhost:18484/api/v1/auth/login/verify_mfa',
        cookieName: 'jelou_auth',
      },
      verifyUrls: ['http://localhost:18383/v1/company'],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      keyring: { read: () => 'phase06-password-canary' },
      postJson: async () => ({ status: 401, json: { status: 0 }, setCookies: [] }),
      readOtp: async () => null,
      request: async () => { throw new Error('rejected login must not be probed'); },
      createBrowserContext: async () => { throw new Error('rejected login must not be injected'); },
      onLifecycle: (event) => events.push(event),
    }));

    assert.deepEqual(events, [
      { stage: 'login', outcome: 'started' },
      { stage: 'login', outcome: 'failed', reason: 'rejected' },
    ]);
    assert.doesNotMatch(JSON.stringify(events), /phase06-password-canary/);
  });

  test('fails a permission-less account by name without spending a keyring login', async (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-session-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const stateOptions = { workspaceId: 'workspace-a', slug: 'task-a', baseDir };
    writeAuthCookie(stateOptions, cookie);
    const identityUrl = 'http://localhost:18484/api/v1/auth/me';
    const events = [];

    await assert.rejects(
      () => establishAuthenticatedSession({
        stateOptions,
        profile: { user: { email: 'expected@example.test' }, keyringIdentity: 'jlu-local-auth:workspace-a:task-a' },
        login: {
          loginUrl: 'http://localhost:18484/api/v1/auth/login',
          verifyMfaUrl: 'http://localhost:18484/api/v1/auth/login/verify_mfa',
          cookieName: 'jelou_auth',
        },
        verifyUrls: [identityUrl],
        identityUrl,
        appUrl: 'http://localhost:15175/',
        protectedPath: '/home',
      }, {
        keyring: { read: () => { throw new Error('a permission-less account must not spend a login'); } },
        postJson: async () => { throw new Error('a permission-less account must not spend a login'); },
        readOtp: async () => null,
        request: async () => ({ status: 200, json: async () => ({ data: { User: { permissions: [] } } }) }),
        createBrowserContext: async () => { throw new Error('a permission-less session must not be injected'); },
        onLifecycle: (event) => events.push(event),
      }),
      (error) => {
        assert.match(error.message, /expected@example\.test/);
        assert.match(error.message, /no permissions/i);
        assert.doesNotMatch(error.message, /--reconfigure/);
        return true;
      },
    );

    assert.deepEqual(events, [
      { stage: 'authorization', outcome: 'failed', reason: 'no-permissions' },
    ]);
  });

  test('emits a failed browser lifecycle outcome for a rejected fresh session', async (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-session-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const events = [];

    await assert.rejects(() => establishAuthenticatedSession({
      stateOptions: { workspaceId: 'workspace-a', slug: 'task-a', baseDir },
      profile: { user: { email: 'local@example.test' }, keyringIdentity: 'jlu-local-auth:workspace-a:task-a' },
      login: {
        loginUrl: 'http://localhost:18484/api/v1/auth/login',
        verifyMfaUrl: 'http://localhost:18484/api/v1/auth/login/verify_mfa',
        cookieName: 'jelou_auth',
      },
      verifyUrls: ['http://localhost:18383/v1/company'],
      appUrl: 'http://localhost:15175/',
      protectedPath: '/home',
    }, {
      keyring: { read: () => 'phase06-password-canary' },
      postJson: async () => ({
        status: 200,
        json: { status: 1, data: { user: { names: 'Local Developer' } } },
        setCookies: ['jelou_auth=phase06-cookie-canary; Path=/; HttpOnly; SameSite=Lax'],
      }),
      readOtp: async () => null,
      request: async () => ({ status: 401 }),
      createBrowserContext: async () => { throw new Error('rejected cookie must not be injected'); },
      onLifecycle: (event) => events.push(event),
    }));

    assert.deepEqual(events, [
      { stage: 'login', outcome: 'started' },
      { stage: 'login', outcome: 'succeeded', source: 'login' },
      { stage: 'browser_verification', outcome: 'started' },
      { stage: 'browser_verification', outcome: 'failed', reason: 'api-rejected' },
    ]);
    assert.doesNotMatch(JSON.stringify(events), /phase06-password-canary|phase06-cookie-canary/);
  });
});
