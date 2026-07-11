// bin/lib/trace/cost.mjs
//
// Best-effort USD cost derivation for the tracing system. Stdlib only, no I/O.
//
// Prices are USD per 1,000,000 tokens, keyed by Claude tier. They drift over
// time and are approximate — cost is an advisory signal, never a billing
// source of truth. Override the table by passing a `prices` argument or by
// editing this constant. Unknown models return null (distinct from a genuine
// zero) so callers can tell "no price known" apart from "free".

export const PRICES = Object.freeze({
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.8, output: 4 },
});

export function normalizeModel(model) {
  if (!model || typeof model !== 'string') return null;
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return null;
}

export function deriveCost(model, tokensIn, tokensOut, prices = PRICES) {
  const tier = normalizeModel(model);
  if (!tier || !prices[tier]) return null;
  if (tokensIn == null || tokensOut == null) return null;
  const ti = Number(tokensIn);
  const to = Number(tokensOut);
  if (!Number.isFinite(ti) || !Number.isFinite(to)) return null;
  const cost = (ti / 1e6) * prices[tier].input + (to / 1e6) * prices[tier].output;
  return Number(cost.toFixed(6));
}
