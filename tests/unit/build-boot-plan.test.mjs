// tests/unit/build-boot-plan.test.mjs
//
// Run: `node --test tests/unit/build-boot-plan.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlanForWorkspace, unsafeTeardownEntries } from '../../bin/build-boot-plan.mjs';

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
});
