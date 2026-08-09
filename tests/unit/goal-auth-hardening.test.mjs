// tests/unit/goal-auth-hardening.test.mjs
//
// Hardens the auth/boot path against the remaining failure modes from the datum-legacy saga:
//  A. A captcha/Turnstile on a LOOPBACK target is a misconfiguration (the local frontend is
//     calling a prod backend), NOT a reason to capture a prod session — capturing one is what
//     poisoned the next run with an undecryptable cookie.
//  B. A persisted session whose jelou_auth cookie can't be decrypted with the LOCAL
//     COOKIE_SECRET is a foreign/prod-captured artifact → discard it, force a fresh local login.
//  C. On ready_timeout, boot surfaces the launch-log crash reason so a dependency that died on a
//     missing local-only env var is diagnosable, not opaque.
//
// Run: `node --test tests/unit/goal-auth-hardening.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const prodlike = read('jelou/workflows/goal.md');
const env = read('jelou/references/env-lifecycle.md');
const e2eenv = read('jelou/references/e2e-environment.md');
const fixtures = read('jelou/references/auth-fixtures.md');

describe('auth gate — captcha on a loopback target is a misconfiguration, not a capture trigger', () => {
  test('goal 11c refuses the consumer-capture flow for a loopback exit-47', () => {
    assert.match(prodlike, /Captcha on a loopback target is a misconfiguration, not a capture trigger/i);
    assert.match(prodlike, /consumer-capture flow is FORBIDDEN/i);
    assert.match(prodlike, /poisons the next run/i);
  });

  test('a loopback captcha diagnoses a frontend pointing at a prod/remote backend', () => {
    assert.match(prodlike, /NX_REACT_APP/);
    assert.match(prodlike, /(prod|remote)[\s\S]{0,60}backend|backend[\s\S]{0,60}(prod|remote)/i);
  });

  test('the exit-47 diagnosis names the reused-frontend-bakes-prod trap', () => {
    assert.match(prodlike, /never reads `?\.env\.e2e`?/i);
    assert.match(prodlike, /reused dev server/i);
    assert.match(prodlike, /\*\*booted fresh\*\*/i);
    assert.match(prodlike, /VITE_TURNSTILE_ENABLED=false/);
  });

  test('consumer capture is reserved for a genuinely remote E2E_BASE_URL', () => {
    assert.match(prodlike, /remote[\s\S]{0,120}capture|capture[\s\S]{0,120}remote/i);
    assert.match(prodlike, /never\s*\n?\s*a prod fallback/i);
  });

  test('the four sanctioned prompts are enumerated in goal itself, not by reference', () => {
    assert.match(prodlike, /ONLY four user prompts/i);
    assert.match(prodlike, /e2e-auth\.yaml/);
    assert.match(prodlike, /Gmail paste fallback/i);
    assert.match(prodlike, /exit 44/);
    assert.match(prodlike, /exit 47/);
  });
});

describe('auth gate — discards a foreign/undecryptable persisted session', () => {
  test('a cookie undecryptable with the local COOKIE_SECRET is foreign and discarded', () => {
    assert.match(fixtures, /decrypt/i);
    assert.match(fixtures, /foreign|prod-captured/i);
    assert.match(fixtures, /discard|regenerate|fresh local login|treat (it )?as invalid/i);
  });
});

describe('auth gate — an invalid session is auto-refreshed, never a discretionary "your call" menu', () => {
  test('goal 11c forbids the accept/pause/choose menu and mandates auto-login', () => {
    assert.match(prodlike, /discretionary auth-gate menu/i);
    assert.match(prodlike, /accept the stale session/i);
    assert.match(prodlike, /automatically/i);
    assert.match(prodlike, /bin\/e2e-login\.mjs/);
  });

  test('goal 11c never punts the refresh to the user as "your call"', () => {
    assert.match(prodlike, /your call/i);
    assert.match(prodlike, /never punt the refresh\s+to the user/i);
  });
});

describe('boot — a frontend bakes build-time env, so it is never reused (always fresh)', () => {
  test('env-lifecycle forbids reusing a frontend and mandates a fresh boot with the overlay', () => {
    assert.match(env, /frontend[\s\S]{0,80}NEVER reused[\s\S]{0,40}boot it fresh/i);
    assert.match(env, /react.*nextjs.*vue.*angular.*svelte/i);
    assert.match(env, /never sourced `?\.env\.e2e`?/i);
    assert.match(env, /register it in `?BOOTED/i);
  });

  test('goal step 10 reboots a ui_services frontend fresh instead of reusing it', () => {
    assert.match(prodlike, /frontend service[\s\S]{0,80}ui_services[\s\S]{0,80}never reuse[\s\S]{0,40}reboot fresh/i);
    assert.match(prodlike, /bakes/i);
  });

  test('e2e-environment documents that .env.e2e build-time vars must be injected at serve start', () => {
    assert.match(e2eenv, /baked at dev-server start/i);
    assert.match(e2eenv, /dotenv\.config\(\)/);
    assert.match(e2eenv, /never `?\.env\.e2e`?/i);
    assert.match(e2eenv, /always boots a frontend fresh, never reuses one/i);
    assert.match(e2eenv, /VITE_TURNSTILE_ENABLED/);
    assert.match(e2eenv, /NX_REACT_APP_DASHBOARD_SERVER_BASE/);
  });
});

describe('boot — surfaces the crash reason on ready_timeout', () => {
  test('ready_timeout prints the launch-log tail so missing-env crashes are diagnosable', () => {
    const i = env.indexOf('ready_timeout');
    assert.ok(i > -1, 'ready_timeout present');
    assert.match(env, /launch-?<?service>?\.log|log tail|tail .*log/i);
    assert.match(env, /missing|required|env var|crash/i);
  });
});
