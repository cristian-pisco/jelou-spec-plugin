// tests/unit/boot-engine-host-map.test.mjs
//
// Run: `node --test tests/unit/boot-engine-host-map.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { hostByService } from '../../bin/lib/boot-engine/host-map.mjs';

function registry() {
  return {
    services: [
      { id: 'jelou-api', dev: { port_env: 'APP_PORT', ports: { APP_PORT: 8080 } } },
      { id: 'dashboard-server', dev: { port_env: 'PORT', ports: { PORT: 8484 } } }
    ]
  };
}

describe('hostByService', () => {
  test('task-isolated -> allocated primary host (and all ports occupied); shared-reuse -> normal dev port (not occupied)', () => {
    const plan = {
      services: [
        { id: 'jelou-api', policy: 'task-isolated', ports: [
          { internal: 8080, host: 3100, portEnv: 'APP_PORT', primary: true },
          { internal: 9001, host: 3101, portEnv: 'SUPERVISOR_PORT', primary: false }
        ] },
        { id: 'dashboard-server', policy: 'shared-reuse' }
      ]
    };
    const out = hostByService({ plan, registry: registry() });
    assert.deepEqual(out.hostByService, { 'jelou-api': 3100, 'dashboard-server': 8484 });
    assert.deepEqual(out.occupied.sort((a, b) => a - b), [3100, 3101]);
  });

  test('all shared-reuse -> empty occupied', () => {
    const plan = { services: [{ id: 'jelou-api', policy: 'shared-reuse' }, { id: 'dashboard-server', policy: 'shared-reuse' }] };
    const out = hostByService({ plan, registry: registry() });
    assert.deepEqual(out.hostByService, { 'jelou-api': 8080, 'dashboard-server': 8484 });
    assert.deepEqual(out.occupied, []);
  });
});
