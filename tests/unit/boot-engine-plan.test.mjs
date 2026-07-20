// tests/unit/boot-engine-plan.test.mjs
//
// Run: `node --test tests/unit/boot-engine-plan.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildBootPlan } from '../../bin/lib/boot-engine/plan.mjs';
import { unmaskWiredEnv } from '../../bin/lib/boot-engine/env-mask.mjs';

function reg() {
  return {
    network: { composeNetworkAlias: 'app-network', basePort: 3100 },
    services: [
      {
        id: 'jelou-api', path: '/repo/jelou-api', stack: 'nestjs', peers: { 'chatbot-server': 'CHATBOT_SERVER_URL' }, depends_on: [],
        dev: { launcher: 'docker-exec', command: 'yarn start:dev', docker: { service: 'app', compose_file: 'docker-compose.yml' }, port_env: 'APP_PORT', extra_ports: ['SUPERVISOR_PORT'], ports: { APP_PORT: 8080, SUPERVISOR_PORT: 9001 }, ready_signal: { type: 'stdout_match', pattern: 'started' }, ram_estimate_mb: 400, teardown: 'pkill -f nest' }
      },
      {
        id: 'chatbot-server', path: '/repo/chatbot-server', stack: 'nestjs', peers: {}, depends_on: [],
        dev: { launcher: 'docker-exec', command: 'yarn dev', docker: { service: 'chatbot_app', compose_file: 'docker-compose.yml' }, port_env: 'APP_PORT', extra_ports: [], ports: { APP_PORT: 8080 }, ready_signal: { type: 'stdout_match', pattern: 'started' }, ram_estimate_mb: 350, teardown: 'pkill -f nest' }
      }
    ]
  };
}

const resolveImage = () => 'jelou-api-app';
const readEnv = () => 'CHATBOT_SERVER_URL=http://old\nOTHER=1\n';

