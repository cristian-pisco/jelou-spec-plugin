import { allocateHostPorts } from '../dev-orchestrator/stack/ports.mjs';
import { renderOverride } from '../dev-orchestrator/stack/override.mjs';
import { wireEnv } from '../dev-orchestrator/stack/wiring.mjs';
import { resolveBaseImage } from '../dev-orchestrator/stack/resolve-base-image.mjs';
import { maskWiredEnv } from './env-mask.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

function defaultResolveImage({ cwd, composeFile, composeService }) {
  return resolveBaseImage({ cwd, composeFile, composeService, run: (b, a, o) => spawnSync(b, a, { encoding: 'utf8', ...o }) });
}

function defaultReadEnv(cwd) {
  try { return readFileSync(`${cwd}/.env`, 'utf8'); } catch { return ''; }
}

function defaultExists(p) { return existsSync(p); }

function nodeModulesMountFor({ launcher, worktreeDir, canonicalPath, exists }) {
  if (launcher !== 'docker-exec') return { mount: null, missing: false };
  if (exists(`${worktreeDir}/node_modules`)) return { mount: null, missing: false };
  if (exists(`${canonicalPath}/node_modules`)) return { mount: `${canonicalPath}/node_modules`, missing: false };
  return { mount: null, missing: true };
}

function defaultReadJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } }

function installCommandFor(dir, exists) {
  if (exists(`${dir}/yarn.lock`)) return 'yarn install';
  if (exists(`${dir}/pnpm-lock.yaml`)) return 'pnpm install';
  return 'npm install';
}

function runtimeMountsFor({ launcher, canonicalPath, declared, exists }) {
  if (launcher !== 'docker-exec') return [];
  const out = [];
  for (const p of declared || []) {
    if (exists(`${canonicalPath}/${p}`)) out.push({ source: `${canonicalPath}/${p}`, target: `/app/${p}` });
  }
  return out;
}

function dependencyDivergence({ launcher, worktreeDir, canonicalPath, exists, readJson }) {
  if (launcher !== 'docker-exec') return null;
  const pkg = readJson(`${worktreeDir}/package.json`);
  const deps = Object.keys(pkg.dependencies || {});
  const missing = deps.filter((name) => !exists(`${canonicalPath}/node_modules/${name}`));
  return missing.length ? { missing, installCmd: installCommandFor(worktreeDir, exists) } : null;
}

function taskReadiness(readySignal, primaryHost) {
  const r = { ...(readySignal || {}) };
  if (r.type === 'http_200' || r.type === 'port_open') r.port = primaryHost;
  return r;
}

export function buildBootPlan({ registry, slug, worktreePaths, occupied = [], resolveImage = defaultResolveImage, readEnv = defaultReadEnv, exists = defaultExists, readJson = defaultReadJson }) {
  const wt = worktreePaths || {};
  const isolated = new Set(registry.services.filter((s) => wt[s.id]).map((s) => s.id));
  const peerInternalPort = {};
  for (const s of registry.services) peerInternalPort[s.id] = s.dev.ports[s.dev.port_env];

  const taken = new Set(occupied);
  const services = registry.services.map((svc) => {
    const dev = svc.dev;
    const cwd = isolated.has(svc.id) ? wt[svc.id] : svc.path;
    const wiredPeers = {};
    for (const [target, envVar] of Object.entries(svc.peers || {})) {
      if (isolated.has(target)) wiredPeers[target] = envVar;
    }
    const wiredEnv = Object.keys(wiredPeers).length
      ? maskWiredEnv(wireEnv({ envText: readEnv(svc.path), peers: wiredPeers, slug, peerInternalPort }))
      : null;

    const entry = {
      id: svc.id,
      launcher: dev.launcher,
      cwd,
      command: dev.command,
      readiness: { ...(dev.ready_signal || {}) },
      teardownCmd: dev.teardown || null,
      ramEstimateMb: dev.ram_estimate_mb ?? null,
      policy: isolated.has(svc.id) ? 'task-isolated' : 'shared-reuse',
      wiredEnv
    };

    if (!isolated.has(svc.id)) return entry;

    const portEnvs = [dev.port_env, ...(dev.extra_ports || [])];
    const allocations = allocateHostPorts({ mappings: portEnvs.map((e) => ({ internal: dev.ports[e] })), occupied: [...taken], basePort: registry.network.basePort });
    for (const a of allocations) taken.add(a.host);
    const ports = allocations.map((a, i) => ({ internal: a.internal, host: a.host, portEnv: portEnvs[i], primary: portEnvs[i] === dev.port_env }));
    const image = resolveImage({ cwd: svc.path, composeFile: dev.docker.compose_file, composeService: dev.docker.service });
    const projectName = `${svc.id}-${slug}`;
    const nm = nodeModulesMountFor({ launcher: dev.launcher, worktreeDir: cwd, canonicalPath: svc.path, exists });
    const runtimeMounts = runtimeMountsFor({ launcher: dev.launcher, canonicalPath: svc.path, declared: svc.runtimeMounts, exists });
    const depsDiverged = dependencyDivergence({ launcher: dev.launcher, worktreeDir: cwd, canonicalPath: svc.path, exists, readJson });

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
      depsDiverged,
      overrideYaml: renderOverride({
        service: { name: svc.id, compose_service: dev.docker.service, mode: dev.launcher === 'docker-exec' ? 'exec' : dev.launcher },
        slug,
        allocations,
        networkAlias: registry.network.composeNetworkAlias,
        image,
        nodeModulesMount: nm.mount,
        runtimeMounts
      }),
      teardownCmd: `docker compose -p ${projectName} down`,
      readiness: taskReadiness(dev.ready_signal, ports.find((p) => p.primary).host)
    };
  });

  return { services, network: registry.network, slug };
}
