// tests/unit/stack-peer-warn.test.mjs
//
// Run: `node --test tests/unit/stack-peer-warn.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { missingPeerVars } from '../../bin/lib/dev-orchestrator/stack/peer-warn.mjs';

describe('missingPeerVars', () => {
  test('flags declared peer vars absent from the env text', () => {
    const envText = 'FOO=1\nCHATBOT_SERVER_URL=http://x\n';
    const peers = { 'chatbot-server': 'CHATBOT_SERVER_URL', 'billing': 'BILLING_URL' };
    assert.deepEqual(missingPeerVars({ envText, peers }), ['BILLING_URL']);
  });

  test('none missing when all present; empty peers is empty', () => {
    assert.deepEqual(missingPeerVars({ envText: 'A=1\nB=2', peers: { x: 'A', y: 'B' } }), []);
    assert.deepEqual(missingPeerVars({ envText: '', peers: {} }), []);
  });
});
