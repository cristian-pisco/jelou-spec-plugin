// tests/unit/stack-observer-diff.test.mjs
//
// Run: `node --test tests/unit/stack-observer-diff.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { diffAppended } from '../../bin/lib/dev-orchestrator/stack/observer-diff.mjs';

describe('diffAppended', () => {
  test('returns all lines when there is no previous capture', () => {
    assert.deepEqual(diffAppended('', 'a\nb'), ['a', 'b']);
  });

  test('returns only the appended lines when the capture extends the previous', () => {
    assert.deepEqual(diffAppended('a\nb\n', 'a\nb\nc\nd'), ['c', 'd']);
  });

  test('returns the whole capture on rollover (no common prefix)', () => {
    assert.deepEqual(diffAppended('x\ny\n', 'p\nq'), ['p', 'q']);
  });

  test('returns nothing when the capture is unchanged', () => {
    assert.deepEqual(diffAppended('a\nb', 'a\nb'), []);
  });
});
