import {
  pairSpans, groupByAgent, percentile, retryRate, retriedFraction,
  wilsonLowerBound, rollupCost,
} from './aggregate.mjs';
import { judgeCalibration } from './rules.mjs';
import { classifyFailureMode, earliestDecisiveFailure } from './failure.mjs';
import {
  SUCCESS, FAILURE_MODE, EVAL_EVENT_NAME, EVENT_KIND, STATUS, SPAN_NAMES, SIGNAL,
} from './schema.mjs';

const DECISIVE_STATUS = new Set([STATUS.BLOCKED, STATUS.FAILED, STATUS.ORPHANED]);

function evalEvents(events) {
  return events.filter(
    (e) => e.event_kind === EVENT_KIND.EVENT && e.name === EVAL_EVENT_NAME,
  );
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function buildTasks(pairs) {
  const taskPairs = pairs.filter((p) => p.start.name === SPAN_NAMES.EXECUTE_TASK);
  const out = { total: taskPairs.length, pass_1: 0, pass_k: 0, fail: 0, autonomy: 0 };
  if (!taskPairs.length) return out;
  let ok = 0;
  for (const p of taskPairs) {
    const success = p.end?.attrs?.success ?? p.start.attrs?.success;
    if (success === SUCCESS.PASS_1) out.pass_1 += 1;
    else if (success === SUCCESS.PASS_K) out.pass_k += 1;
    else if (success === SUCCESS.FAIL) out.fail += 1;
    if (p.end?.status === STATUS.OK) ok += 1;
  }
  out.autonomy = ok / taskPairs.length;
  return out;
}

function buildCost(pairs, tasks) {
  const roll = rollupCost(pairs);
  const successful = tasks.pass_1 + tasks.pass_k;
  return { ...roll, cost_per_successful_task: roll.total_usd / Math.max(1, successful) };
}

function buildAgents(pairs, events) {
  const evals = evalEvents(events);
  const byAgent = groupByAgent(pairs);
  const out = [];
  for (const [agent_role, agentPairs] of Object.entries(byAgent)) {
    const spanIds = new Set(agentPairs.map((p) => p.start.span_id));
    const durations = agentPairs.map((p) => p.duration_ms);
    const { k, n, fraction } = retriedFraction(agentPairs);
    const quality = [];
    const faithfulness = [];
    for (const e of evals) {
      if (!spanIds.has(e.parent_span_id)) continue;
      const score = e.attrs?.quality_score;
      if (typeof score === 'number') quality.push(score);
      const f = e.attrs?.quality_dims?.faithfulness_to_spec;
      if (typeof f === 'number') faithfulness.push(f);
    }
    out.push({
      agent_role,
      n: agentPairs.length,
      p50_ms: percentile(durations, 50),
      p95_ms: percentile(durations, 95),
      retry_rate: retryRate(agentPairs),
      retried_fraction: fraction,
      wilson_lower_bound: wilsonLowerBound(k, n),
      mean_quality: mean(quality),
      mean_faithfulness: mean(faithfulness),
    });
  }
  return out;
}

function buildQuality(events, feedback) {
  const scores = [];
  for (const e of evalEvents(events)) {
    const score = e.attrs?.quality_score;
    if (typeof score === 'number') scores.push(score);
  }
  return { ...judgeCalibration({ events, feedback }), mean_quality_score: mean(scores) };
}

function buildFailures(pairs) {
  const out = {
    [FAILURE_MODE.SPEC]: 0,
    [FAILURE_MODE.COORDINATION]: 0,
    [FAILURE_MODE.VERIFICATION]: 0,
    [FAILURE_MODE.EXECUTION]: 0,
    [FAILURE_MODE.UNKNOWN]: 0,
  };
  const byTrace = new Map();
  for (const p of pairs) {
    if (!p.end || !DECISIVE_STATUS.has(p.end.status)) continue;
    const traceId = p.start.trace_id;
    if (!byTrace.has(traceId)) byTrace.set(traceId, []);
    byTrace.get(traceId).push(p);
  }
  for (const tracePairs of byTrace.values()) {
    const p = earliestDecisiveFailure(tracePairs);
    if (!p) continue;
    const coordinated = p.start.name === SPAN_NAMES.PHASE && tracePairs.length > 1;
    const escalation_reason = coordinated ? 'coordination' : p.end?.attrs?.escalation_reason;
    const mode = classifyFailureMode({
      name: p.start.name,
      agent_role: p.start.agent_role,
      escalation_reason,
    });
    out[mode] = (out[mode] || 0) + 1;
  }
  return out;
}

function buildFeedback(feedback) {
  const out = {
    [SIGNAL.ACCEPT]: 0,
    [SIGNAL.REJECT]: 0,
    [SIGNAL.IMPLICIT_NEGATIVE]: 0,
    [SIGNAL.EDIT]: 0,
  };
  for (const f of feedback) {
    if (f && Object.prototype.hasOwnProperty.call(out, f.signal)) out[f.signal] += 1;
  }
  return out;
}

function buildSuggestions(history) {
  const verifications = history.filter((h) => h && h.kind === 'verification');
  const verified = verifications.length;
  const met = verifications.filter((h) => h.met === true).length;
  return { verified, met, hit_rate: verified ? met / verified : 0 };
}

export function buildScorecard({ events = [], feedback = [], history = [] } = {}) {
  const pairs = pairSpans(events);
  const tasks = buildTasks(pairs);
  return {
    tasks,
    cost: buildCost(pairs, tasks),
    agents: buildAgents(pairs, events),
    quality: buildQuality(events, feedback),
    failures: buildFailures(pairs),
    feedback: buildFeedback(feedback),
    suggestions: buildSuggestions(history),
  };
}
