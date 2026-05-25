// bin/lib/trace/rules.mjs
//
// The four suggestion rules and the cooldown logic. Pure functions over
// the [{start, end, duration_ms}] pair shape from aggregate.mjs.
//
// Rules:
//   bump_model_tier      — per agent_role, retry_rate > 0.20 over last N=10 dispatches
//   extend_patterns      — error_signature appears >= 3 times in last 30 days
//   suggest_parallelize  — per (service:phase), p95/median > 3.0 over last N=10 phase runs
//   immediate_flag       — any span with status: "blocked"/"failed" in last 24 hours
//
// Cooldown: 7 days per (rule_id, signature) pair. Both approved and declined
// history entries start a cooldown.

import { groupByAgent, groupByPhase, percentile, retryRate } from './aggregate.mjs';

const N_WINDOW = 10;
const PATTERN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const BLOCKED_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const RETRY_RATE_THRESHOLD = 0.20;
const PARALLEL_RATIO_THRESHOLD = 3.0;
const PATTERN_OCCURRENCE_THRESHOLD = 3;

export const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export const RULES = [
  {
    id: 'bump_model_tier',
    description: 'Per-agent retry rate exceeds threshold',
    evaluate: (pairs) => {
      const findings = [];
      const byAgent = groupByAgent(pairs);
      for (const [agent_role, agentPairs] of Object.entries(byAgent)) {
        const recent = agentPairs.slice(-N_WINDOW);
        if (recent.length < N_WINDOW) continue;
        const rate = retryRate(recent);
        if (rate <= RETRY_RATE_THRESHOLD) continue;
        const signatures = recent
          .map(p => p.end?.attrs?.error_signature)
          .filter(Boolean);
        findings.push({
          rule_id: 'bump_model_tier',
          signature: agent_role,
          evidence: {
            retry_rate: rate,
            dispatches_checked: recent.length,
            error_signatures: signatures,
          },
          message: `${agent_role} has ${Math.round(rate * 100)}% retry rate ` +
            `(${Math.round(rate * recent.length)}/${recent.length} last runs)`,
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
    description: 'Recently blocked span',
    evaluate: (pairs) => {
      const cutoff = Date.now() - BLOCKED_LOOKBACK_MS;
      const findings = [];
      for (const p of pairs) {
        if (!p.end) continue;
        if (p.end.status !== 'blocked' && p.end.status !== 'failed') continue;
        const ts = new Date(p.end.ts).getTime();
        if (ts < cutoff) continue;
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
          },
          message: `${p.start.name} ${sig} ${p.end.status} on task=${p.start.task_slug || '?'}`,
        });
      }
      return findings;
    },
  },
];

export const RULE_IDS = RULES.map(r => r.id);

export function evaluate(pairs) {
  const findings = [];
  for (const rule of RULES) {
    findings.push(...rule.evaluate(pairs));
  }
  return findings;
}

export function applyCooldown(findings, history) {
  const now = Date.now();
  const cooled = new Set();
  for (const h of history) {
    const ts = new Date(h.ts).getTime();
    if (now - ts < COOLDOWN_MS) cooled.add(`${h.rule_id}:${h.signature}`);
  }
  return findings.filter(f => !cooled.has(`${f.rule_id}:${f.signature}`));
}

export function formatSuggestion(finding) {
  const ev = Object.entries(finding.evidence || {})
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
  return [
    `SUGGEST [${finding.rule_id}] ${finding.message}`,
    `  evidence: ${ev}`,
    `  apply: y/n?`,
  ].join('\n');
}
