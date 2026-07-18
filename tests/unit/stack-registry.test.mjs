// tests/unit/stack-registry.test.mjs
//
// Run: `node --test tests/unit/stack-registry.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateStack, loadStack } from '../../bin/lib/dev-orchestrator/stack/registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures', 'stack');
const load = (name) => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));

describe('validateStack', () => {
  test('accepts a minimal valid stack', () => {
    const result = validateStack(load('valid-min.json'));
    assert.equal(result.valid, true, result.errors.join(', '));
  });

  test('rejects a service name with an underscore', () => {
    const result = validateStack(load('invalid-underscore-name.json'));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('name')), result.errors.join(', '));
  });

  test('rejects a peers target that is not a registered service', () => {
    const stack = load('valid-min.json');
    stack.services[0].peers = { 'ghost-service': 'GHOST_URL' };
    const result = validateStack(stack);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('ghost-service')), result.errors.join(', '));
  });

  test('rejects a stack with a missing basePort', () => {
    const stack = load('valid-min.json');
    delete stack.basePort;
    const result = validateStack(stack);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('basePort')), result.errors.join(', '));
  });

  test('loadStack parses and validates a file, throwing on invalid', () => {
    assert.throws(
      () => loadStack(join(fixtures, 'invalid-underscore-name.json')),
      err => err && err.code === 'INVALID_STACK'
    );
  });

  test('rejects a service missing readiness.url', () => {
    const stack = load('valid-min.json');
    delete stack.services[0].readiness;
    const result = validateStack(stack);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('readiness')), result.errors.join(', '));
  });

  test('the shipped jelou-stack.json registry is valid', () => {
    const registryPath = join(here, '..', '..', 'jelou', 'references', 'jelou-stack.json');
    const result = validateStack(JSON.parse(readFileSync(registryPath, 'utf8')));
    assert.equal(result.valid, true, result.errors.join(', '));
  });

  test('rejects a frontend envLocal entry referencing an unregistered service', () => {
    const stack = load('valid-min.json');
    stack.frontend = { envLocal: { FOO_URL: { service: 'ghost', suffix: '' } } };
    const result = validateStack(stack);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('ghost')), result.errors.join(', '));
  });

  test('rejects an auth verify entry referencing an unregistered service', () => {
    const stack = load('valid-min.json');
    stack.auth = { verify: [{ service: 'ghost', path: '/x' }] };
    const result = validateStack(stack);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('ghost')), result.errors.join(', '));
  });

  test('the shipped registry validates with reshaped frontend/auth', () => {
    const registryPath = join(here, '..', '..', 'jelou', 'references', 'jelou-stack.json');
    const result = validateStack(JSON.parse(readFileSync(registryPath, 'utf8')));
    assert.equal(result.valid, true, result.errors.join(', '));
  });
});
