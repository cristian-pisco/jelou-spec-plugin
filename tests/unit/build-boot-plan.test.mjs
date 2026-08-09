// tests/unit/build-boot-plan.test.mjs
//
// Run: `node --test tests/unit/build-boot-plan.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlanForWorkspace, unsafeTeardownEntries } from '../../bin/build-boot-plan.mjs';
import { computeWorkspaceId } from '../../bin/lib/dev-orchestrator/workspace.mjs';
import { readStackState, stackStatePath, writeStackState } from '../../bin/lib/dev-orchestrator/stack/stack-state.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'build-boot-plan.mjs');

function hostService(id, teardown) {
  return {
    id,
    path: `/repo/${id}`,
    stack: 'node-hono',
    peers: {},
    depends_on: [],
    dev: {
      launcher: 'shell',
      command: 'pnpm dev',
      teardown,
      port_env: 'PORT',
      ports: { PORT: 8080 },
      ready_signal: { type: 'port_open', port: 8080 },
      ram_estimate_mb: 300,
    },
  };
}

function containerService(id) {
  return {
    id,
    path: `/repo/${id}`,
    stack: 'nestjs',
    peers: {},
    depends_on: [],
    dev: {
      launcher: 'docker-exec',
      command: 'npm run start:dev',
      docker: { service: 'app', compose_file: 'docker-compose.yml' },
      teardown: "docker compose -f docker-compose.yml exec -T app pkill -f 'node' || true",
      port_env: 'APP_PORT',
      ports: { APP_PORT: 8080 },
      ready_signal: { type: 'stdout_match', pattern: 'started' },
      ram_estimate_mb: 350,
    },
  };
}

function registry(services) {
  return { network: { composeNetworkAlias: 'app-network', basePort: 3100 }, services };
}

function makeWorkspace(reg) {
  const ws = mkdtempSync(join(tmpdir(), 'boot-plan-ws-'));
  mkdirSync(join(ws, 'registry'), { recursive: true });
  writeFileSync(join(ws, 'registry', 'registry.json'), JSON.stringify(reg));
  return ws;
}

function planOf(reg) {
  return {
    services: reg.services.map((s) => ({
      id: s.id,
      launcher: s.dev.launcher,
      teardownCmd: s.dev.teardown,
      policy: 'shared-reuse',
    })),
  };
}

function createHybridFixture() {
  const slug = 'hybrid-task';
  const branch = `production/${slug}`;
  const affectedBackend = hostService('api-service', "pkill -f '[a]pi-service.*src/index\\.ts' || true");
  affectedBackend.path = '/repos/api-service';
  affectedBackend.depends_on = ['dashboard-server'];
  affectedBackend.dev.ports.PORT = 4100;
  affectedBackend.dev.ready_signal = { type: 'http_200', path: '/health' };
  const unaffectedBackend = containerService('dashboard-server');
  unaffectedBackend.path = '/repos/dashboard-server';
  unaffectedBackend.dev.ports.APP_PORT = 8484;
  const apps = hostService('jelou-apps', "pkill -f '[j]elou-apps.*vite' || true");
  apps.path = '/repos/jelou-apps';
  apps.depends_on = ['api-service', 'dashboard-server'];
  apps.dev.ports.PORT = 5173;
  const workspaceRoot = makeWorkspace(registry([affectedBackend, unaffectedBackend, apps]));
  const taskContext = {
    slug,
    mode: 'worktree',
    affectedServices: [
      { id: 'api-service', branch },
      { id: 'jelou-apps', branch },
    ],
  };
  const inspectGit = (path) => ({
    topLevel: path,
    commit: path.includes('api-service')
      ? '1111111111111111111111111111111111111111'
      : path.includes('dashboard-server')
        ? '2222222222222222222222222222222222222222'
        : '3333333333333333333333333333333333333333',
    branch: path.includes('.worktrees') ? branch : 'main',
    worktrees: path.includes('.worktrees') ? [{ path, branch, prunable: false }] : [],
  });
  return { slug, branch, workspaceRoot, taskContext, inspectGit };
}

