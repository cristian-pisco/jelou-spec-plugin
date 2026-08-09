// tests/unit/boot-engine-launcher-aware.test.mjs
//
// Run: `node --test tests/unit/boot-engine-launcher-aware.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { isContainerLauncher, startsDevOnUp, taskLogSource } from '../../bin/lib/boot-engine/launcher.mjs';
import { resolveDepsProvision } from '../../bin/lib/boot-engine/deps-provision.mjs';
import { buildBootPlan, resolveFrontendTarget } from '../../bin/lib/boot-engine/plan.mjs';
import { observerPlanFromBootPlan } from '../../bin/lib/dev-orchestrator/stack/observer-plan.mjs';
import { projectName } from '../../bin/lib/dev-orchestrator/stack/override.mjs';
import { wireEnv } from '../../bin/lib/dev-orchestrator/stack/wiring.mjs';

describe('launcher predicates', () => {
  test('docker and docker-exec are container launchers; npm is not', () => {
    assert.equal(isContainerLauncher('docker'), true);
    assert.equal(isContainerLauncher('docker-exec'), true);
    assert.equal(isContainerLauncher('npm'), false);
    assert.equal(isContainerLauncher(undefined), false);
  });

  test('only docker starts its dev command from the image CMD on up', () => {
    assert.equal(startsDevOnUp('docker'), true);
    assert.equal(startsDevOnUp('docker-exec'), false);
    assert.equal(startsDevOnUp('npm'), false);
  });

  test('log source follows who started the process', () => {
    assert.deepEqual(taskLogSource({ launcher: 'docker', projectName: 'svc-t1', logPath: '/tmp/svc-t1.dev.log' }), {
      mode: 'docker-logs',
      container: 'svc-t1'
    });
    assert.deepEqual(taskLogSource({ launcher: 'docker-exec', projectName: 'svc-t1', logPath: '/tmp/svc-t1.dev.log' }), {
      mode: 'exec-file',
      container: 'svc-t1',
      path: '/tmp/svc-t1.dev.log'
    });
  });
});

describe('observerPlanFromBootPlan — launcher aware', () => {
  test('a self-starting task-isolated service is tailed with docker logs', () => {
    const plan = { services: [{ id: 'harness', policy: 'task-isolated', launcher: 'docker', projectName: 'harness-t1' }] };
    assert.deepEqual(observerPlanFromBootPlan(plan), [
      { name: 'harness', policy: 'task-isolated', logMode: 'docker-logs', projectName: 'harness-t1', container: 'harness-t1' }
    ]);
  });

  test('an exec-launched task-isolated service still reads its dev log file', () => {
    const plan = { services: [{ id: 'api', policy: 'task-isolated', launcher: 'docker-exec', projectName: 'api-t1' }] };
    assert.deepEqual(observerPlanFromBootPlan(plan), [
      { name: 'api', policy: 'task-isolated', logMode: 'exec-file', projectName: 'api-t1' }
    ]);
  });
});

describe('resolveDepsProvision — self-starting containers', () => {
  const lockFiles = { '/wt/svc/pnpm-lock.yaml': 'lock-contents' };
  const readFile = (p) => (p in lockFiles ? lockFiles[p] : null);

  test('a shadowed node_modules on a docker launcher reconciles inside the container, never on the host', () => {
    const out = resolveDepsProvision({
      launcher: 'docker',
      serviceId: 'harness',
      slug: 't1',
      worktreeDir: '/wt/svc',
      canonicalPath: '/repo/svc',
      mounts: [
        { type: 'bind', source: '/wt/svc', target: '/app' },
        { type: 'volume', source: null, target: '/app/node_modules' }
      ],
      exists: (p) => p in lockFiles || p === '/wt/svc/node_modules',
      readFile
    });
    assert.equal(out.source, 'image');
    assert.equal(out.install.runs_in, 'container');
    assert.equal(out.install.cwd, '/app');
    assert.match(out.install.cmd, /pnpm install --frozen-lockfile/);
  });

  test('the same shadowed mount on docker-exec still takes the named-volume install path', () => {
    const out = resolveDepsProvision({
      launcher: 'docker-exec',
      serviceId: 'harness',
      slug: 't1',
      worktreeDir: '/wt/svc',
      canonicalPath: '/repo/svc',
      mounts: [
        { type: 'bind', source: '/wt/svc', target: '/app' },
        { type: 'volume', source: null, target: '/app/node_modules' }
      ],
      exists: (p) => p in lockFiles,
      readFile
    });
    assert.equal(out.source, 'named-volume');
    assert.equal(out.install.runs_in, 'container');
  });

  test('a host launcher keeps installing on the host', () => {
    const out = resolveDepsProvision({
      launcher: 'npm',
      serviceId: 'apps',
      slug: 't1',
      worktreeDir: '/wt/svc',
      canonicalPath: '/repo/svc',
      mounts: null,
      exists: (p) => p in lockFiles,
      readFile
    });
    assert.equal(out.source, 'worktree');
    assert.equal(out.install.runs_in, 'host');
  });
});

