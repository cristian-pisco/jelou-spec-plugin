// bin/lib/dev-orchestrator/events.mjs
//
// JSONL writer + event type/severity constants for the dev-env daemon.
//
// Phase 2 migration: appendEvent now delegates to the shared
// bin/lib/trace/emitter.mjs so daemon events join the workspace trace store
// with `scope: "daemon"`. The legacy API (EVENT_TYPES, SEVERITY, severityFor,
// appendEvent signature) is preserved verbatim — daemon callers do not need
// to change.

import { appendSpan } from '../trace/emitter.mjs';
import { EVENT_KIND, SCOPE } from '../trace/schema.mjs';

export const EVENT_TYPES = Object.freeze({
  daemon_started: 'daemon_started',
  pane_started: 'pane_started',
  panes_changed: 'panes_changed',
  ready: 'ready',
  daemon_reload: 'daemon_reload',
  pattern_match: 'pattern_match',
  pane_dead: 'pane_dead',
  readiness_failed: 'readiness_failed',
});

export const SEVERITY = Object.freeze({
  info: 'info',
  soft: 'soft',
  hard: 'hard',
});

const SEVERITY_BY_TYPE = {
  daemon_started: SEVERITY.info,
  pane_started: SEVERITY.info,
  panes_changed: SEVERITY.info,
  ready: SEVERITY.info,
  daemon_reload: SEVERITY.info,
  pattern_match: SEVERITY.soft,
  pane_dead: SEVERITY.hard,
  readiness_failed: SEVERITY.hard,
};

export function severityFor(type) {
  return SEVERITY_BY_TYPE[type] || SEVERITY.info;
}

export function appendEvent(absLogPath, evt) {
  const { type, ts, severity, ...rest } = evt;
  const span = {
    event_kind: EVENT_KIND.EVENT,
    scope: SCOPE.DAEMON,
    name: type,
    severity: severity || severityFor(type),
    type,
    ...rest,
  };
  if (ts !== undefined) span.ts = ts;
  appendSpan(absLogPath, span);
}
