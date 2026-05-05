// bin/lib/dev-orchestrator/notify.mjs
//
// OS-native notifications via notify-send (Linux) or osascript (macOS).
// Caller injects `runner` (cmd, args) -> { status, stdout, stderr } and may
// inject `hasNotifySend` / `hasOsascript` for testing without spawning real binaries.

import { spawnSync } from 'node:child_process';

function defaultRunner(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function detectNotifySend(runner) {
  const r = runner('which', ['notify-send']);
  return r.status === 0 && (r.stdout || '').trim().length > 0;
}

function detectOsascript(runner) {
  const r = runner('which', ['osascript']);
  return r.status === 0 && (r.stdout || '').trim().length > 0;
}

export function notifyOs({
  title, body,
  urgency = 'normal',
  platform = process.platform,
  runner = defaultRunner,
  hasNotifySend = null,
  hasOsascript = null
}) {
  if (platform === 'linux') {
    const ok = hasNotifySend === null ? detectNotifySend(runner) : hasNotifySend;
    if (!ok) return { delivered: false, reason: 'no-notifier' };
    runner('notify-send', ['-u', urgency, title, body]);
    return { delivered: true };
  }
  if (platform === 'darwin') {
    const ok = hasOsascript === null ? detectOsascript(runner) : hasOsascript;
    if (!ok) return { delivered: false, reason: 'no-notifier' };
    const script = `display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
    runner('osascript', ['-e', script]);
    return { delivered: true };
  }
  return { delivered: false, reason: 'no-notifier' };
}
