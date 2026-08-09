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

describe('self-healing gate — goal delegates to the same deterministic path', () => {
  test('goal 11c names the deterministic A+B drivers for loopback targets', () => {
    assert.match(prodlike, /e2e-ensure-account\.mjs/);
    assert.match(prodlike, /e2e-login-local\.mjs/);
  });
});
