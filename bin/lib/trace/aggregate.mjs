// bin/lib/trace/aggregate.mjs
//
// Pure aggregation helpers for the tracing system. Stdlib only — no I/O.
//
//   - pairSpans(events): zip span_start with matching span_end by span_id.
//     Returns [{ start, end, duration_ms }, ...]. Orphans are omitted.
//   - groupByTrace(pairs): { trace_id -> pairs[] }
//   - groupByAgent(pairs): { agent_role -> pairs[] }, agent_dispatch only.
//   - groupByPhase(pairs): { "<service_id>:<phase_num>" -> pairs[] }, phase only.
//   - percentile(arr, p): linear-interpolated p-th percentile (0-100).
//   - retryRate(agentPairs): sum(retry_count) / count. 0 for empty input.
//   - rollupCost(pairs): total/by-agent/by-model USD from agent_dispatch spans.
//   - classifySuccess({passed, attempts}): pass@1 / pass@k / fail.
//   - trajectoryMatch(actual, reference): in_order / subset / off_plan vs a
//     canonical step sequence, plus matched + unexpected steps.
//   - progressRate(completed, planned): completed/planned, 0 when planned<=0.

import { SUCCESS, ATTR } from './schema.mjs';

export function pairSpans(events) {
  const starts = new Map();
  const pairs = [];
  for (const e of events) {
    if (e.event_kind === 'span_start') {
      starts.set(e.span_id, e);
    } else if (e.event_kind === 'span_end') {
      const start = starts.get(e.span_id);
      if (!start) continue;
      const duration_ms = e.duration_ms != null
        ? e.duration_ms
        : (new Date(e.ts).getTime() - new Date(start.ts).getTime());
      pairs.push({ start, end: e, duration_ms });
      starts.delete(e.span_id);
    }
  }
  return pairs;
}

export function groupByTrace(pairs) {
  const out = {};
  for (const p of pairs) {
    const key = p.start.trace_id;
    if (!out[key]) out[key] = [];
    out[key].push(p);
  }
  return out;
}

export function groupByAgent(pairs) {
  const out = {};
  for (const p of pairs) {
    if (p.start.name !== 'agent_dispatch') continue;
    const role = p.start.agent_role;
    if (!role) continue;
    if (!out[role]) out[role] = [];
    out[role].push(p);
  }
  return out;
}

export function groupByPhase(pairs) {
  const out = {};
  for (const p of pairs) {
    if (p.start.name !== 'phase') continue;
    const key = `${p.start.service_id || 'unknown'}:${p.start.phase_num ?? 'unknown'}`;
    if (!out[key]) out[key] = [];
    out[key].push(p);
  }
  return out;
}

export function percentile(arr, p) {
  if (arr.length === 0) return 0;
  if (arr.length === 1) return arr[0];
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function retryRate(agentPairs) {
  if (agentPairs.length === 0) return 0;
  let total = 0;
  for (const p of agentPairs) {
    total += (p.end?.attrs?.retry_count ?? 0);
  }
  return total / agentPairs.length;
}

export function wilsonLowerBound(successes, n, z = 1.96) {
  if (n === 0) return 0;
  const p = successes / n;
  const numerator = p + (z * z) / (2 * n) -
    z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const denominator = 1 + (z * z) / n;
  const lb = numerator / denominator;
  return Math.min(1, Math.max(0, lb));
}

export function retriedFraction(agentPairs) {
  const n = agentPairs.length;
  let k = 0;
  for (const p of agentPairs) {
    if ((p.end?.attrs?.retry_count ?? 0) > 0) k += 1;
  }
  return { k, n, fraction: n ? k / n : 0 };
}

export function rollupCost(pairs) {
  const by_agent = {};
  const by_model = {};
  let total_usd = 0;
  for (const p of pairs) {
    if (p.start?.name !== 'agent_dispatch') continue;
    const cost = Number(p.end?.attrs?.[ATTR.COST_USD] ?? 0);
    if (!Number.isFinite(cost) || cost === 0) continue;
    total_usd += cost;
    const role = p.start.agent_role || 'unknown';
    by_agent[role] = (by_agent[role] || 0) + cost;
    const model = p.start.attrs?.model_used || p.end?.attrs?.model_used || 'unknown';
    by_model[model] = (by_model[model] || 0) + cost;
  }
  return { total_usd, by_agent, by_model };
}

export function classifySuccess({ passed, attempts } = {}) {
  if (!passed) return SUCCESS.FAIL;
  return (attempts ?? 1) <= 1 ? SUCCESS.PASS_1 : SUCCESS.PASS_K;
}

export function trajectoryMatch(actual, reference) {
  const refSet = new Set(reference);
  const unexpected = actual.filter((step) => !refSet.has(step));
  const subset = unexpected.length === 0;
  const matched = actual.filter((step) => refSet.has(step));
  const in_order = matched.length > 0 && isOrderedSubsequence(matched, reference);
  return { in_order, subset, off_plan: !subset, matched, unexpected };
}

function isOrderedSubsequence(seq, reference) {
  let i = 0;
  for (const step of seq) {
    while (i < reference.length && reference[i] !== step) i++;
    if (i >= reference.length) return false;
    i++;
  }
  return true;
}

export function progressRate(completed, planned) {
  if (!planned || planned <= 0) return 0;
  return completed / planned;
}
