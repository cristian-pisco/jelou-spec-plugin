// tests/unit/stack-task-stack.test.mjs
//
// Run: `node --test tests/unit/stack-task-stack.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildTaskStack } from '../../bin/lib/dev-orchestrator/stack/task-stack.mjs';

const stack = {
  network: 'net',
  composeNetworkAlias: 'app-network',
  basePort: 3100,
  services: [
    { name: 'svc-a', path: '/repo/a', command: 'yarn dev', mode: 'exec', compose_file: 'docker-compose.yml', compose_service: 'app', port_mappings: [{ internal: 8080, port_env: 'APP_PORT', primary: true }], readiness: { type: 'http', url: 'http://localhost:8080/' }, peers: { 'svc-b': 'SVC_B_URL' } },
    { name: 'svc-b', path: '/repo/b', command: 'yarn dev', mode: 'exec', compose_file: 'docker-compose.yml', compose_service: 'app', port_mappings: [{ internal: 8080, port_env: 'APP_PORT', primary: true }], readiness: { type: 'http', url: 'http://localhost:8081/' }, peers: {} }
  ]
};

describe('buildTaskStack', () => {
  test('produces an entry per service with cwd, ports, override and wired env', () => {
    const worktreePaths = { 'svc-b': '/repo/b/.worktrees/task-x' };
    const readEnv = (svc) => svc.name === 'svc-a' ? 'FOO=bar\nSVC_B_URL=http://svc-b:8080\n' : 'FOO=bar\n';
    const plan = buildTaskStack({ stack, slug: 'task-x', worktreePaths, occupied: new Set(), readEnv });

    assert.equal(plan.length, 2);
    const a = plan.find(p => p.name === 'svc-a');
    const b = plan.find(p => p.name === 'svc-b');

    assert.equal(a.cwd, '/repo/a');
    assert.equal(b.cwd, '/repo/b/.worktrees/task-x');

    assert.deepEqual(a.ports, [{ internal: 8080, host: 3100, portEnv: 'APP_PORT', primary: true }]);
    assert.deepEqual(b.ports, [{ internal: 8080, host: 3101, portEnv: 'APP_PORT', primary: true }]);
    assert.deepEqual(a.readiness, { type: 'http', url: 'http://localhost:8080/' });

    assert.equal(a.projectName, 'svc-a-task-x');
    assert.equal(a.command, 'yarn dev');
    assert.ok(a.overrideYaml.includes('container_name: svc-a-task-x'));
    assert.ok(a.wiredEnv.includes('SVC_B_URL=http://svc-b-task-x:8080'));
    assert.equal(b.wiredEnv, 'FOO=bar\n');
  });

  test('allocates non-overlapping host ports across the whole stack', () => {
    const plan = buildTaskStack({ stack, slug: 't', worktreePaths: {}, occupied: new Set(), readEnv: () => '' });
    const hosts = plan.flatMap(p => p.ports.map(x => x.host));
    assert.equal(new Set(hosts).size, hosts.length);
  });

  test('threads baseImages into the rendered override', () => {
    const stack = {
      basePort: 3100,
      composeNetworkAlias: 'app-network',
      services: [
        { name: 'jelou-api', compose_service: 'app', mode: 'exec', compose_file: 'docker-compose.yml', path: '/repo/api', port_mappings: [{ internal: 8080, port_env: 'APP_PORT', primary: true }], peers: {} }
      ]
    };
    const plan = buildTaskStack({ stack, slug: 't1', worktreePaths: {}, occupied: new Set(), readEnv: () => '', baseImages: { 'jelou-api': 'jelou-api-app' } });
    assert.ok(plan[0].overrideYaml.includes('    image: jelou-api-app'));
    assert.ok(plan[0].overrideYaml.includes('    entrypoint: ["sleep", "infinity"]'));
  });

  test('baseImages defaults to empty (no image line) without breaking', () => {
    const stack = {
      basePort: 3100,
      composeNetworkAlias: 'app-network',
      services: [
        { name: 'jelou-api', compose_service: 'app', mode: 'exec', compose_file: 'docker-compose.yml', path: '/repo/api', port_mappings: [{ internal: 8080, port_env: 'APP_PORT', primary: true }], peers: {} }
      ]
    };
    const plan = buildTaskStack({ stack, slug: 't1', worktreePaths: {}, occupied: new Set(), readEnv: () => '' });
    assert.ok(!plan[0].overrideYaml.includes('image:'));
  });
});
