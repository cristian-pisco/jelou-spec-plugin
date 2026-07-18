// tests/unit/stack-observer-runtime.test.mjs
//
// Run: `node --test tests/unit/stack-observer-runtime.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildObserverServices, runObserverPass } from '../../bin/lib/dev-orchestrator/stack/observer-runtime.mjs';

describe('buildObserverServices', () => {
  test('maps each plan entry to its name + docker log-source args', () => {
    const plan = [
      { name: 'jelou-api', projectName: 'jelou-api-t', mode: 'exec' },
      { name: 'agent-harness-service', projectName: 'agent-harness-service-t', mode: 'start' }
    ];
    const out = buildObserverServices(plan, { tailLines: 200 });
    assert.deepEqual(out, [
      { name: 'jelou-api', args: ['exec', 'jelou-api-t', 'tail', '-n', '200', '/tmp/jelou-api-t.dev.log'] },
      { name: 'agent-harness-service', args: ['logs', '--tail', '200', 'agent-harness-service-t'] }
    ]);
  });
});

describe('runObserverPass', () => {
  test('does not re-emit an unchanged failing line across passes with retained prevCaptures', () => {
    const events = [];
    const prevCaptures = {};
    const cooldown = { allow: () => false };
    const config = { services: [{ name: 'api' }] };
    const plan = [{ name: 'api', projectName: 'api-t', mode: 'start' }];
    const run = () => ({ stdout: 'boom ECONNREFUSED 127.0.0.1:6379' });
    const appendEventFn = (_path, evt) => events.push(evt);
    const opts = { plan, config, workspaceId: 'w', slug: 's', run, cooldown, prevCaptures, appendEventFn };
    runObserverPass(opts);
    runObserverPass(opts);
    assert.equal(events.filter((e) => e.type === 'pattern_match').length, 1);
  });
});
