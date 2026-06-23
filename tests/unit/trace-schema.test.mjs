// tests/unit/trace-schema.test.mjs
//
// Run: `node --test tests/unit/trace-schema.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  EVENT_KIND,
  STATUS,
  SCOPE,
  SPAN_NAMES,
  PAYLOAD_CAP_BYTES,
  RECONCILE_AFTER_MS,
} from '../../bin/lib/trace/schema.mjs';

describe('schema constants are frozen and stable', () => {
  test('EVENT_KIND has exactly the three documented kinds', () => {
    assert.deepEqual(
      Object.keys(EVENT_KIND).sort(),
      ['EVENT', 'SPAN_END', 'SPAN_START']
    );
    assert.equal(EVENT_KIND.SPAN_START, 'span_start');
    assert.equal(EVENT_KIND.SPAN_END, 'span_end');
    assert.equal(EVENT_KIND.EVENT, 'event');
  });

  test('STATUS includes ok / blocked / failed / escalated / orphaned', () => {
    assert.equal(STATUS.OK, 'ok');
    assert.equal(STATUS.BLOCKED, 'blocked');
    assert.equal(STATUS.FAILED, 'failed');
    assert.equal(STATUS.ESCALATED, 'escalated');
    assert.equal(STATUS.ORPHANED, 'orphaned');
  });

  test('SCOPE includes task / daemon / global', () => {
    assert.deepEqual(
      Object.values(SCOPE).sort(),
      ['daemon', 'global', 'task']
    );
  });

  test('SPAN_NAMES includes canonical workflow names', () => {
    for (const name of ['execute_task', 'new_task', 'refine_task', 'ship',
                        'report_task', 'close_task', 'phase', 'agent_dispatch']) {
      assert.ok(Object.values(SPAN_NAMES).includes(name),
        `SPAN_NAMES missing ${name}`);
    }
  });

  test('PAYLOAD_CAP_BYTES is 3500 (below PIPE_BUF 4096)', () => {
    assert.equal(PAYLOAD_CAP_BYTES, 3500);
  });

  test('RECONCILE_AFTER_MS defaults to 30 minutes', () => {
    assert.equal(RECONCILE_AFTER_MS, 30 * 60 * 1000);
  });

  test('all exports are frozen (no runtime mutation)', () => {
    assert.ok(Object.isFrozen(EVENT_KIND));
    assert.ok(Object.isFrozen(STATUS));
    assert.ok(Object.isFrozen(SCOPE));
    assert.ok(Object.isFrozen(SPAN_NAMES));
  });
});
