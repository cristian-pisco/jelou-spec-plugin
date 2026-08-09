import { isLoggedOutUrl } from '../../e2e-auth.mjs';
import { clearAuthCookie, readAuthCookie, writeAuthCookie } from './auth-cookie-state.mjs';
import { loginForCookie } from './login-cookie.mjs';

function authenticationFailure(reason) {
  return new Error(`Local authentication failed after one keyring-backed login (${reason}); verify the local user and rerun /jlu-start-dev --reconfigure`);
}

function authorizationFailure(reason, email) {
  const account = email || 'the configured local account';
  if (reason === 'no-permissions') {
    return new Error(`Local session for ${account} has no permissions, so the jelou-apps sidebar renders empty; grant this account its roles in the local dashboard database, then log out and log back in`);
  }
  return new Error(`Local session for ${account} could not be authorized: the dashboard identity endpoint exposed no permission set; confirm the dashboard-server verify path returns the authenticated user`);
}

const IDENTITY_ENVELOPES = ['data', 'result', 'payload'];
const IDENTITY_HOLDERS = ['User', 'user'];

function permissionCandidates(root) {
  const scopes = [root, ...IDENTITY_ENVELOPES.map((key) => root?.[key])];
  const out = [];
  for (const scope of scopes) {
    if (!scope || typeof scope !== 'object') continue;
    out.push(scope.permissions);
    for (const holder of IDENTITY_HOLDERS) out.push(scope[holder]?.permissions);
  }
  return out;
}

function readPermissions(payload) {
  return permissionCandidates(payload).find((value) => Array.isArray(value)) || null;
}

export async function verifyProtectedSession({ cookie, verifyUrls, identityUrl, appUrl, protectedPath }, { request, createBrowserContext }) {
  const apiStatuses = [];
  let identityPayload = null;
  for (const url of verifyUrls) {
    const response = await request(url, { headers: { cookie: `${cookie.name}=${cookie.value}` }, redirect: 'manual' });
    apiStatuses.push(response.status);
    if (identityUrl && url === identityUrl && response.status === 200 && typeof response.json === 'function') {
      try {
        identityPayload = await response.json();
      } catch {
        identityPayload = null;
      }
    }
  }
  if (apiStatuses.some((status) => status !== 200)) {
    return { status: 'invalid', reason: 'api-rejected', apiStatuses, finalUrl: null };
  }

  let permissionCount = null;
  if (identityUrl) {
    const permissions = readPermissions(identityPayload);
    if (!permissions) {
      return { status: 'invalid', reason: 'identity-unreadable', apiStatuses, finalUrl: null, permissionCount: null };
    }
    if (permissions.length === 0) {
      return { status: 'invalid', reason: 'no-permissions', apiStatuses, finalUrl: null, permissionCount: 0 };
    }
    permissionCount = permissions.length;
  }

  const context = await createBrowserContext();
  try {
    await context.addCookies([{
      name: cookie.name,
      value: cookie.value,
      url: new URL(appUrl).origin,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }]);
    const page = await context.newPage();
    await page.goto(new URL(protectedPath, appUrl).href);
    const finalUrl = page.url();
    if (isLoggedOutUrl(finalUrl)) {
      return { status: 'invalid', reason: 'browser-redirected-to-login', apiStatuses, finalUrl };
    }
    return { status: 'valid', apiStatuses, finalUrl, ...(permissionCount === null ? {} : { permissionCount }) };
  } finally {
    await context.close();
  }
}

export async function establishAuthenticatedSession(options, dependencies) {
  const lifecycle = dependencies.onLifecycle || (() => {});
  const unauthorized = new Set(['no-permissions', 'identity-unreadable']);
  const email = options.profile?.user?.email;
  const cookie = readAuthCookie(options.stateOptions);
  let source = 'login';
  if (cookie) {
    const verification = await verifyProtectedSession({
      cookie,
      verifyUrls: options.verifyUrls,
      identityUrl: options.identityUrl,
      appUrl: options.appUrl,
      protectedPath: options.protectedPath,
    }, dependencies);
    if (verification.status === 'valid') {
      return {
        status: 'authenticated',
        source: 'stored',
        apiStatuses: verification.apiStatuses,
        finalUrl: verification.finalUrl,
        ...(verification.permissionCount === undefined ? {} : { permissionCount: verification.permissionCount }),
      };
    }
    if (unauthorized.has(verification.reason)) {
      lifecycle({ stage: 'authorization', outcome: 'failed', reason: verification.reason });
      throw authorizationFailure(verification.reason, email);
    }
    clearAuthCookie(options.stateOptions);
    source = 'refreshed';
  }

  lifecycle({ stage: 'login', outcome: 'started' });
  const password = dependencies.keyring.read(options.profile.keyringIdentity);
  const login = await loginForCookie({
    ...options.login,
    email: options.profile.user.email,
    password,
    postJson: dependencies.postJson,
    readOtp: dependencies.readOtp,
  });
  if (login.status !== 'ok' || !login.cookie) {
    clearAuthCookie(options.stateOptions);
    lifecycle({ stage: 'login', outcome: 'failed', reason: login.status });
    throw authenticationFailure(login.status);
  }
  lifecycle({ stage: 'login', outcome: 'succeeded', source });
  lifecycle({ stage: 'browser_verification', outcome: 'started' });
  const refreshed = await verifyProtectedSession({
    cookie: login.cookie,
    verifyUrls: options.verifyUrls,
    identityUrl: options.identityUrl,
    appUrl: options.appUrl,
    protectedPath: options.protectedPath,
  }, dependencies);
  if (unauthorized.has(refreshed.reason)) {
    clearAuthCookie(options.stateOptions);
    lifecycle({ stage: 'authorization', outcome: 'failed', reason: refreshed.reason });
    throw authorizationFailure(refreshed.reason, email);
  }
  if (refreshed.status !== 'valid') {
    clearAuthCookie(options.stateOptions);
    lifecycle({ stage: 'browser_verification', outcome: 'failed', reason: refreshed.reason });
    throw authenticationFailure(refreshed.reason);
  }
  lifecycle({ stage: 'browser_verification', outcome: 'succeeded' });
  writeAuthCookie(options.stateOptions, login.cookie);
  return {
    status: 'authenticated',
    source,
    apiStatuses: refreshed.apiStatuses,
    finalUrl: refreshed.finalUrl,
    ...(refreshed.permissionCount === undefined ? {} : { permissionCount: refreshed.permissionCount }),
  };
}
