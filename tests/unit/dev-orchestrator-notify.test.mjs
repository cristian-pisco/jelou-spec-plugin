// tests/unit/dev-orchestrator-notify.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { notifyOs } from '../../bin/lib/dev-orchestrator/notify.mjs';

function fakeRunner(handlers = {}) {
  const calls = [];
  const fn = (cmd, args) => {
    calls.push({ cmd, args: [...args] });
    if (typeof handlers[cmd] === 'function') return handlers[cmd](args);
    return { status: 0, stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

describe('notifyOs — Linux', () => {
  test('calls notify-send with -u + title + body', () => {
    const r = fakeRunner();
    const out = notifyOs({ title: 't', body: 'b', urgency: 'critical', platform: 'linux', runner: r, hasNotifySend: true });
    assert.equal(out.delivered, true);
    const call = r.calls[0];
    assert.equal(call.cmd, 'notify-send');
    assert.ok(call.args.includes('-u'));
    assert.ok(call.args.includes('critical'));
    assert.ok(call.args.includes('t'));
    assert.ok(call.args.includes('b'));
  });

  test('returns no-notifier when notify-send unavailable', () => {
    const r = fakeRunner();
    const out = notifyOs({ title: 't', body: 'b', platform: 'linux', runner: r, hasNotifySend: false });
    assert.equal(out.delivered, false);
    assert.equal(out.reason, 'no-notifier');
  });
});

describe('notifyOs — macOS', () => {
  test('calls osascript with display notification', () => {
    const r = fakeRunner();
    const out = notifyOs({ title: 't', body: 'b', platform: 'darwin', runner: r, hasOsascript: true });
    assert.equal(out.delivered, true);
    const call = r.calls[0];
    assert.equal(call.cmd, 'osascript');
    const joined = call.args.join(' ');
    assert.ok(joined.includes('display notification'));
    assert.ok(joined.includes('"t"'));
    assert.ok(joined.includes('"b"'));
  });
});

describe('notifyOs — unknown platform', () => {
  test('returns no-notifier on win32', () => {
    const r = fakeRunner();
    const out = notifyOs({ title: 't', body: 'b', platform: 'win32', runner: r });
    assert.equal(out.delivered, false);
    assert.equal(out.reason, 'no-notifier');
  });
});
