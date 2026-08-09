import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { proveLocalDatabaseTarget } from './local-target.mjs';

const METHODS = ['inspectPreflight', 'runMode', 'provisionAndVerify', 'collectEvidence', 'cleanupResource', 'inspectCleanup'];

async function loadBoundary(config) {
  const proof = proveLocalDatabaseTarget(config.localDatabase.target, config.localDatabase.topology);
  const registered = proof.kind === 'loopback'
    ? config.localDatabase.topology.registeredLoopbackDatabase
    : config.localDatabase.topology.registeredDockerServices.find((service) => (
      service.id === proof.serviceId
      && service.host === proof.host
      && service.port === proof.port
      && service.composeProject === proof.composeProject
      && service.composeFile === proof.composeFile
      && service.service === proof.service
    ));
  if (!registered?.provisioningBoundaryPath) throw new Error('registered local stack provisioning boundary is unavailable');
  const module = await import(pathToFileURL(resolve(registered.provisioningBoundaryPath)).href);
  const boundary = await module.createLocalJelouBoundary({
    target: config.localDatabase.target,
    topology: config.localDatabase.topology,
  });
  const missing = METHODS.filter((method) => typeof boundary?.e2e?.[method] !== 'function');
  if (missing.length > 0) throw new Error(`registered local stack boundary lacks E2E operations: ${missing.join(', ')}`);
  return boundary.e2e;
}

export function createRegisteredStackDriver(config) {
  let boundaryPromise;
  const boundary = () => {
    boundaryPromise ||= loadBoundary(config);
    return boundaryPromise;
  };
  return Object.fromEntries(METHODS.map((method) => [method, async (input) => (await boundary())[method](input)]));
}
