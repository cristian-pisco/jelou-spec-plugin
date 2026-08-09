// tests/unit/classify-task-scope.test.mjs
//
// Tests for bin/classify-task-scope.mjs — classifies a task as `fullstack` or
// `full-backend` from its affected services. UI detection mirrors goal.md
// Phase 1 step 6.
//
// Run: `node --test tests/unit/classify-task-scope.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTaskScope } from '../../bin/classify-task-scope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', '..', 'bin', 'classify-task-scope.mjs');

describe('classify-task-scope — classifyTaskScope()', () => {
  test('only backend services -> full-backend', () => {
    const r = classifyTaskScope([
      { id: 'api-gateway-service', stack: 'nestjs' },
      { id: 'marketplace-service', stack: 'laravel' },
    ]);
    assert.equal(r.scope, 'full-backend');
    assert.deepEqual(r.ui_services, []);
    assert.deepEqual(r.backend_services, ['api-gateway-service', 'marketplace-service']);
    assert.deepEqual(r.warnings, []);
  });

  test('a UI service by stack -> fullstack', () => {
    const r = classifyTaskScope([
      { id: 'jelou-apps', stack: 'react' },
      { id: 'api-gateway-service', stack: 'nestjs' },
    ]);
    assert.equal(r.scope, 'fullstack');
    assert.deepEqual(r.ui_services, ['jelou-apps']);
    assert.deepEqual(r.backend_services, ['api-gateway-service']);
    assert.deepEqual(r.warnings, []);
  });

  test('UI by description only -> fullstack + warning', () => {
    const r = classifyTaskScope([
      { id: 'operator-ui', description: 'The operator app frontend' },
    ]);
    assert.equal(r.scope, 'fullstack');
    assert.deepEqual(r.ui_services, ['operator-ui']);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /no stack field/);
  });

  test('stack set -> no spurious description warning', () => {
    const r = classifyTaskScope([{ id: 'x', stack: 'nextjs', description: 'frontend' }]);
    assert.deepEqual(r.warnings, []);
  });

  test('empty list throws', () => {
    assert.throws(() => classifyTaskScope([]), /empty/i);
  });

  test('non-array throws', () => {
    // null and [] intentionally share the same "is empty" error path
    assert.throws(() => classifyTaskScope(null), /affected_services is empty/i);
  });

  test('service without id throws', () => {
    assert.throws(() => classifyTaskScope([{ stack: 'react' }]), /id/);
  });

  test('numeric (non-string) id throws', () => {
    assert.throws(() => classifyTaskScope([{ id: 42, stack: 'react' }]), /id/);
  });

  test('all UI services -> fullstack with empty backend_services', () => {
    const r = classifyTaskScope([
      { id: 'jelou-apps', stack: 'react' },
      { id: 'operator-ui', stack: 'vue' },
    ]);
    assert.equal(r.scope, 'fullstack');
    assert.deepEqual(r.ui_services, ['jelou-apps', 'operator-ui']);
    assert.deepEqual(r.backend_services, []);
  });
});

describe('classify-task-scope — CLI', () => {
  function run(arg) {
    const r = spawnSync('node', [SCRIPT, arg], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  }
  test('prints classification JSON and exits 0', () => {
    const r = run(JSON.stringify([{ id: 'jelou-apps', stack: 'react' }]));
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), {
      scope: 'fullstack',
      ui_services: ['jelou-apps'],
      backend_services: [],
      warnings: [],
    });
  });
  test('empty array exits 1 with a message', () => {
    const r = run('[]');
    assert.equal(r.code, 1);
    assert.match(r.err, /empty/i);
  });
  test('invalid JSON exits 1', () => {
    const r = run('not-json');
    assert.equal(r.code, 1);
  });
  test('--version prints semver and exits 0', () => {
    const r = run('--version');
    assert.equal(r.code, 0);
    assert.match(r.out, /^\d+\.\d+\.\d+$/);
  });
});
