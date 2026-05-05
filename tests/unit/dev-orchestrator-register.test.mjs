// tests/unit/dev-orchestrator-register.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOrInitConfig,
  addOrUpdateService,
  inferDefaults,
  inferComposeServices
} from '../../bin/lib/dev-orchestrator/register.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jlu-reg-')); }

describe('loadOrInitConfig', () => {
  test('returns fresh skeleton when file is missing', () => {
    const cfg = loadOrInitConfig(join(tmp(), 'no.json'));
    assert.equal(cfg.version, 1);
    assert.deepEqual(cfg.services, []);
    assert.ok(cfg.defaults);
  });

  test('returns parsed file when present', () => {
    const dir = tmp();
    const path = join(dir, 'jlu-services.json');
    writeFileSync(path, JSON.stringify({ version: 1, services: [{ name: 'x', path: '.', command: 'y' }] }));
    const cfg = loadOrInitConfig(path);
    assert.equal(cfg.services.length, 1);
    assert.equal(cfg.services[0].name, 'x');
  });
});

describe('addOrUpdateService', () => {
  test('appends a new service', () => {
    const cfg = { version: 1, services: [] };
    const next = addOrUpdateService(cfg, { name: 'a', path: '.', command: 'x' });
    assert.equal(next.services.length, 1);
    assert.equal(next.services[0].name, 'a');
  });

  test('updates an existing service in place', () => {
    const cfg = { version: 1, services: [{ name: 'a', path: '.', command: 'old' }] };
    const next = addOrUpdateService(cfg, { name: 'a', path: '.', command: 'new' });
    assert.equal(next.services.length, 1);
    assert.equal(next.services[0].command, 'new');
  });

  test('preserves order on update', () => {
    const cfg = { version: 1, services: [
      { name: 'a', path: '.', command: 'a' },
      { name: 'b', path: '.', command: 'b' }
    ] };
    const next = addOrUpdateService(cfg, { name: 'a', path: '.', command: 'A' });
    assert.deepEqual(next.services.map(s => s.name), ['a', 'b']);
  });
});

describe('inferDefaults', () => {
  test('detects pnpm by lockfile', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 6');
    writeFileSync(join(dir, 'package.json'), '{}');
    const inf = inferDefaults(dir);
    assert.equal(inf.packageManager, 'pnpm');
    assert.equal(inf.suggestedCommand, 'pnpm dev');
  });

  test('detects yarn by lockfile', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'yarn.lock'), '');
    writeFileSync(join(dir, 'package.json'), '{}');
    const inf = inferDefaults(dir);
    assert.equal(inf.packageManager, 'yarn');
    assert.equal(inf.suggestedCommand, 'yarn dev');
  });

  test('falls back to npm', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'package.json'), '{}');
    const inf = inferDefaults(dir);
    assert.equal(inf.packageManager, 'npm');
    assert.equal(inf.suggestedCommand, 'npm run dev');
  });

  test('lists .env files', () => {
    const dir = tmp();
    writeFileSync(join(dir, '.env'), '');
    writeFileSync(join(dir, '.env.local'), '');
    writeFileSync(join(dir, 'README.md'), '');
    const inf = inferDefaults(dir);
    assert.ok(inf.dotEnvFiles.includes('.env'));
    assert.ok(inf.dotEnvFiles.includes('.env.local'));
    assert.ok(!inf.dotEnvFiles.includes('README.md'));
  });

  test('detects compose services when compose file exists', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  api:\n    image: x\n  redis:\n    image: y\n');
    const inf = inferDefaults(dir);
    assert.deepEqual(inf.composeServices.sort(), ['api', 'redis']);
  });

  test('returns empty composeServices when no compose file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'package.json'), '{}');
    const inf = inferDefaults(dir);
    assert.deepEqual(inf.composeServices, []);
  });
});

describe('inferComposeServices', () => {
  test('parses top-level service keys from a minimal compose file', () => {
    const dir = tmp();
    const path = join(dir, 'docker-compose.yml');
    writeFileSync(path, [
      'version: "3.9"',
      'services:',
      '  api:',
      '    image: x',
      '  worker:',
      '    image: y',
      'networks:',
      '  default: {}'
    ].join('\n') + '\n');
    const out = inferComposeServices(path);
    assert.deepEqual(out.sort(), ['api', 'worker']);
  });

  test('returns [] when no services key present', () => {
    const dir = tmp();
    const path = join(dir, 'docker-compose.yml');
    writeFileSync(path, 'version: "3.9"\n');
    assert.deepEqual(inferComposeServices(path), []);
  });

  test('returns [] when file does not exist', () => {
    assert.deepEqual(inferComposeServices('/no/such/file'), []);
  });
});
