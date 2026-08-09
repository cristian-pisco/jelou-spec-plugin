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
  lifecycle_stage: 'lifecycle_stage',
});

export const LIFECYCLE_STAGES = Object.freeze({
  resolution: 'resolution',
  planning: 'planning',
  boot: 'boot',
  provisioning: 'provisioning',
  login: 'login',
  authorization: 'authorization',
  browser: 'browser_verification',
  cleanup: 'cleanup',
});

export const LIFECYCLE_OUTCOMES = Object.freeze({
  started: 'started',
  succeeded: 'succeeded',
  failed: 'failed',
  reused: 'reused',
  refused: 'refused',
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
  lifecycle_stage: SEVERITY.info,
};

const SENSITIVE_KEY = /(authorization|cookie|credential|password|secret|token|api[_-]?key)/i;
const SENSITIVE_FLAG = /^--?(authorization|cookie|credential|password|secret|token|api[_-]?key)$/i;
const REDACTED = '[REDACTED]';

function collectSecrets(value, secrets, key = '') {
  if (value === null || value === undefined) return;
  if (SENSITIVE_KEY.test(key) && (typeof value === 'string' || typeof value === 'number')) {
    const secret = String(value);
    if (secret) secrets.add(secret);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (index > 0 && SENSITIVE_FLAG.test(String(value[index - 1])) && (typeof item === 'string' || typeof item === 'number')) secrets.add(String(item));
      collectSecrets(item, secrets);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) collectSecrets(child, secrets, childKey);
  }
}

function redactString(value, secrets) {
  let redacted = value;
  for (const secret of secrets) redacted = redacted.split(secret).join(REDACTED);
  redacted = redacted.replace(/(Bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`);
  redacted = redacted.replace(/((?:authorization|cookie|credential|password|secret|token|api[_-]?key)\s*[:=]\s*)(?!Bearer\b)[^\s,;]+/gi, `$1${REDACTED}`);
  return redacted;
}

function redactValue(value, secrets, key = '') {
  if (SENSITIVE_KEY.test(key) && value !== null && value !== undefined) return REDACTED;
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) {
    return value.map((item, index) => (index > 0 && SENSITIVE_FLAG.test(String(value[index - 1])) ? REDACTED : redactValue(item, secrets)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactValue(child, secrets, childKey)]));
  }
  return value;
}

export function redactDiagnostics(value) {
  const secrets = new Set();
  collectSecrets(value, secrets);
  return redactValue(value, secrets);
}

export function severityFor(type) {
  return SEVERITY_BY_TYPE[type] || SEVERITY.info;
}

export function appendEvent(absLogPath, evt) {
  const { type, ts, severity, ...rest } = redactDiagnostics(evt);
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

export function appendLifecycleEvent(absLogPath, event) {
  if (!Object.values(LIFECYCLE_STAGES).includes(event.stage)) throw new Error(`unsupported lifecycle stage: ${event.stage}`);
  if (!Object.values(LIFECYCLE_OUTCOMES).includes(event.outcome)) throw new Error(`unsupported lifecycle outcome: ${event.outcome}`);
  appendEvent(absLogPath, { type: EVENT_TYPES.lifecycle_stage, ...event });
}

const DAEMON_LIFECYCLE = Object.freeze({
  daemon_started: { stage: LIFECYCLE_STAGES.boot, outcome: 'started' },
  ready: { stage: LIFECYCLE_STAGES.boot, outcome: 'succeeded' },
  pane_dead: { stage: LIFECYCLE_STAGES.boot, outcome: 'failed' },
  readiness_failed: { stage: LIFECYCLE_STAGES.boot, outcome: 'failed' },
  daemon_stopping: { stage: LIFECYCLE_STAGES.cleanup, outcome: 'succeeded' },
});

export function appendDaemonEvent(absLogPath, event) {
  appendEvent(absLogPath, event);
  const lifecycle = DAEMON_LIFECYCLE[event.type];
  if (!lifecycle) return;
  appendLifecycleEvent(absLogPath, {
    ...lifecycle,
    taskSlug: event.slug,
    service: event.service,
    reason: event.reason,
  });
}
