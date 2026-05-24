// bin/lib/trace/schema.mjs
//
// Tracing schema constants. No logic — values only.
// Imported by emitter, reader, all bin/trace-* CLIs, future analyze/suggest.

export const EVENT_KIND = Object.freeze({
  SPAN_START: 'span_start',
  SPAN_END: 'span_end',
  EVENT: 'event',
});

export const STATUS = Object.freeze({
  OK: 'ok',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  ESCALATED: 'escalated',
  ORPHANED: 'orphaned',
});

export const SCOPE = Object.freeze({
  TASK: 'task',
  DAEMON: 'daemon',
  GLOBAL: 'global',
});

export const SPAN_NAMES = Object.freeze({
  EXECUTE_TASK: 'execute_task',
  NEW_TASK: 'new_task',
  REFINE_TASK: 'refine_task',
  CREATE_PR: 'create_pr',
  REPORT_TASK: 'report_task',
  CLOSE_TASK: 'close_task',
  PHASE: 'phase',
  AGENT_DISPATCH: 'agent_dispatch',
});

// Single appendFileSync call must stay below PIPE_BUF (4096 on Linux)
// to remain atomic. Leave headroom for the trailing newline + envelope.
export const PAYLOAD_CAP_BYTES = 3500;

// Threshold for reconciler to declare a span_start orphaned.
export const RECONCILE_AFTER_MS = 30 * 60 * 1000;
