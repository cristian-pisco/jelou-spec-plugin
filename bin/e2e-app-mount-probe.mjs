#!/usr/bin/env node
import { createRequire } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';
import { classifyMountOutcome, summarizeMountFailure } from './lib/app-mount.mjs';
import { applyEnvFiles } from './lib/env-files.mjs';

const POLL_MS = 2_000;

async function samplePage(page, selectors) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel.root) || document.body;
    return {
      shellPresent: Boolean(document.querySelector(sel.shell)),
      rootChildCount: root ? root.children.length : 0,
      rootHtmlLength: root ? root.innerHTML.length : 0,
      interactiveCount: document.querySelectorAll('input,button,select,textarea,a[href]').length,
    };
  }, selectors).catch(() => null);
}

async function main() {
  const UI_WORKTREE = process.env.UI_WORKTREE;
  const explicitBase = process.env.APP_MOUNT_BASE_URL;
  if (UI_WORKTREE) applyEnvFiles(process.env, UI_WORKTREE);
  const E2E_BASE_URL = explicitBase || process.env.E2E_BASE_URL;
  if (!E2E_BASE_URL || !UI_WORKTREE) {
    console.error('app-mount-probe: E2E_BASE_URL and UI_WORKTREE are required');
    process.exit(2);
  }

  const timeoutS = Number(process.env.APP_MOUNT_TIMEOUT_S || 180);
  const route = process.env.APP_MOUNT_ROUTE || '/';
  const selectors = {
    shell: process.env.APP_SHELL_SELECTOR || '#app-shell',
    root: process.env.APP_ROOT_SELECTOR || '#root',
  };

  const requireFromWorktree = createRequire(join(UI_WORKTREE, 'package.json'));
  const { chromium } = requireFromWorktree('@playwright/test');
  const browser = await chromium.launch();
  let exitCode = 1;
  try {
    const ctx = await browser.newContext({ baseURL: E2E_BASE_URL });
    const page = await ctx.newPage();
    let consoleErrors = 0;
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors += 1;
    });
    const startedAt = Date.now();
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    const initial = await samplePage(page, selectors);
    let lastSample = initial;
    while ((Date.now() - startedAt) / 1_000 < timeoutS) {
      await page.waitForTimeout(POLL_MS);
      const current = await samplePage(page, selectors);
      if (current) lastSample = current;
      if (classifyMountOutcome({ initial, current }) === 'mounted') {
        const elapsedS = Math.round((Date.now() - startedAt) / 1_000);
        console.log(`mounted t=${elapsedS}s url=${page.url()}`);
        exitCode = 0;
        break;
      }
    }
    if (exitCode !== 0) {
      console.log(summarizeMountFailure({
        elapsedS: Math.round((Date.now() - startedAt) / 1_000),
        consoleErrors,
        finalUrl: page.url(),
        lastSample,
      }));
    }
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`app-mount-probe: ${err.message}`);
  process.exit(2);
});
