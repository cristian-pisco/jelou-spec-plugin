import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUnifiedRegistry } from '../../registry/read.mjs';
import { resolveSpecWorkspace } from '../workspace.mjs';

function pluginRoot() {
  return dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
}

function databaseConfiguration(registry) {
  const database = registry.localDatabase || registry.database || null;
  if (!database) return null;
  const target = database.target || database;
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.host);
  const topology = {
    registeredDockerServices: database.registeredDockerServices || [database],
    ...(loopback ? { registeredLoopbackDatabase: database.registeredLoopbackDatabase || database } : {}),
  };
  return { target, topology };
}

export function resolveLocalStackE2eConfig({ cwd = process.cwd(), browserExecutable = process.env.JLU_BROWSER_EXECUTABLE } = {}) {
  const workspaceRoot = resolveSpecWorkspace(cwd);
  if (!workspaceRoot) throw new Error('shared spec workspace could not be resolved from .spec-workspace.json');
  const registryPath = join(workspaceRoot, 'registry', 'registry.json');
  if (!existsSync(registryPath)) throw new Error(`registered stack registry not found at ${registryPath}`);
  const registry = readUnifiedRegistry(workspaceRoot);
  return {
    pluginRoot: pluginRoot(),
    projectRoot: workspaceRoot,
    workspaceRoot,
    registryPath,
    services: registry.services,
    localDatabase: databaseConfiguration(registry),
    browserExecutable: browserExecutable || null,
    dashboardServiceId: registry.auth?.dashboardService || 'dashboard-server',
    apiServiceId: registry.auth?.verify?.[0]?.service || 'jelou-api',
    uiServiceId: registry.frontend?.id || 'jelou-apps',
  };
}