function summarizeHybridDescriptors(plan) {
  return plan.services.map((service) => ({
    id: service.id,
    affected: service.affected,
    sourcePath: service.source.sourcePath,
    commit: service.source.commit,
    launcher: service.launcher,
    topology: service.topology,
    dependencies: service.dependencies,
    ports: service.ports,
    readiness: service.readiness,
    environmentOverlay: service.environmentOverlay,
    ownership: service.ownership,
  }));
}

function expectedHybridDescriptors(workspaceId, slug) {
  const ownerTag = (serviceId, portEnv) => `${workspaceId}:${slug}:task-aware:${serviceId}:${portEnv}`;
  return [
    {
      id: 'api-service', affected: true, sourcePath: `/repos/api-service/.worktrees/${slug}`,
      commit: '1111111111111111111111111111111111111111', launcher: 'shell',
      topology: { runtime: 'host', host: 'localhost', container: null }, dependencies: ['dashboard-server'],
      ports: [{ internal: 4100, host: 4100, portEnv: 'PORT', primary: true, ownerTag: ownerTag('api-service', 'PORT') }],
      readiness: { type: 'http_200', path: '/health', port: 4100 },
      environmentOverlay: { path: null, digest: null, restartRequired: false },
      ownership: { source: 'task', runtime: `${workspaceId}:${slug}:task-aware:api-service` },
    },
    {
      id: 'dashboard-server', affected: false, sourcePath: '/repos/dashboard-server',
      commit: '2222222222222222222222222222222222222222', launcher: 'docker-exec',
      topology: { runtime: 'container', host: 'localhost', container: { service: 'app', network: 'app-network' } }, dependencies: [],
      ports: [{ internal: 8484, host: 8484, portEnv: 'APP_PORT', primary: true, published: false, ownerTag: ownerTag('dashboard-server', 'APP_PORT') }],
      readiness: { type: 'stdout_match', pattern: 'started' },
      environmentOverlay: { path: null, digest: null, restartRequired: false },
      ownership: { source: 'main', runtime: `${workspaceId}:${slug}:task-aware:dashboard-server` },
    },
    {
      id: 'jelou-apps', affected: true, sourcePath: `/repos/jelou-apps/.worktrees/${slug}`,
      commit: '3333333333333333333333333333333333333333', launcher: 'shell',
      topology: { runtime: 'host', host: 'localhost', container: null }, dependencies: ['api-service', 'dashboard-server'],
      ports: [{ internal: 5173, host: 5173, portEnv: 'PORT', primary: true, ownerTag: ownerTag('jelou-apps', 'PORT') }],
      readiness: { type: 'port_open', port: 5173 },
      environmentOverlay: { path: null, digest: null, restartRequired: false },
      ownership: { source: 'task', runtime: `${workspaceId}:${slug}:task-aware:jelou-apps` },
    },
  ];
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initializeRepository(path, name) {
  mkdirSync(path, { recursive: true });
  runGit(path, ['init', '-b', 'main']);
  runGit(path, ['config', 'user.email', 'tests@example.test']);
  runGit(path, ['config', 'user.name', 'Jelou Tests']);
  writeFileSync(join(path, 'package.json'), `${JSON.stringify({ name })}\n`);
  runGit(path, ['add', 'package.json']);
  runGit(path, ['commit', '-m', 'fixture']);
  return runGit(path, ['rev-parse', 'HEAD']);
}

function createCliTaskFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'build-plan-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const projectRoot = join(root, 'project');
  const workspaceRoot = join(root, 'shared-spec-workspace');
  const apiPath = join(root, 'repositories', 'api-service');
  const appsPath = join(root, 'repositories', 'jelou-apps');
  const slug = 'dated-cli-task';
  const branch = `production/${slug}`;
  const apiCommit = initializeRepository(apiPath, 'api-service');
  const appsCommit = initializeRepository(appsPath, 'jelou-apps');
  const apiWorktree = join(apiPath, '.worktrees', slug);
  mkdirSync(dirname(apiWorktree), { recursive: true });
  runGit(apiPath, ['worktree', 'add', '-b', branch, apiWorktree, apiCommit]);
  mkdirSync(join(projectRoot, 'registry'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'specs', '08-08-2026', slug), { recursive: true });
  writeFileSync(join(projectRoot, '.spec-workspace.json'), `${JSON.stringify({ workspace: workspaceRoot })}\n`);
  const service = hostService('api-service', "pkill -f '[a]pi-service.*src/index\\.ts' || true");
  service.path = apiPath;
  const compiled = {
    ...registry([service]),
    frontend: {
      path: appsPath,
      command: 'yarn start --host 127.0.0.1',
      port: 5175,
      envLocal: { NX_REACT_APP_JELOU_API_BASE: { service: 'api-service', suffix: '/v1' } },
    },
  };
  writeFileSync(join(projectRoot, 'registry', 'registry.json'), `${JSON.stringify(compiled)}\n`);
  const tasks = `---\naffected_services:\n  - id: api-service\n    sub_state: implementing\n    branch: ${branch}\n---\n\n# TASKS: CLI fixture\n\n## Status: implementing\n\n| Field | Value |\n|---|---|\n| Slug | ${slug} |\n| Created | 08-08-2026 |\n| Status | implementing |\n\n## Branching\n\n- Mode: worktree\n`;
  writeFileSync(join(workspaceRoot, 'specs', '08-08-2026', slug, 'TASKS.md'), tasks);
  writeFileSync(join(workspaceRoot, 'specs', '08-08-2026', slug, 'SPEC.md'), '# CLI fixture\n');
  const fakeBin = join(root, 'fake-bin');
  mkdirSync(fakeBin);
  for (const command of ['ss', 'docker']) {
    const path = join(fakeBin, command);
    writeFileSync(path, '#!/bin/sh\nexit 0\n');
    chmodSync(path, 0o755);
  }
  return { projectRoot, workspaceRoot, apiPath, apiWorktree, appsPath, apiCommit, appsCommit, slug, fakeBin, runtimeRoot: join(root, 'runtime') };
}

