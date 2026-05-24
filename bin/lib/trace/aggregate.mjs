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
