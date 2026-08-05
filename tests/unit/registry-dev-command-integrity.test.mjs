import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { detectPackageManager, commandManager, frozenInstallCommand, runCommand, LOCKFILES } from '../../bin/lib/registry/package-manager.mjs';
import { devCommandMismatches, mismatchReport } from '../../bin/lib/registry/validate-dev-commands.mjs';
import { mergeDevBlocks } from '../../bin/lib/registry/merge-dev-blocks.mjs';

function existsOnly(paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

describe('package-manager is the single source for manager derivation', () => {
  test('lockfile precedence: pnpm > yarn > bun > npm', () => {
    assert.deepEqual(LOCKFILES.map((l) => l.manager), ['pnpm', 'yarn', 'bun', 'npm']);
    assert.equal(detectPackageManager('/r', { exists: existsOnly(['/r/pnpm-lock.yaml', '/r/package-lock.json']) }), 'pnpm');
    assert.equal(detectPackageManager('/r', { exists: existsOnly(['/r/package-lock.json']) }), 'npm');
    assert.equal(detectPackageManager('/r', { exists: existsOnly(['/r/package.json']) }), 'npm');
    assert.equal(detectPackageManager('/r', { exists: existsOnly([]) }), null);
  });

  test('frozen installs never mutate a lockfile', () => {
    assert.equal(frozenInstallCommand('npm'), 'npm ci');
    assert.equal(frozenInstallCommand('yarn'), 'yarn install --frozen-lockfile');
    assert.equal(frozenInstallCommand('pnpm'), 'pnpm install --frozen-lockfile');
    assert.doesNotMatch(frozenInstallCommand('npm'), /npm install/);
  });

  test('runCommand only npm needs run', () => {
    assert.equal(runCommand('npm', 'start:dev'), 'npm run start:dev');
    assert.equal(runCommand('yarn', 'start:dev'), 'yarn start:dev');
    assert.equal(runCommand('pnpm', 'dev'), 'pnpm dev');
  });

  test('commandManager finds the manager token anywhere in the command', () => {
    assert.equal(commandManager('npm run start:dev'), 'npm');
    assert.equal(commandManager('yarn start:dev'), 'yarn');
    assert.equal(commandManager('cd packages/mcp-server && pnpm dev'), 'pnpm');
    assert.equal(commandManager('docker compose up -d app'), null);
    assert.equal(commandManager(undefined), null);
  });
});

describe('devCommandMismatches — the api-gateway class of defect', () => {
  test('flags an npm repo declared with yarn', () => {
    const services = [{ id: 'api-gateway-service', path: '/repo/api-gateway-service', dev: { command: 'yarn start:dev' } }];
    const m = devCommandMismatches(services, { detect: () => 'npm' });
    assert.equal(m.length, 1);
    assert.equal(m[0].declaredManager, 'yarn');
    assert.equal(m[0].repoManager, 'npm');
    assert.match(mismatchReport(m), /api-gateway-service/);
  });

  test('accepts a repo whose declared manager matches', () => {
    const services = [
      { id: 'a', path: '/r/a', dev: { command: 'npm run start:dev' } },
      { id: 'b', path: '/r/b', dev: { command: 'pnpm dev' } }
    ];
    const detect = (p) => (p === '/r/a' ? 'npm' : 'pnpm');
    assert.deepEqual(devCommandMismatches(services, { detect }), []);
  });

  test('stays silent when the command names no manager or the repo has none', () => {
    const services = [
      { id: 'a', path: '/r/a', dev: { command: 'docker compose up -d app' } },
      { id: 'b', path: '/r/b', dev: { command: 'yarn start' } }
    ];
    assert.deepEqual(devCommandMismatches(services, { detect: () => null }), []);
  });

  test('a service with no dev command is not a mismatch', () => {
    assert.deepEqual(devCommandMismatches([{ id: 'a', path: '/r/a', dev: {} }], { detect: () => 'npm' }), []);
  });
});

describe('mergeDevBlocks — services.yaml wins per declared field, matched by path', () => {
  const resolve = (p) => p.replace('../', '/repo/');

  test('reconciles two ids for the same path and overlays the command', () => {
    const baseServices = {
      'jelou-auth-service': { path: '../auth-service', peers: {}, dev: { launcher: 'docker-exec', command: 'yarn start:dev', port_env: 'APP_PORT', ports: { APP_PORT: 8080 } } }
    };
    const overlayServices = {
      'auth-service': { path: '../auth-service', dev: { command: 'npm run start:dev', ready_timeout_s: 90 } }
    };
    const { services, merged } = mergeDevBlocks({ baseServices, overlayServices, resolve });
    const dev = services['jelou-auth-service'].dev;
    assert.equal(dev.command, 'npm run start:dev');
    assert.equal(dev.ready_timeout_s, 90);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'jelou-auth-service');
    assert.equal(merged[0].from, 'auth-service');
    assert.deepEqual(merged[0].fields, ['command', 'ready_timeout_s']);
  });

  test('never drops the port topology the overlay does not declare', () => {
    const baseServices = {
      'api-gateway-service': { path: '../api-gateway-service', dev: { command: 'yarn start:dev', port_env: 'APP_PORT', extra_ports: ['DEBUG_PORT'], ports: { APP_PORT: 8080, DEBUG_PORT: 9001 } } }
    };
    const overlayServices = { 'api-gateway-service': { path: '../api-gateway-service', dev: { command: 'npm run start:dev' } } };
    const { services } = mergeDevBlocks({ baseServices, overlayServices, resolve });
    const dev = services['api-gateway-service'].dev;
    assert.equal(dev.command, 'npm run start:dev');
    assert.deepEqual(dev.ports, { APP_PORT: 8080, DEBUG_PORT: 9001 });
    assert.deepEqual(dev.extra_ports, ['DEBUG_PORT']);
    assert.equal(dev.port_env, 'APP_PORT');
  });

  test('nested objects merge one level instead of being replaced wholesale', () => {
    const baseServices = { a: { path: '../a', dev: { docker: { service: 'app', compose_file: 'docker-compose.yml' } } } };
    const overlayServices = { a: { path: '../a', dev: { docker: { service: 'web' } } } };
    const { services } = mergeDevBlocks({ baseServices, overlayServices, resolve });
    assert.deepEqual(services.a.dev.docker, { service: 'web', compose_file: 'docker-compose.yml' });
  });

  test('a base service with no overlay counterpart is untouched', () => {
    const baseServices = { a: { path: '../a', dev: { command: 'pnpm dev' } } };
    const { services, merged } = mergeDevBlocks({ baseServices, overlayServices: { b: { path: '../b', dev: { command: 'x' } } }, resolve });
    assert.equal(services.a.dev.command, 'pnpm dev');
    assert.deepEqual(merged, []);
  });

  test('overlay dev blocks with no base counterpart are reported, never silently booted', () => {
    const baseServices = { a: { path: '../a', dev: { command: 'npm run dev' } } };
    const overlayServices = {
      a: { path: '../a', dev: {} },
      'datum-service': { path: '../datum-service', dev: { command: 'npm run start:dev' } }
    };
    const { services, unmerged } = mergeDevBlocks({ baseServices, overlayServices, resolve });
    assert.deepEqual(Object.keys(services), ['a']);
    assert.deepEqual(unmerged, ['datum-service']);
  });

  test('a missing overlay leaves the base registry identical', () => {
    const baseServices = { a: { path: '../a', dev: { command: 'npm run dev' } } };
    const { services, merged, unmerged } = mergeDevBlocks({ baseServices, overlayServices: null, resolve });
    assert.deepEqual(services, baseServices);
    assert.deepEqual(merged, []);
    assert.deepEqual(unmerged, []);
  });
});

