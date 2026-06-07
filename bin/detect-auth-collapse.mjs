#!/usr/bin/env node
// bin/detect-auth-collapse.mjs — did the session die mid-suite?
//
// Reads a Playwright JSON report and prints `auth_collapse` when 3+
// consecutive failures look like 401/Unauthorized. The orchestrator then
// aborts with the user-facing 401 message instead of dispatching fix-loops
// (fix-loops must never patch auth state — design doc §401 handling).
//
// Usage: node bin/detect-auth-collapse.mjs <run.json>
// Exit: 0 with `auth_collapse` or `ok` · 2 unreadable input.

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { collectFailureMessages, detectAuthCollapse } from './lib/e2e-auth.mjs';

const path = process.argv[2];
if (!path) {
  console.error('usage: detect-auth-collapse.mjs <run.json>');
  process.exit(2);
}
let report;
try {
  report = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`detect-auth-collapse: unreadable report: ${e.message}`);
  process.exit(2);
}
console.log(detectAuthCollapse(collectFailureMessages(report)) ? 'auth_collapse' : 'ok');
