import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  resolveServicePackageManager,
  lockfileForManager,
  addCommand,
  commandManager
} from '../../bin/lib/registry/package-manager.mjs';

describe('resolveServicePackageManager', () => {
  test('a declared manager wins and never touches the filesystem', () => {
    const detect = () => { throw new Error('must not probe the checkout'); };
    const out = resolveServicePackageManager({
      entry: { path: '/repo/workflows-service', dev: { package_manager: 'pnpm' } },
      detect
    });
    assert.deepEqual(out, { manager: 'pnpm', source: 'declared', lockFile: 'pnpm-lock.yaml', declared: 'pnpm' });
  });

  test('an undeclared manager falls back to lockfile detection and says so', () => {
    const out = resolveServicePackageManager({
      entry: { path: '/repo/api', dev: {} },
      detect: () => 'yarn'
    });
    assert.equal(out.manager, 'yarn');
    assert.equal(out.source, 'detected');
    assert.equal(out.lockFile, 'yarn.lock');
  });

  test('a typo in services.yaml is rejected rather than silently coerced', () => {
    const out = resolveServicePackageManager({
      entry: { path: '/repo/api', dev: { package_manager: 'pnmp' } },
      detect: () => 'pnpm'
    });
    assert.equal(out.source, 'invalid');
    assert.equal(out.manager, null);
    assert.equal(out.declared, 'pnmp');
  });

  test('nothing declared and nothing detectable stays unknown — never defaults to npm', () => {
    const out = resolveServicePackageManager({ entry: { path: '/repo/go-svc', dev: {} }, detect: () => null });
    assert.equal(out.source, 'unknown');
    assert.equal(out.manager, null);
  });
});

describe('lockfileForManager', () => {
  test('maps each manager to its lockfile', () => {
    assert.equal(lockfileForManager('pnpm'), 'pnpm-lock.yaml');
    assert.equal(lockfileForManager('yarn'), 'yarn.lock');
    assert.equal(lockfileForManager('npm'), 'package-lock.json');
    assert.equal(lockfileForManager('bun'), 'bun.lockb');
    assert.equal(lockfileForManager('cargo'), null);
  });
});

describe('addCommand', () => {
  test('dev flags differ only in spelling', () => {
    assert.equal(addCommand('pnpm', ['zod'], { dev: true }), 'pnpm add -D zod');
    assert.equal(addCommand('bun', ['zod'], { dev: true }), 'bun add -d zod');
    assert.equal(addCommand('npm', ['zod'], { dev: true }), 'npm install -D zod');
  });

  test('multiple packages share one invocation', () => {
    assert.equal(addCommand('pnpm', ['a', 'b']), 'pnpm add a b');
  });

  test('an empty list produces no command', () => {
    assert.equal(addCommand('pnpm', []), null);
  });
});

describe('commandManager round-trips against addCommand', () => {
  test('every generated add command reports its own manager', () => {
    for (const pm of ['npm', 'yarn', 'pnpm', 'bun']) {
      assert.equal(commandManager(addCommand(pm, ['zod'])), pm);
    }
  });
});
