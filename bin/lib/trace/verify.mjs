import { groupByAgent, retriedFraction } from './aggregate.mjs';

function metricValue(metric, window) {
  if (metric === 'retried_fraction') return retriedFraction(window).fraction;
  return null;
}

function satisfies(actual, target, direction) {
  if (direction === 'increase') return actual >= target;
  return actual <= target;
}

export function verifyPredictions(pairs, history, { now = Date.now() } = {}) {
  const list = Array.isArray(history) ? history : [];
  const byAgent = groupByAgent(Array.isArray(pairs) ? pairs : []);
  const results = [];
  for (const entry of list) {
    if (!entry || entry.action !== 'approved') continue;
    const prediction = entry.expected_improvement;
    if (!prediction || typeof prediction !== 'object') continue;
    const windowN = Number(prediction.window_n);
    if (!Number.isFinite(windowN) || windowN <= 0) continue;
    const approvalTs = new Date(entry.ts).getTime();
    if (!Number.isFinite(approvalTs)) continue;
    const signature = prediction.signature ?? entry.signature;
    const agentPairs = byAgent[signature] || [];
    const post = agentPairs.filter((p) => {
      const t = new Date(p.start?.ts).getTime();
      return Number.isFinite(t) && t > approvalTs && t <= now;
    });
    if (post.length < windowN) continue;
    const window = post
      .slice()
      .sort((a, b) => new Date(a.start.ts) - new Date(b.start.ts))
      .slice(0, windowN);
    const actual = metricValue(prediction.metric, window);
    if (actual == null) continue;
    const met = satisfies(actual, Number(prediction.target), prediction.direction);
    results.push({
      rule_id: entry.rule_id,
      signature: entry.signature,
      metric: prediction.metric,
      predicted_target: Number(prediction.target),
      actual,
      met,
      direction: prediction.direction,
      ts: entry.ts,
    });
  }
  return results;
}
