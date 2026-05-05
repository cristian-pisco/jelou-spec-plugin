// bin/lib/dev-orchestrator/tmux.mjs
//
// Thin wrapper around the tmux CLI. All callers go through `runner`, which
// defaults to spawnSync('tmux', args, ...). Tests inject a fake runner.
// No shell, no string interpolation.

import { spawnSync } from 'node:child_process';

function defaultRunner(args, opts = {}) {
  return spawnSync('tmux', args, { encoding: 'utf8', ...opts });
}

export function tmuxAvailable(runner = defaultRunner) {
  const r = runner(['-V']);
  if (r.status !== 0) return { ok: false, version: null };
  const m = /^tmux\s+(\S+)/.exec(r.stdout || '');
  return { ok: true, version: m ? m[1] : null };
}

export function inTmuxSession(env = process.env) {
  return Boolean(env && env.TMUX);
}

export function serverAlive(runner = defaultRunner) {
  return runner(['list-sessions']).status === 0;
}

export function newSessionDetached(name, runner = defaultRunner) {
  return runner(['new-session', '-d', '-s', name]);
}

export function attachSession(name) {
  return ['attach-session', '-t', name];
}

export function listWindows(runner = defaultRunner) {
  const r = runner(['list-windows', '-a', '-F', '#{session_name}:#{window_index}:#{window_name}']);
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [session, idx, ...rest] = line.split(':');
      return { session, index: parseInt(idx, 10), name: rest.join(':') };
    });
}

export function findWindow(name, runner = defaultRunner) {
  return listWindows(runner).find(w => w.name === name) || null;
}

export function newWindow({ session, name }, runner = defaultRunner) {
  return runner(['new-window', '-t', `${session}:`, '-n', name]);
}

export function splitWindow({ target }, runner = defaultRunner) {
  return runner(['split-window', '-t', target]);
}

export function selectLayout({ target, layout }, runner = defaultRunner) {
  return runner(['select-layout', '-t', target, layout]);
}

export function selectPaneTitle({ target, title }, runner = defaultRunner) {
  return runner(['select-pane', '-t', target, '-T', title]);
}

export function setPaneStyle({ target, style }, runner = defaultRunner) {
  return runner(['select-pane', '-t', target, '-P', style]);
}

export function selectPane({ target }, runner = defaultRunner) {
  return runner(['select-pane', '-t', target]);
}

export function selectWindow({ target }, runner = defaultRunner) {
  return runner(['select-window', '-t', target]);
}

export function sendKeys({ target, keys }, runner = defaultRunner) {
  return runner(['send-keys', '-t', target, keys, 'Enter']);
}

export function capturePane({ target, lines = 100 }, runner = defaultRunner) {
  const r = runner(['capture-pane', '-p', '-S', `-${lines}`, '-t', target]);
  return r.stdout || '';
}

export function killWindow({ target }, runner = defaultRunner) {
  return runner(['kill-window', '-t', target]);
}

export function listPanes({ window, runner = defaultRunner }) {
  const r = runner(['list-panes', '-t', window, '-F', '#{pane_id}:#{pane_title}:#{pane_dead}']);
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [id, title, dead] = line.split(':');
      return { id, title, dead: dead === '1' };
    });
}
