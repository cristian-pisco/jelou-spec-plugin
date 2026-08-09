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
  test('a landing outside /login is the transferred session', () => {
    assert.equal(handoffSucceeded('http://localhost:5175/dashboard'), true);
    assert.equal(handoffSucceeded('http://localhost:5175/'), true);
    assert.equal(handoffSucceeded('http://localhost:5175/loginish'), false);
  });

  test('a redirect back to /login is a failed handoff, never a green stack', () => {
    assert.equal(handoffSucceeded('http://localhost:5175/login'), false);
    assert.equal(handoffSucceeded('http://localhost:5175/login?redirect=/dashboard'), false);
  });

  test('an unusable final url is a failure rather than a throw', () => {
    assert.equal(handoffSucceeded(''), false);
    assert.equal(handoffSucceeded(null), false);
    assert.equal(handoffSucceeded('/dashboard'), false);
  });
});
