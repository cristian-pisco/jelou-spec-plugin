import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { proveLocalDatabaseTarget } from './local-target.mjs';

function registeredDatabase(request) {
  const services = request.topology?.registeredDockerServices || [];
  const loopback = request.topology?.registeredLoopbackDatabase;
  if (loopback?.host === request.target?.host && loopback?.port === request.target?.port) return loopback;
  return services.find((service) => (
    typeof service === 'object'
    && service.id === request.target?.dockerServiceId
    && service.host === request.target?.host
    && service.port === request.target?.port
    && service.composeProject === request.target?.composeProject
    && service.composeFile === request.target?.composeFile
    && service.service === request.target?.service
  ));
}

export async function createProvisioningAdapter(request, { importModule = (url) => import(url) } = {}) {
  proveLocalDatabaseTarget(request.target, request.topology);
  const database = registeredDatabase(request);
  const boundaryPath = database?.provisioningBoundaryPath;
  if (!boundaryPath || !existsSync(boundaryPath)) {
    throw new Error('registered local database provisioning boundary is unavailable');
  }
  const boundaryModule = await importModule(pathToFileURL(resolve(boundaryPath)).href);
  if (typeof boundaryModule.createLocalJelouBoundary !== 'function') {
    throw new Error('registered local database boundary must export createLocalJelouBoundary');
  }
  const boundary = await boundaryModule.createLocalJelouBoundary({ target: request.target, topology: request.topology });
  if (typeof boundary?.database?.transaction !== 'function' || typeof boundary?.bcrypt?.hash !== 'function') {
    throw new Error('registered local database boundary lacks transaction or bcrypt support');
  }
  return {
    database: {
      ...boundary.database,
      cleanupDescriptor: {
        target: request.target,
        topology: request.topology,
        provisioningBoundaryPath: boundaryPath,
      },
    },
    bcrypt: boundary.bcrypt,
  };
}
