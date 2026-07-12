import { FAILURE_MODE } from './schema.mjs';

const VERIFICATION_ROLES = new Set(['qa-agent', 'test-writer', 'spec-reviewer']);
const SPEC_ROLES = new Set(['spec-interviewer', 'proposal-agent']);
const EXECUTION_ROLES = new Set(['implementer', 'build-validator', 'refactor-agent']);
const COORDINATION_PATTERN = /coordinat|handoff|dependency|blocked_on|deadlock|contention|orphan/i;
const DECISIVE_STATUS = new Set(['blocked', 'failed', 'orphaned']);

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase().replace(/^jlu-/, '');
}

export function classifyFailureMode({ name, agent_role, escalation_reason } = {}) {
  if (escalation_reason && COORDINATION_PATTERN.test(String(escalation_reason))) {
    return FAILURE_MODE.COORDINATION;
  }
  const role = normalizeRole(agent_role);
  if (VERIFICATION_ROLES.has(role)) return FAILURE_MODE.VERIFICATION;
  if (SPEC_ROLES.has(role)) return FAILURE_MODE.SPEC;
  if (EXECUTION_ROLES.has(role)) return FAILURE_MODE.EXECUTION;
  return FAILURE_MODE.UNKNOWN;
}

export function earliestDecisiveFailure(tracePairs) {
  const list = Array.isArray(tracePairs) ? tracePairs : [];
  let best = null;
  let bestTs = Infinity;
  for (const p of list) {
    if (!p || !p.end || !DECISIVE_STATUS.has(p.end.status)) continue;
    const parsed = new Date(p.start?.ts).getTime();
    const ts = Number.isFinite(parsed) ? parsed : Infinity;
    if (ts < bestTs) {
      bestTs = ts;
      best = p;
    }
  }
  return best;
}
