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

  test('a consumer with no routed variables receives no overlay', () => {
    const overlays = buildTopologyOverlays({
      slug: 'task-a',
      services: [service({ id: 'consumer', runtime: 'host', host: 4301 })],
    });
    assert.equal(overlays.has('consumer'), false);
  });
});
