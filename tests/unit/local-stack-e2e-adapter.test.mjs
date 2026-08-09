import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdapter } from '../../bin/lib/dev-orchestrator/stack/local-stack-e2e-adapter.mjs';
import { resolveLocalStackE2eConfig } from '../../bin/lib/dev-orchestrator/stack/local-stack-e2e-config.mjs';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

function createAdapterFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'local-stack-adapter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const serviceIds = ['dashboard-server', 'jelou-api', 'jelou-apps'];
  const services = serviceIds.map((id) => {
    const path = join(root, id);
    mkdirSync(path);
    return { id, path };
  });
  const registryPath = writeJson(join(root, 'registry.json'), { services });
  const browserExecutable = join(root, 'browser');
  writeFileSync(browserExecutable, 'browser');
  const provisioningBoundaryPath = join(root, 'boundary.mjs');
  writeFileSync(provisioningBoundaryPath, 'export async function createLocalJelouBoundary() { return { e2e: {} }; }\n');
  const localDatabase = {
    target: { host: '127.0.0.1', port: 5432 },
    topology: {
      registeredLoopbackDatabase: { host: '127.0.0.1', port: 5432, provisioningBoundaryPath },
    },
  };
  return {
    root,
    services,
    registryPath,
    browserExecutable,
    provisioningBoundaryPath,
    config: {
      services,
      registryPath,
      localDatabase,
      browserExecutable,
      dashboardServiceId: 'dashboard-server',
      apiServiceId: 'jelou-api',
      uiServiceId: 'jelou-apps',
      pluginRoot: root,
      projectRoot: root,
    },
  };
}

async function assertConfigurationRejected(config, expected) {
  await assert.rejects(
    () => createAdapter(config),
    (error) => error.code === 'E2E_PREFLIGHT_FAILED'
      && Array.isArray(error.failures)
      && error.failures.length === 1
      && error.failures[0].name === 'configuration'
      && expected.test(error.failures[0].reason),
  );
}

const REJECTION_CASES = [
  ['missing services', (fixture) => ({ ...fixture.config, services: undefined }), /services must be a non-empty array/],
  ['empty services', (fixture) => ({ ...fixture.config, services: [] }), /services must be a non-empty array/],
  ['malformed service ID', (fixture) => ({ ...fixture.config, services: [{ path: fixture.root }] }), /services entry requires id and path/],
  ['malformed service path', (fixture) => ({ ...fixture.config, services: [{ id: 'dashboard-server' }] }), /services entry requires id and path/],
  ['nonexistent service path', (fixture) => ({ ...fixture.config, services: fixture.services.map((service, index) => index === 0 ? { ...service, path: join(fixture.root, 'missing-service') } : service) }), /repository not found|services entry.*path/],
  ['missing registry path', (fixture) => ({ ...fixture.config, registryPath: undefined }), /registryPath must identify an existing registry/],
  ['nonexistent registry path', (fixture) => ({ ...fixture.config, registryPath: join(fixture.root, 'missing-registry.json') }), /registryPath must identify an existing registry/],
  ['malformed registry JSON', (fixture) => {
    const registryPath = join(fixture.root, 'malformed-registry.json');
    writeFileSync(registryPath, '{');
    return { ...fixture.config, registryPath };
  }, /registryPath must contain valid JSON/],
  ['registry without services', (fixture) => ({ ...fixture.config, registryPath: writeJson(join(fixture.root, 'empty-registry.json'), {}) }), /registry must contain services/],
  ['missing database target', (fixture) => ({ ...fixture.config, localDatabase: { topology: {} } }), /localDatabase target and topology are required/],
  ['remote database topology', (fixture) => ({ ...fixture.config, localDatabase: { target: { host: 'shared-db.example', port: 5432 }, topology: {} } }), /not proven local/],
  ['missing browser path', (fixture) => ({ ...fixture.config, browserExecutable: undefined }), /browserExecutable is required/],
  ['nonexistent browser path', (fixture) => ({ ...fixture.config, browserExecutable: join(fixture.root, 'missing-browser') }), /browser not found|browserExecutable/],
  ['missing dashboard ID', (fixture) => ({ ...fixture.config, dashboardServiceId: undefined }), /dashboardServiceId must name a registered service/],
  ['unknown API ID', (fixture) => ({ ...fixture.config, apiServiceId: 'unknown-api' }), /apiServiceId must name a registered service/],
  ['unknown UI ID', (fixture) => ({ ...fixture.config, uiServiceId: 'unknown-ui' }), /uiServiceId must name a registered service/],
  ['missing plugin path', (fixture) => ({ ...fixture.config, pluginRoot: undefined }), /pluginRoot.*projectRoot.*required/],
  ['nonexistent plugin path', (fixture) => ({ ...fixture.config, pluginRoot: join(fixture.root, 'missing-plugin') }), /pluginRoot.*not found|pluginRoot.*existing/],
  ['missing project path', (fixture) => ({ ...fixture.config, projectRoot: undefined }), /pluginRoot.*projectRoot.*required/],
  ['nonexistent project path', (fixture) => ({ ...fixture.config, projectRoot: join(fixture.root, 'missing-project') }), /projectRoot.*not found|projectRoot.*existing/],
];

