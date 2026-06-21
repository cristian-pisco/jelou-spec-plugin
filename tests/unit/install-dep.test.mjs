// tests/unit/install-dep.test.mjs
//
// Tests for bin/lib/install-dep.mjs — the pure planner behind the runtime-aware
// dependency installer. A docker-compose-runtime service must install INSIDE its
// container (booting it first if down); a host-runtime or unregistered service
// installs on the host, as before.
//
// Run: `node --test tests/unit/install-dep.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planInstall } from '../../bin/lib/install-dep.mjs';
import { executeInstall } from '../../bin/install-dep.mjs';

function scratch(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'install-dep-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

const dockerService = {
  name: 'datum-service',
  runtime: { type: 'docker-compose', compose_file: 'docker-compose.yml', compose_service: 'app' }
};

describe('planInstall — host runtime', () => {
  test('npm host install when runtime.type is host', () => {
    const dir = scratch({ 'package-lock.json': '{}' });
    const plan = planInstall({ service: { name: 's', runtime: { type: 'host' } }, serviceDir: dir, packages: ['lodash'] });
    assert.equal(plan.runtime, 'host');
    assert.equal(plan.packageManager, 'npm');
    assert.deepEqual(plan.steps.map((s) => s.kind), ['install']);
    assert.equal(plan.steps[0].runs_in, 'host');
    assert.equal(plan.steps[0].cmd, 'npm install lodash');
    assert.equal(plan.steps[0].cwd, dir);
  });

  test('unregistered service (no runtime block) falls back to host', () => {
    const dir = scratch({ 'yarn.lock': '' });
    const plan = planInstall({ service: null, serviceDir: dir, packages: ['lodash'] });
    assert.equal(plan.runtime, 'host');
    assert.equal(plan.steps[0].cmd, 'yarn add lodash');
  });

  test('--dev flag and package manager variants', () => {
    const npm = scratch({ 'package-lock.json': '{}' });
    const pnpm = scratch({ 'pnpm-lock.yaml': '' });
    const yarn = scratch({ 'yarn.lock': '' });
    assert.equal(planInstall({ service: null, serviceDir: npm, packages: ['jest'], dev: true }).steps[0].cmd, 'npm install -D jest');
    assert.equal(planInstall({ service: null, serviceDir: pnpm, packages: ['jest'], dev: true }).steps[0].cmd, 'pnpm add -D jest');
    assert.equal(planInstall({ service: null, serviceDir: yarn, packages: ['jest'], dev: true }).steps[0].cmd, 'yarn add -D jest');
  });

  test('multiple packages are space-joined', () => {
    const dir = scratch({ 'package-lock.json': '{}' });
    const plan = planInstall({ service: null, serviceDir: dir, packages: ['a@^1.0.0', 'b'] });
    assert.equal(plan.steps[0].cmd, 'npm install a@^1.0.0 b');
  });
});

describe('planInstall — docker-compose runtime', () => {
  test('three-step plan: check, boot, exec-install', () => {
    const dir = scratch({ 'package-lock.json': '{}' });
    const plan = planInstall({ service: dockerService, serviceDir: dir, packages: ['@jeloulatam/elastic-db@^2.3.0'] });
    assert.equal(plan.runtime, 'docker-compose');
    assert.deepEqual(plan.steps.map((s) => s.kind), ['check', 'boot', 'install']);
    assert.equal(plan.steps[0].cmd, 'docker compose -f docker-compose.yml ps --status running --services');
    assert.equal(plan.steps[0].expectService, 'app');
    assert.equal(plan.steps[1].cmd, 'docker compose -f docker-compose.yml up -d app');
    assert.equal(plan.steps[1].onlyIfDown, true);
    assert.equal(plan.steps[2].runs_in, 'container');
    assert.equal(
      plan.steps[2].cmd,
      'docker compose -f docker-compose.yml exec app npm install @jeloulatam/elastic-db@^2.3.0'
    );
  });

  test('custom exec_template is substituted', () => {
    const dir = scratch({ 'pnpm-lock.yaml': '' });
    const svc = {
      runtime: {
        type: 'docker-compose',
        compose_file: 'compose.yaml',
        compose_service: 'api',
        exec_template: 'docker compose -f {compose_file} exec -T {compose_service} sh -lc "{cmd}"'
      }
    };
    const plan = planInstall({ service: svc, serviceDir: dir, packages: ['zod'] });
    assert.equal(plan.steps[2].cmd, 'docker compose -f compose.yaml exec -T api sh -lc "pnpm add zod"');
  });

  test('non-node lockfile warns but still emits an exec-wrapped npm install', () => {
    const dir = scratch({ 'requirements.txt': 'flask' });
    const plan = planInstall({ service: dockerService, serviceDir: dir, packages: ['x'] });
    assert.equal(plan.packageManager, 'npm');
    assert.equal(plan.warnings.length, 1);
    assert.match(plan.warnings[0], /no node lockfile/);
    assert.equal(plan.steps[2].cmd, 'docker compose -f docker-compose.yml exec app npm install x');
  });
});

describe('planInstall — validation', () => {
  test('throws when no packages given', () => {
    assert.throws(() => planInstall({ service: null, serviceDir: '/tmp', packages: [] }), /at least one package/);
  });
});

describe('executeInstall — orchestration', () => {
  function fakeRunner(scripts) {
    const calls = [];
    const runner = (cmd, opts) => {
      calls.push(cmd);
      const status = scripts[cmd] !== undefined ? scripts[cmd] : 0;
      return { status };
    };
    return { runner, calls };
  }

  test('host runtime runs the single install command', () => {
    const dir = scratch({ 'package-lock.json': '{}' });
    const plan = planInstall({ service: null, serviceDir: dir, packages: ['lodash'] });
    const { runner, calls } = fakeRunner({});
    const code = executeInstall({ plan, serviceDir: dir, runner, log: () => {} });
    assert.equal(code, 0);
    assert.deepEqual(calls, ['npm install lodash']);
  });

  test('docker-compose: container down → boots then installs', () => {
    const dir = scratch({ 'package-lock.json': '{}' });
    const plan = planInstall({ service: dockerService, serviceDir: dir, packages: ['x'] });
    const { runner, calls } = fakeRunner({});
    const code = executeInstall({ plan, serviceDir: dir, runner, probe: () => false, log: () => {} });
    assert.equal(code, 0);
    assert.deepEqual(calls, [
      'docker compose -f docker-compose.yml up -d app',
      'docker compose -f docker-compose.yml exec app npm install x'
    ]);
  });

  test('docker-compose: container up → skips boot, installs', () => {
    const dir = scratch({ 'package-lock.json': '{}' });
    const plan = planInstall({ service: dockerService, serviceDir: dir, packages: ['x'] });
    const { runner, calls } = fakeRunner({});
    const code = executeInstall({ plan, serviceDir: dir, runner, probe: () => true, log: () => {} });
    assert.equal(code, 0);
    assert.deepEqual(calls, ['docker compose -f docker-compose.yml exec app npm install x']);
  });

  test('docker-compose: failed boot aborts before install', () => {
    const dir = scratch({ 'package-lock.json': '{}' });
    const plan = planInstall({ service: dockerService, serviceDir: dir, packages: ['x'] });
    const { runner, calls } = fakeRunner({ 'docker compose -f docker-compose.yml up -d app': 1 });
    const code = executeInstall({ plan, serviceDir: dir, runner, probe: () => false, log: () => {} });
    assert.equal(code, 1);
    assert.deepEqual(calls, ['docker compose -f docker-compose.yml up -d app']);
  });
});
