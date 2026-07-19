// tests/unit/registry-compile-seed.test.mjs
//
// Run: `node --test tests/unit/registry-compile-seed.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseYamlLite } from '../../bin/lib/registry/yaml-lite.mjs';
import { normalizeRegistry } from '../../bin/lib/registry/normalize.mjs';

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
