import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { rewriteE2eEnv, unresolvedServices, manageableEnvLocal, E2E_ENV_FILE } from '../../bin/lib/dev-orchestrator/stack/e2e-env.mjs';
import { hostByService } from '../../bin/lib/boot-engine/host-map.mjs';

const ENV_LOCAL = {
  NX_REACT_APP_API_GATEWAY_BASE_URL: { service: 'api-gateway-service', suffix: '' },
  NX_REACT_APP_DASHBOARD_SERVER_BASE: { service: 'dashboard-server', suffix: '/api' }
};

const HOSTS = { 'api-gateway-service': 3103, 'dashboard-server': 8484 };

describe('rewriteE2eEnv points the frontend at the task-isolated backend', () => {
  test('rewrites a stale host and preserves every unmanaged line', () => {
    const input = [
      'E2E_USER_EMAIL=someone@example.com',
      'NX_REACT_APP_API_GATEWAY_BASE_URL=http://localhost:3102',
      'SOME_TOKEN=abc123',
      ''
    ].join('\n');
    const { text, managed } = rewriteE2eEnv({ envText: input, envLocal: ENV_LOCAL, hostByService: HOSTS });
    assert.match(text, /NX_REACT_APP_API_GATEWAY_BASE_URL=http:\/\/localhost:3103\n/);
    assert.match(text, /E2E_USER_EMAIL=someone@example\.com/);
    assert.match(text, /SOME_TOKEN=abc123/);
    assert.match(text, /NX_REACT_APP_DASHBOARD_SERVER_BASE=http:\/\/localhost:8484\/api/);
    assert.equal(managed.NX_REACT_APP_API_GATEWAY_BASE_URL, 'http://localhost:3103');
  });

  test('the reported managed map never carries an unmanaged secret', () => {
    const { managed } = rewriteE2eEnv({
      envText: 'E2E_USER_PASSWORD=hunter2\n',
      envLocal: ENV_LOCAL,
      hostByService: HOSTS
    });
    assert.deepEqual(Object.keys(managed).sort(), Object.keys(ENV_LOCAL).sort());
    assert.equal(JSON.stringify(managed).includes('hunter2'), false);
  });

  test('E2E_BASE_URL is only touched when a frontend host is supplied', () => {
    const input = 'E2E_BASE_URL=http://localhost:5173\n';
    const untouched = rewriteE2eEnv({ envText: input, envLocal: ENV_LOCAL, hostByService: HOSTS });
    assert.match(untouched.text, /E2E_BASE_URL=http:\/\/localhost:5173/);
    assert.equal(untouched.managed.E2E_BASE_URL, undefined);

    const wired = rewriteE2eEnv({ envText: input, envLocal: ENV_LOCAL, hostByService: HOSTS, frontendHost: 5175 });
    assert.match(wired.text, /E2E_BASE_URL=http:\/\/localhost:5175/);
  });

  test('refuses rather than writing http://localhost:undefined', () => {
    assert.throws(
      () => rewriteE2eEnv({ envText: '', envLocal: ENV_LOCAL, hostByService: { 'api-gateway-service': 3103 } }),
      /no booted host for: NX_REACT_APP_DASHBOARD_SERVER_BASE -> dashboard-server/
    );
  });

  test('unresolvedServices reports every gap, sorted', () => {
    assert.deepEqual(unresolvedServices({ envLocal: ENV_LOCAL, hostByService: {} }), [
      { key: 'NX_REACT_APP_API_GATEWAY_BASE_URL', service: 'api-gateway-service' },
      { key: 'NX_REACT_APP_DASHBOARD_SERVER_BASE', service: 'dashboard-server' }
    ]);
    assert.deepEqual(unresolvedServices({ envLocal: ENV_LOCAL, hostByService: HOSTS }), []);
  });

  test('the overlay filename is the one the frontend dev block declares', () => {
    assert.equal(E2E_ENV_FILE, '.env.e2e');
  });

  test('manageOnly leaves a shared-reuse URL untouched — its registry port is container-internal', () => {
    const input = [
      'NX_REACT_APP_API_GATEWAY_BASE_URL=http://localhost:3102',
      'NX_REACT_APP_DASHBOARD_SERVER_BASE=http://localhost:8484/api',
      ''
    ].join('\n');
    const { text, managed } = rewriteE2eEnv({
      envText: input,
      envLocal: ENV_LOCAL,
      hostByService: { 'api-gateway-service': 3103, 'dashboard-server': 8080 },
      manageOnly: ['api-gateway-service']
    });
    assert.match(text, /NX_REACT_APP_API_GATEWAY_BASE_URL=http:\/\/localhost:3103\n/);
    assert.match(text, /NX_REACT_APP_DASHBOARD_SERVER_BASE=http:\/\/localhost:8484\/api\n/);
    assert.doesNotMatch(text, /DASHBOARD_SERVER_BASE=http:\/\/localhost:8080/);
    assert.deepEqual(Object.keys(managed), ['NX_REACT_APP_API_GATEWAY_BASE_URL']);
  });

  test('manageOnly narrows the unresolved check to the services it manages', () => {
    assert.deepEqual(
      manageableEnvLocal({ envLocal: ENV_LOCAL, manageOnly: ['dashboard-server'] }),
      { NX_REACT_APP_DASHBOARD_SERVER_BASE: ENV_LOCAL.NX_REACT_APP_DASHBOARD_SERVER_BASE }
    );
    assert.doesNotThrow(() =>
      rewriteE2eEnv({
        envText: '',
        envLocal: ENV_LOCAL,
        hostByService: { 'api-gateway-service': 3103 },
        manageOnly: ['api-gateway-service']
      })
    );
  });
});

describe('end-to-end with a real boot plan: the allocated host wins over the dev port', () => {
  const registry = {
    services: [
      { id: 'api-gateway-service', dev: { port_env: 'APP_PORT', ports: { APP_PORT: 8080, DEBUG_PORT: 9001 } } },
      { id: 'dashboard-server', dev: { port_env: 'APP_PORT', ports: { APP_PORT: 8484 } } }
    ],
    frontend: { envLocal: ENV_LOCAL }
  };
  const plan = {
    services: [
      {
        id: 'api-gateway-service',
        policy: 'task-isolated',
        launcher: 'docker-exec',
        ports: [
          { internal: 8080, host: 3103, primary: true },
          { internal: 9001, host: 3104, primary: false }
        ]
      },
      { id: 'dashboard-server', policy: 'shared-reuse' }
    ]
  };

  test('a task-isolated backend gets its namespaced host, a shared one keeps its dev port', () => {
    const { hostByService: hosts } = hostByService({ plan, registry });
    const { text } = rewriteE2eEnv({
      envText: 'NX_REACT_APP_API_GATEWAY_BASE_URL=http://localhost:8080\n',
      envLocal: registry.frontend.envLocal,
      hostByService: hosts
    });
    assert.match(text, /NX_REACT_APP_API_GATEWAY_BASE_URL=http:\/\/localhost:3103\n/);
    assert.match(text, /NX_REACT_APP_DASHBOARD_SERVER_BASE=http:\/\/localhost:8484\/api\n/);
    assert.doesNotMatch(text, /localhost:3104/);
  });
});
