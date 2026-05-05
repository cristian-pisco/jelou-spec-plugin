// bin/lib/dev-orchestrator/logs.mjs
//
// Implements /jlu:logs: capture-pane on demand for one service.

import { findWindow, listPanes, capturePane } from './tmux.mjs';

function windowNameFor(slug) { return `jlu-dev-${slug || '_global'}`; }

export function logsFor({ slug, serviceName, lines = 100, runner, allServices = [] }) {
  const svc = allServices.find(s => s.name === serviceName);
  if (!svc) return { status: 'not-registered' };

  const winName = windowNameFor(slug);
  const win = findWindow(winName, runner);
  if (!win) return { status: 'no-window' };

  const target = `${win.session}:${winName}`;
  const panes = listPanes({ window: target, runner });
  const title = (svc.panel && svc.panel.title) || svc.name;
  const idx = panes.findIndex(p => p.title === title);
  if (idx < 0) return { status: 'no-pane' };

  const capture = capturePane({ target: `${target}.${idx}`, lines }, runner);
  return { status: 'ok', capture, paneIndex: idx };
}