describe('unsafeTeardownEntries', () => {
  test('flags a host entry whose teardown kills every such process on the machine', () => {
    const found = unsafeTeardownEntries(planOf(registry([hostService('legacy-api', "pkill -f 'node' || true")])));
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'legacy-api');
    assert.match(found[0].cause, /unsafe_teardown/);
    assert.match(found[0].cause, /'node'/);
  });

  test('an anchored host teardown and a container-scoped one are both fine', () => {
    const reg = registry([
      hostService('scoped-api', "pkill -f '[s]coped-api.*src/index\\.ts' || true"),
      containerService('jelou-api'),
    ]);
    assert.deepEqual(unsafeTeardownEntries(planOf(reg)), []);
  });

  test('flags task-isolated entries too — the registry string is lethal either way', () => {
    const plan = planOf(registry([hostService('legacy-api', "pkill -f 'vite' || true")]));
    plan.services[0].policy = 'task-isolated';
    assert.equal(unsafeTeardownEntries(plan).length, 1);
  });

  test('a plan with no services yields nothing', () => {
    assert.deepEqual(unsafeTeardownEntries({ services: [] }), []);
  });
});

describe('buildPlanForWorkspace — refuses to hand back a plan carrying an unsafe teardown', () => {
  test('throws naming the service and the pattern', () => {
    const ws = makeWorkspace(registry([containerService('jelou-api'), hostService('legacy-api', "pkill -f 'node' || true")]));
    assert.throws(
      () => buildPlanForWorkspace({ workspaceRoot: ws, slug: 't1', worktreePaths: {}, occupied: [] }),
      /unsafe_teardown.*legacy-api|legacy-api.*unsafe_teardown/s,
    );
  });

  test('a clean registry builds normally', () => {
    const ws = makeWorkspace(registry([containerService('jelou-api')]));
    const plan = buildPlanForWorkspace({ workspaceRoot: ws, slug: 't1', worktreePaths: {}, occupied: [] });
    assert.equal(plan.services.length, 1);
    assert.equal(plan.slug, 't1');
  });
});

