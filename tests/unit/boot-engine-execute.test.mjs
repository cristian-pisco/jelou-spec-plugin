// tests/unit/boot-engine-execute.test.mjs
//
// Run: `node --test tests/unit/boot-engine-execute.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { planEntryToCommands } from '../../bin/lib/boot-engine/execute.mjs';

function taskEntry(over = {}) {
  return {
    id: 'jelou-api',
    policy: 'task-isolated',
    launcher: 'docker-exec',
    cwd: '/wt/jelou-api',
    command: 'yarn start:dev',
    projectName: 'jelou-api-t1',
    composeFile: 'docker-compose.yml',
    overrideYaml: 'services:\n  app:\n    image: jelou-api-app\n',
    image: 'jelou-api-app',
    imageResolved: true,
    wiredEnv: null,
    readiness: { type: 'stdout_match', pattern: 'started' },
    teardownCmd: 'docker compose -p jelou-api-t1 down',
    ports: [{ internal: 8080, host: 3100, portEnv: 'APP_PORT', primary: true }],
    ...over
  };
}

function sharedEntry(over = {}) {
  return {
    id: 'chatbot-server',
    policy: 'shared-reuse',
    launcher: 'docker-exec',
    cwd: '/repo/chatbot-server',
    command: 'yarn dev',
    readiness: { type: 'stdout_match', pattern: 'started' },
    teardownCmd: 'pkill -f nest',
    wiredEnv: null,
    ...over
  };
}

describe('planEntryToCommands task-isolated', () => {
  test('docker-exec with wiredEnv: files, up, exec, readiness, teardown', () => {
    const d = planEntryToCommands(taskEntry({ wiredEnv: 'CHATBOT_SERVER_URL=http://chatbot-server-t1:8080\n' }));
    assert.equal(d.policy, 'task-isolated');
    assert.equal(d.cwd, '/wt/jelou-api');
    assert.deepEqual(d.files, [
      { path: '/wt/jelou-api/docker-compose.jlu.yml', content: 'services:\n  app:\n    image: jelou-api-app\n' },
      { path: '/wt/jelou-api/.env', content: 'CHATBOT_SERVER_URL=http://chatbot-server-t1:8080\n' }
    ]);
    assert.deepEqual(d.up, ['compose', '-p', 'jelou-api-t1', '-f', 'docker-compose.yml', '-f', 'docker-compose.jlu.yml', 'up', '-d']);
    assert.deepEqual(d.exec, ['exec', '-d', 'jelou-api-t1', 'sh', '-lc', 'cd /app && yarn start:dev > /tmp/jelou-api-t1.dev.log 2>&1']);
    assert.deepEqual(d.teardown, ['compose', '-p', 'jelou-api-t1', 'down']);
    assert.equal(d.imageResolved, true);
  });

  test('no wiredEnv: files has only the override', () => {
    const d = planEntryToCommands(taskEntry());
    assert.deepEqual(d.files, [
      { path: '/wt/jelou-api/docker-compose.jlu.yml', content: 'services:\n  app:\n    image: jelou-api-app\n' }
    ]);
  });

  test('non-docker-exec launcher: exec is null', () => {
    const d = planEntryToCommands(taskEntry({ launcher: 'docker' }));
    assert.equal(d.exec, null);
  });

  test('http readiness carries the host port through; stdout_match carries logPath', () => {
    const http = planEntryToCommands(taskEntry({ readiness: { type: 'http_200', path: '/health', port: 3100 } }));
    assert.deepEqual(http.readiness, { type: 'http_200', path: '/health', port: 3100, logPath: '/tmp/jelou-api-t1.dev.log' });
    const stdout = planEntryToCommands(taskEntry());
    assert.equal(stdout.readiness.logPath, '/tmp/jelou-api-t1.dev.log');
  });

  test('imageResolved false is propagated', () => {
    const d = planEntryToCommands(taskEntry({ imageResolved: false }));
    assert.equal(d.imageResolved, false);
  });
});

describe('planEntryToCommands shared-reuse', () => {
  test('with wiredEnv: files has the single .env, teardown string, no up/exec', () => {
    const d = planEntryToCommands(sharedEntry({ wiredEnv: 'JELOU_API_URL=http://jelou-api-t1:8080\n' }));
    assert.equal(d.policy, 'shared-reuse');
    assert.equal(d.launcher, 'docker-exec');
    assert.equal(d.command, 'yarn dev');
    assert.deepEqual(d.files, [{ path: '/repo/chatbot-server/.env', content: 'JELOU_API_URL=http://jelou-api-t1:8080\n' }]);
    assert.equal(d.teardown, 'pkill -f nest');
    assert.equal(d.up, undefined);
    assert.equal(d.exec, undefined);
  });

  test('no wiredEnv: files empty; teardown null when dev-block has none', () => {
    const d = planEntryToCommands(sharedEntry({ teardownCmd: null }));
    assert.deepEqual(d.files, []);
    assert.equal(d.teardown, null);
  });
});

describe('planEntryToCommands errors', () => {
  test('unknown policy throws naming the id', () => {
    assert.throws(() => planEntryToCommands({ id: 'x', policy: 'weird' }), /planEntryToCommands.*weird.*x|x.*weird/);
  });
});
