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
    assert.deepEqual(out.network, { composeNetworkAlias: 'app-network', basePort: 3100, authInjectPort: null });
    assert.equal(out.services.length, 1);
    assert.deepEqual(out.services[0], {
      id: 'jelou-api',
      path: '/ws/jelou-api',
      stack: 'nestjs',
      peers: { 'chatbot-server': 'CHATBOT_SERVER_URL' },
      depends_on: [],
      runtimeMounts: [],
      dev: { launcher: 'docker-exec', command: 'yarn start:dev', port_env: 'APP_PORT', extra_ports: ['SUPERVISOR_PORT'] }
    });
  });

  test('absorbs and resolves auth + frontend', () => {
    const raw = {
      services: {},
      auth: { cookieName: 'jelou_auth', dashboardService: 'dashboard-server', localProvisioningAdapter: '../jelou-api/tools/local-auth.mjs', verify: { 'jelou-api': '/v1/company' } },
      frontend: { path: '../jelou-apps', command: 'yarn start', port: 5175, envLocal: { NX_A: { service: 'jelou-api', suffix: '' } } }
    };
    const out = normalizeRegistry(raw, { resolve });
    assert.equal(out.auth.cookieName, 'jelou_auth');
    assert.equal(out.auth.localProvisioningAdapter, '/ws/jelou-api/tools/local-auth.mjs');
    assert.deepEqual(out.auth.verify, [{ service: 'jelou-api', path: '/v1/company' }]);
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

  test('network carries authInjectPort from auth_inject_port', () => {
    const out = normalizeRegistry({ services: {}, base_port: 3100, auth_inject_port: 7788 }, { resolve });
    assert.equal(out.network.authInjectPort, 7788);
  });

  test('auth.verify map is normalized to an ordered array', () => {
    const raw = { services: {}, auth: { cookieName: 'c', verify: { 'jelou-api': '/v1/company', 'dashboard-server': '/api/v1/auth/me' } } };
    const out = normalizeRegistry(raw, { resolve });
    assert.deepEqual(out.auth.verify, [
      { service: 'jelou-api', path: '/v1/company' },
      { service: 'dashboard-server', path: '/api/v1/auth/me' }
    ]);
  });

  test('auth without verify keeps verify undefined; no authInjectPort -> null', () => {
    const out = normalizeRegistry({ services: {}, auth: { cookieName: 'c' } }, { resolve });
    assert.equal(out.auth.verify, undefined);
    assert.equal(out.network.authInjectPort, null);
  });

  test('carries runtime_mounts as runtimeMounts (default [])', () => {
    const raw = { services: {
      a: { path: '../a', runtime_mounts: ['config/secrets'], dev: { launcher: 'docker-exec' } },
      b: { path: '../b', dev: { launcher: 'docker-exec' } }
    } };
    const reg = normalizeRegistry(raw, { resolve: (p) => p });
    const a = reg.services.find((s) => s.id === 'a');
    const b = reg.services.find((s) => s.id === 'b');
    assert.deepEqual(a.runtimeMounts, ['config/secrets']);
    assert.deepEqual(b.runtimeMounts, []);
  });
});
