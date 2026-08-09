import { isLoggedOutUrl } from '../../e2e-auth.mjs';
import { clearAuthCookie, readAuthCookie, writeAuthCookie } from './auth-cookie-state.mjs';
import { loginForCookie } from './login-cookie.mjs';

function authenticationFailure(reason) {
  return new Error(`Local authentication failed after one keyring-backed login (${reason}); verify the local user and rerun /jlu-start-dev --reconfigure`);
}

export async function verifyProtectedSession({ cookie, verifyUrls, appUrl, protectedPath }, { request, createBrowserContext }) {
  const apiStatuses = [];
  for (const url of verifyUrls) {
    const response = await request(url, { headers: { cookie: `${cookie.name}=${cookie.value}` }, redirect: 'manual' });
    apiStatuses.push(response.status);
  }
  if (apiStatuses.some((status) => status !== 200)) {
    return { status: 'invalid', reason: 'api-rejected', apiStatuses, finalUrl: null };
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
    return { status: 'valid', apiStatuses, finalUrl };
  } finally {
    await context.close();
  }
}

export async function establishAuthenticatedSession(options, dependencies) {
  const lifecycle = dependencies.onLifecycle || (() => {});
  const cookie = readAuthCookie(options.stateOptions);
  let source = 'login';
  if (cookie) {
    const verification = await verifyProtectedSession({
      cookie,
      verifyUrls: options.verifyUrls,
      appUrl: options.appUrl,
      protectedPath: options.protectedPath,
    }, dependencies);
    if (verification.status === 'valid') {
      return {
        status: 'authenticated',
        source: 'stored',
        apiStatuses: verification.apiStatuses,
        finalUrl: verification.finalUrl,
      };
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
    appUrl: options.appUrl,
    protectedPath: options.protectedPath,
  }, dependencies);
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
  };
}
