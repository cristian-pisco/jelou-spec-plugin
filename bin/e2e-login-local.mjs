#!/usr/bin/env node
// bin/e2e-login-local.mjs — deterministic local E2E login (no browser, no OTP).
//
// The consumer (prod) flow captures a session from a real Chrome because
// Cloudflare Turnstile blocks automation. The LOCAL dev stack has no Turnstile
// and the E2E account has 2FA disabled, so a plain POST /v1/auth/login mints a
// jelou_auth session cookie directly. This writes that session to
// E2E_STORAGE_STATE in Playwright storageState format — the deterministic
// alternative that the auth gate uses for local targets. If 2FA is ever
// re-armed on the account, it reads the freshly-minted code from local Redis
// and completes verify_mfa.
//
// Env: DASHBOARD_BASE (or NX_REACT_APP_DASHBOARD_SERVER_BASE), TEST_EMAIL (or
//      E2E_USER_EMAIL), TEST_PASSWORD (or E2E_USER_PASSWORD), E2E_BASE_URL (UI
//      origin), E2E_STORAGE_STATE, UI_WORKTREE; optional REDIS_CONTAINER
//      (default redis).
// Exit (shared EXIT): 0 ok · 41 auth rejected · 43 OTP rejected ·
//      48 dashboard unreachable · 2 misconfig.
//
// Secrets: TEST_PASSWORD is read from the env and POSTed; it is never logged.

import { isAbsolute, resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { EXIT } from './lib/e2e-auth.mjs';
import { applyEnvFiles } from './lib/env-files.mjs';
import {
  loginUrl,
  verifyMfaUrl,
  mfaRedisKey,
  classifyLogin,
  extractAuthCookie,
  cookieHeaderFromSetCookies,
  buildStorageState,
} from './lib/api-login.mjs';

function fail(msg, code) {
  console.error(`login-local: ${msg}`);
  process.exit(code);
}

async function postJson(url, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const raw = await res.text();
  let json = null;
  let parseError = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (e) {
    parseError = e;
  }
  return { status: res.status, json, parseError, rawSnippet: raw.slice(0, 200).replace(/\s+/g, ' ').trim(), setCookies: res.headers.getSetCookie() };
}

function readMfaCode(container, email) {
  const r = spawnSync('docker', ['exec', container, 'redis-cli', 'GET', mfaRedisKey(email)], { encoding: 'utf8' });
  const code = (r.stdout || '').trim();
  return code && code !== 'nil' ? code.replace(/\D/g, '') : null;
}

async function main() {
  const env = process.env;
  if (env.UI_WORKTREE) applyEnvFiles(env, env.UI_WORKTREE);

  const email = env.TEST_EMAIL || env.E2E_USER_EMAIL;
  const password = env.TEST_PASSWORD || env.E2E_USER_PASSWORD;
  const dashboardBase = env.DASHBOARD_BASE || env.NX_REACT_APP_DASHBOARD_SERVER_BASE;
  const { E2E_BASE_URL, E2E_STORAGE_STATE, UI_WORKTREE } = env;
  const missing = { TEST_EMAIL: email, TEST_PASSWORD: password, DASHBOARD_BASE: dashboardBase, E2E_BASE_URL, E2E_STORAGE_STATE, UI_WORKTREE };
  for (const [k, v] of Object.entries(missing)) {
    if (!v) fail(`missing ${k}`, 2);
  }

  let origin;
  try {
    origin = new URL(E2E_BASE_URL).origin;
  } catch {
    return fail(`E2E_BASE_URL is not a URL: ${E2E_BASE_URL}`, 2);
  }
  const domain = new URL(E2E_BASE_URL).hostname;
  const storagePath = isAbsolute(E2E_STORAGE_STATE) ? E2E_STORAGE_STATE : resolve(UI_WORKTREE, E2E_STORAGE_STATE);

  let login;
  try {
    login = await postJson(loginUrl(dashboardBase), { email, password });
  } catch (e) {
    return fail(`dashboard unreachable: ${e.message}`, EXIT.DASHBOARD_UNREACHABLE);
  }

  // A non-JSON body (HTML error page, 502 from a proxy, an interstitial) is a stack-health
  // symptom, not a credential rejection — keep exit 41 reserved for the latter so the real cause shows.
  if (login.parseError) {
    return fail(`dashboard returned HTTP ${login.status} with a non-JSON body (${login.rawSnippet}) — the local stack is likely unhealthy or a proxy is in the path, not an auth problem`, EXIT.DASHBOARD_UNREACHABLE);
  }

  const verdict = classifyLogin(login.status, login.json);
  let authSetCookies = login.setCookies;
  let user = verdict.user;

  if (verdict.outcome === 'rejected') {
    return fail(`credentials rejected (HTTP ${login.status})`, EXIT.AUTH_REJECTED);
  }

  if (verdict.outcome === 'mfa') {
    const code = readMfaCode(env.REDIS_CONTAINER || 'redis', email);
    if (!code) return fail('2FA required but no code found in Redis', EXIT.OTP_REJECTED);
    let verify;
    try {
      verify = await postJson(verifyMfaUrl(dashboardBase), { email, code }, { cookie: cookieHeaderFromSetCookies(login.setCookies) });
    } catch (e) {
      return fail(`dashboard unreachable on verify_mfa: ${e.message}`, EXIT.DASHBOARD_UNREACHABLE);
    }
    if (verify.parseError) return fail(`verify_mfa returned HTTP ${verify.status} with a non-JSON body — the local stack is likely unhealthy`, EXIT.DASHBOARD_UNREACHABLE);
    const after = classifyLogin(verify.status, verify.json);
    if (after.outcome !== 'ok') return fail(`OTP rejected (HTTP ${verify.status})`, EXIT.OTP_REJECTED);
    authSetCookies = verify.setCookies;
    user = after.user;
  }

  const cookie = extractAuthCookie(authSetCookies, { domain, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!cookie) return fail('login succeeded but no jelou_auth cookie was set', EXIT.AUTH_REJECTED);

  mkdirSync(dirname(storagePath), { recursive: true });
  writeFileSync(storagePath, JSON.stringify(buildStorageState(cookie, user, { origin }), null, 2));
  console.log('LOGIN_OK');
  process.exit(EXIT.OK);
}

main().catch((e) => fail(e.message, 2));
