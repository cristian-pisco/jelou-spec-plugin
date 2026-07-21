// bin/lib/trace/rules.mjs
//
// Suggestion rules and cooldown logic. Pure functions over the
// [{start, end, duration_ms}] pair shape from aggregate.mjs.
//
// Rules:
//   bump_model_tier              — per agent_role, retry_rate > 0.20 over last N=10 dispatches
//   extend_patterns              — error_signature appears >= 3 times in last 30 days
//   suggest_parallelize          — per (service:phase), p95/median > 3.0 over last N=10 phase runs
//   immediate_flag               — recent blocked/failed span (orphaned excluded, self-healing), one flag per trace, scoped to current task
//   faithfulness_below_baseline  — per agent_role, mean faithfulness_to_spec below floor (calibrated judge only)
//   quality_regression           — phase quality_score below its historical median (calibrated judge only)
//
// The last two are DORMANT until the LLM judge is calibrated against feedback
// ground truth (Cohen's kappa gate). Below the floor they return no findings.
//
// Cooldown: 7 days per (rule_id, signature) pair. Both approved and declined
// history entries start a cooldown; verification records do not.

import {
  groupByAgent, groupByPhase, percentile, retryRate, retriedFraction,
  wilsonLowerBound, binarizeScore, cohensKappa,
} from './aggregate.mjs';
import { MIN_SAMPLE, EVAL_EVENT_NAME, SIGNAL } from './schema.mjs';
import { classifyFailureMode, earliestDecisiveFailure } from './failure.mjs';

const N_WINDOW = 10;
const PATTERN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const BLOCKED_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const RETRY_RATE_THRESHOLD = 0.20;
const PARALLEL_RATIO_THRESHOLD = 3.0;
const PATTERN_OCCURRENCE_THRESHOLD = 3;
const QUALITY_REGRESSION_MARGIN = 0.1;
const DECISIVE_STATUS = new Set(['blocked', 'failed', 'orphaned']);
const FLAGGABLE_STATUS = new Set(['blocked', 'failed']);

export const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const KAPPA_FLOOR = 0.4;
export const FAITHFULNESS_FLOOR = 0.6;

export { N_WINDOW, RETRY_RATE_THRESHOLD };

function indexStarts(events) {
  const byId = new Map();
  for (const e of events) {
    if (e.event_kind === 'span_start') byId.set(e.span_id, e);
  }
  return byId;
}

function evalEvents(events) {
  return events.filter((e) => e.event_kind === 'event' && e.name === EVAL_EVENT_NAME);
}

export function judgeCalibration({ events = [], feedback = [] } = {}) {
  const scoreBySpan = new Map();
  for (const e of evalEvents(events)) {
    const target = e.parent_span_id;
    const score = e.attrs?.quality_score;
    if (!target || typeof score !== 'number') continue;
    scoreBySpan.set(target, score);
  }
  const labelBySpan = new Map();
  for (const f of feedback) {
    const label = f.signal === SIGNAL.ACCEPT ? 'positive'
      : f.signal === SIGNAL.REJECT ? 'negative'
        : null;
    if (!label) continue;
    labelBySpan.set(f.span_id, label);
  }
  const paired = [];
  for (const [spanId, score] of scoreBySpan) {
    const label = labelBySpan.get(spanId);
    if (!label) continue;
    paired.push({ a: binarizeScore(score), b: label });
  }
  const kappa = cohensKappa(paired);
  const pairs = paired.length;
  const calibrated = pairs >= MIN_SAMPLE && kappa >= KAPPA_FLOOR;
  return { kappa, pairs, calibrated };
}

