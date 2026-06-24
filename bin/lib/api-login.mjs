// bin/lib/api-login.mjs — pure helpers for the deterministic local E2E login.
//
// The local dev stack needs neither Turnstile (the dashboard's recaptcha check
// is optional, so an absent token skips it) nor an OTP for the E2E account
// (company 2FA is disabled and the account has no per-user 2FA row), so a plain
// POST /v1/auth/login with a plaintext password — no `uuid`, no `recaptchaToken`
// — returns a `jelou_auth` session cookie directly. These helpers shape that
// request, read the dashboard's success envelope, lift the cookie into
// Playwright storageState, and build the idempotent account-guard SQL. The IO
// shells live in bin/e2e-login-local.mjs and bin/e2e-ensure-account.mjs.

export const COOKIE_NAME = 'jelou_auth';

function trimBase(dashboardBase) {
  return String(dashboardBase || '').replace(/\/+$/, '');
}

export function loginUrl(dashboardBase) {
  return `${trimBase(dashboardBase)}/v1/auth/login`;
}

export function verifyMfaUrl(dashboardBase) {
  return `${trimBase(dashboardBase)}/v1/auth/login/verify_mfa`;
}

export function mfaRedisKey(email) {
  return `mfa-code-${email}`;
}

// The dashboard wraps every response in buildSuccessResponse: { data, message:[],
// status:1 }. An MFA challenge is ALSO status:1, distinguished only by
// data.twoFaPending — so it must be tested before the success branch, which
// additionally requires data.user (absent on the MFA challenge).
export function classifyLogin(httpStatus, body) {
  const data = (body && typeof body === 'object' && body.data) || {};
  if (httpStatus === 200 && (data.twoFaPending === true || data.sessionType === '2FA_PENDING')) {
    return { outcome: 'mfa' };
  }
  if (httpStatus === 200 && body && body.status === 1 && data.user) {
    return { outcome: 'ok', user: data.user };
  }
  return { outcome: 'rejected' };
}

function parseSetCookie(line) {
  const [nameValue, ...rawAttrs] = String(line).split(';');
  const eq = nameValue.indexOf('=');
  if (eq < 1) return null;
  const attr = {};
  for (const a of rawAttrs) {
    const i = a.indexOf('=');
    if (i === -1) attr[a.trim().toLowerCase()] = true;
    else attr[a.slice(0, i).trim().toLowerCase()] = a.slice(i + 1).trim();
  }
  return { name: nameValue.slice(0, eq).trim(), value: nameValue.slice(eq + 1).trim(), attr };
}

function asArray(setCookieHeaders) {
  if (Array.isArray(setCookieHeaders)) return setCookieHeaders;
  return setCookieHeaders ? [setCookieHeaders] : [];
}

export function extractAuthCookie(setCookieHeaders, { domain = 'localhost', nowSeconds } = {}) {
  for (const line of asArray(setCookieHeaders)) {
    const parsed = parseSetCookie(line);
    if (!parsed || parsed.name !== COOKIE_NAME || !parsed.value) continue;
    const maxAge = Number(parsed.attr['max-age']);
    const expires = Number.isFinite(maxAge) && typeof nowSeconds === 'number' ? nowSeconds + maxAge : -1;
    // Chromium drops SameSite=None cookies that aren't Secure; the dev cookie is
    // non-Secure and the UI + APIs are same-site on localhost, so Lax restores cleanly.
    const sameSite = String(parsed.attr['samesite'] || '').toLowerCase() === 'strict' ? 'Strict' : 'Lax';
    return {
      name: parsed.name,
      value: parsed.value,
      domain,
      path: parsed.attr['path'] || '/',
      expires,
      httpOnly: 'httponly' in parsed.attr,
      secure: 'secure' in parsed.attr,
      sameSite,
    };
  }
  return null;
}

// Forwards the 2FA_PENDING cookie set on the login response into the verify_mfa
// call — that route authenticates via the cookie-2fa strategy.
export function cookieHeaderFromSetCookies(setCookieHeaders) {
  const pairs = [];
  for (const line of asArray(setCookieHeaders)) {
    const parsed = parseSetCookie(line);
    if (parsed && parsed.value) pairs.push(`${parsed.name}=${parsed.value}`);
  }
  return pairs.join('; ');
}

// The jelou_auth cookie carries the session; the localStorage entries are
// non-auth UI hints that let the SPA paint the authenticated shell without a
// redirect (isLogin gates it; session/user/lang are best-effort from the login
// response).
export function buildStorageState(cookie, user, { origin } = {}) {
  const u = user || {};
  const localStorage = [{ name: 'isLogin', value: 'true' }];
  if (u.sessionId != null) localStorage.push({ name: 'session', value: String(u.sessionId) });
  if (u.names != null) localStorage.push({ name: 'user', value: String(u.names) });
  if (u.lang != null) localStorage.push({ name: 'lang', value: String(u.lang) });
  return {
    cookies: cookie ? [cookie] : [],
    origins: origin ? [{ origin, localStorage }] : [],
  };
}

function sqlQuote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// Idempotent guard (B): keep the E2E account deterministically loginable —
// verified email, and no per-user 2FA row that would re-arm the OTP gate even
// while company-level 2FA stays disabled.
export function buildEnsureAccountSql(email) {
  const e = sqlQuote(email);
  return [
    `UPDATE chatbot.users SET emailVerified = 1 WHERE email = ${e};`,
    `DELETE t FROM chatbot.user_two_fa t JOIN chatbot.users u ON u.id = t.userId WHERE u.email = ${e};`,
  ].join('\n');
}
