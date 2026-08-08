// tests/unit/stack-ports.test.mjs
//
// Run: `node --test tests/unit/stack-ports.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { allocateHostPorts, allocateOwnedPorts, parseListeningPorts, parseOccupiedPorts } from '../../bin/lib/dev-orchestrator/stack/ports.mjs';

describe('allocateHostPorts', () => {
  test('allocates sequentially from basePort', () => {
    const out = allocateHostPorts({ mappings: [{ internal: 8080 }, { internal: 9001 }], occupied: new Set(), basePort: 3100 });
    assert.deepEqual(out, [{ internal: 8080, host: 3100 }, { internal: 9001, host: 3101 }]);
  });

  test('skips occupied host ports', () => {
    const out = allocateHostPorts({ mappings: [{ internal: 8080 }, { internal: 9001 }], occupied: new Set([3100, 3101]), basePort: 3100 });
    assert.deepEqual(out, [{ internal: 8080, host: 3102 }, { internal: 9001, host: 3103 }]);
  });

  test('does not reuse a port within the same allocation', () => {
    const out = allocateHostPorts({ mappings: [{ internal: 8080 }, { internal: 8081 }], occupied: new Set([3101]), basePort: 3100 });
    assert.deepEqual(out, [{ internal: 8080, host: 3100 }, { internal: 8081, host: 3102 }]);
  });

  test('throws when the search would exceed 65535', () => {
    assert.throws(
      () => allocateHostPorts({ mappings: [{ internal: 8080 }], occupied: new Set(), basePort: 65536 }),
      /no free host port/
    );
  });
});

describe('parseOccupiedPorts', () => {
  test('extracts host-bound ports from docker ps output', () => {
    const out = parseOccupiedPorts('0.0.0.0:3100->8080/tcp, 0.0.0.0:5433->5432/tcp');
    assert.equal(out.has(3100), true);
    assert.equal(out.has(5433), true);
    assert.equal(out.has(8080), false);
  });
});

describe('parseListeningPorts', () => {
  test('reports IPv4 and IPv6 listeners with process identity and ignores malformed lines', () => {
    const snapshot = [
      'LISTEN 0 511 127.0.0.1:8080 0.0.0.0:* users:(("node",pid=912,fd=20))',
      'LISTEN 0 4096 [::]:5173 [::]:* users:(("vite",pid=913,fd=24))',
      'not a listener',
    ].join('\n');

    assert.deepEqual(parseListeningPorts(snapshot), [
      { port: 8080, ownerTag: null, pid: 912, command: 'node' },
      { port: 5173, ownerTag: null, pid: 913, command: 'vite' },
    ]);
  });
});

describe('allocateOwnedPorts', () => {
  const requests = [
    { serviceId: 'api-service', portEnv: 'PORT', internal: 8080, primary: true },
    { serviceId: 'jelou-apps', portEnv: 'PORT', internal: 5173, primary: true },
  ];
  const identity = {
    workspaceId: 'workspace-1',
    taskSlug: 'task-a',
    sourceMode: 'task-aware',
  };

  test('main mode preserves every free registered default with owner tags', () => {
    const allocations = allocateOwnedPorts({
      requests,
      workspaceId: identity.workspaceId,
      taskSlug: '_global',
      sourceMode: 'main',
      basePort: 3100,
      persisted: [],
      live: [],
    });

    assert.deepEqual(allocations, [
      {
        ...requests[0],
        host: 8080,
        ownerTag: 'workspace-1:_global:main:api-service:PORT',
      },
      {
        ...requests[1],
        host: 5173,
        ownerTag: 'workspace-1:_global:main:jelou-apps:PORT',
      },
    ]);
  });

  test('another task on a default port produces the same deterministic free alternate', () => {
    const live = [{ port: 8080, ownerTag: 'workspace-1:other-task:task-aware:api-service:PORT', pid: 44 }];
    const first = allocateOwnedPorts({ ...identity, requests: [requests[0]], basePort: 3100, persisted: [], live });
    const second = allocateOwnedPorts({ ...identity, requests: [requests[0]], basePort: 3100, persisted: [], live });

    assert.deepEqual(second, first);
    assert.notEqual(first[0].host, 8080);
    assert.ok(first[0].host >= 3100 && first[0].host <= 65535);
  });

  test('a subsequent start reuses its persisted free allocation', () => {
    const ownerTag = 'workspace-1:task-a:task-aware:api-service:PORT';
    const persisted = [{ ...requests[0], host: 43210, ownerTag }];
    const allocations = allocateOwnedPorts({
      ...identity,
      requests: [requests[0]],
      basePort: 3100,
      persisted,
      live: [{ port: 43210, ownerTag, pid: 55 }],
    });

    assert.deepEqual(allocations, persisted);
  });

  test('an unrelated live process on a persisted port stops allocation and is preserved', () => {
    const ownerTag = 'workspace-1:task-a:task-aware:api-service:PORT';
    const persisted = [{ ...requests[0], host: 43210, ownerTag }];
    const unrelated = { port: 43210, ownerTag: null, pid: 912, command: 'python local-server.py' };
    const before = structuredClone(unrelated);

    assert.throws(
      () => allocateOwnedPorts({
        ...identity,
        requests: [requests[0]],
        basePort: 3100,
        persisted,
        live: [unrelated],
      }),
      /api-service.*43210.*unrelated.*912/i,
    );
    assert.deepEqual(unrelated, before);
  });
});
