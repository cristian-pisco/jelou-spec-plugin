import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { containerNameFromCompose, createRunningNameResolver, parseRunningContainerNames, resolveNetworkAlias } from '../../bin/lib/dev-orchestrator/stack/resolve-network-alias.mjs';

const COMPOSE = `services:
    app:
        container_name: jelou-auth-service
        build:
            context: .
        ports:
            - "8229:8080"
    worker:
        container_name: jelou-auth-worker
`;

describe('containerNameFromCompose', () => {
  test('reads the container_name of the requested compose service', () => {
    assert.equal(containerNameFromCompose(COMPOSE, 'app'), 'jelou-auth-service');
    assert.equal(containerNameFromCompose(COMPOSE, 'worker'), 'jelou-auth-worker');
  });

  test('a service without container_name yields null rather than a neighbour name', () => {
    assert.equal(containerNameFromCompose('services:\n  app:\n    image: x\n  other:\n    container_name: taken\n', 'app'), null);
  });

  test('an unknown service yields null', () => {
    assert.equal(containerNameFromCompose(COMPOSE, 'absent'), null);
  });
});

describe('resolveNetworkAlias', () => {
  test('the network name is the container_name, not the registry service id', () => {
    assert.equal(resolveNetworkAlias({ composeText: COMPOSE, composeService: 'app' }), 'jelou-auth-service');
  });

  test('a declared alias wins over anything read from the compose file', () => {
    assert.equal(resolveNetworkAlias({ composeText: COMPOSE, composeService: 'app', declaredAlias: 'explicit' }), 'explicit');
  });

  test('without a container_name the compose service name is the docker default alias', () => {
    assert.equal(resolveNetworkAlias({ composeText: 'services:\n  app:\n    image: x\n', composeService: 'app' }), 'app');
  });
});

const DOCKER_PS = [
  JSON.stringify({ Names: 'api-gateway-service-app-1', Labels: 'com.docker.compose.project=api-gateway-service,com.docker.compose.service=app,com.docker.compose.project.working_dir=/repos/api-gateway-service' }),
  JSON.stringify({ Names: 'workflows-service-app-1', Labels: 'com.docker.compose.service=app,com.docker.compose.project.working_dir=/repos/workflows-service' }),
  'not json',
].join('\n');

describe('running container names', () => {
  test('two compose projects that both name their service "app" stay distinguishable', () => {
    const index = parseRunningContainerNames(DOCKER_PS);

    assert.equal(index.get('/repos/api-gateway-service|app'), 'api-gateway-service-app-1');
    assert.equal(index.get('/repos/workflows-service|app'), 'workflows-service-app-1');
  });

  test('the running name is read once and reused for every service', () => {
    let calls = 0;
    const resolve = createRunningNameResolver({ run: () => { calls += 1; return { status: 0, stdout: DOCKER_PS }; } });

    assert.equal(resolve({ cwd: '/repos/api-gateway-service', composeService: 'app' }), 'api-gateway-service-app-1');
    assert.equal(resolve({ cwd: '/repos/workflows-service', composeService: 'app' }), 'workflows-service-app-1');
    assert.equal(calls, 1);
  });

  test('a compose service named "app" resolves to the running container, never to the ambiguous "app" alias', () => {
    const alias = resolveNetworkAlias({ composeText: 'services:\n  app:\n    image: x\n', composeService: 'app', runningName: 'workflows-service-app-1' });

    assert.equal(alias, 'workflows-service-app-1');
  });

  test('a stopped container falls back to the compose service name rather than nothing', () => {
    assert.equal(resolveNetworkAlias({ composeText: 'services:\n  app:\n    image: x\n', composeService: 'app', runningName: null }), 'app');
  });
});