describe('resolveFrontendTarget', () => {
  const frontend = { path: '/repo/apps', envFile: '.env', command: 'yarn start' };

  test('a slug with a frontend worktree boots that worktree, not the canonical checkout', () => {
    const out = resolveFrontendTarget({
      frontend,
      slug: 't1',
      exists: (p) => p === '/repo/apps/.worktrees/t1' || p === '/repo/apps/.worktrees/t1/.env' || p === '/repo/apps/.worktrees/t1/node_modules'
    });
    assert.equal(out.path, '/repo/apps/.worktrees/t1');
    assert.equal(out.canonicalPath, '/repo/apps');
    assert.equal(out.isWorktree, true);
    assert.equal(out.policy, 'task-isolated');
    assert.equal(out.envSeed, '/repo/apps/.worktrees/t1/.env');
    assert.equal(out.depsPresent, true);
  });

  test('a worktree without its own .env seeds from the canonical checkout', () => {
    const out = resolveFrontendTarget({ frontend, slug: 't1', exists: (p) => p === '/repo/apps/.worktrees/t1' });
    assert.equal(out.envSeed, '/repo/apps/.env');
    assert.equal(out.depsPresent, false);
  });

  test('no worktree for the slug falls back to the canonical checkout', () => {
    const out = resolveFrontendTarget({ frontend, slug: 't1', exists: () => false });
    assert.equal(out.path, '/repo/apps');
    assert.equal(out.isWorktree, false);
    assert.equal(out.policy, 'shared-reuse');
  });

  test('a registry with no frontend block yields null', () => {
    assert.equal(resolveFrontendTarget({ frontend: null, slug: 't1', exists: () => true }), null);
  });
});

describe('buildBootPlan — frontend target', () => {
  test('the plan carries the resolved frontend target alongside the services', () => {
    const registry = {
      network: { basePort: 3100, composeNetworkAlias: 'app-network' },
      frontend: { path: '/repo/apps', envFile: '.env', command: 'yarn start' },
      services: []
    };
    const plan = buildBootPlan({ registry, slug: 't1', worktreePaths: {}, exists: (p) => p === '/repo/apps/.worktrees/t1' });
    assert.equal(plan.frontend.path, '/repo/apps/.worktrees/t1');
    assert.equal(plan.frontend.isWorktree, true);
  });
});

describe('projectName — DNS label safety', () => {
  test('a name that fits is returned verbatim', () => {
    assert.equal(projectName('jelou-api', 'short-slug'), 'jelou-api-short-slug');
  });

  test('a name past the 63-char DNS label limit is truncated with a stable digest', () => {
    const name = projectName('agent-harness-service', 'restore-agent-execution-feedback-after-reload');
    assert.equal(name.length, 63);
    assert.equal(name, projectName('agent-harness-service', 'restore-agent-execution-feedback-after-reload'));
    assert.match(name, /^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    assert.ok(!name.includes('--'));
  });

  test('slugs that differ only past the truncation point stay distinct', () => {
    const base = 'restore-agent-execution-feedback-after-reload-variant';
    assert.notEqual(projectName('agent-harness-service', `${base}-a`), projectName('agent-harness-service', `${base}-b`));
  });

  test('the wired peer URL uses the same DNS-safe host as the container alias', () => {
    const wired = wireEnv({
      envText: 'HARNESS_URL=http://old\n',
      peers: { 'agent-harness-service': 'HARNESS_URL' },
      slug: 'restore-agent-execution-feedback-after-reload',
      peerInternalPort: { 'agent-harness-service': 3000 }
    });
    const host = wired.split('\n')[0].replace('HARNESS_URL=http://', '').replace(':3000', '');
    assert.equal(host, projectName('agent-harness-service', 'restore-agent-execution-feedback-after-reload'));
    assert.ok(host.length <= 63);
  });
});