describe('registered local-stack E2E adapter configuration', () => {
  for (const [name, invalidConfig, expected] of REJECTION_CASES) {
    test(`rejects ${name} before fixture mutation`, async (t) => {
      const fixture = createAdapterFixture(t);
      await assertConfigurationRejected(invalidConfig(fixture), expected);
    });
  }

  test('creates the concrete registered driver without stackDriverPath or adapterPath', async (t) => {
    const fixture = createAdapterFixture(t);
    const adapter = await createAdapter(fixture.config);

    assert.equal('stackDriverPath' in fixture.config, false);
    assert.equal('adapterPath' in fixture.config, false);
    assert.deepEqual(
      ['inspectPreflight', 'createFixture', 'runMode', 'provisionAndVerify', 'collectEvidence', 'inspectCleanup', 'cleanupResource']
        .filter((method) => typeof adapter[method] !== 'function'),
      [],
    );
  });
});

describe('registry-derived local-stack E2E configuration', () => {
  test('resolves services database browser and protected service IDs without an external driver path', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'local-stack-config-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const projectRoot = join(root, 'project');
    const workspaceRoot = join(root, 'shared-spec-workspace');
    const registryRoot = join(workspaceRoot, 'registry');
    const browserExecutable = join(root, 'browser');
    const dashboardPath = join(root, 'dashboard-server');
    const apiPath = join(root, 'jelou-api');
    const appsPath = join(root, 'jelou-apps');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(workspaceRoot, 'specs'), { recursive: true });
    mkdirSync(registryRoot, { recursive: true });
    mkdirSync(dashboardPath);
    mkdirSync(apiPath);
    mkdirSync(appsPath);
    writeFileSync(browserExecutable, 'browser');
    writeJson(join(projectRoot, '.spec-workspace.json'), { workspace: workspaceRoot });
    writeJson(join(registryRoot, 'registry.json'), {
      services: [
        { id: 'dashboard-server', path: dashboardPath, dev: { launcher: 'npm', command: 'npm run dev', ports: { PORT: 3000 } } },
        { id: 'jelou-api', path: apiPath, dev: { launcher: 'npm', command: 'npm run dev', ports: { PORT: 8080 } } },
      ],
      auth: { dashboardService: 'dashboard-server', verify: [{ service: 'jelou-api', path: '/v1/company' }] },
      frontend: { path: appsPath, command: 'yarn start', port: 5175, envLocal: {} },
      localDatabase: {
        target: { host: '127.0.0.1', port: 5432 },
        registeredLoopbackDatabase: { host: '127.0.0.1', port: 5432, provisioningBoundaryPath: join(root, 'boundary.mjs') },
      },
      network: { basePort: 3100 },
    });

    const config = resolveLocalStackE2eConfig({ cwd: projectRoot, browserExecutable });

    assert.deepEqual(config.services.map(({ id }) => id), ['dashboard-server', 'jelou-api', 'jelou-apps']);
    assert.equal(config.registryPath, join(registryRoot, 'registry.json'));
    assert.equal(config.browserExecutable, browserExecutable);
    assert.equal(config.dashboardServiceId, 'dashboard-server');
    assert.equal(config.apiServiceId, 'jelou-api');
    assert.equal(config.uiServiceId, 'jelou-apps');
    assert.equal(config.localDatabase.target.host, '127.0.0.1');
    assert.equal('stackDriverPath' in config, false);
    assert.equal('adapterPath' in config, false);
  });
});