describe('mergeDevBlocks reports value changes, not just field names', () => {
  const resolve = (p) => p.replace('../', '/repo/');

  test('a replaced command is reported with its old and new value', () => {
    const baseServices = { a: { path: '../a', dev: { command: 'yarn start:dev', port_env: 'APP_PORT' } } };
    const overlayServices = { a: { path: '../a', dev: { command: 'npm run start:dev' } } };
    const { merged } = mergeDevBlocks({ baseServices, overlayServices, resolve });
    assert.deepEqual(merged[0].changes, [{ field: 'command', from: 'yarn start:dev', to: 'npm run start:dev' }]);
  });

  test('an identical value is not reported as a change', () => {
    const baseServices = { a: { path: '../a', dev: { command: 'npm run dev' } } };
    const overlayServices = { a: { path: '../a', dev: { command: 'npm run dev' } } };
    assert.deepEqual(mergeDevBlocks({ baseServices, overlayServices, resolve }).merged[0].changes, []);
  });

  test('a field the base never had is reported as appearing from null', () => {
    const baseServices = { a: { path: '../a', dev: { command: 'npm run dev' } } };
    const overlayServices = { a: { path: '../a', dev: { teardown: 'pkill -f nest' } } };
    assert.deepEqual(mergeDevBlocks({ baseServices, overlayServices, resolve }).merged[0].changes, [{ field: 'teardown', from: null, to: 'pkill -f nest' }]);
  });
});
