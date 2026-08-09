import { allocateHostPorts } from '../dev-orchestrator/stack/ports.mjs';
import { renderOverride, projectName as taskProjectName } from '../dev-orchestrator/stack/override.mjs';
import { applyTopologyOverlays, wireEnv } from '../dev-orchestrator/stack/wiring.mjs';
import { resolveBaseImage } from '../dev-orchestrator/stack/resolve-base-image.mjs';
import { resolveComposeMounts } from '../dev-orchestrator/stack/resolve-compose-mounts.mjs';
import { createRunningNameResolver, resolveNetworkAlias } from '../dev-orchestrator/stack/resolve-network-alias.mjs';
import { createPublishedPortResolver } from './host-map.mjs';
import { resolveDepsProvision } from './deps-provision.mjs';
import { isContainerLauncher } from './launcher.mjs';
import { maskWiredEnv } from './env-mask.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

function defaultResolveImage({ cwd, composeFile, composeService }) {
  return resolveBaseImage({ cwd, composeFile, composeService, run: (b, a, o) => spawnSync(b, a, { encoding: 'utf8', ...o }) });
}

function defaultResolveMounts({ cwd, composeFile, composeService }) {
  return resolveComposeMounts({ cwd, composeFile, composeService, run: (b, a, o) => spawnSync(b, a, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...o }) });
}

const defaultRunningName = createRunningNameResolver({ run: (b, a, o) => spawnSync(b, a, { encoding: 'utf8', ...o }) });

function defaultResolveAlias({ cwd, composeFile, composeService, declaredAlias }) {
  return resolveNetworkAlias({
    composeText: defaultReadFile(`${cwd}/${composeFile}`),
    composeService,
    declaredAlias,
    runningName: defaultRunningName({ cwd, composeService }),
  });
}

const defaultResolvePublishedPort = createPublishedPortResolver();

function defaultReadFile(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function defaultReadEnv(cwd) {
  try { return readFileSync(`${cwd}/.env`, 'utf8'); } catch { return ''; }
}

function defaultExists(p) { return existsSync(p); }

function nodeModulesMountFor({ launcher, worktreeDir, canonicalPath, exists }) {
  if (!isContainerLauncher(launcher)) return { mount: null, missing: false };
  if (exists(`${worktreeDir}/node_modules`)) return { mount: null, missing: false };
  if (exists(`${canonicalPath}/node_modules`)) return { mount: `${canonicalPath}/node_modules`, missing: false };
  return { mount: null, missing: true };
}

function defaultReadJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } }

function runtimeMountsFor({ launcher, canonicalPath, declared, exists }) {
  if (!isContainerLauncher(launcher)) return [];
  const out = [];
  for (const p of declared || []) {
    if (exists(`${canonicalPath}/${p}`)) out.push({ source: `${canonicalPath}/${p}`, target: `/app/${p}` });
  }
  return out;
}

export function resolveFrontendTarget({ frontend, slug, exists = defaultExists }) {
  if (!frontend || !frontend.path) return null;
  const worktreeDir = `${frontend.path}/.worktrees/${slug}`;
  const isWorktree = exists(worktreeDir);
  const path = isWorktree ? worktreeDir : frontend.path;
  const envFile = frontend.envFile || '.env';
  const hasOwnEnv = exists(`${path}/${envFile}`);
  return {
    ...frontend,
    path,
    canonicalPath: frontend.path,
    isWorktree,
    policy: isWorktree ? 'task-isolated' : 'shared-reuse',
    envSeed: hasOwnEnv ? `${path}/${envFile}` : `${frontend.path}/${envFile}`,
    depsPresent: exists(`${path}/node_modules`)
  };
}

function taskReadiness(readySignal, primaryHost) {
  const r = { ...(readySignal || {}) };
  if (r.type === 'http_200' || r.type === 'port_open') r.port = primaryHost;
  return r;
}

function topologyFor(service, network) {
  if (!isContainerLauncher(service.dev.launcher)) return { runtime: 'host', host: 'localhost', container: null };
  return {
    runtime: 'container',
    host: 'localhost',
    container: {
      service: service.dev.docker.service,
      network: network.composeNetworkAlias,
    },
  };
}

