// tests/unit/registry-compile-seed.test.mjs
//
// Run: `node --test tests/unit/registry-compile-seed.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYamlLite } from '../../bin/lib/registry/yaml-lite.mjs';
import { normalizeRegistry } from '../../bin/lib/registry/normalize.mjs';
import { compileRegistry, registryJsonPath } from '../../bin/compile-registry.mjs';
import { seedRegistry } from '../../bin/seed-registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '..', '..', 'jelou', 'config', 'jelou-registry.template.yaml');

describe('canonical template', () => {
  test('parses + normalizes into the expected shape', () => {
    const raw = parseYamlLite(readFileSync(TEMPLATE, 'utf8'));
    const reg = normalizeRegistry(raw, { resolve: (p) => (p.startsWith('/') ? p : '/ws/' + p.replace(/^\.\.\//, '')) });
    assert.ok(reg.services.length >= 12, 'all canonical services present');
    const api = reg.services.find((s) => s.id === 'jelou-api');
    assert.equal(api.dev.launcher, 'docker-exec');
    assert.equal(api.dev.port_env, 'APP_PORT');
    assert.equal(api.dev.ports.APP_PORT, 8080);
    assert.equal(api.dev.ports.SUPERVISOR_PORT, 9001);
    assert.deepEqual(api.peers, { 'chatbot-server': 'CHATBOT_SERVER_URL' });
    assert.equal(reg.auth.dashboardService, 'dashboard-server');
    assert.ok(reg.frontend.path.endsWith('jelou-apps'));
    assert.equal(reg.network.basePort, 3100);
  });
});

describe('compileRegistry', () => {
  test('yaml -> normalized registry.json under <workspace>/registry', () => {
    const ws = mkdtempSync(join(tmpdir(), 'jlu-reg-'));
    mkdirSync(join(ws, 'registry'), { recursive: true });
    writeFileSync(join(ws, 'registry', 'jelou-registry.yaml'), [
      'base_port: 3100',
      'services:',
      '  jelou-api:',
      '    path: ../jelou-api',
      '    dev:',
      '      launcher: docker-exec'
    ].join('\n'));
    const out = compileRegistry({ workspaceRoot: ws });
    assert.equal(out.dest, registryJsonPath(ws));
    const reg = JSON.parse(readFileSync(registryJsonPath(ws), 'utf8'));
    assert.equal(reg.services[0].id, 'jelou-api');
    assert.ok(reg.services[0].path.endsWith('/jelou-api'));
    assert.ok(existsSync(registryJsonPath(ws)));
  });
});

describe('service-id divergence between the two sources', () => {
  test('every template id equals the basename of its path, so a derived services.yaml cannot diverge', () => {
    const raw = parseYamlLite(readFileSync(TEMPLATE, 'utf8'));
    const offenders = Object.entries(raw.services)
      .filter(([id, svc]) => id !== svc.path.split('/').filter(Boolean).pop())
      .map(([id, svc]) => `${id} <> ${svc.path}`);
    assert.deepEqual(offenders, [], 'map-codebase derives services.yaml ids from the repo directory name');
  });

  test('compileRegistry refuses when one path is declared under two ids', () => {
    const ws = mkdtempSync(join(tmpdir(), 'jlu-reg-div-'));
    mkdirSync(join(ws, 'registry'), { recursive: true });
    writeFileSync(join(ws, 'registry', 'jelou-registry.yaml'), [
      'base_port: 3100',
      'services:',
      '  jelou-auth-service:',
      '    path: ../auth-service',
      '    dev:',
      '      launcher: docker-exec'
    ].join('\n'));
    writeFileSync(join(ws, 'registry', 'services.yaml'), [
      'services:',
      '  auth-service:',
      '    path: ../auth-service',
      '    dev:',
      '      ready_timeout_s: 90'
    ].join('\n'));
    assert.throws(() => compileRegistry({ workspaceRoot: ws }), /different id in each source[\s\S]*jelou-auth-service[\s\S]*auth-service/);
    assert.equal(existsSync(registryJsonPath(ws)), false, 'never writes a registry that silently loses task isolation');
  });

  test('matching ids compile and still overlay', () => {
    const ws = mkdtempSync(join(tmpdir(), 'jlu-reg-ok-'));
    mkdirSync(join(ws, 'registry'), { recursive: true });
    writeFileSync(join(ws, 'registry', 'jelou-registry.yaml'), [
      'base_port: 3100',
      'services:',
      '  auth-service:',
      '    path: ../auth-service',
      '    dev:',
      '      launcher: docker-exec'
    ].join('\n'));
    writeFileSync(join(ws, 'registry', 'services.yaml'), [
      'services:',
      '  auth-service:',
      '    path: ../auth-service',
      '    dev:',
      '      ready_timeout_s: 90'
    ].join('\n'));
    const out = compileRegistry({ workspaceRoot: ws });
    const reg = JSON.parse(readFileSync(out.dest, 'utf8'));
    assert.equal(reg.services[0].id, 'auth-service');
    assert.equal(reg.services[0].dev.ready_timeout_s, 90);
  });
});

describe('seedRegistry', () => {
  test('seeds the template when absent, then compiles; re-seed does not clobber', () => {
    const ws = mkdtempSync(join(tmpdir(), 'jlu-seed-'));
    const first = seedRegistry({ workspaceRoot: ws });
    assert.equal(first.created, true);
    assert.ok(existsSync(join(ws, 'registry', 'jelou-registry.yaml')));
    assert.ok(existsSync(registryJsonPath(ws)));
    writeFileSync(join(ws, 'registry', 'jelou-registry.yaml'), 'base_port: 9999\nservices:\n  x:\n    path: ../x\n    dev:\n      launcher: npm\n');
    const second = seedRegistry({ workspaceRoot: ws });
    assert.equal(second.created, false);
    assert.equal(JSON.parse(readFileSync(registryJsonPath(ws), 'utf8')).network.basePort, 9999);
  });
});

describe('compileRegistry dev-block integrity', () => {
  function workspaceWithService({ baseCommand, overlayCommand, lockfile }) {
    const root = mkdtempSync(join(tmpdir(), 'jlu-merge-'));
    const ws = join(root, 'workspace');
    mkdirSync(join(ws, 'registry'), { recursive: true });
    mkdirSync(join(root, 'api-gateway-service'), { recursive: true });
    if (lockfile) writeFileSync(join(root, 'api-gateway-service', lockfile), '{}');
    const base = [
      'base_port: 3100',
      'services:',
      '  api-gateway-service:',
      '    path: ../api-gateway-service',
      '    dev:',
      '      launcher: docker-exec',
      `      command: ${baseCommand}`,
      '      port_env: APP_PORT',
      '      ports:',
      '        APP_PORT: 8080'
    ].join('\n');
    writeFileSync(join(ws, 'registry', 'jelou-registry.yaml'), base);
    if (overlayCommand) {
      writeFileSync(join(ws, 'registry', 'services.yaml'), [
        'services:',
        '  api-gateway-service:',
        '    path: ../api-gateway-service',
        '    dev:',
        `      command: ${overlayCommand}`
      ].join('\n'));
    }
    return ws;
  }

  test('services.yaml overrides a stale command while keeping the port topology', () => {
    const ws = workspaceWithService({ baseCommand: 'yarn start:dev', overlayCommand: 'npm run start:dev', lockfile: 'package-lock.json' });
    const { merged } = compileRegistry({ workspaceRoot: ws });
    const reg = JSON.parse(readFileSync(registryJsonPath(ws), 'utf8'));
    assert.equal(reg.services[0].dev.command, 'npm run start:dev');
    assert.deepEqual(reg.services[0].dev.ports, { APP_PORT: 8080 });
    assert.equal(merged[0].id, 'api-gateway-service');
  });

  test('refuses to compile a command that contradicts the repo lockfile', () => {
    const ws = workspaceWithService({ baseCommand: 'yarn start:dev', overlayCommand: null, lockfile: 'package-lock.json' });
    assert.throws(() => compileRegistry({ workspaceRoot: ws }), /wrong package manager[\s\S]*api-gateway-service/);
    assert.equal(existsSync(registryJsonPath(ws)), false);
  });

  test('a genuine yarn project with a yarn command compiles', () => {
    const ws = workspaceWithService({ baseCommand: 'yarn start', overlayCommand: null, lockfile: 'yarn.lock' });
    const { dest } = compileRegistry({ workspaceRoot: ws });
    assert.ok(existsSync(dest));
  });
});
