// tests/unit/registry-normalize.test.mjs
//
// Run: `node --test tests/unit/registry-normalize.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeRegistry } from '../../bin/lib/registry/normalize.mjs';

const resolve = (p) => (p.startsWith('/') ? p : '/ws/' + p.replace(/^\.\.\//, ''));

describe('normalizeRegistry', () => {
  test('services map -> array with resolved path, mapped dev block, peers', () => {
    const raw = {
      base_port: 3100,
      compose_network_alias: 'app-network',
      services: {
        'jelou-api': {
          path: '../jelou-api',
          stack: 'nestjs',
          peers: { 'chatbot-server': 'CHATBOT_SERVER_URL' },
          dev: { launcher: 'docker-exec', command: 'yarn start:dev', port_env: 'APP_PORT', extra_ports: ['SUPERVISOR_PORT'] }
        }
      }
    };
    const out = normalizeRegistry(raw, { resolve });
    assert.deepEqual(out.network, { composeNetworkAlias: 'app-network', basePort: 3100 });
    assert.equal(out.services.length, 1);
    assert.deepEqual(out.services[0], {
      id: 'jelou-api',
      path: '/ws/jelou-api',
      stack: 'nestjs',
      peers: { 'chatbot-server': 'CHATBOT_SERVER_URL' },
      depends_on: [],
      dev: { launcher: 'docker-exec', command: 'yarn start:dev', port_env: 'APP_PORT', extra_ports: ['SUPERVISOR_PORT'] }
    });
  });

  test('absorbs and resolves auth + frontend', () => {
    const raw = {
      services: {},
      auth: { cookieName: 'jelou_auth', dashboardService: 'dashboard-server', verify: { 'jelou-api': '/v1/company' } },
      frontend: { path: '../jelou-apps', command: 'yarn start', port: 5175, envLocal: { NX_A: { service: 'jelou-api', suffix: '' } } }
    };
    const out = normalizeRegistry(raw, { resolve });
    assert.equal(out.auth.cookieName, 'jelou_auth');
    assert.deepEqual(out.auth.verify, { 'jelou-api': '/v1/company' });
    assert.equal(out.frontend.path, '/ws/jelou-apps');
    assert.deepEqual(out.frontend.envLocal, { NX_A: { service: 'jelou-api', suffix: '' } });
  });

  test('defaults: no auth/frontend -> null; missing peers/depends_on/extra_ports -> empty', () => {
    const out = normalizeRegistry({ services: { a: { path: '../a', dev: { launcher: 'npm' } } } }, { resolve });
    assert.equal(out.auth, null);
    assert.equal(out.frontend, null);
    assert.deepEqual(out.services[0].peers, {});
    assert.deepEqual(out.services[0].depends_on, []);
    assert.deepEqual(out.services[0].dev.extra_ports, []);
  });
});
