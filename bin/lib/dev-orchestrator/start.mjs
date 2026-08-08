// bin/lib/dev-orchestrator/start.mjs
//
// Implements /jlu:start-dev. Composes Phase 1 helpers + the tmux wrapper.
// Daemon spawn is a callback so Phase 3 can inject the real daemon without
// rewriting this module.

import { isAbsolute, resolve, relative } from 'node:path';
import {
  tmuxAvailable, inTmuxSession, serverAlive,
  newSessionDetached, findWindow, newWindow,
  splitWindow, selectLayout, selectPaneTitle, setPaneStyle,
  selectWindow, sendKeys
} from './tmux.mjs';
import { daemonSpawn as realDaemonSpawn } from './daemon-spawn.mjs';
import { effectiveDefaults } from './config.mjs';
import { LIFECYCLE_STAGES } from './events.mjs';

export function chooseLayout(n) {
  if (n <= 1) return 'single-pane';
  if (n <= 3) return 'even-horizontal';
  return 'tiled';
}

function pickLayout(services, n) {
  const overridden = services.find(s => s.panel && s.panel.layout);
  if (overridden) return overridden.panel.layout;
  return chooseLayout(n);
}

export function buildPaneCommand({ service, paneCwd }) {
  const parts = [`cd ${paneCwd}`];
  const env = service.env_file;
  if (env !== null && env !== undefined && env !== '') {
    parts.push(`[ -f ${env} ] && set -a && source ${env}; set +a`);
  }
  parts.push(service.command);
  return parts.join(' && ');
}

function paneCwdFor(workspaceRoot, service) {
  const rel = service.path || '.';
  return isAbsolute(rel) ? rel : resolve(workspaceRoot, rel);
}

function isInsideRoot(workspaceRoot, abs) {
  const rel = relative(workspaceRoot, abs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function windowNameFor(slug, prefix = '') {
  const safe = slug || '_global';
  return `${prefix}jlu-dev-${safe}`;
}

export function planStart({ config, workspaceRoot, slug, windowName }) {
  const services = config.services || [];
  const panes = [];
  const skipped = [];
  for (const svc of services) {
    const cwd = paneCwdFor(workspaceRoot, svc);
    if (!isInsideRoot(workspaceRoot, cwd)) {
      skipped.push({ name: svc.name, reason: 'path-outside-workspace' });
      continue;
    }
    panes.push({
      name: svc.name,
      cwd,
      command: buildPaneCommand({ service: svc, paneCwd: cwd }),
      title: (svc.panel && svc.panel.title) || svc.name,
      color: svc.panel && svc.panel.color
    });
  }
  return {
    windowName: windowName || windowNameFor(slug),
    layout: pickLayout(services, panes.length),
    panes,
    skipped
  };
}

function ensureTmuxRunning({ env, runner }) {
  if (inTmuxSession(env)) return { mode: 'inside' };
  if (!serverAlive(runner)) newSessionDetached('jlu-dev', runner);
  return { mode: 'outside' };
}

export function startDev({
  config, workspaceRoot, workspaceId, slug, configPath,
  env = process.env,
  runner, daemonSpawn = realDaemonSpawn, onLifecycle = () => {}
}) {
  const lifecycle = (stage, outcome, details = {}) => onLifecycle({ stage, outcome, workspaceId, taskSlug: slug, ...details });
  lifecycle(LIFECYCLE_STAGES.resolution, 'succeeded');
  const tmux = tmuxAvailable(runner);
  if (!tmux.ok) {
    lifecycle(LIFECYCLE_STAGES.boot, 'failed', { reason: 'tmux-missing' });
    return { status: 'tmux-missing' };
  }

  ensureTmuxRunning({ env, runner });

  const prefix = effectiveDefaults(config).window_prefix || '';
  const windowName = windowNameFor(slug, prefix);
  const existing = findWindow(windowName, runner);
  if (existing) {
    lifecycle(LIFECYCLE_STAGES.boot, 'reused', { windowName });
    return { status: 'exists', windowName, session: existing.session };
  }

  const plan = planStart({ config, workspaceRoot, slug, windowName });
  lifecycle(LIFECYCLE_STAGES.planning, 'succeeded', { paneCount: plan.panes.length, skipped: plan.skipped });
  // Phase 2: always operate on a session named 'jlu-dev'. If the user is
  // inside a different session, the orchestrator will create the window in
  // 'jlu-dev'. They can attach via: tmux attach -t jlu-dev.
  const session = 'jlu-dev';

  lifecycle(LIFECYCLE_STAGES.boot, 'started', { windowName });
  newWindow({ session, name: windowName }, runner);
  const winTarget = `${session}:${windowName}`;

  if (plan.panes.length > 0) {
    const p0 = plan.panes[0];
    selectPaneTitle({ target: `${winTarget}.0`, title: p0.title }, runner);
    if (p0.color) setPaneStyle({ target: `${winTarget}.0`, style: p0.color }, runner);
    sendKeys({ target: `${winTarget}.0`, keys: p0.command }, runner);
  }

  for (let i = 1; i < plan.panes.length; i++) {
    splitWindow({ target: winTarget }, runner);
    const p = plan.panes[i];
    selectPaneTitle({ target: winTarget + '.' + i, title: p.title }, runner);
    if (p.color) setPaneStyle({ target: winTarget + '.' + i, style: p.color }, runner);
    sendKeys({ target: winTarget + '.' + i, keys: p.command }, runner);
  }

  selectLayout({ target: winTarget, layout: plan.layout }, runner);
  selectWindow({ target: winTarget }, runner);

  const daemon = daemonSpawn({ slug, workspaceRoot, workspaceId, windowName, configPath });
  lifecycle(LIFECYCLE_STAGES.boot, 'succeeded', { windowName, paneCount: plan.panes.length });

  return {
    status: 'created',
    windowName,
    session,
    layout: plan.layout,
    paneCount: plan.panes.length,
    skipped: plan.skipped,
    daemonPid: daemon.pid
  };
}