describe('buildBootPlan policy', () => {
  test('no worktree -> shared-reuse, no task extras', () => {
    const plan = buildBootPlan({ registry: reg(), slug: 't1', worktreePaths: {}, occupied: [], resolveImage, readEnv });
    const api = plan.services.find((s) => s.id === 'jelou-api');
    assert.equal(api.policy, 'shared-reuse');
    assert.equal(api.cwd, '/repo/jelou-api');
    assert.equal(api.projectName, undefined);
    assert.equal(api.overrideYaml, undefined);
    assert.equal(api.wiredEnv, null);
    assert.equal(api.teardownCmd, 'pkill -f nest');
    assert.deepEqual(api.readiness, { type: 'stdout_match', pattern: 'started' });
  });

  test('worktree -> task-isolated with ports, override, image, cwd=worktree', () => {
    const plan = buildBootPlan({ registry: reg(), slug: 't1', worktreePaths: { 'jelou-api': '/wt/jelou-api' }, occupied: [], resolveImage, readEnv });
    const api = plan.services.find((s) => s.id === 'jelou-api');
    assert.equal(api.policy, 'task-isolated');
    assert.equal(api.cwd, '/wt/jelou-api');
    assert.equal(api.projectName, 'jelou-api-t1');
    assert.equal(api.image, 'jelou-api-app');
    assert.equal(api.imageResolved, true);
    assert.deepEqual(api.ports, [
      { internal: 8080, host: 3100, portEnv: 'APP_PORT', primary: true },
      { internal: 9001, host: 3101, portEnv: 'SUPERVISOR_PORT', primary: false }
    ]);
    assert.ok(api.overrideYaml.includes('container_name: jelou-api-t1'));
    assert.ok(api.overrideYaml.includes('image: jelou-api-app'));
    assert.ok(api.overrideYaml.includes('entrypoint: ["sleep", "infinity"]'));
    assert.equal(api.teardownCmd, 'docker compose -p jelou-api-t1 down');
  });

  test('policy-aware wiring: shared-reuse A gets wiredEnv only for a task-isolated peer B', () => {
    const withWt = buildBootPlan({ registry: reg(), slug: 't1', worktreePaths: { 'chatbot-server': '/wt/chatbot' }, occupied: [], resolveImage, readEnv });
    const api = withWt.services.find((s) => s.id === 'jelou-api');
    assert.equal(api.policy, 'shared-reuse');
    assert.ok(unmaskWiredEnv(api.wiredEnv).includes('CHATBOT_SERVER_URL=http://chatbot-server-t1:8080'));

    const noWt = buildBootPlan({ registry: reg(), slug: 't1', worktreePaths: {}, occupied: [], resolveImage, readEnv });
    assert.equal(noWt.services.find((s) => s.id === 'jelou-api').wiredEnv, null);
  });

  test('image unresolved -> imageResolved false, override omits image', () => {
    const plan = buildBootPlan({ registry: reg(), slug: 't1', worktreePaths: { 'jelou-api': '/wt/jelou-api' }, occupied: [], resolveImage: () => null, readEnv });
    const api = plan.services.find((s) => s.id === 'jelou-api');
    assert.equal(api.imageResolved, false);
    assert.ok(!api.overrideYaml.includes('image:'));
    assert.ok(api.overrideYaml.includes('entrypoint: ["sleep", "infinity"]'));
  });

  test('task-isolated http readiness gets the allocated primary host port', () => {
    const r = reg();
    r.services[0].dev.ready_signal = { type: 'http_200', path: '/health' };
    const plan = buildBootPlan({ registry: r, slug: 't1', worktreePaths: { 'jelou-api': '/wt/jelou-api' }, occupied: [], resolveImage, readEnv });
    assert.deepEqual(plan.services.find((s) => s.id === 'jelou-api').readiness, { type: 'http_200', path: '/health', port: 3100 });
  });

  test('task-isolated entry carries composeFile; shared-reuse does not', () => {
    const plan = buildBootPlan({ registry: reg(), slug: 't1', worktreePaths: { 'jelou-api': '/wt/jelou-api' }, occupied: [], resolveImage, readEnv });
    const api = plan.services.find((s) => s.id === 'jelou-api');
    const chatbot = plan.services.find((s) => s.id === 'chatbot-server');
    assert.equal(api.policy, 'task-isolated');
    assert.equal(api.composeFile, 'docker-compose.yml');
    assert.equal(chatbot.policy, 'shared-reuse');
    assert.equal(chatbot.composeFile, undefined);
  });

  test('task-isolated base env comes from canonical checkout and wiredEnv is obfuscated', () => {
    const registry = {
      network: { composeNetworkAlias: 'app-network', basePort: 3100 },
      services: [
        {
          id: 'a', path: '/repo/a', stack: 'nestjs', peers: { b: 'B_URL' }, depends_on: [],
          dev: { launcher: 'docker-exec', command: 'yarn dev', docker: { service: 'a_app', compose_file: 'docker-compose.yml' }, port_env: 'APP_PORT', extra_ports: [], ports: { APP_PORT: 8080 }, ready_signal: { type: 'stdout_match', pattern: 'started' }, ram_estimate_mb: 300, teardown: 'pkill -f nest' }
        },
        {
          id: 'b', path: '/repo/b', stack: 'nestjs', peers: {}, depends_on: [],
          dev: { launcher: 'docker-exec', command: 'yarn dev', docker: { service: 'b_app', compose_file: 'docker-compose.yml' }, port_env: 'APP_PORT', extra_ports: [], ports: { APP_PORT: 8080 }, ready_signal: { type: 'stdout_match', pattern: 'started' }, ram_estimate_mb: 300, teardown: 'pkill -f nest' }
        }
      ]
    };
    const worktreePaths = { a: '/wt/a', b: '/wt/b' };
    const readEnv = (dir) => (dir === '/repo/a' ? 'B_URL=http://b:8080\n' : '');
    const plan = buildBootPlan({ registry, slug: 't1', worktreePaths, occupied: [], resolveImage: () => 'img', readEnv });
    const a = plan.services.find((s) => s.id === 'a');
    assert.equal(a.policy, 'task-isolated');
    assert.ok(a.wiredEnv);
    assert.ok(a.wiredEnv.startsWith('JLUENV1:'));
    assert.ok(unmaskWiredEnv(a.wiredEnv).includes('b-t1:'));
  });
});
