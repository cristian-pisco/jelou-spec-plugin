// tests/unit/trace-failure.test.mjs
//
// Run: `node --test tests/unit/trace-failure.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  classifyFailureMode,
  earliestDecisiveFailure,
  RETIRED_VERIFICATION_ROLES,
} from '../../bin/lib/trace/failure.mjs';
import { FAILURE_MODE } from '../../bin/lib/trace/schema.mjs';

describe('classifyFailureMode', () => {
  test('verification roles map to verification', () => {
    for (const role of ['qa-agent', 'test-writer', 'spec-reviewer', 'jlu-qa-agent']) {
      assert.equal(classifyFailureMode({ agent_role: role }), FAILURE_MODE.VERIFICATION);
    }
  });

  test('retired verification roles stay classifiable for historical spans only', () => {
    assert.deepEqual([...RETIRED_VERIFICATION_ROLES].sort(), ['qa-agent', 'spec-reviewer']);
    for (const role of RETIRED_VERIFICATION_ROLES) {
      assert.equal(classifyFailureMode({ agent_role: role }), FAILURE_MODE.VERIFICATION);
      assert.equal(classifyFailureMode({ agent_role: `jlu-${role}` }), FAILURE_MODE.VERIFICATION);
    }
  });

  test('spec roles map to spec', () => {
    for (const role of ['spec-interviewer', 'proposal-agent', 'jlu-proposal-agent']) {
      assert.equal(classifyFailureMode({ agent_role: role }), FAILURE_MODE.SPEC);
    }
  });

  test('execution roles map to execution', () => {
    for (const role of ['implementer', 'build-validator', 'refactor-agent']) {
      assert.equal(classifyFailureMode({ agent_role: role }), FAILURE_MODE.EXECUTION);
    }
  });

  test('coordination escalation_reason maps to coordination', () => {
    assert.equal(
      classifyFailureMode({ name: 'phase', escalation_reason: 'coordination' }),
      FAILURE_MODE.COORDINATION,
    );
    assert.equal(
      classifyFailureMode({ agent_role: 'implementer', escalation_reason: 'blocked_on dependency' }),
      FAILURE_MODE.COORDINATION,
    );
  });

  test('unknown role and no signal maps to unknown', () => {
    assert.equal(classifyFailureMode({ agent_role: 'mystery-agent' }), FAILURE_MODE.UNKNOWN);
    assert.equal(classifyFailureMode({}), FAILURE_MODE.UNKNOWN);
  });
});

describe('earliestDecisiveFailure', () => {
  function pair(span_id, ts, status, extra = {}) {
    return {
      start: { span_id, trace_id: 'T', name: 'agent_dispatch', ts, ...extra },
      end: { span_id, status, ts },
      duration_ms: 1000,
    };
  }

  test('returns the earliest blocked/failed/orphaned pair by start.ts', () => {
    const pairs = [
      pair('C', '2026-07-11T10:03:00Z', 'failed'),
      pair('A', '2026-07-11T10:01:00Z', 'blocked'),
      pair('B', '2026-07-11T10:02:00Z', 'orphaned'),
    ];
    const p = earliestDecisiveFailure(pairs);
    assert.equal(p.start.span_id, 'A');
  });

  const wrap = (span_id, name, ts, status, extra = {}) => ({
    start: { span_id, trace_id: 'T', name, ts, ...extra },
    end: { span_id, status, ts, attrs: {} },
    duration_ms: 1000,
  });

  test('excludes the top-level workflow wrapper (blocked as a consequence of children)', () => {
    const pairs = [
      wrap('WS', 'execute_task', '2026-07-11T10:00:00Z', 'blocked'),
      wrap('PH', 'phase', '2026-07-11T10:00:30Z', 'blocked'),
      wrap('IMPL', 'agent_dispatch', '2026-07-11T10:01:00Z', 'failed', { agent_role: 'implementer' }),
    ];
    assert.equal(earliestDecisiveFailure(pairs).start.span_id, 'PH');
  });

  test('attributes to the earliest failed agent when no phase failed', () => {
    const pairs = [
      wrap('WS', 'execute_task', '2026-07-11T10:00:00Z', 'blocked'),
      wrap('IMPL', 'agent_dispatch', '2026-07-11T10:01:00Z', 'failed', { agent_role: 'implementer' }),
      wrap('BUILD', 'agent_dispatch', '2026-07-11T10:02:00Z', 'failed', { agent_role: 'build-validator' }),
    ];
    assert.equal(earliestDecisiveFailure(pairs).start.span_id, 'IMPL');
  });

  test('falls back to a workflow wrapper only when nothing more specific failed', () => {
    const pairs = [wrap('WS', 'execute_task', '2026-07-11T10:00:00Z', 'blocked')];
    assert.equal(earliestDecisiveFailure(pairs).start.span_id, 'WS');
  });

  test('ignores ok spans', () => {
    const pairs = [
      pair('OK', '2026-07-11T09:00:00Z', 'ok'),
      pair('BAD', '2026-07-11T10:00:00Z', 'failed'),
    ];
    assert.equal(earliestDecisiveFailure(pairs).start.span_id, 'BAD');
  });

  test('returns null when no decisive failure present', () => {
    const pairs = [pair('OK', '2026-07-11T09:00:00Z', 'ok')];
    assert.equal(earliestDecisiveFailure(pairs), null);
    assert.equal(earliestDecisiveFailure([]), null);
  });
});
