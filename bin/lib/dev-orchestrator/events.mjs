// bin/lib/dev-orchestrator/events.mjs
//
// JSONL writer + event type/severity constants for dev-events.log.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const EVENT_TYPES = Object.freeze({
  daemon_started: 'daemon_started',
  pane_started: 'pane_started',
  panes_changed: 'panes_changed',
  ready: 'ready',
  daemon_reload: 'daemon_reload',
  pattern_match: 'pattern_match',
  pane_dead: 'pane_dead',
  readiness_failed: 'readiness_failed'
});

export const SEVERITY = Object.freeze({
  info: 'info',
  soft: 'soft',
  hard: 'hard'
});

const SEVERITY_BY_TYPE = {
  daemon_started: SEVERITY.info,
  pane_started: SEVERITY.info,
  panes_changed: SEVERITY.info,
  ready: SEVERITY.info,
  daemon_reload: SEVERITY.info,
  pattern_match: SEVERITY.soft,
  pane_dead: SEVERITY.hard,
  readiness_failed: SEVERITY.hard
};

export function severityFor(type) {
  return SEVERITY_BY_TYPE[type] || SEVERITY.info;
}

export function appendEvent(absLogPath, evt) {
  const dir = dirname(absLogPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = { ts: evt.ts || new Date().toISOString(), severity: evt.severity || severityFor(evt.type), ...evt };
  appendFileSync(absLogPath, JSON.stringify(out) + '\n', 'utf8');
}
