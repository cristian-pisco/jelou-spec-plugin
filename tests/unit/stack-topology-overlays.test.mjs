import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildTopologyOverlays } from '../../bin/lib/dev-orchestrator/stack/wiring.mjs';

function service({ id, runtime, peers = {}, host, internal = 8080, policy = 'task-isolated' }) {
  return {
    id,
    policy,
    peers,
    topology: runtime === 'host'
      ? { runtime: 'host', host: 'localhost', container: null }
      : { runtime: 'container', host: 'localhost', container: { service: 'app', network: 'app-network' } },
    ports: [{ host, internal, primary: true }],
  };
}

describe('buildTopologyOverlays', () => {
  test('a mixed graph gives every consumer a URL reachable through its runtime topology', () => {
    const peers = { 'host-provider': 'HOST_URL', 'docker-provider': 'DOCKER_URL' };
    const overlays = buildTopologyOverlays({
      slug: 'task-a',
      services: [
        service({ id: 'host-consumer', runtime: 'host', peers, host: 4301 }),
        service({ id: 'docker-consumer', runtime: 'container', peers, host: 4302 }),
        service({ id: 'host-provider', runtime: 'host', host: 4101 }),
        service({ id: 'docker-provider', runtime: 'container', host: 4201 }),
      ],
    });

    assert.equal(overlays.get('host-consumer').content, 'DOCKER_URL=http://localhost:4201\nHOST_URL=http://localhost:4101\n');
    assert.equal(overlays.get('docker-consumer').content, 'DOCKER_URL=http://docker-provider-task-a:8080\nHOST_URL=http://host.docker.internal:4101\n');
  });

  test('provider mapping rejects missing and ambiguous providers with actionable candidates', () => {
    const missing = [
      service({ id: 'consumer-a', runtime: 'host', peers: { absent: 'API_URL' }, host: 4301 }),
    ];
    assert.throws(
      () => buildTopologyOverlays({ slug: 'task-a', services: missing }),
      /consumer-a.*API_URL.*absent.*candidates: none/i,
    );

    const ambiguous = [
      service({ id: 'consumer-b', runtime: 'host', peers: { 'provider-a': 'API_URL', 'provider-b': 'API_URL' }, host: 4301 }),
      service({ id: 'provider-a', runtime: 'host', host: 4101 }),
      service({ id: 'provider-b', runtime: 'container', host: 4201 }),
    ];
    assert.throws(
      () => buildTopologyOverlays({ slug: 'task-a', services: ambiguous }),
      /consumer-b.*API_URL.*candidates: provider-a, provider-b/i,
    );
  });

  test('a shared-reuse provider is addressed by its docker network alias, never by its registry id', () => {
    const overlays = buildTopologyOverlays({
      slug: 'task-a',
      aliasByService: { 'auth-service': 'jelou-auth-service' },
      services: [
        service({ id: 'gateway', runtime: 'container', peers: { 'auth-service': 'AUTH_URL' }, host: 4302 }),
        service({ id: 'auth-service', runtime: 'container', host: 8229, policy: 'shared-reuse' }),
      ],
    });

    assert.equal(overlays.get('gateway').content, 'AUTH_URL=http://jelou-auth-service:8080\n');
  });

  test('an entry-carried networkAlias wins over the alias map', () => {
    const provider = service({ id: 'chatbot-server', runtime: 'container', host: 9090, policy: 'shared-reuse' });
    const overlays = buildTopologyOverlays({
      slug: 'task-a',
      aliasByService: { 'chatbot-server': 'wrong' },
      services: [
        service({ id: 'gateway', runtime: 'container', peers: { 'chatbot-server': 'CHATBOT_SERVER_URL' }, host: 4302 }),
        { ...provider, networkAlias: 'chatbot_server' },
      ],
    });

    assert.equal(overlays.get('gateway').content, 'CHATBOT_SERVER_URL=http://chatbot_server:8080\n');
  });

  test('a GRPC_ variable gets the provider gRPC port and no http scheme', () => {
    const provider = service({ id: 'auth-service', runtime: 'container', host: 8229, policy: 'shared-reuse' });
    provider.ports.push({ host: 50051, internal: 50051, portEnv: 'GRPC_PORT', primary: false });
    provider.ports[0].portEnv = 'APP_PORT';
    const overlays = buildTopologyOverlays({
      slug: 'task-a',
      aliasByService: { 'auth-service': 'jelou-auth-service' },
      services: [
        service({ id: 'gateway', runtime: 'container', peers: { 'auth-service': 'GRPC_AUTH_SERVER_URL' }, host: 4302 }),
        provider,
      ],
    });

    assert.equal(overlays.get('gateway').content, 'GRPC_AUTH_SERVER_URL=jelou-auth-service:50051\n');
  });

  test('a host consumer reaching a gRPC provider still drops the http scheme', () => {
    const provider = service({ id: 'auth-service', runtime: 'container', host: 8229, policy: 'shared-reuse' });
    provider.ports.push({ host: 50051, internal: 50051, portEnv: 'GRPC_PORT', primary: false });
    const overlays = buildTopologyOverlays({
      slug: 'task-a',
      services: [
        service({ id: 'cli', runtime: 'host', peers: { 'auth-service': 'GRPC_AUTH_SERVER_URL' }, host: 4302 }),
        provider,
      ],
    });

    assert.equal(overlays.get('cli').content, 'GRPC_AUTH_SERVER_URL=localhost:50051\n');
  });

  test('a consumer with no routed variables receives no overlay', () => {
    const overlays = buildTopologyOverlays({
      slug: 'task-a',
      services: [service({ id: 'consumer', runtime: 'host', host: 4301 })],
    });
    assert.equal(overlays.has('consumer'), false);
  });
});