export const RULES = [
  {
    id: 'bump_model_tier',
    description: 'Per-agent retry rate exceeds threshold',
    evaluate: (pairs) => {
      const findings = [];
      const byAgent = groupByAgent(pairs);
      for (const [agent_role, agentPairs] of Object.entries(byAgent)) {
        const recent = agentPairs.slice(-N_WINDOW);
        if (recent.length < MIN_SAMPLE) continue;
        const { k, n } = retriedFraction(recent);
        const lb = wilsonLowerBound(k, n);
        if (lb <= RETRY_RATE_THRESHOLD) continue;
        const rate = retryRate(recent);
        const signatures = recent
          .map(p => p.end?.attrs?.error_signature)
          .filter(Boolean);
        findings.push({
          rule_id: 'bump_model_tier',
          signature: agent_role,
          evidence: {
            retry_rate: rate,
            retried_fraction: k / n,
            wilson_lower_bound: Number(lb.toFixed(3)),
            dispatches_checked: recent.length,
            error_signatures: signatures,
          },
          message: `${agent_role} has ${Math.round(rate * 100)}% retry rate ` +
            `(${Math.round(rate * recent.length)}/${recent.length} last runs)`,
          expected_improvement: {
            metric: 'retried_fraction',
            signature: agent_role,
            baseline: k / n,
            target: RETRY_RATE_THRESHOLD,
            window_n: N_WINDOW,
            direction: 'decrease',
          },
        });
      }
      return findings;
    },
  },
  {
    id: 'extend_patterns',
    description: 'Repeated error_signature across last 30 days',
    evaluate: (pairs) => {
      const cutoff = Date.now() - PATTERN_LOOKBACK_MS;
      const counts = new Map();
      for (const p of pairs) {
        if (!p.end) continue;
        const ts = new Date(p.end.ts).getTime();
        if (ts < cutoff) continue;
        const sig = p.end?.attrs?.error_signature;
        if (!sig) continue;
        counts.set(sig, (counts.get(sig) || 0) + 1);
      }
      const findings = [];
      for (const [sig, occurrences] of counts) {
        if (occurrences < PATTERN_OCCURRENCE_THRESHOLD) continue;
        findings.push({
          rule_id: 'extend_patterns',
          signature: sig,
          evidence: { occurrences },
          message: `error_signature ${sig} repeated ${occurrences}x in last 30 days`,
        });
      }
      return findings;
    },
  },
  {
    id: 'suggest_parallelize',
    description: 'Phase p95 / median > 3.0',
    evaluate: (pairs) => {
      const findings = [];
      const byPhase = groupByPhase(pairs);
      for (const [key, phasePairs] of Object.entries(byPhase)) {
        const recent = phasePairs.slice(-N_WINDOW);
        if (recent.length < N_WINDOW) continue;
        const durations = recent.map(p => p.duration_ms);
        const p95 = percentile(durations, 95);
        const median = percentile(durations, 50);
        if (median === 0) continue;
        const ratio = p95 / median;
        if (ratio <= PARALLEL_RATIO_THRESHOLD) continue;
        findings.push({
          rule_id: 'suggest_parallelize',
          signature: key,
          evidence: {
            p95_ms: Math.round(p95),
            median_ms: Math.round(median),
            ratio: Number(ratio.toFixed(2)),
            samples: recent.length,
          },
          message: `phase ${key} p95 ${Math.round(p95)}ms / median ${Math.round(median)}ms ` +
            `= ${ratio.toFixed(1)}x (over ${PARALLEL_RATIO_THRESHOLD}x threshold)`,
        });
      }
      return findings;
    },
  },
  {
    id: 'immediate_flag',
    description: 'Recently blocked/failed span (orphaned excluded), one flag per trace, scoped to current task',
    evaluate: (pairs, context = {}) => {
      const cutoff = Date.now() - BLOCKED_LOOKBACK_MS;
      const { currentTask } = context;
      const byTrace = new Map();
      for (const p of pairs) {
        if (!p.end || !FLAGGABLE_STATUS.has(p.end.status)) continue;
        if (new Date(p.end.ts).getTime() < cutoff) continue;
        if (currentTask && p.start.task_slug !== currentTask) continue;
        const traceId = p.start.trace_id;
        if (!byTrace.has(traceId)) byTrace.set(traceId, []);
        byTrace.get(traceId).push(p);
      }
      const findings = [];
      for (const [traceId, tracePairs] of byTrace) {
        const p = earliestDecisiveFailure(tracePairs);
        if (!p) continue;
        const failedInTrace = tracePairs.length;
        const coordinated = p.start.name === 'phase' && failedInTrace > 1;
        const escalation_reason = coordinated
          ? 'coordination'
          : p.end?.attrs?.escalation_reason;
        const failure_mode = classifyFailureMode({
          name: p.start.name,
          agent_role: p.start.agent_role,
          escalation_reason,
        });
        const sig = p.end?.attrs?.error_signature ||
          `${p.start.name}:${p.start.agent_role || p.start.service_id || 'unknown'}`;
        findings.push({
          rule_id: 'immediate_flag',
          signature: sig,
          evidence: {
            span_id: p.start.span_id,
            agent_role: p.start.agent_role,
            phase_num: p.start.phase_num,
            service_id: p.start.service_id,
            task_slug: p.start.task_slug,
            status: p.end.status,
            ts: p.end.ts,
            trace_id: traceId,
            failed_in_trace: failedInTrace,
            failure_mode,
          },
          message: `${p.start.name} ${sig} ${p.end.status} on task=${p.start.task_slug || '?'} [${failure_mode}]`,
        });
      }
      return findings;
    },
  },
  {
    id: 'faithfulness_below_baseline',
    description: 'Per-agent faithfulness_to_spec below floor (calibrated judge only)',
    evaluate: (pairs, context = {}) => {
      const { events = [], feedback = [] } = context;
      if (!judgeCalibration({ events, feedback }).calibrated) return [];
      const startById = indexStarts(events);
      const byAgent = new Map();
      for (const e of evalEvents(events)) {
        const parent = startById.get(e.parent_span_id);
        if (!parent || parent.name !== 'agent_dispatch' || !parent.agent_role) continue;
        const faithfulness = e.attrs?.quality_dims?.faithfulness_to_spec;
        if (typeof faithfulness !== 'number') continue;
        if (!byAgent.has(parent.agent_role)) byAgent.set(parent.agent_role, []);
        byAgent.get(parent.agent_role).push(faithfulness);
      }
      const findings = [];
      for (const [agent_role, values] of byAgent) {
        if (values.length < MIN_SAMPLE) continue;
        const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
        if (mean >= FAITHFULNESS_FLOOR) continue;
        findings.push({
          rule_id: 'faithfulness_below_baseline',
          signature: agent_role,
          evidence: {
            faithfulness_mean: Number(mean.toFixed(3)),
            evals_checked: values.length,
            floor: FAITHFULNESS_FLOOR,
          },
          message: `${agent_role} faithfulness_to_spec ${mean.toFixed(2)} below floor ${FAITHFULNESS_FLOOR} ` +
            `over ${values.length} evals — tighten prompt or escalate`,
          expected_improvement: {
            metric: 'faithfulness_to_spec',
            signature: agent_role,
            baseline: Number(mean.toFixed(3)),
            target: FAITHFULNESS_FLOOR,
            window_n: N_WINDOW,
            direction: 'increase',
          },
        });
      }
      return findings;
    },
  },
  {
    id: 'quality_regression',
    description: 'Phase quality_score regressed below its historical median (calibrated judge only)',
    evaluate: (pairs, context = {}) => {
      const { events = [], feedback = [] } = context;
      if (!judgeCalibration({ events, feedback }).calibrated) return [];
      const startById = indexStarts(events);
      const byPhase = new Map();
      for (const e of evalEvents(events)) {
        const parent = startById.get(e.parent_span_id);
        if (!parent || parent.name !== 'phase') continue;
        const score = e.attrs?.quality_score;
        if (typeof score !== 'number') continue;
        const key = `${parent.service_id || 'unknown'}:${parent.phase_num ?? 'unknown'}`;
        if (!byPhase.has(key)) byPhase.set(key, []);
        byPhase.get(key).push({ score, ts: e.ts });
      }
      const findings = [];
      for (const [key, entries] of byPhase) {
        if (entries.length < MIN_SAMPLE) continue;
        entries.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
        const scores = entries.map(e => e.score);
        const recent = scores[scores.length - 1];
        const median = percentile(scores.slice(0, -1), 50);
        if (recent >= median - QUALITY_REGRESSION_MARGIN) continue;
        findings.push({
          rule_id: 'quality_regression',
          signature: key,
          evidence: {
            recent_score: Number(recent.toFixed(3)),
            historical_median: Number(median.toFixed(3)),
            margin: QUALITY_REGRESSION_MARGIN,
            samples: scores.length,
          },
          message: `phase ${key} quality_score ${recent.toFixed(2)} regressed below median ${median.toFixed(2)} ` +
            `(margin ${QUALITY_REGRESSION_MARGIN}) — likely prompt regression`,
          expected_improvement: {
            metric: 'quality_score',
            signature: key,
            baseline: Number(recent.toFixed(3)),
            target: Number(median.toFixed(3)),
            window_n: N_WINDOW,
            direction: 'increase',
          },
        });
      }
      return findings;
    },
  },
];

