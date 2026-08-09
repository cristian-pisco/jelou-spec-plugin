import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { codeTargetKillScript, verifySharedReuse } from '../../bin/lib/boot-engine/execute-shared-reuse.mjs';
import { hostByService } from '../../bin/lib/boot-engine/host-map.mjs';
import { emptyStackState, recordOwnedMutation, addProject, staleRunAudit } from '../../bin/lib/dev-orchestrator/stack/stack-state.mjs';
import { verifyProtectedSession } from '../../bin/lib/dev-orchestrator/stack/auth-session.mjs';
import { createOsKeyring } from '../../bin/lib/dev-orchestrator/stack/local-keyring.mjs';
import { LIFECYCLE_STAGES } from '../../bin/lib/dev-orchestrator/events.mjs';

describe('shared-reuse restart leaves no orphan dev process', () => {
  const entry = {
    id: 'api-gateway-service',
    launcher: 'docker-exec',
    cwd: '/repos/api-gateway-service',
    composeFile: 'docker-compose.yml',
    dockerService: 'app',
    command: 'npm run start:dev',
    teardownCmd: "docker compose exec -T app pkill -f 'nest start' || true",
    restartRequired: true,
    readiness: { type: 'port_open', port: 8998 },
    environmentFiles: [],
  };

  test('the restart kills every process rooted at the container code target, not only the launcher pattern', async () => {
    const calls = [];
    const runner = async (bin, args) => {
      const key = `${bin} ${args.join(' ')}`;
      calls.push(key);
      if (key.includes('ps --services --status running')) return { code: 0, stdout: 'app\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };

    await verifySharedReuse(entry, {
      runner,
      probePort: async () => true,
      probeHttp: async () => ({ status: 200 }),
      sleep: async () => {},
      pollIntervalMs: 1,
      now: (() => { let t = 0; return () => (t += 1000); })(),
      readEnvironmentFile: () => '',
    });

    assert.ok(calls.some((c) => c.includes("pkill -f 'nest start'")));
    assert.ok(calls.some((c) => c.includes('/proc/[0-9]*') && c.includes('/app')));
  });

  test('the kill script is scoped to the code target and never touches unrelated pids', () => {
    const script = codeTargetKillScript('/srv');

    assert.match(script, /case "\$cwd" in \/srv\|\/srv\/\*\)/);
    assert.doesNotMatch(script, /pkill -f node/);
  });
});

describe('hostByService — a resolved port that nothing serves', () => {
  const plan = { services: [{ id: 'jelou-functions-api', policy: 'shared-reuse', launcher: 'docker', cwd: '/repos/jelou-functions-api', ports: [] }] };
  const registry = { services: [{ id: 'jelou-functions-api', dev: { port_env: 'APP_PORT', ports: { APP_PORT: 8905 }, docker: { service: 'app', compose_file: 'docker-compose.yml' } } }] };

  test('a dead published port falls back to the container port that actually answers', () => {
    const result = hostByService({
      plan,
      registry,
      publishedPort: () => 8905,
      probeHostPort: (port) => port === 8000,
      listPublishedPorts: () => [{ internal: 8000, host: 8000 }, { internal: 8905, host: 8905 }],
    });

    assert.equal(result.hostByService['jelou-functions-api'], 8000);
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(result.corrected, [{ id: 'jelou-functions-api', declaredInternal: 8905, servingInternal: 8000, host: 8000 }]);
  });

  test('when nothing on the container answers the service is reported unresolved', () => {
    const result = hostByService({
      plan,
      registry,
      publishedPort: () => 8905,
      probeHostPort: () => false,
      listPublishedPorts: () => [],
    });

    assert.deepEqual(result.unresolved, ['jelou-functions-api']);
    assert.deepEqual(result.corrected, []);
  });
});

describe('orphaned run reconciliation', () => {
  const marker = { workspaceId: 'ws', taskSlug: 'task-a', runId: 'run-old' };

  test('a run whose processes are all gone is reported stale so the boot can reconcile it', () => {
    let state = recordOwnedMutation(emptyStackState(), marker, { kind: 'process', resource: { pid: 918082 } });
    state = { ...state, hostPids: [{ role: 'vite', pid: 918082 }] };

    assert.deepEqual(staleRunAudit(state, { isAlive: () => false }), {
      hasRun: true, stale: true, currentRun: marker, livePids: [], journalSize: 1,
    });
  });

  test('a run with a live process is active, never silently taken over', () => {
    let state = recordOwnedMutation(emptyStackState(), marker, { kind: 'process', resource: { pid: 4242 } });
    state = { ...state, hostPids: [{ role: 'vite', pid: 4242 }] };

    const audit = staleRunAudit(state, { isAlive: (pid) => pid === 4242 });

    assert.equal(audit.stale, false);
    assert.deepEqual(audit.livePids, [4242]);
  });

  test('a clean state has no run to reconcile', () => {
    assert.equal(staleRunAudit(emptyStackState(), { isAlive: () => true }).hasRun, false);
  });

  test('a host-launched plan entry cannot be recorded as a compose project', () => {
    assert.throws(() => addProject(emptyStackState(), { cwd: '/repos/jelou-apps' }), /projectName/);
  });
});

describe('identity payloads', () => {
  function session(payload) {
    return verifyProtectedSession(
      { cookie: { name: 'jelou_auth', value: 'v' }, verifyUrls: ['https://api/me'], identityUrl: 'https://api/me', appUrl: 'http://localhost:3102', protectedPath: '/home' },
      {
        request: async () => ({ status: 200, json: async () => payload }),
        createBrowserContext: async () => ({
          addCookies: async () => {},
          newPage: async () => ({ goto: async () => {}, url: () => 'http://localhost:3102/home' }),
          close: async () => {},
        }),
      },
    );
  }

  test('permissions published at data.permissions authorize the session', async () => {
    const result = await session({ data: { id: 1, permissions: ['a', 'b'] } });

    assert.equal(result.status, 'valid');
    assert.equal(result.permissionCount, 2);
  });

  test('the historic data.User.permissions shape still authorizes', async () => {
    const result = await session({ data: { User: { permissions: ['a'] } } });

    assert.equal(result.status, 'valid');
  });

  test('a payload with no permission array anywhere is identity-unreadable', async () => {
    const result = await session({ data: { id: 1 } });

    assert.equal(result.reason, 'identity-unreadable');
  });

  test('authorization is a lifecycle stage the emitter accepts', () => {
    assert.equal(LIFECYCLE_STAGES.authorization, 'authorization');
  });
});

describe('operating-system keyring availability', () => {
  test('a libsecret build without --version is still available when a lookup works', () => {
    const keyring = createOsKeyring({ run: (bin, args) => {
      assert.equal(bin, 'secret-tool');
      assert.equal(args[0], 'lookup');
      return { status: 1, stdout: '', stderr: '' };
    } });

    assert.equal(keyring.isAvailable(), true);
  });

  test('a broken secret service reports unavailable', () => {
    const keyring = createOsKeyring({ run: () => ({ status: 1, stdout: '', stderr: 'secret-tool: Could not connect: No such file or directory' }) });

    assert.equal(keyring.isAvailable(), false);
  });

  test('a found probe item is available too', () => {
    const keyring = createOsKeyring({ run: () => ({ status: 0, stdout: 'x', stderr: '' }) });

    assert.equal(keyring.isAvailable(), true);
  });
});
