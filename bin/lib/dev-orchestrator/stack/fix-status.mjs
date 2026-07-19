const RERUN_OK = new Set(['DONE', 'DONE_WITH_CONCERNS']);

export function parseFixStatus(line) {
  const m = String(line || '').match(/STATUS:\s*([A-Za-z_]+)/i);
  const status = m ? m[1].toUpperCase() : 'UNKNOWN';
  const reason = (String(line || '').match(/reason=([A-Za-z0-9_]+)/) || [])[1] || null;
  return { status, reason };
}

export function nextAction({ status, attempt, maxAttempts }) {
  if (!RERUN_OK.has(status)) return 'escalate';
  if (attempt >= maxAttempts) return 'escalate';
  return 'rerun';
}
