#!/usr/bin/env node
// bin/e2e-session-probe.mjs — is the stored E2E session still valid?
//
// Opens E2E_BASE_URL with E2E_STORAGE_STATE in the consumer's own Playwright
// (resolved from UI_WORKTREE/node_modules) and classifies the outcome:
// redirect to a login route or a 401 on boot calls → invalid.
//
// Prints "valid" or "invalid". Exit: 0 valid · 1 invalid · 2 misconfig.
// A missing storage-state file is "invalid", not an error — it just means
// the login flow must run.

import { createRequire } from 'node:module';
import { join, isAbsolute, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { classifyProbeOutcome } from './lib/e2e-auth.mjs';
import { applyEnvFiles } from './lib/env-files.mjs';

async function main() {
  const UI_WORKTREE = process.env.UI_WORKTREE;
  if (UI_WORKTREE) applyEnvFiles(process.env, UI_WORKTREE);
  const { E2E_BASE_URL, E2E_STORAGE_STATE } = process.env;
  if (!E2E_BASE_URL || !UI_WORKTREE) {
    console.error('probe: E2E_BASE_URL and UI_WORKTREE are required');
    process.exit(2);
  }
  const storage = E2E_STORAGE_STATE
    ? (isAbsolute(E2E_STORAGE_STATE) ? E2E_STORAGE_STATE : resolve(UI_WORKTREE, E2E_STORAGE_STATE))
    : null;
  if (!storage || !existsSync(storage)) {
    console.log('invalid');
    process.exit(1);
  }

  const requireFromWorktree = createRequire(join(UI_WORKTREE, 'package.json'));
  const { chromium } = requireFromWorktree('@playwright/test');
  const browser = await chromium.launch();
  let verdict;
  try {
    const ctx = await browser.newContext({ storageState: storage, baseURL: E2E_BASE_URL });
    const page = await ctx.newPage();
    const apiStatuses = [];
    page.on('response', (r) => {
      if (r.status() === 401) apiStatuses.push(401);
    });
    await page.goto(E2E_BASE_URL, { waitUntil: 'load', timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(8_000);
    verdict = classifyProbeOutcome({ finalUrl: page.url(), apiStatuses });
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(verdict);
  process.exit(verdict === 'valid' ? 0 : 1);
}

main().catch((e) => {
  console.error(`probe: ${e.message}`);
  process.exit(2);
});
