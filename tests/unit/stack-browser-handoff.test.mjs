import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { planBrowserHandoff, handoffSucceeded, HANDOFF_HOST } from '../../bin/lib/dev-orchestrator/stack/browser-handoff.mjs';

const cookie = { name: 'jelou_auth', value: 'genuine-token' };
const target = { appUrl: 'http://localhost:5175/dashboard', account: 'dev@jelou.ai', port: 7799 };

describe('planBrowserHandoff', () => {
  test('transfers a verified genuine cookie through a localhost entry url', () => {
    const plan = planBrowserHandoff({ cookie, ...target, sessionVerified: true });

    assert.equal(plan.ok, true);
    assert.equal(plan.reason, null);
    assert.equal(plan.entryUrl, `http://${HANDOFF_HOST}:7799/`);
    assert.equal(HANDOFF_HOST, 'localhost');
    assert.equal(plan.appUrl, target.appUrl);
    assert.ok(plan.page.includes(cookie.value));
  });

  test('refuses to mint a session when the caller has not verified one', () => {
    const plan = planBrowserHandoff({ cookie, ...target, sessionVerified: false });

    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'session-unverified');
    assert.equal(plan.page, null);
    assert.equal(plan.entryUrl, null);
  });

  test('treats a missing or forged cookie as no genuine cookie', () => {
    for (const forged of [null, undefined, {}, { name: 'other', value: 'x' }, { name: 'jelou_auth', value: '' }, { name: 'jelou_auth' }]) {
      const plan = planBrowserHandoff({ cookie: forged, ...target, sessionVerified: true });
      assert.equal(plan.ok, false);
      assert.equal(plan.reason, 'no-genuine-cookie');
      assert.equal(plan.page, null);
    }
  });

  test('rejects an incomplete target instead of serving a page that goes nowhere', () => {
    assert.equal(planBrowserHandoff({ cookie, ...target, appUrl: '', sessionVerified: true }).reason, 'incomplete-target');
    assert.equal(planBrowserHandoff({ cookie, ...target, port: 0, sessionVerified: true }).reason, 'incomplete-target');
  });
});

describe('handoffSucceeded', () => {
  const markers = { isLogin: 'true' };

  test('a landing outside /login with every session marker present is the transferred session', () => {
    assert.deepEqual(handoffSucceeded({ finalUrl: 'http://localhost:5175/dashboard', sessionMarkers: markers, observedStorage: { isLogin: 'true' } }), { ok: true, reason: null });
    assert.equal(handoffSucceeded({ finalUrl: 'http://localhost:5175/', sessionMarkers: markers, observedStorage: { isLogin: 'true' } }).ok, true);
  });

  test('a redirect back to /login is a failed handoff, never a green stack', () => {
    assert.deepEqual(handoffSucceeded({ finalUrl: 'http://localhost:5175/login', sessionMarkers: markers, observedStorage: { isLogin: 'true' } }), { ok: false, reason: 'browser-on-login' });
    assert.equal(handoffSucceeded({ finalUrl: 'http://localhost:5175/login?redirect=/dashboard', sessionMarkers: markers }).ok, false);
  });

  test('an off-login url whose session marker is absent is NOT a green handoff', () => {
    const verdict = handoffSucceeded({ finalUrl: 'http://localhost:5175/home', sessionMarkers: markers, observedStorage: { isLogin: null } });

    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'session-markers-missing:isLogin');
  });

  test('refusing to observe the app storage cannot pass as success', () => {
    assert.deepEqual(handoffSucceeded({ finalUrl: 'http://localhost:5175/home', sessionMarkers: markers }), { ok: false, reason: 'session-markers-unobserved' });
  });

  test('an unusable final url is a failure rather than a throw', () => {
    for (const finalUrl of ['', null, '/dashboard']) {
      assert.deepEqual(handoffSucceeded({ finalUrl, sessionMarkers: markers }), { ok: false, reason: 'no-final-url' });
    }
  });
});

describe('session markers', () => {
  test('the plan carries the marker write and probe scripts for the app origin', () => {
    const plan = planBrowserHandoff({ cookie, ...target, sessionVerified: true });

    assert.deepEqual(plan.sessionMarkers, { isLogin: 'true' });
    assert.match(plan.markerScript, /localStorage\.setItem\("isLogin", "true"\)/);
    assert.match(plan.markerScript, /location\.reload\(\)/);
    assert.match(plan.probeScript, /localStorage\.getItem/);
  });

  test('a registry-declared marker set replaces the default', () => {
    const plan = planBrowserHandoff({ cookie, ...target, sessionVerified: true, frontend: { session_markers: { authed: '1' } } });

    assert.deepEqual(plan.sessionMarkers, { authed: '1' });
  });

  test('the inject page never claims to set app-origin storage it cannot reach', () => {
    const plan = planBrowserHandoff({ cookie, ...target, sessionVerified: true });

    assert.equal(plan.page.includes('localStorage'), false);
  });
});
