import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createE2eIdentity, runDeterministicFullStackE2e } from '../../bin/local-stack-e2e.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'bin', 'local-stack-e2e.mjs');

const completePreflight = {
  docker: { ok: true },
  repositories: { ok: true },
  keyring: { ok: true },
  localDatabase: { ok: true, proof: 'registered-local-docker' },
  browser: { ok: true },
  provisioningAdapter: { ok: true },
  dashboard: { ok: true },
  api: { ok: true },
  ui: { ok: true },
};

describe('deterministic local-stack E2E preflight', () => {
  test('reports every missing prerequisite before suite-owned mutation', async () => {
    const mutations = [];
    const preflight = Object.fromEntries(
      Object.keys(completePreflight).map((name) => [name, { ok: false, reason: `${name} unavailable` }]),
    );

    await assert.rejects(
      () => runDeterministicFullStackE2e({ workspaceRoot: '/workspace' }, {
        inspectPreflight: async () => preflight,
        createFixture: async () => mutations.push('fixture'),
      }),
      (error) => {
        assert.equal(error.code, 'E2E_PREFLIGHT_FAILED');
        assert.deepEqual(error.failures.map(({ name }) => name), Object.keys(completePreflight));
        return true;
      },
    );
    assert.deepEqual(mutations, []);
  });

  test('the installed runner requires explicit opt-in before loading its adapter', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'jlu-local-stack-e2e-cli-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const loadedMarker = join(directory, 'adapter-loaded');
    const adapterPath = join(directory, 'adapter.mjs');
    const configPath = join(directory, 'config.json');
    writeFileSync(adapterPath, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(loadedMarker)}, 'loaded');\nexport function createAdapter() { return {}; }\n`);
    writeFileSync(configPath, JSON.stringify({ adapterPath }));

    const result = spawnSync(process.execPath, [CLI, '--config', configPath], { encoding: 'utf8' });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /--confirm-local-e2e/);
    assert.equal(existsSync(loadedMarker), false);
  });
});

describe('deterministic local-stack E2E orchestration', () => {
  test('creates isolated company, user, credential, task, and run identities', () => {
    const first = createE2eIdentity({ workspaceId: 'workspace-a' });
    const second = createE2eIdentity({ workspaceId: 'workspace-a' });

    assert.notEqual(first.marker.runId, second.marker.runId);
    assert.notEqual(first.marker.taskSlug, second.marker.taskSlug);
    assert.notEqual(first.companies.ENTERPRISE.name, first.companies.SELF_SERVICE.name);
    assert.notEqual(first.users.ENTERPRISE.email, first.users.SELF_SERVICE.email);
    assert.notEqual(first.users.ENTERPRISE.password, first.users.SELF_SERVICE.password);
    assert.equal(first.marker.workspaceId, 'workspace-a');
  });

  test('proves main and task-aware plans, stable ports, topology, restart, both plans, and protected access', async () => {
    const calls = [];
    const ports = { 'jelou-api': 18383, 'dashboard-server': 18484, 'jelou-apps': 15175 };
    const marker = { workspaceId: 'workspace-fixture', taskSlug: 'e2e-task', runId: 'run-fixture' };
    const adapter = {
      inspectPreflight: async () => completePreflight,
      createIdentity: () => ({
        marker,
        companies: {
          ENTERPRISE: { name: 'E2E Enterprise run-fixture' },
          SELF_SERVICE: { name: 'E2E Self Service run-fixture' },
        },
        users: {
          ENTERPRISE: { email: 'enterprise-run-fixture@example.test', password: 'enterprise-secret' },
          SELF_SERVICE: { email: 'self-service-run-fixture@example.test', password: 'self-service-secret' },
        },
      }),
      async createFixture({ identity }) {
        calls.push(`fixture:${identity.marker.runId}`);
        return {
          workspaceRoot: '/tmp/e2e-workspace',
          taskSlug: identity.marker.taskSlug,
          repositories: ['/tmp/repos/jelou-api', '/tmp/repos/dashboard-server', '/tmp/repos/jelou-apps'],
          worktrees: ['/tmp/repos/jelou-api/.worktrees/e2e-task'],
          resources: [],
        };
      },
      async runMode({ sourceMode, attempt }) {
        calls.push(`mode:${sourceMode}:${attempt}`);
        return {
          sourceMode,
          ports,
          sources: sourceMode === 'main'
            ? { 'jelou-api': 'main', 'dashboard-server': 'main', 'jelou-apps': 'main' }
            : { 'jelou-api': 'task', 'dashboard-server': 'main', 'jelou-apps': 'task' },
          topologyDirections: ['host-to-host', 'host-to-docker', 'docker-to-host', 'docker-to-docker'],
          overlayRestartedConsumers: ['jelou-apps', 'dashboard-server'],
          resources: [],
        };
      },
      async provisionAndVerify({ plan, company, user }) {
        calls.push(`provision:${plan}:${user.email}`);
        return {
          plan,
          company: { id: `company-${plan}`, name: company.name, plan },
          user: { id: `user-${plan}`, email: user.email, active: true, emailVerified: true },
          relations: {
            chatbotCompanyId: `company-${plan}`,
            accessCompanyId: `company-${plan}`,
            accessUserId: `user-${plan}`,
            operatorUserId: `user-${plan}`,
            roleUserId: `user-${plan}`,
          },
          cookie: { name: 'jelou_auth', source: 'dashboard' },
          apiStatuses: [200, 200],
          protectedUrl: 'http://localhost:15175/home',
          resources: [],
        };
      },
      async cleanupResource() {},
    };

    const result = await runDeterministicFullStackE2e({ workspaceRoot: '/workspace' }, adapter);

    assert.equal(result.status, 'passed');
    assert.deepEqual(result.modes.map(({ sourceMode }) => sourceMode), ['main', 'task-aware', 'task-aware']);
    assert.deepEqual(result.modes[1].ports, result.modes[2].ports);
    assert.deepEqual(result.provisioning.map(({ plan }) => plan), ['ENTERPRISE', 'SELF_SERVICE']);
    assert.equal(result.provisioning.every(({ cookie }) => cookie.name === 'jelou_auth' && cookie.source === 'dashboard'), true);
    assert.equal(result.provisioning.every(({ apiStatuses }) => apiStatuses.every((status) => status === 200)), true);
    assert.equal(result.provisioning.every(({ protectedUrl }) => !new URL(protectedUrl).pathname.startsWith('/login')), true);
    assert.doesNotMatch(JSON.stringify(result), /enterprise-secret|self-service-secret/);
    assert.deepEqual(calls, [
      'fixture:run-fixture',
      'mode:main:1',
      'mode:task-aware:1',
      'mode:task-aware:2',
      'provision:ENTERPRISE:enterprise-run-fixture@example.test',
      'provision:SELF_SERVICE:self-service-run-fixture@example.test',
    ]);
  });
});

function validMode(sourceMode, resources = []) {
  return {
    sourceMode,
    ports: { api: 18383 },
    sources: sourceMode === 'main' ? { api: 'main' } : { api: 'task' },
    topologyDirections: ['host-to-host', 'host-to-docker', 'docker-to-host', 'docker-to-docker'],
    overlayRestartedConsumers: ['consumer'],
    resources,
  };
}

function validProvisioning(plan, resources = []) {
  return {
    plan,
    company: { id: `company-${plan}`, plan },
    user: { id: `user-${plan}`, active: true, emailVerified: true },
    relations: {
      chatbotCompanyId: `company-${plan}`,
      accessCompanyId: `company-${plan}`,
      accessUserId: `user-${plan}`,
      operatorUserId: `user-${plan}`,
      roleUserId: `user-${plan}`,
    },
    cookie: { name: 'jelou_auth', source: 'dashboard' },
    apiStatuses: [200],
    protectedUrl: 'http://localhost:15175/home',
    resources,
  };
}

function cleanupAdapter({ failPlan = null, includeForeign = false } = {}) {
  const marker = { workspaceId: 'workspace-fixture', taskSlug: 'e2e-task', runId: 'run-fixture' };
  const foreign = { workspaceId: 'workspace-other', taskSlug: 'e2e-task', runId: 'run-fixture' };
  const removed = [];
  const resource = (kind, id, owner = marker) => ({ kind, id, owner });
  return {
    marker,
    removed,
    inspectPreflight: async () => completePreflight,
    createIdentity: () => ({
      marker,
      companies: { ENTERPRISE: {}, SELF_SERVICE: {} },
      users: { ENTERPRISE: {}, SELF_SERVICE: {} },
    }),
    createFixture: async () => ({ resources: [resource('worktree', 'worktree')] }),
    runMode: async ({ sourceMode, attempt }) => validMode(sourceMode, [
      resource(attempt === 1 ? 'process' : 'runtime', `${sourceMode}-${attempt}`),
      ...(includeForeign && sourceMode === 'main' ? [resource('container', 'foreign-container', foreign)] : []),
    ]),
    provisionAndVerify: async ({ plan, registerResource }) => {
      if (plan === failPlan) {
        registerResource(resource('databaseRecord', `partial-${plan}`));
        throw new Error(`injected ${plan} failure`);
      }
      return validProvisioning(plan, [resource(plan === 'ENTERPRISE' ? 'credential' : 'databaseRecord', plan)]);
    },
    cleanupResource: async ({ kind, id }) => removed.push(`${kind}:${id}`),
  };
}

describe('deterministic local-stack E2E cleanup', () => {
  test('passing and injected-failure runs remove every owned resource in reverse order', async () => {
    const passing = cleanupAdapter();
    const passed = await runDeterministicFullStackE2e({ workspaceRoot: '/workspace' }, passing);
    assert.deepEqual(passed.cleanup, { removed: 6, refused: [] });
    assert.deepEqual(passing.removed, [
      'databaseRecord:SELF_SERVICE',
      'credential:ENTERPRISE',
      'runtime:task-aware-2',
      'process:task-aware-1',
      'process:main-1',
      'worktree:worktree',
    ]);

    const failing = cleanupAdapter({ failPlan: 'SELF_SERVICE' });
    await assert.rejects(
      () => runDeterministicFullStackE2e({ workspaceRoot: '/workspace', injectFailure: true }, failing),
      (error) => {
        assert.match(error.message, /injected SELF_SERVICE failure/);
        assert.deepEqual(error.cleanup, { removed: 6, refused: [] });
        return true;
      },
    );
    assert.deepEqual(failing.removed, [
      'databaseRecord:partial-SELF_SERVICE',
      'credential:ENTERPRISE',
      'runtime:task-aware-2',
      'process:task-aware-1',
      'process:main-1',
      'worktree:worktree',
    ]);
  });

  test('cleanup refuses foreign resources without invoking their cleanup handler', async () => {
    const adapter = cleanupAdapter({ includeForeign: true });
    const result = await runDeterministicFullStackE2e({ workspaceRoot: '/workspace' }, adapter);

    assert.equal(adapter.removed.includes('container:foreign-container'), false);
    assert.deepEqual(result.cleanup.refused, [{ kind: 'container', id: 'foreign-container', reason: 'ownership-marker-mismatch' }]);
  });
});

describe('deterministic local-stack E2E opt-in surface', () => {
  test('has an explicit real-stack script and remains outside the default test command', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

    assert.equal(packageJson.scripts.test, 'node --test tests/unit/*.test.mjs');
    assert.equal(
      packageJson.scripts['test:e2e:local-stack'],
      'node --test tests/e2e/deterministic-local-stack.e2e.test.mjs',
    );
    assert.equal(existsSync(join(ROOT, 'tests/e2e/deterministic-local-stack.e2e.test.mjs')), true);
    assert.equal(existsSync(join(ROOT, 'tests/e2e/real-local-stack-adapter.mjs')), true);
  });
});
