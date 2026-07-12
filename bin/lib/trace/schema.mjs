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
  SHIP: 'ship',
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

export const SUCCESS = Object.freeze({
  PASS_1: 'pass@1',
  PASS_K: 'pass@k',
  FAIL: 'fail',
});

export const FAILURE_MODE = Object.freeze({
  SPEC: 'spec',
  COORDINATION: 'coordination',
  VERIFICATION: 'verification',
  EXECUTION: 'execution',
  UNKNOWN: 'unknown',
});

export const SIGNAL = Object.freeze({
  ACCEPT: 'accept',
  REJECT: 'reject',
  IMPLICIT_NEGATIVE: 'implicit_negative',
  EDIT: 'edit',
});

export const PR_OUTCOME = Object.freeze({
  MERGED_CLEAN: 'merged_clean',
  REVERTED: 'reverted',
  OPEN: 'open',
});

export const EVAL_EVENT_NAME = 'eval';

export const MIN_SAMPLE = 10;

export const ATTR = Object.freeze({
  INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  REASONING_TOKENS: 'gen_ai.usage.reasoning_tokens',
  CACHE_READ_TOKENS: 'gen_ai.usage.cache_read_tokens',
  COST_USD: 'cost_usd',
  SUCCESS: 'success',
  ATTEMPTS_TO_GREEN: 'attempts_to_green',
  PR_OUTCOME: 'pr_outcome',
  TRAJECTORY_MATCH: 'trajectory_match',
  PROGRESS_RATE: 'progress_rate',
  QUALITY_SCORE: 'quality_score',
  QUALITY_DIMS: 'quality_dims',
  FAILURE_MODE: 'failure_mode',
  JUDGE_PANEL: 'judge_panel',
});
