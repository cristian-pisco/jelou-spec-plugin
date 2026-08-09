import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { bootableEntries, runBootPlan } from '../../bin/lib/boot-engine/boot-plan-runner.mjs';

function taskEntry(overrides = {}) {
  return {
    id: 'api-service',
    policy: 'task-isolated',
    launcher: 'docker-exec',
    cwd: '/repos/api-service/.worktrees/task-a',
    command: 'npm run start:dev',
    projectName: 'api-service-task-a',
    composeFile: 'docker-compose.yml',
    overrideYaml: 'name: api-service-task-a\n',
    imageResolved: true,
    readiness: { type: 'port_open', port: 4100 },
    ports: [{ internal: 8080, host: 4100, portEnv: 'APP_PORT', primary: true }],
    environmentOverlay: { path: null, digest: null, restartRequired: false },
    ...overrides,
  };
}

function harness({ upCode = 0, execCode = 0, ready = true } = {}) {
  const calls = [];
  const files = [];
  const runner = async (bin, args) => {
    const key = `${bin} ${args.join(' ')}`;
    calls.push(key);
    if (key.includes(' up -d')) return { code: upCode, stdout: '', stderr: upCode ? 'no image' : '' };
    if (key.includes(' exec ')) return { code: execCode, stdout: '', stderr: execCode ? 'boom' : '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return {
    calls,
    files,
    options: {
      runner,
      writeFile: (path, content) => files.push({ path, content }),
      probePort: async () => ready,
      probeHttp: async () => ({ status: ready ? 200 : 0 }),
      sleep: async () => {},
      pollIntervalMs: 1,
      now: (() => { let t = 0; return () => (t += 1000); })(),
    },
  };
}

const runIdentity = { workspaceId: 'ws', taskSlug: 'task-a', runId: 'run-1' };

describe('bootableEntries', () => {
  test('host-launched entries are skipped with a reason instead of reaching docker compose', () => {
    const { bootable, skipped } = bootableEntries({ services: [taskEntry(), { id: 'jelou-apps', launcher: 'npm', policy: 'task-isolated' }] });

    assert.deepEqual(bootable.map((e) => e.id), ['api-service']);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /host launcher/);
  });

  test('a task-isolated entry without a projectName is skipped, never recorded as a compose project', () => {
    const { bootable, skipped } = bootableEntries({ services: [taskEntry({ projectName: undefined })] });

    assert.deepEqual(bootable, []);
    assert.match(skipped[0].reason, /projectName/);
  });
});

describe('runBootPlan — task-isolated', () => {
  test('writes the descriptor files, brings the container up, execs the dev command and reaches readiness', async () => {
    const { calls, files, options } = harness();

    const result = await runBootPlan({ plan: { services: [taskEntry()] }, runIdentity }, options);

    assert.deepEqual(result.green, ['api-service']);
    assert.deepEqual(result.down, []);
    assert.deepEqual(files.map((f) => f.path), ['/repos/api-service/.worktrees/task-a/docker-compose.jlu.yml']);
    assert.equal(files[0].content, 'name: api-service-task-a\n');
    assert.ok(calls.some((c) => c.includes('up -d')));
    assert.ok(calls.some((c) => c.includes('exec')));
    assert.deepEqual(result.mutations, [{
      kind: 'container',
      resource: { projectName: 'api-service-task-a', cwd: '/repos/api-service/.worktrees/task-a', composeFile: 'docker-compose.yml', overrideFile: 'docker-compose.jlu.yml' },
    }]);
  });

  test('writes descriptor files under the key the descriptor actually emits', async () => {
    const { files, options } = harness();

    await runBootPlan({ plan: { services: [taskEntry()] }, runIdentity }, options);

    assert.equal(files.every((f) => typeof f.content === 'string'), true);
  });

  test('a failed compose up stops before the dev command and reports the cause', async () => {
    const { calls, options } = harness({ upCode: 1 });

    const result = await runBootPlan({ plan: { services: [taskEntry()] }, runIdentity }, options);

    assert.deepEqual(result.down, ['api-service']);
    assert.match(result.services[0].cause, /up_failed: no image/);
    assert.equal(calls.some((c) => c.includes(' exec ')), false);
  });

  test('a readiness timeout is down, and the boot is never reported green', async () => {
    const { options } = harness({ ready: false });

    const result = await runBootPlan({ plan: { services: [taskEntry()] }, runIdentity }, options);

    assert.deepEqual(result.green, []);
    assert.equal(result.services[0].cause, 'ready_timeout');
  });

  test('the runner leaves what it started running — it registers teardown instead of executing it', async () => {
    const { calls, options } = harness();

    await runBootPlan({ plan: { services: [taskEntry()] }, runIdentity }, options);

    assert.equal(calls.some((c) => c.includes(' down')), false);
    assert.equal(calls.some((c) => c.includes(' stop ')), false);
  });
});

