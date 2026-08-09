// tests/unit/boot-engine-host-map.test.mjs
//
// Run: `node --test tests/unit/boot-engine-host-map.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { hostByService, parsePublishedPort } from '../../bin/lib/boot-engine/host-map.mjs';

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

describe('hostByService — published ports for shared-reuse', () => {
  const registry = {
    services: [
      { id: 'jelou-api', dev: { port_env: 'APP_PORT', ports: { APP_PORT: 8080 }, docker: { compose_file: 'docker-compose.yml', service: 'app' } } },
      { id: 'dashboard-server', dev: { port_env: 'APP_PORT', ports: { APP_PORT: 8080 }, docker: { compose_file: 'docker-compose.yml', service: 'app' } } }
    ]
  };
  const plan = {
    services: [
      { id: 'jelou-api', policy: 'shared-reuse', cwd: '/repo/jelou-api' },
      { id: 'dashboard-server', policy: 'shared-reuse', cwd: '/repo/dashboard-server' }
    ]
  };

  test('the published host port wins over the registry internal port', () => {
    const out = hostByService({ plan, registry, publishedPort: ({ cwd }) => (cwd === '/repo/jelou-api' ? 8383 : 8484) });
    assert.deepEqual(out.hostByService, { 'jelou-api': 8383, 'dashboard-server': 8484 });
    assert.deepEqual(out.unresolved, []);
    assert.deepEqual(out.occupied.sort(), [8383, 8484]);
  });

  test('a container that is not running falls back to the internal port and is reported unresolved', () => {
    const out = hostByService({ plan, registry, publishedPort: () => null });
    assert.deepEqual(out.hostByService, { 'jelou-api': 8080, 'dashboard-server': 8080 });
    assert.deepEqual(out.unresolved, ['jelou-api', 'dashboard-server']);
  });

  test('ports already published on the host are carried into occupied', () => {
    const out = hostByService({ plan, registry, publishedPort: () => null, occupiedOnHost: [3100, 3101] });
    assert.deepEqual(out.occupied, [3100, 3101]);
  });
});

describe('parsePublishedPort', () => {
  test('reads the port off a docker compose port line', () => {
    assert.equal(parsePublishedPort('0.0.0.0:8383\n'), 8383);
    assert.equal(parsePublishedPort('[::]:8383'), 8383);
  });

  test('empty or malformed output yields null', () => {
    assert.equal(parsePublishedPort(''), null);
    assert.equal(parsePublishedPort('\n\n'), null);
    assert.equal(parsePublishedPort('0.0.0.0:notaport'), null);
  });
});