describe('buildPlanForWorkspace — normalized source contract', () => {
  test('reports the exact canonical source and commit for explicit main mode', () => {
    const serviceId = 'scoped-api';
    const sourcePath = `/repo/${serviceId}`;
    const ws = makeWorkspace(registry([hostService(serviceId, "pkill -f '[s]coped-api.*src/index\\.ts' || true")]));
    const plan = buildPlanForWorkspace({
      workspaceRoot: ws,
      slug: 't1',
      sourceMode: 'main',
      occupied: [],
      pathExists: () => true,
      inspectGit: (path) => ({
        topLevel: path,
        commit: 'dddddddddddddddddddddddddddddddddddddddd',
        branch: 'main',
        worktrees: [],
      }),
    });

    assert.equal(plan.sourceMode, 'main');
    assert.deepEqual(plan.services[0].source, {
      mode: 'main',
      taskSlug: null,
      serviceId,
      affected: false,
      sourcePath,
      commit: 'dddddddddddddddddddddddddddddddddddddddd',
      branch: 'main',
      ownership: 'main',
    });
  });
});

describe('buildPlanForWorkspace — complete hybrid descriptors', () => {
  test('describes affected and unaffected backends plus jelou-apps through one boot contract', () => {
    const fixture = createHybridFixture();
    const plan = buildPlanForWorkspace({
      workspaceRoot: fixture.workspaceRoot,
      slug: fixture.slug,
      sourceMode: 'task-aware',
      taskContext: fixture.taskContext,
      occupied: [],
      pathExists: () => true,
      inspectGit: fixture.inspectGit,
    });

    assert.equal(plan.sourceMode, 'task-aware');
    assert.equal(plan.services.length, 3);
    assert.deepEqual(plan.services.map((service) => service.id), ['api-service', 'dashboard-server', 'jelou-apps']);
    assert.deepEqual(
      summarizeHybridDescriptors(plan),
      expectedHybridDescriptors(computeWorkspaceId(fixture.workspaceRoot), fixture.slug),
    );
  });

  test('reuses the same deterministic allocation from task-scoped runtime state', () => {
    const slug = 'stable-task';
    const service = hostService('api-service', "pkill -f '[a]pi-service.*src/index\\.ts' || true");
    service.path = '/repos/api-service';
    const ws = makeWorkspace(registry([service]));
    const workspaceId = computeWorkspaceId(ws);
    const stateBaseDir = mkdtempSync(join(tmpdir(), 'boot-plan-state-'));
    const liveDefault = [{ port: 8080, ownerTag: 'another-workspace:other-task:task-aware:api-service:PORT', pid: 41 }];
    const input = {
      workspaceRoot: ws,
      slug,
      sourceMode: 'main',
      taskContext: { slug },
      livePorts: liveDefault,
      persistState: true,
      stateBaseDir,
      pathExists: () => true,
      inspectGit: (path) => ({
        topLevel: path,
        commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        branch: 'main',
        worktrees: [],
      }),
    };

    const first = buildPlanForWorkspace(input);
    const allocation = first.services[0].ports[0];
    const second = buildPlanForWorkspace({
      ...input,
      livePorts: [...liveDefault, { port: allocation.host, ownerTag: allocation.ownerTag, pid: 42 }],
    });

    assert.notEqual(allocation.host, 8080);
    assert.deepEqual(second.services[0].ports, first.services[0].ports);
    assert.deepEqual(
      readStackState({ workspaceId, slug, baseDir: stateBaseDir }).portAllocations,
      first.services[0].ports.map((port) => ({ serviceId: 'api-service', ...port })),
    );
  });

  test('an affected branch-mode service launches from its exact canonical task source', () => {
    const slug = 'branch-task';
    const branch = `production/${slug}`;
    const apps = hostService('jelou-apps', "pkill -f '[j]elou-apps.*vite' || true");
    apps.path = '/repos/jelou-apps';
    apps.dev.ports.PORT = 5173;
    const ws = makeWorkspace(registry([apps]));

    const plan = buildPlanForWorkspace({
      workspaceRoot: ws,
      slug,
      sourceMode: 'task-aware',
      taskContext: {
        slug,
        mode: 'branch',
        affectedServices: [{ id: 'jelou-apps', branch }],
      },
      livePorts: [],
      pathExists: () => true,
      inspectGit: (path) => ({
        topLevel: path,
        commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        branch,
        worktrees: [],
      }),
    });

    assert.equal(plan.services[0].cwd, '/repos/jelou-apps');
    assert.equal(plan.services[0].policy, 'task-isolated');
    assert.equal(plan.services[0].source.sourcePath, '/repos/jelou-apps');
    assert.equal(plan.services[0].source.commit, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  test('keeps deterministic allocations isolated across source-mode switches', () => {
    const slug = 'mode-switch-task';
    const branch = `production/${slug}`;
    const service = hostService('api-service', "pkill -f '[a]pi-service.*src/index\\.ts' || true");
    service.path = '/repos/api-service';
    const ws = makeWorkspace(registry([service]));
    const workspaceId = computeWorkspaceId(ws);
    const stateBaseDir = mkdtempSync(join(tmpdir(), 'boot-plan-state-'));
    const common = {
      workspaceRoot: ws,
      slug,
      taskContext: {
        slug,
        mode: 'worktree',
        affectedServices: [{ id: 'api-service', branch }],
      },
      persistState: true,
      stateBaseDir,
      pathExists: () => true,
      inspectGit: (path) => ({
        topLevel: path,
        commit: path.includes('.worktrees') ? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        branch: path.includes('.worktrees') ? branch : 'main',
        worktrees: path.includes('.worktrees') ? [{ path, branch, prunable: false }] : [],
      }),
    };

    const main = buildPlanForWorkspace({ ...common, sourceMode: 'main', livePorts: [] });
    const taskAware = buildPlanForWorkspace({
      ...common,
      sourceMode: 'task-aware',
      livePorts: [{ port: main.services[0].ports[0].host, ownerTag: main.services[0].ports[0].ownerTag, pid: 51 }],
    });
    const stored = readStackState({ workspaceId, slug, baseDir: stateBaseDir }).portAllocations;

    assert.notEqual(taskAware.services[0].ports[0].host, main.services[0].ports[0].host);
    assert.deepEqual(stored.map((allocation) => allocation.ownerTag).sort(), [
      `${workspaceId}:${slug}:main:api-service:PORT`,
      `${workspaceId}:${slug}:task-aware:api-service:PORT`,
    ]);
  });
});

describe('buildPlanForWorkspace — preflight mutation boundary', () => {
  test('an unsafe descriptor creates no runtime state', () => {
    const slug = 'preflight-task';
    const ws = makeWorkspace(registry([hostService('legacy-api', "pkill -f 'node' || true")]));
    const workspaceId = computeWorkspaceId(ws);
    const stateBaseDir = mkdtempSync(join(tmpdir(), 'boot-plan-state-'));
    const stateOptions = { workspaceId, slug, baseDir: stateBaseDir };

    assert.throws(
      () => buildPlanForWorkspace({
        workspaceRoot: ws,
        slug,
        sourceMode: 'main',
        taskContext: { slug },
        livePorts: [],
        persistState: true,
        stateBaseDir,
        pathExists: () => true,
        inspectGit: (path) => ({ topLevel: path, commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', branch: 'main', worktrees: [] }),
      }),
      /unsafe_teardown.*legacy-api|legacy-api.*unsafe_teardown/s,
    );
    assert.equal(existsSync(stackStatePath(stateOptions)), false);
  });

  test('an unrelated live owner leaves the persisted allocation unchanged', () => {
    const slug = 'preflight-task';
    const service = hostService('api-service', "pkill -f '[a]pi-service.*src/index\\.ts' || true");
    service.path = '/repos/api-service';
    const ws = makeWorkspace(registry([service]));
    const workspaceId = computeWorkspaceId(ws);
    const stateBaseDir = mkdtempSync(join(tmpdir(), 'boot-plan-state-'));
    const stateOptions = { workspaceId, slug, baseDir: stateBaseDir };
    const ownerTag = `${workspaceId}:${slug}:main:api-service:PORT`;
    const portAllocations = [{ serviceId: 'api-service', portEnv: 'PORT', internal: 8080, host: 43210, primary: true, ownerTag }];
    writeStackState(stateOptions, { ...readStackState(stateOptions), portAllocations });

    assert.throws(
      () => buildPlanForWorkspace({
        workspaceRoot: ws,
        slug,
        sourceMode: 'main',
        taskContext: { slug },
        livePorts: [{ port: 43210, ownerTag: null, pid: 912, command: 'python local-server.py' }],
        persistState: true,
        stateBaseDir,
        pathExists: () => true,
        inspectGit: (path) => ({ topLevel: path, commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', branch: 'main', worktrees: [] }),
      }),
      /api-service.*43210.*unrelated.*912/i,
    );
    assert.deepEqual(readStackState(stateOptions).portAllocations, portAllocations);
  });
});

describe('buildPlanForWorkspace — task-scoped environment overlays', () => {
  test('persists a deterministic routed-only overlay without changing the source environment', (t) => {
    const consumer = hostService('consumer', "pkill -f '[c]onsumer.*src/index\\.ts' || true");
    const provider = hostService('provider', "pkill -f '[p]rovider.*src/index\\.ts' || true");
    const sourceRoot = mkdtempSync(join(tmpdir(), 'boot-plan-sources-'));
    t.after(() => rmSync(sourceRoot, { recursive: true, force: true }));
    consumer.path = join(sourceRoot, 'consumer');
    provider.path = join(sourceRoot, 'provider');
    consumer.peers = { provider: 'API_URL' };
    consumer.depends_on = ['provider'];
    consumer.dev.ports.PORT = 4100;
    provider.dev.ports.PORT = 4200;
    mkdirSync(consumer.path, { recursive: true });
    mkdirSync(provider.path, { recursive: true });
    const sourceEnv = 'API_URL=https://production.example\nSECRET=developer-owned\n';
    writeFileSync(join(consumer.path, '.env'), sourceEnv);
    const ws = makeWorkspace(registry([consumer, provider]));
    t.after(() => rmSync(ws, { recursive: true, force: true }));
    const workspaceId = computeWorkspaceId(ws);
    const stateBaseDir = mkdtempSync(join(tmpdir(), 'boot-plan-state-'));
    t.after(() => rmSync(stateBaseDir, { recursive: true, force: true }));
    const input = {
      workspaceRoot: ws,
      slug: 'overlay-task',
      sourceMode: 'main',
      taskContext: { slug: 'overlay-task' },
      livePorts: [],
      persistState: true,
      stateBaseDir,
      pathExists: () => true,
      inspectGit: (path) => ({ topLevel: path, commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', branch: 'main', worktrees: [] }),
    };

    const first = buildPlanForWorkspace(input);
    const second = buildPlanForWorkspace(input);
    const overlay = first.services.find((service) => service.id === 'consumer').environmentOverlay;
    const stored = readStackState({ workspaceId, slug: 'overlay-task', baseDir: stateBaseDir });

    assert.equal(readFileSync(join(consumer.path, '.env'), 'utf8'), sourceEnv);
    assert.equal(readFileSync(overlay.path, 'utf8'), 'API_URL=http://localhost:4200\n');
    assert.match(overlay.digest, /^[a-f0-9]{64}$/);
    assert.equal(overlay.path.includes('/overlays/main/consumer.env'), true);
    assert.deepEqual(second.services.find((service) => service.id === 'consumer').environmentOverlay, overlay);
    assert.deepEqual(stored.environmentOverlays, [{ serviceId: 'consumer', sourceMode: 'main', path: overlay.path, digest: overlay.digest }]);
    assert.equal(statSync(overlay.path).mode & 0o777, 0o600);
  });

  test('a changed overlay digest requires the consumer to restart before readiness', (t) => {
    const consumer = hostService('consumer', "pkill -f '[c]onsumer.*src/index\\.ts' || true");
    const providerA = hostService('provider-a', "pkill -f '[p]rovider-a.*src/index\\.ts' || true");
    const providerB = hostService('provider-b', "pkill -f '[p]rovider-b.*src/index\\.ts' || true");
    consumer.peers = { 'provider-a': 'API_URL' };
    consumer.dev.ports.PORT = 4100;
    providerA.dev.ports.PORT = 4200;
    providerB.dev.ports.PORT = 4300;
    const ws = makeWorkspace(registry([consumer, providerA, providerB]));
    t.after(() => rmSync(ws, { recursive: true, force: true }));
    const workspaceId = computeWorkspaceId(ws);
    const stateBaseDir = mkdtempSync(join(tmpdir(), 'boot-plan-state-'));
    t.after(() => rmSync(stateBaseDir, { recursive: true, force: true }));
    const input = {
      workspaceRoot: ws,
      slug: 'overlay-change-task',
      sourceMode: 'main',
      taskContext: { slug: 'overlay-change-task' },
      livePorts: [],
      persistState: true,
      stateBaseDir,
      pathExists: () => true,
      inspectGit: (path) => ({ topLevel: path, commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', branch: 'main', worktrees: [] }),
    };

    const first = buildPlanForWorkspace(input);
    consumer.peers = { 'provider-b': 'API_URL' };
    writeFileSync(join(ws, 'registry', 'registry.json'), JSON.stringify(registry([consumer, providerA, providerB])));
    const second = buildPlanForWorkspace(input);
    const firstOverlay = first.services.find((service) => service.id === 'consumer').environmentOverlay;
    const secondOverlay = second.services.find((service) => service.id === 'consumer').environmentOverlay;
    const stored = readStackState({ workspaceId, slug: 'overlay-change-task', baseDir: stateBaseDir });

    assert.notEqual(secondOverlay.digest, firstOverlay.digest);
    assert.equal(secondOverlay.restartRequired, true);
    assert.equal(readFileSync(secondOverlay.path, 'utf8'), 'API_URL=http://localhost:4300\n');
    assert.equal(stored.environmentOverlays.find((overlay) => overlay.serviceId === 'consumer').digest, secondOverlay.digest);
  });
});

describe('build-boot-plan CLI', () => {
  function run(ws, args = []) {
    return spawnSync(process.execPath, [CLI, '--workspace', ws, '--slug', 't1', ...args], { encoding: 'utf8' });
  }

  test('exits non-zero with the cause and prints NO plan when a teardown is unsafe', () => {
    const r = run(makeWorkspace(registry([hostService('legacy-api', "pkill -f 'node' || true")])));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unsafe_teardown/);
    assert.match(r.stderr, /legacy-api/);
    assert.equal(r.stdout.trim(), '');
  });

  test('missing arguments still exit 2', () => {
    const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });

  test('rejects an unsupported explicit source mode before emitting a plan', () => {
    const r = run(makeWorkspace(registry([hostService('scoped-api', "pkill -f '[s]coped-api.*src/index\\.ts' || true")])), ['--source-mode', 'worktree']);
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /unsupported source mode.*worktree.*main.*task-aware/i);
  });

  test('resolves dated shared task metadata through the project pointer while reading the separate project registry', (t) => {
    const fixture = createCliTaskFixture(t);
    const result = spawnSync(process.execPath, [
      CLI,
      '--workspace', fixture.projectRoot,
      '--slug', fixture.slug,
      '--source-mode', 'task-aware',
    ], {
      cwd: fixture.projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixture.fakeBin}:${process.env.PATH}`,
        JLU_HOME: fixture.runtimeRoot,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    const api = plan.services.find((service) => service.id === 'api-service');
    const apps = plan.services.find((service) => service.id === 'jelou-apps');
    assert.equal(plan.sourceMode, 'task-aware');
    assert.deepEqual(api.source, {
      mode: 'worktree',
      taskSlug: fixture.slug,
      serviceId: 'api-service',
      affected: true,
      sourcePath: fixture.apiWorktree,
      commit: fixture.apiCommit,
      branch: `production/${fixture.slug}`,
      ownership: 'task',
    });
    assert.equal(apps.source.sourcePath, fixture.appsPath);
    assert.equal(apps.source.commit, fixture.appsCommit);
    assert.equal(apps.source.affected, false);
    assert.equal(apps.launcher, 'npm');
    assert.deepEqual(apps.dependencies, ['api-service']);
    assert.deepEqual(apps.topology, { runtime: 'host', host: 'localhost', container: null });
    assert.deepEqual(apps.ports.map(({ internal, host, portEnv, primary }) => ({ internal, host, portEnv, primary })), [
      { internal: 5175, host: 5175, portEnv: 'PORT', primary: true },
    ]);
    assert.deepEqual(apps.readiness, { type: 'http_200', path: '/', port: 5175 });
    assert.equal(apps.ownership.source, 'main');
    assert.match(apps.environmentOverlay.path, /overlays\/task-aware\/jelou-apps\.env$/);
    assert.equal(readFileSync(apps.environmentOverlay.path, 'utf8'), 'NX_REACT_APP_JELOU_API_BASE=http://localhost:8080/v1\n');
    assert.equal(existsSync(join(fixture.workspaceRoot, 'registry', 'registry.json')), false);
  });
});