describe('runBootPlan — declared migrations', () => {
  test('a blocking migration failure stops the boot before the dev command starts', async () => {
    const calls = [];
    const options = {
      runner: async (bin, args) => {
        const key = `${bin} ${args.join(' ')}`;
        calls.push(key);
        if (key.includes('drizzle-kit migrate')) return { code: 1, stdout: '', stderr: 'relation already exists' };
        return { code: 0, stdout: '', stderr: '' };
      },
      writeFile: () => {},
      probePort: async () => true,
      probeHttp: async () => ({ status: 200 }),
      sleep: async () => {},
      pollIntervalMs: 1,
      now: (() => { let t = 0; return () => (t += 1000); })(),
    };

    const result = await runBootPlan({ plan: { services: [taskEntry({ migrate: { command: 'npx drizzle-kit migrate' } })] }, runIdentity }, options);

    assert.deepEqual(result.down, ['api-service']);
    assert.match(result.services[0].cause, /migrate_failed: relation already exists/);
    assert.equal(calls.some((c) => c.includes('-d api-service-task-a')), false);
  });

  test('a non-blocking migration failure warns but lets the service boot', async () => {
    const options = {
      runner: async (bin, args) => (args.join(' ').includes('drizzle-kit migrate') ? { code: 1, stdout: '', stderr: 'drift' } : { code: 0, stdout: '', stderr: '' }),
      writeFile: () => {},
      probePort: async () => true,
      probeHttp: async () => ({ status: 200 }),
      sleep: async () => {},
      pollIntervalMs: 1,
      now: (() => { let t = 0; return () => (t += 1000); })(),
    };

    const result = await runBootPlan({ plan: { services: [taskEntry({ migrate: { command: 'npx drizzle-kit migrate', blocking: false } })] }, runIdentity }, options);

    assert.deepEqual(result.green, ['api-service']);
    assert.match(result.services[0].error_hints[0], /migrate_failed: drift/);
  });

  test('no declared migration means no migration call at all', async () => {
    const { calls, options } = harness();

    await runBootPlan({ plan: { services: [taskEntry()] }, runIdentity }, options);

    assert.equal(calls.some((c) => c.includes('migrate')), false);
  });
});

describe('runBootPlan — shared-reuse', () => {
  function sharedEntry() {
    return {
      id: 'auth-service',
      policy: 'shared-reuse',
      launcher: 'docker-exec',
      cwd: '/repos/auth-service',
      command: 'npm run start:dev',
      composeFile: 'docker-compose.yml',
      dockerService: 'app',
      readiness: { type: 'port_open', port: 8229 },
      ports: [{ internal: 8080, host: 8229, portEnv: 'APP_PORT', primary: true }],
      environmentOverlay: { path: null, digest: null, restartRequired: false },
      teardownCmd: null,
    };
  }

  test('a service this run started stays up — nothing is stopped after readiness', async () => {
    const calls = [];
    const runner = async (bin, args) => {
      const key = `${bin} ${args.join(' ')}`;
      calls.push(key);
      if (key.includes('ps --services --status running')) return { code: 0, stdout: calls.length > 2 ? 'app\n' : '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const options = {
      runner,
      writeFile: () => {},
      probePort: async () => true,
      probeHttp: async () => ({ status: 200 }),
      sleep: async () => {},
      pollIntervalMs: 1,
      now: (() => { let t = 0; return () => (t += 1000); })(),
      readEnvironmentFile: () => '',
    };

    const result = await runBootPlan({ plan: { services: [sharedEntry()] }, runIdentity }, options);

    assert.deepEqual(result.green, ['auth-service']);
    assert.equal(calls.some((c) => c.includes(' stop ')), false);
    assert.equal(calls.some((c) => c.includes(' down')), false);
  });
});
