#!/usr/bin/env node
// bin/e2e-login.mjs — real UI login: email+password → OTP → dashboard.
//
// The OTP arrives out-of-band (Gmail). This script prints WAITING_OTP and
// polls OTP_FILE; the orchestrator reads the code from Gmail (or asks the
// user) and writes it there. On success the session is saved to
// E2E_STORAGE_STATE in Playwright storageState format.
//
// Env: E2E_BASE_URL, TEST_EMAIL, TEST_PASSWORD, E2E_STORAGE_STATE, OTP_FILE,
//      UI_WORKTREE; optional LOGIN_PATH (default /login), OTP_WAIT_S (180).
// Exit codes (see lib EXIT): 0 ok · 41 auth rejected / HTTP 401 ·
//      42 OTP never arrived · 43 OTP rejected · 44 login form not found ·
//      2 misconfig.
//
// Secrets: TEST_PASSWORD is read from the environment and typed into the
// browser; it is never printed. Do not add logging of field values.

import { createRequire } from 'node:module';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import process from 'node:process';
import { EXIT, isLoggedOutUrl, waitForFile } from './lib/e2e-auth.mjs';

const REQUIRED = ['E2E_BASE_URL', 'TEST_EMAIL', 'TEST_PASSWORD', 'E2E_STORAGE_STATE', 'OTP_FILE', 'UI_WORKTREE'];

async function main() {
  const env = process.env;
  for (const k of REQUIRED) {
    if (!env[k]) {
      console.error(`login: missing ${k}`);
      process.exit(2);
    }
  }
  const storagePath = isAbsolute(env.E2E_STORAGE_STATE)
    ? env.E2E_STORAGE_STATE
    : resolve(env.UI_WORKTREE, env.E2E_STORAGE_STATE);

  const requireFromWorktree = createRequire(join(env.UI_WORKTREE, 'package.json'));
  const { chromium } = requireFromWorktree('@playwright/test');
  const browser = await chromium.launch();
  const finish = async (code) => {
    await browser.close().catch(() => {});
    process.exit(code);
  };

  try {
    const ctx = await browser.newContext({ baseURL: env.E2E_BASE_URL });
    const page = await ctx.newPage();
    let sawAuthReject = false;
    page.on('response', (r) => {
      if (r.status() === 401) sawAuthReject = true;
    });

    await page.goto(env.LOGIN_PATH || '/login', { waitUntil: 'load', timeout: 60_000 }).catch(() => {});

    const email = page.locator('input[type="email"], input[name="email"], input[autocomplete="username"]').first();
    const password = page.locator('input[type="password"]').first();
    const emailVisible = await email.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
    const passwordVisible = await password.isVisible().catch(() => false);
    if (!emailVisible || !passwordVisible) {
      console.error('login: email/password fields not found on the login page');
      return finish(EXIT.LOGIN_FORM_NOT_FOUND);
    }

    await email.fill(env.TEST_EMAIL);
    await password.fill(env.TEST_PASSWORD);
    await page.locator('button[type="submit"], form button').first().click();

    const otpInput = page
      .locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i], input[inputmode="numeric"]')
      .first();
    const outcome = await Promise.race([
      otpInput.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'otp'),
      page.waitForURL((u) => !isLoggedOutUrl(String(u)), { timeout: 30_000 }).then(() => 'dashboard'),
    ]).catch(() => 'stuck');

    if (outcome === 'stuck') {
      console.error(sawAuthReject ? 'login: credentials rejected (HTTP 401)' : 'login: neither OTP screen nor dashboard appeared');
      return finish(sawAuthReject ? EXIT.AUTH_REJECTED : EXIT.LOGIN_FORM_NOT_FOUND);
    }

    if (outcome === 'otp') {
      console.log('WAITING_OTP');
      const code = await waitForFile(env.OTP_FILE, (Number(env.OTP_WAIT_S) || 180) * 1000);
      if (code === null) {
        console.error('login: OTP never arrived in OTP_FILE');
        return finish(EXIT.OTP_TIMEOUT);
      }
      await otpInput.click();
      await page.keyboard.type(code.replace(/\D/g, ''), { delay: 80 });
      const confirm = page.locator('button[type="submit"], form button').last();
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      const loggedIn = await page
        .waitForURL((u) => !isLoggedOutUrl(String(u)), { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (!loggedIn) {
        console.error(sawAuthReject ? 'login: OTP step returned HTTP 401' : 'login: OTP rejected');
        return finish(sawAuthReject ? EXIT.AUTH_REJECTED : EXIT.OTP_REJECTED);
      }
    }

    mkdirSync(dirname(storagePath), { recursive: true });
    await page.context().storageState({ path: storagePath });
    console.log('LOGIN_OK');
    return finish(EXIT.OK);
  } catch (e) {
    console.error(`login: ${e.message}`);
    return finish(2);
  }
}

main().catch((e) => {
  console.error(`login: ${e.message}`);
  process.exit(2);
});
