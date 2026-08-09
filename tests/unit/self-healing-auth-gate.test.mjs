// tests/unit/self-healing-auth-gate.test.mjs
//
// The self-healing auth gate (phase 2 of the deterministic-local-login feature):
// for a LOOPBACK target the gate mints the session itself — guarantee the account
// (B, e2e-ensure-account) → API login (A, e2e-login-local) → re-probe — with no
// browser, Turnstile, or OTP, and fails fast with the REAL cause instead of the
// "DB schema drift" rabbit hole. The Gmail/OTP driver (e2e-login.mjs) and the
// cookie-guard provisioning (14c) are reserved for genuinely remote/prod targets.
//
// Run: `node --test tests/unit/self-healing-auth-gate.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const prodlike = read('jelou/workflows/goal.md');
const runner = read('agents/jlu-ui-qa-runner.md');

describe('self-healing gate — goal delegates to the same deterministic path', () => {
  test('goal 11c names the deterministic A+B drivers for loopback targets', () => {
    assert.match(prodlike, /e2e-ensure-account\.mjs/);
    assert.match(prodlike, /e2e-login-local\.mjs/);
  });
});

describe('self-healing gate — mid-suite collapse re-mints non-interactively for safe targets', () => {
  test('the runner re-mints via e2e-login-local on a safe target instead of blocking', () => {
    const i = runner.indexOf('auth collapse');
    assert.ok(i > -1, 'the runner must carry the mid-suite auth-collapse step');
    const region = runner.slice(i - 800, i + 900);
    assert.match(region, /detect-auth-collapse\.mjs/);
    assert.match(region, /classify-e2e-target\.mjs/);
    assert.match(region, /e2e-login-local\.mjs/);
    assert.match(region, /non-interactive/i);
  });

  test('the fix-loop is forbidden as a response to an auth collapse', () => {
    assert.match(runner, /fix-loop[\s\S]{0,80}forbidden/i);
    assert.match(runner, /auth_collapse/);
  });
});
