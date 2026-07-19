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
    assert.equal(out, registryJsonPath(ws));
    const reg = JSON.parse(readFileSync(registryJsonPath(ws), 'utf8'));
    assert.equal(reg.services[0].id, 'jelou-api');
    assert.ok(reg.services[0].path.endsWith('/jelou-api'));
    assert.ok(existsSync(registryJsonPath(ws)));
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
