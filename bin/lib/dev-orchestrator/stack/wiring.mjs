import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectName } from './override.mjs';

export function wireEnv({ envText, peers, slug, peerInternalPort }) {
  const targets = new Map();
  for (const [target, envVar] of Object.entries(peers || {})) {
    const port = peerInternalPort[target];
    targets.set(envVar, `http://${projectName(target, slug)}:${port}`);
  }
  const out = envText.split('\n').map((line) => {
    const eq = line.indexOf('=');
    if (eq === -1) return line;
    const key = line.slice(0, eq).trim();
    if (targets.has(key)) return `${key}=${targets.get(key)}`;
    return line;
  });
  return out.join('\n');
}

function primaryPort(service) {
  return service.ports.find((port) => port.primary);
}

export function topologyProviderUrl({ consumer, provider, slug, hostGateway = 'host.docker.internal' }) {
  const port = primaryPort(provider);
  if (consumer.topology.runtime === 'host') return `http://localhost:${port.host}`;
  if (provider.topology.runtime === 'host') return `http://${hostGateway}:${port.host}`;
  const hostname = provider.policy === 'task-isolated' ? projectName(provider.id, slug) : provider.id;
  return `http://${hostname}:${port.internal}`;
}

export function buildTopologyOverlays({ services, slug, hostGateway }) {
  const overlays = new Map();
  for (const consumer of services) {
    const routes = Object.entries(consumer.peers || {});
    const variables = new Map();
    for (const [providerId, variable] of routes) {
      const matches = services.filter((service) => service.id === providerId);
      if (matches.length === 0) {
        throw new Error(`cannot route environment for consumer '${consumer.id}', variable '${variable}', provider '${providerId}'; candidates: none`);
      }
      const candidates = variables.get(variable) || [];
      candidates.push(...matches);
      variables.set(variable, candidates);
    }
    const values = [];
    for (const [variable, candidates] of variables) {
      if (candidates.length !== 1) {
        throw new Error(`cannot route environment for consumer '${consumer.id}', variable '${variable}'; candidates: ${candidates.map((provider) => provider.id).sort().join(', ')}`);
      }
      values.push([
        variable,
        `${topologyProviderUrl({ consumer, provider: candidates[0], slug, hostGateway })}${consumer.peerSuffixes?.[variable] || ''}`,
      ]);
    }
    if (values.length === 0) continue;
    values.sort(([left], [right]) => left.localeCompare(right));
    const content = values.map(([key, value]) => `${key}=${value}\n`).join('');
    const digest = createHash('sha256').update(content).digest('hex');
    overlays.set(consumer.id, { content, digest });
  }
  return overlays;
}

export function applyTopologyOverlays({ services, registryServices, slug, sourceMode, overlayDirectory, previousOverlays = [], hostGateway }) {
  const registryById = new Map(registryServices.map((service) => [service.id, service]));
  const graph = services.map((service) => ({
    ...service,
    peers: registryById.get(service.id)?.peers || {},
    peerSuffixes: registryById.get(service.id)?.peerSuffixes || {},
  }));
  const generated = buildTopologyOverlays({ services: graph, slug, hostGateway });
  const overlayFiles = [];
  const plannedServices = services.map((service) => {
    const overlay = generated.get(service.id);
    const previous = previousOverlays.find((item) => item.serviceId === service.id && item.sourceMode === sourceMode);
    if (!overlay) {
      return {
        ...service,
        environmentOverlay: { path: null, digest: null, restartRequired: false },
      };
    }
    const path = join(overlayDirectory, `${service.id}.env`);
    overlayFiles.push({ serviceId: service.id, sourceMode, path, digest: overlay.digest, content: overlay.content });
    return {
      ...service,
      environmentOverlay: {
        path,
        digest: overlay.digest,
        restartRequired: Boolean(previous && previous.digest !== overlay.digest),
      },
    };
  });
  return { services: plannedServices, overlayFiles };
}

export function persistTopologyOverlays(overlayFiles) {
  for (const file of overlayFiles) {
    mkdirSync(dirname(file.path), { recursive: true });
    const temporary = `${file.path}.tmp-${process.pid}`;
    writeFileSync(temporary, file.content, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file.path);
    chmodSync(file.path, 0o600);
  }
}
