// tests/unit/dev-orchestrator-config.test.mjs
//
// Run: `node --test tests/unit/dev-orchestrator-config.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateConfig } from '../../bin/lib/dev-orchestrator/config.mjs';

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
