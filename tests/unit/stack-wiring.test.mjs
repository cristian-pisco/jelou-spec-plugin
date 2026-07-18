// tests/unit/stack-wiring.test.mjs
//
// Run: `node --test tests/unit/stack-wiring.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { wireEnv } from '../../bin/lib/dev-orchestrator/stack/wiring.mjs';

describe('wireEnv', () => {
  const peers = { 'svc-b': 'SVC_B_URL' };
  const peerInternalPort = { 'svc-b': 8080 };

  test('rewrites a peer env var to the task alias URL', () => {
    const input = 'FOO=bar\nSVC_B_URL=http://svc-b:8080\nBAZ=qux\n';
    const out = wireEnv({ envText: input, peers, slug: 'task-x', peerInternalPort });
    assert.equal(out, 'FOO=bar\nSVC_B_URL=http://svc-b-task-x:8080\nBAZ=qux\n');
  });

  test('preserves non-peer lines and blank lines verbatim', () => {
    const input = '\n# comment\nOTHER=1\n';
    const out = wireEnv({ envText: input, peers, slug: 'task-x', peerInternalPort });
    assert.equal(out, input);
  });

  test('leaves an absent peer var untouched (rewrite-only)', () => {
    const out = wireEnv({ envText: 'FOO=bar\n', peers, slug: 'task-x', peerInternalPort });
    assert.equal(out, 'FOO=bar\n');
  });
});