function descriptorPorts({ service, workspaceId, slug, sourceMode, taken, basePort, portAllocations, usePublished, publishedHostPort }) {
  const portEnvs = [service.dev.port_env, ...(service.dev.extra_ports || [])];
  return portEnvs.map((portEnv) => {
    const internal = service.dev.ports[portEnv];
    const ownerTag = `${workspaceId}:${slug}:${sourceMode}:${service.id}:${portEnv}`;
    if (usePublished) {
      const published = publishedHostPort(internal);
      const host = published || internal;
      taken.add(host);
      return { internal, host, portEnv, primary: portEnv === service.dev.port_env, published: published !== null, ownerTag };
    }
    const persisted = (portAllocations || []).find((allocation) => allocation.serviceId === service.id && allocation.portEnv === portEnv);
    const allocation = persisted || allocateHostPorts({ mappings: [{ internal }], occupied: [...taken], basePort: taken.has(internal) ? basePort : internal })[0];
    taken.add(allocation.host);
    return {
      internal,
      host: allocation.host,
      portEnv,
      primary: portEnv === service.dev.port_env,
      ownerTag,
    };
  });
}

function buildDockerExecEntry({ entry, svc, dev, slug, cwd, completeDescriptors, taken, registry, resolveImage, resolveMounts, exists, readFile }) {
  const portEnvs = [dev.port_env, ...(dev.extra_ports || [])];
  const allocations = completeDescriptors
    ? entry.ports.map((port) => ({ internal: port.internal, host: port.host }))
    : allocateHostPorts({ mappings: portEnvs.map((e) => ({ internal: dev.ports[e] })), occupied: [...taken], basePort: registry.network.basePort });
  if (!completeDescriptors) for (const a of allocations) taken.add(a.host);
  const ports = completeDescriptors
    ? entry.ports
    : allocations.map((a, i) => ({ internal: a.internal, host: a.host, portEnv: portEnvs[i], primary: portEnvs[i] === dev.port_env }));
  const image = resolveImage({ cwd: svc.path, composeFile: dev.docker.compose_file, composeService: dev.docker.service });
  const projectName = taskProjectName(svc.id, slug);
  const mounts = isContainerLauncher(dev.launcher)
    ? resolveMounts({ cwd: svc.path, composeFile: dev.docker.compose_file, composeService: dev.docker.service })
    : null;
  const depsProvision = resolveDepsProvision({
    launcher: dev.launcher,
    serviceId: svc.id,
    slug,
    worktreeDir: cwd,
    canonicalPath: svc.path,
    mounts,
    exists,
    readFile
  });
  const depsVolume = depsProvision && depsProvision.volumeName
    ? { name: depsProvision.volumeName, target: depsProvision.mountTarget }
    : null;
  const nm = depsVolume
    ? { mount: null, missing: false }
    : nodeModulesMountFor({ launcher: dev.launcher, worktreeDir: cwd, canonicalPath: svc.path, exists });
  const runtimeMounts = runtimeMountsFor({ launcher: dev.launcher, canonicalPath: svc.path, declared: svc.runtimeMounts, exists });

  return {
    ...entry,
    projectName,
    composeFile: dev.docker.compose_file,
    image,
    imageResolved: !!image,
    ports,
    nodeModulesMount: nm.mount,
    nodeModulesMissing: nm.missing,
    runtimeMounts,
    depsProvision,
    overrideYaml: renderOverride({
      service: { name: svc.id, compose_service: dev.docker.service, mode: dev.launcher === 'docker-exec' ? 'exec' : dev.launcher },
      slug,
      allocations,
      networkAlias: registry.network.composeNetworkAlias,
      image,
      nodeModulesMount: nm.mount,
      runtimeMounts,
      depsVolume
    }),
    teardownCmd: `docker compose -p ${projectName} down`,
    readiness: taskReadiness(dev.ready_signal, ports.find((p) => p.primary).host)
  };
}

