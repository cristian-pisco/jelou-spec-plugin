// bin/lib/dev-orchestrator/add.mjs
//
// Implements /jlu:add-service: add one service's pane to an existing window.

import { findWindow, listPanes, splitWindow, sendKeys, selectLayout, selectPane, selectPaneTitle, setPaneStyle } from './tmux.mjs';
import { buildPaneCommand } from './start.mjs';
import { isAbsolute, resolve } from 'node:path';
import { LIFECYCLE_STAGES } from './events.mjs';

function paneCwdFor(workspaceRoot, service) {
  const rel = service.path || '.';
  return isAbsolute(rel) ? rel : resolve(workspaceRoot, rel);
}

function windowNameFor(slug) { return `jlu-dev-${slug || '_global'}`; }

export function addService({ config, workspaceRoot, slug, serviceName, runner, onLifecycle = () => {} }) {
  const services = config.services || [];
  const svc = services.find(s => s.name === serviceName);
  if (!svc) return { status: 'not-registered' };

  const winName = windowNameFor(slug);
  const win = findWindow(winName, runner);
  if (!win) return { status: 'no-window' };

  const target = `${win.session}:${winName}`;
  const panes = listPanes({ window: target, runner });
  const desiredTitle = (svc.panel && svc.panel.title) || svc.name;
  if (panes.find(p => p.title === desiredTitle)) return { status: 'pane-exists' };

  onLifecycle({ stage: LIFECYCLE_STAGES.boot, outcome: 'started', taskSlug: slug, service: serviceName });
  splitWindow({ target }, runner);

  // After split, the new pane is the last index.
  const newIdx = panes.length;
  const paneTarget = `${target}.${newIdx}`;

  selectPaneTitle({ target: paneTarget, title: desiredTitle }, runner);
  if (svc.panel && svc.panel.color) setPaneStyle({ target: paneTarget, style: svc.panel.color }, runner);

  const cwd = paneCwdFor(workspaceRoot, svc);
  const cmd = buildPaneCommand({ service: svc, paneCwd: cwd });
  sendKeys({ target: paneTarget, keys: cmd }, runner);

  selectLayout({ target, layout: 'tiled' }, runner);
  selectPane({ target: paneTarget }, runner);
  onLifecycle({ stage: LIFECYCLE_STAGES.boot, outcome: 'succeeded', taskSlug: slug, service: serviceName });

  return { status: 'added', paneIndex: newIdx };
}
