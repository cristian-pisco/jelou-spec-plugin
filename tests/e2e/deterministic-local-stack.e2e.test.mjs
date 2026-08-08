import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const configPath = process.env.JLU_LOCAL_STACK_E2E_CONFIG;
const pluginRoot = resolve(process.env.JLU_INSTALLED_PLUGIN_ROOT || '.');
const runner = join(pluginRoot, 'bin', 'local-stack-e2e.mjs');

function execute(extraArgs = []) {
  return spawnSync(process.execPath, [
    runner,
    '--confirm-local-e2e',
    '--config',
    configPath,
    ...extraArgs,
  ], { encoding: 'utf8', env: process.env });
}

describe('installed deterministic local-stack E2E', () => {
  test('preflight configuration names an installed runner and isolated real-stack adapter', () => {
    assert.ok(configPath, 'JLU_LOCAL_STACK_E2E_CONFIG must name the explicit local E2E config');
    assert.equal(existsSync(runner), true);
  });

  test('passes main, hybrid task-aware, onboarding, cookie, API, and browser verification', () => {
    const result = execute();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.sourceModes, ['main', 'task-aware', 'task-aware']);
    assert.deepEqual(report.plans, ['ENTERPRISE', 'SELF_SERVICE']);
    assert.deepEqual(report.cleanup.refused, []);
  });

  test('an injected failure still removes every owned resource', () => {
    const result = execute(['--inject-failure-after', 'SELF_SERVICE']);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stderr);
    assert.match(report.message, /injected failure after SELF_SERVICE/);
    assert.equal(report.cleanup.removed > 0, true);
    assert.deepEqual(report.cleanup.refused, []);
  });
});
