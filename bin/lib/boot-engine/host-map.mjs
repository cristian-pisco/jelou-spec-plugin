import { spawnSync } from 'node:child_process';
import { isContainerLauncher } from './launcher.mjs';

export function parsePublishedPort(stdout) {
  const line = String(stdout || '').split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const port = Number(line.slice(line.lastIndexOf(':') + 1));
  return Number.isInteger(port) && port > 0 ? port : null;
}

export function publishedPortOf({ cwd, composeFile, composeService, internal, run }) {
  if (!cwd || !composeFile || !composeService || !internal) return null;
  const r = run('docker', ['compose', '-f', composeFile, 'port', composeService, String(internal)], { cwd });
  if (!r || r.status !== 0) return null;
  return parsePublishedPort(r.stdout);
}

export function parsePublishedPortTable(stdout) {
  const out = [];
  for (const line of String(stdout || '').split('\n')) {
    const match = line.match(/^\s*(\d+)\/tcp\s*->\s*\S*:(\d+)\s*$/);
    if (match) out.push({ internal: Number(match[1]), host: Number(match[2]) });
  }
  return out;
}

function defaultRun(bin, args, options) {
  return spawnSync(bin, args, { encoding: 'utf8', ...options });
}

function defaultPublishedPort(args) {
  return publishedPortOf({ ...args, run: defaultRun });
}

export function createPublishedPortResolver({ run = defaultRun } = {}) {
  const cache = new Map();
  return ({ cwd, composeFile, composeService, internal }) => {
    if (!cwd || !composeFile || !composeService || !internal) return null;
    const key = `${cwd}|${composeFile}|${composeService}`;
    if (!cache.has(key)) cache.set(key, containerPublishedPorts({ cwd, composeFile, composeService, run }));
    const match = cache.get(key).find((p) => p.internal === internal);
    return match ? match.host : null;
  };
}

function containerPublishedPorts({ cwd, composeFile, composeService, run }) {
  if (!cwd || !composeFile || !composeService) return [];
  const id = run('docker', ['compose', '-f', composeFile, 'ps', '-q', composeService], { cwd });
  const containerId = id && id.status === 0 ? String(id.stdout || '').trim().split('\n')[0] : '';
  if (!containerId) return [];
  const ports = run('docker', ['port', containerId], { cwd });
  if (!ports || ports.status !== 0) return [];
  return parsePublishedPortTable(ports.stdout);
}

export function hostByService({
  plan,
  registry,
  publishedPort = defaultPublishedPort,
  occupiedOnHost = [],
  probeHostPort = null,
  listPublishedPorts = (args) => containerPublishedPorts({ ...args, run: defaultRun }),
}) {
  const byId = {};
  for (const s of registry.services) byId[s.id] = s;
  const map = {};
  const occupied = [...occupiedOnHost];
  const unresolved = [];
  const corrected = [];
  for (const entry of plan.services) {
    if (entry.policy === 'task-isolated') {
      if (!isContainerLauncher(entry.launcher)) {
        unresolved.push(entry.id);
        continue;
      }
      const primary = entry.ports.find((p) => p.primary) || entry.ports[0];
      map[entry.id] = primary.host;
      for (const p of entry.ports) occupied.push(p.host);
      continue;
    }
    const dev = byId[entry.id].dev;
    const internal = dev.ports[dev.port_env];
    const composeFile = dev.docker && dev.docker.compose_file;
    const composeService = dev.docker && dev.docker.service;
    const published = publishedPort({ cwd: entry.cwd, composeFile, composeService, internal });
    let resolved = published;
    if (probeHostPort && resolved && !probeHostPort(resolved)) resolved = null;
    if (probeHostPort && !resolved) {
      const alternatives = listPublishedPorts({ cwd: entry.cwd, composeFile, composeService })
        .filter((p) => p.host !== published);
      const live = alternatives.find((p) => probeHostPort(p.host));
      if (live) {
        resolved = live.host;
        corrected.push({ id: entry.id, declaredInternal: internal, servingInternal: live.internal, host: live.host });
      }
    }
    map[entry.id] = resolved || published || internal;
    if (resolved) occupied.push(resolved);
    else unresolved.push(entry.id);
  }
  return { hostByService: map, occupied: [...new Set(occupied)], unresolved, corrected };
}
