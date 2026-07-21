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
const uiwf = read('jelou/workflows/ui-qa-run.md');
const prodlike = read('jelou/workflows/goal.md');

describe('self-healing gate — 14b classifies the target and mints a local session deterministically', () => {
  test('the gate classifies the target and runs the A+B drivers for a loopback stack', () => {
    assert.match(uiwf, /classify-e2e-target\.mjs/);
    assert.match(uiwf, /e2e-ensure-account\.mjs/);
    assert.match(uiwf, /e2e-login-local\.mjs/);
  });

  test('the deterministic local path needs no browser, Turnstile, or OTP', () => {
    assert.match(uiwf, /no browser,?\s*no Turnstile,?\s*(and\s*)?no OTP/i);
  });

  test('the safe path is gated on a `safe` classification', () => {
    assert.match(uiwf, /classify-e2e-target\.mjs[\s\S]{0,120}=\s*"safe"|"safe"[\s\S]{0,120}classify-e2e-target/);
  });
});

describe('self-healing gate — fails fast with the real cause, never DB drift', () => {
  test('a failed local mint names the real cause and explicitly rejects the DB-drift diagnosis', () => {
    assert.match(uiwf, /real cause[\s\S]{0,80}never[\s\S]{0,40}DB schema drift/i);
  });

  test('the failure branches name the concrete causes (unreachable / overlay / 401)', () => {
    assert.match(uiwf, /dashboard-server unreachable/i);
    assert.match(uiwf, /overlay actually applied/i);
    assert.match(uiwf, /credentials rejected \(HTTP 401\)/i);
  });
});

describe('self-healing gate — a local mint that still 401s is provisioned via session-sync, never dead-ended', () => {
  // The dead-end this guards: e2e-login-local mints a valid cookie but the gateway still
  // 401s because the native local login never wrote logsM.userSessions. The gate must run
  // session-sync inline on that LOCAL cookie and re-probe — not exit BLOCKED telling the
  // user to "use the 14c path" by hand, and never improvise a prod-session-refresh menu.
  const i = uiwf.indexOf('bin/e2e-login-local.mjs');
  const region = uiwf.slice(i, i + 1600);

  test('the probe-fail branch auto-runs session-sync and re-probes before BLOCKED', () => {
    assert.match(region, /e2e-session-sync\.mjs/);
    assert.match(region, /e2e-session-sync\.mjs[\s\S]{0,120}e2e-session-probe\.mjs/);
    assert.match(region, /e2e-session-sync[\s\S]{0,200}AUTH_GATE=healed/);
  });

  test('the loopback session-sync runs on the locally-minted cookie, never a prod-captured one', () => {
    assert.match(region, /minted/i);
    assert.match(region, /never[\s\S]{0,80}prod[\s\S]{0,40}(session|captur)/i);
  });
});

describe('self-healing gate — the OTP/sync machinery is reserved for remote/prod', () => {
  test('the Gmail/OTP driver is labelled the remote/prod path', () => {
    assert.match(uiwf, /e2e-login\.mjs`?[\s\S]{0,40}remote\/prod/i);
  });

  test('14c session-sync is skipped for a healed local session (natively valid)', () => {
    assert.match(uiwf, /healed/);
    assert.match(uiwf, /natively valid/i);
    assert.match(uiwf, /session-sync[\s\S]{0,120}skip|skip[\s\S]{0,120}session-sync/i);
  });
});

describe('self-healing gate — mid-suite collapse re-mints non-interactively for safe targets', () => {
  test('an auth collapse on a safe target attempts a non-interactive re-mint via e2e-login-local', () => {
    const i = uiwf.indexOf('auth collapse');
    assert.ok(i > -1, 'mid-suite auth collapse step present');
    const region = uiwf.slice(i, i + 900);
    assert.match(region, /e2e-login-local\.mjs/);
    assert.match(region, /non-interactive/i);
  });
});

describe('self-healing gate — production-like delegates to the same deterministic path', () => {
  test('production-like 11c names the deterministic A+B drivers for loopback targets', () => {
    assert.match(prodlike, /e2e-ensure-account\.mjs/);
    assert.match(prodlike, /e2e-login-local\.mjs/);
  });
});
