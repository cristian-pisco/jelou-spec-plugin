// tests/unit/dev-orchestrator-config.test.mjs
//
// Run: `node --test tests/unit/dev-orchestrator-config.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateConfig, writeConfigAtomic } from '../../bin/lib/dev-orchestrator/config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures', 'dev-orchestrator', 'configs');

function load(name) {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
}

describe('validateConfig — happy path', () => {
  test('accepts the minimal valid config', () => {
    const result = validateConfig(load('valid-minimal.json'));
    assert.equal(result.valid, true, `errors: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.errors, []);
  });

  test('accepts the full valid config', () => {
    const result = validateConfig(load('valid-full.json'));
    assert.equal(result.valid, true, `errors: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.errors, []);
  });
});

describe('validateConfig — package_manager', () => {
  function withManager(package_manager) {
    const cfg = load('valid-minimal.json');
    cfg.services[0] = { ...cfg.services[0], package_manager };
    return validateConfig(cfg);
  }

  test('accepts every supported manager', () => {
    for (const pm of ['npm', 'yarn', 'pnpm', 'bun']) {
      assert.equal(withManager(pm).valid, true, `rejected ${pm}`);
    }
  });

  test('stays optional', () => {
    assert.equal(validateConfig(load('valid-minimal.json')).valid, true);
  });

  test('rejects a typo instead of letting it reach an install command', () => {
    const result = withManager('pnmp');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('package_manager')), result.errors.join(', '));
  });
});

describe('validateConfig — invalid configs', () => {
  test('rejects duplicate service names', () => {
    const result = validateConfig(load('invalid-duplicate-name.json'));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('duplicate')), `errors: ${result.errors.join(', ')}`);
  });

  test('rejects unparseable regex in log_failure_patterns', () => {
    const result = validateConfig(load('invalid-bad-regex.json'));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.toLowerCase().includes('regex')), `errors: ${result.errors.join(', ')}`);
  });

  test('rejects docker-compose runtime without compose_service', () => {
    const result = validateConfig(load('invalid-runtime.json'));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('compose_service')), `errors: ${result.errors.join(', ')}`);
  });

  test('rejects missing required services field', () => {
    const result = validateConfig({ version: 1 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('services')), `errors: ${result.errors.join(', ')}`);
  });

  test('rejects wrong version', () => {
    const result = validateConfig({ version: 2, services: [] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('version')), `errors: ${result.errors.join(', ')}`);
  });

  test('rejects invalid name pattern', () => {
    const result = validateConfig({
      version: 1,
      services: [{ name: 'API_GATEWAY', path: '.', command: 'x' }]
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('name')), `errors: ${result.errors.join(', ')}`);
  });
});

describe('validateConfig — numeric and additionalProperties checks', () => {
  test('rejects defaults.poll_interval_ms below 250', () => {
    const result = validateConfig({ version: 1, services: [], defaults: { poll_interval_ms: 100 } });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(e => e.includes('poll_interval_ms') && e.includes('>=')),
      `errors: ${result.errors.join(', ')}`
    );
  });

  test('rejects unknown key on a service', () => {
    const result = validateConfig({
      version: 1,
      services: [{ name: 'a', path: '.', command: 'x', foo: 'bar' }]
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(e => e.includes('unknown key') && e.includes('foo')),
      `errors: ${result.errors.join(', ')}`
    );
  });

  test('rejects unknown key on defaults', () => {
    const result = validateConfig({ version: 1, services: [], defaults: { not_a_real_key: true } });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(e => e.includes('unknown key')),
      `errors: ${result.errors.join(', ')}`
    );
  });

  test('rejects http expect_status that is not an integer', () => {
    const result = validateConfig({
      version: 1,
      services: [{
        name: 'svc',
        path: '.',
        command: 'x',
        readiness: { type: 'http', url: 'http://x', expect_status: 'two-hundred' }
      }]
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(e => e.includes('expect_status')),
      `errors: ${result.errors.join(', ')}`
    );
  });

  test('rejects tcp port out of range', () => {
    const result = validateConfig({
      version: 1,
      services: [{
        name: 'svc',
        path: '.',
        command: 'x',
        readiness: { type: 'tcp', host: 'x', port: 70000 }
      }]
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(e => e.includes('port') && e.includes('<=')),
      `errors: ${result.errors.join(', ')}`
    );
  });
});

describe('validateConfig — panel.layout', () => {
  test('rejects unknown panel.layout', () => {
    const result = validateConfig({
      version: 1,
      services: [{ name: 'a', path: '.', command: 'x', panel: { layout: 'nope' } }]
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('layout')), `errors: ${result.errors.join(', ')}`);
  });

  test('accepts known panel.layout', () => {
    const result = validateConfig({
      version: 1,
      services: [{ name: 'a', path: '.', command: 'x', panel: { layout: 'main-horizontal' } }]
    });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });
});

describe('writeConfigAtomic — refuses invalid', () => {
  test('rejects invalid config without writing the target file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jlu-cfg-'));
    const target = join(dir, 'jlu-services.json');
    assert.throws(
      () => writeConfigAtomic(target, { version: 2, services: [] }),
      err => err && err.code === 'INVALID_CONFIG'
    );
    assert.equal(existsSync(target), false);
  });
});