function buildServiceEntry({ svc, wt, sourceByService, isolated, completeDescriptors, workspaceId, slug, sourceMode, taken, registry, portAllocations, peerInternalPort, resolveImage, resolveMounts, resolveAlias, resolvePublishedPort, readEnv, exists, readFile }) {
  const dev = svc.dev;
  const source = sourceByService.get(svc.id);
  const cwd = source?.sourcePath || (isolated.has(svc.id) ? wt[svc.id] : svc.path);
  const wiredPeers = {};
  for (const [target, envVar] of Object.entries(svc.peers || {})) {
    if (isolated.has(target)) wiredPeers[target] = envVar;
  }
  const wiredEnv = !completeDescriptors && Object.keys(wiredPeers).length
    ? maskWiredEnv(wireEnv({ envText: readEnv(svc.path), peers: wiredPeers, slug, peerInternalPort }))
    : null;

  const entry = {
    id: svc.id,
    launcher: dev.launcher,
    cwd,
    command: dev.command,
    readiness: { ...(dev.ready_signal || {}) },
    migrate: dev.migrate || null,
    teardownCmd: dev.teardown || null,
    readyTimeoutS: dev.ready_timeout_s ?? null,
    ramEstimateMb: dev.ram_estimate_mb ?? null,
    policy: isolated.has(svc.id) ? 'task-isolated' : 'shared-reuse',
    wiredEnv
  };

  if (completeDescriptors) {
    const containerLaunched = isContainerLauncher(dev.launcher);
    const isolatedHere = isolated.has(svc.id);
    const publishedHostPort = (internal) => resolvePublishedPort({ cwd: svc.path, composeFile: dev.docker?.compose_file, composeService: dev.docker?.service, internal });
    const ports = descriptorPorts({ service: svc, workspaceId, slug, sourceMode, taken, basePort: registry.network.basePort, portAllocations, usePublished: !isolatedHere && containerLaunched, publishedHostPort });
    const networkAlias = !isolatedHere && containerLaunched
      ? resolveAlias({ cwd: svc.path, composeFile: dev.docker?.compose_file, composeService: dev.docker?.service, declaredAlias: dev.docker?.network_alias || null })
      : null;
    Object.assign(entry, {
      affected: source.affected,
      source,
      topology: topologyFor(svc, registry.network),
      dependencies: [...(svc.depends_on || [])],
      ports,
      networkAlias,
      readiness: taskReadiness(dev.ready_signal, ports.find((port) => port.primary).host),
      environmentOverlay: { path: null, digest: null, restartRequired: false },
      ownership: {
        source: source.ownership,
        runtime: `${workspaceId}:${slug}:${sourceMode}:${svc.id}`,
      },
      composeFile: dev.docker?.compose_file || null,
      dockerService: dev.docker?.service || null,
    });
  }

  if (!isolated.has(svc.id)) return entry;
  if (!isContainerLauncher(dev.launcher)) return entry;

  return buildDockerExecEntry({ entry, svc, dev, slug, cwd, completeDescriptors, taken, registry, resolveImage, resolveMounts, exists, readFile });
}

export function buildBootPlan({ registry, workspaceId, slug, worktreePaths, sources, sourceMode, portAllocations, overlayDirectory = null, previousEnvironmentOverlays = [], occupied = [], resolveImage = defaultResolveImage, resolveMounts = defaultResolveMounts, resolveAlias = defaultResolveAlias, resolvePublishedPort = defaultResolvePublishedPort, readEnv = defaultReadEnv, exists = defaultExists, readJson = defaultReadJson, readFile = defaultReadFile }) {
  const wt = worktreePaths || {};
  const sourceByService = new Map((sources || []).map((source) => [source.serviceId, source]));
  const completeDescriptors = sourceByService.size > 0;
  const isolated = new Set(registry.services.filter((s) => wt[s.id] || sourceByService.get(s.id)?.affected).map((s) => s.id));
  const peerInternalPort = {};
  for (const s of registry.services) peerInternalPort[s.id] = s.dev.ports[s.dev.port_env];

  const taken = new Set(occupied);
  const services = registry.services.map((svc) => buildServiceEntry({ svc, wt, sourceByService, isolated, completeDescriptors, workspaceId, slug, sourceMode, taken, registry, portAllocations, peerInternalPort, resolveImage, resolveMounts, resolveAlias, resolvePublishedPort, readEnv, exists, readFile }));

  const frontend = resolveFrontendTarget({ frontend: registry.frontend, slug, exists });

  if (completeDescriptors && overlayDirectory) {
    const overlays = applyTopologyOverlays({
      services,
      registryServices: registry.services,
      slug,
      sourceMode,
      overlayDirectory,
      previousOverlays: previousEnvironmentOverlays,
      hostGateway: registry.network.hostGateway,
      aliasByService: Object.fromEntries(services.filter((s) => s.networkAlias).map((s) => [s.id, s.networkAlias])),
    });
    return { services: overlays.services, network: registry.network, slug, overlayFiles: overlays.overlayFiles, frontend };
  }

  return { services, network: registry.network, slug, overlayFiles: [], frontend };
}