export const RULE_IDS = RULES.map(r => r.id);

export function evaluate(pairs, context = {}) {
  const findings = [];
  for (const rule of RULES) {
    findings.push(...rule.evaluate(pairs, context));
  }
  return findings;
}

export function applyCooldown(findings, history) {
  const now = Date.now();
  const cooled = new Set();
  for (const h of history) {
    if (h.kind === 'verification') continue;
    const ts = new Date(h.ts).getTime();
    if (now - ts < COOLDOWN_MS) cooled.add(`${h.rule_id}:${h.signature}`);
  }
  return findings.filter(f => !cooled.has(`${f.rule_id}:${f.signature}`));
}

function formatPrediction(prediction) {
  const arrow = prediction.direction === 'increase' ? '≥' : '≤';
  const baseline = Number(prediction.baseline).toFixed(2);
  const target = Number(prediction.target).toFixed(2);
  return `predict: ${prediction.metric} ${prediction.signature} ${baseline} → ` +
    `${arrow}${target} within ${prediction.window_n} dispatches`;
}

export function formatSuggestion(finding) {
  const ev = Object.entries(finding.evidence || {})
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
  const lines = [
    `SUGGEST [${finding.rule_id}] ${finding.message}`,
    `  evidence: ${ev}`,
  ];
  if (finding.expected_improvement) {
    lines.push(`  ${formatPrediction(finding.expected_improvement)}`);
  }
  lines.push('  apply: y/n?');
  return lines.join('\n');
}
