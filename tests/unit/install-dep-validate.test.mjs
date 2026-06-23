import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planInstallValidate } from '../../bin/lib/install-dep.mjs';

function dirWith(lockfile) {
  const d = mkdtempSync(join(tmpdir(), 'jlu-validate-'));
  writeFileSync(join(d, 'package.json'), '{}');
  if (lockfile) writeFileSync(join(d, lockfile), '');
  return d;
}

describe('planInstallValidate — host runtime', () => {
  test('npm → frozen ci, no drift step', () => {
    const dir = dirWith('package-lock.json');
    const p = planInstallValidate({ service: { runtime: { type: 'host' } }, serviceDir: dir });
    assert.equal(p.runtime, 'host');
    assert.equal(p.packageManager, 'npm');
    assert.deepEqual(p.steps.map((s) => s.kind), ['install']);
    assert.equal(p.steps[0].cmd, 'npm ci');
  });
  test('pnpm → frozen-lockfile', () => {
    const dir = dirWith('pnpm-lock.yaml');
    const p = planInstallValidate({ service: { runtime: { type: 'host' } }, serviceDir: dir });
    assert.equal(p.steps[0].cmd, 'pnpm install --frozen-lockfile');
  });
  test('no package.json → skip', () => {
    const d = mkdtempSync(join(tmpdir(), 'jlu-validate-empty-'));
    const p = planInstallValidate({ service: { runtime: { type: 'host' } }, serviceDir: d });
    assert.equal(p.runtime, 'skip');
    assert.deepEqual(p.steps, []);
  });
});

describe('planInstallValidate — docker-compose runtime', () => {
  test('check → boot → container install (non-frozen) → drift_check', () => {
    const dir = dirWith('package-lock.json');
    const p = planInstallValidate({
      service: { runtime: { type: 'docker-compose', compose_file: './docker-compose.yml', compose_service: 'app' } },
      serviceDir: dir,
    });
    assert.equal(p.runtime, 'docker-compose');
    assert.deepEqual(p.steps.map((s) => s.kind), ['check', 'boot', 'install', 'drift_check']);
    const install = p.steps.find((s) => s.kind === 'install');
    assert.equal(install.cmd, 'docker compose -f ./docker-compose.yml exec app npm install');
    const drift = p.steps.find((s) => s.kind === 'drift_check');
    assert.equal(drift.lockfile, 'package-lock.json');
  });
});
