import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegisteredStackDriver } from '../../bin/lib/dev-orchestrator/stack/local-stack-driver.mjs';

const METHODS = ['inspectPreflight', 'runMode', 'provisionAndVerify', 'collectEvidence', 'cleanupResource', 'inspectCleanup'];

function loopbackConfig(provisioningBoundaryPath) {
  return {
    localDatabase: {
      target: { host: '127.0.0.1', port: 5432 },
      topology: {
        registeredLoopbackDatabase: { host: '127.0.0.1', port: 5432, provisioningBoundaryPath },
      },
    },
  };
}

function writeBoundary(root, body) {
  const boundaryPath = join(root, 'boundary.mjs');
  writeFileSync(boundaryPath, body);
  return boundaryPath;
}

function fullBoundaryModule() {
  return `
export async function createLocalJelouBoundary() {
  const calls = [];
  const e2e = {};
  for (const method of ${JSON.stringify(METHODS)}) {
    e2e[method] = async (input) => {
      calls.push({ method, input });
      return { method, input, calls: calls.length };
    };
  }
  return { e2e };
}
`;
}

describe('registered local stack driver', () => {
  test('invokes the loaded boundary operation and returns its result for every required method', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'local-stack-driver-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const boundaryPath = writeBoundary(root, fullBoundaryModule());
    const config = loopbackConfig(boundaryPath);
    const driver = createRegisteredStackDriver(config);

    const preflightResult = await driver.inspectPreflight({ marker: 'preflight-input' });
    const runModeResult = await driver.runMode({ marker: 'run-mode-input' });

    assert.deepEqual(preflightResult, { method: 'inspectPreflight', input: { marker: 'preflight-input' }, calls: 1 });
    assert.deepEqual(runModeResult, { method: 'runMode', input: { marker: 'run-mode-input' }, calls: 2 });
  });

  test('loads the registered boundary module only once across multiple operation calls', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'local-stack-driver-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const boundaryPath = join(root, 'counting-boundary.mjs');
    writeFileSync(boundaryPath, `
let loadCount = 0;
export async function createLocalJelouBoundary() {
  loadCount += 1;
  const currentLoad = loadCount;
  const e2e = {};
  for (const method of ${JSON.stringify(METHODS)}) {
    e2e[method] = async () => ({ loadCount: currentLoad });
  }
  return { e2e };
}
`);
    const config = loopbackConfig(boundaryPath);
    const driver = createRegisteredStackDriver(config);

    const first = await driver.inspectPreflight();
    const second = await driver.collectEvidence();

    assert.equal(first.loadCount, 1);
    assert.equal(second.loadCount, 1);
  });

  test('rejects with an unavailable-boundary error when no boundary is registered for the target', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'local-stack-driver-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const config = {
      localDatabase: {
        target: { host: '127.0.0.1', port: 5432 },
        topology: {
          registeredLoopbackDatabase: { host: '127.0.0.1', port: 5432 },
        },
      },
    };
    const driver = createRegisteredStackDriver(config);

    await assert.rejects(
      () => driver.inspectPreflight(),
      /registered local stack provisioning boundary is unavailable/,
    );
  });

  test('rejects with an unavailable-boundary error when the matched docker-registered database has no boundary path', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'local-stack-driver-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const config = {
      localDatabase: {
        target: { host: 'db.internal.example', port: 5432, dockerServiceId: 'shared-db', composeProject: 'p', composeFile: 'f', service: 's' },
        topology: {
          registeredDockerServices: [
            { id: 'shared-db', host: 'db.internal.example', port: 5432, composeProject: 'p', composeFile: 'f', service: 's' },
          ],
        },
      },
    };
    const driver = createRegisteredStackDriver(config);

    await assert.rejects(
      () => driver.inspectPreflight(),
      /registered local stack provisioning boundary is unavailable/,
    );
  });

  test('rejects with a missing-operations error naming every method the boundary fails to expose', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'local-stack-driver-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const boundaryPath = writeBoundary(root, `
export async function createLocalJelouBoundary() {
  return { e2e: { inspectPreflight: async () => ({}) } };
}
`);
    const config = loopbackConfig(boundaryPath);
    const driver = createRegisteredStackDriver(config);

    await assert.rejects(
      () => driver.runMode(),
      /registered local stack boundary lacks E2E operations: runMode, provisionAndVerify, collectEvidence, cleanupResource, inspectCleanup/,
    );
  });
});
