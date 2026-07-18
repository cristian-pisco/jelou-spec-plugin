// tests/unit/stack-boot-commands.test.mjs
//
// Run: `node --test tests/unit/stack-boot-commands.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { composeUpArgs, execAppArgs, bootPlan } from '../../bin/lib/dev-orchestrator/stack/boot-commands.mjs';

describe('composeUpArgs', () => {
  test('builds a namespaced two-file compose up', () => {
    assert.deepEqual(
      composeUpArgs({ projectName: 'svc-a-task-x', composeFile: 'docker-compose.yml', overrideFile: 'docker-compose.jlu.yml' }),
      ['compose', '-p', 'svc-a-task-x', '-f', 'docker-compose.yml', '-f', 'docker-compose.jlu.yml', 'up', '-d']
    );
  });
});

describe('execAppArgs', () => {
  test('builds a detached exec that logs inside the container', () => {
    assert.deepEqual(
      execAppArgs({ containerName: 'svc-a-task-x', command: 'yarn start:dev', logPath: '/tmp/svc-a-task-x.dev.log' }),
      ['exec', '-d', 'svc-a-task-x', 'sh', '-lc', 'cd /app && yarn start:dev > /tmp/svc-a-task-x.dev.log 2>&1']
    );
  });
});

describe('bootPlan', () => {
  const base = { projectName: 'svc-a-task-x', cwd: '/repo/a', composeFile: 'docker-compose.yml', command: 'yarn start:dev', overrideYaml: 'name: svc-a-task-x\n', wiredEnv: 'FOO=bar\n' };

  test('exec mode: writes override + env and runs compose up then exec', () => {
    const out = bootPlan({ ...base, mode: 'exec' });
    assert.deepEqual(out.files, [
      { path: '/repo/a/docker-compose.jlu.yml', content: 'name: svc-a-task-x\n' },
      { path: '/repo/a/.env', content: 'FOO=bar\n' }
    ]);
    assert.equal(out.commands.length, 2);
    assert.deepEqual(out.commands[0], ['compose', '-p', 'svc-a-task-x', '-f', 'docker-compose.yml', '-f', 'docker-compose.jlu.yml', 'up', '-d']);
    assert.deepEqual(out.commands[1], ['exec', '-d', 'svc-a-task-x', 'sh', '-lc', 'cd /app && yarn start:dev > /tmp/svc-a-task-x.dev.log 2>&1']);
  });

  test('start mode: compose up only, no exec', () => {
    const out = bootPlan({ ...base, mode: 'start' });
    assert.equal(out.commands.length, 1);
    assert.deepEqual(out.commands[0][0], 'compose');
  });

  test('compose mode: compose up only, no exec', () => {
    const out = bootPlan({ ...base, mode: 'compose' });
    assert.equal(out.commands.length, 1);
  });
});
