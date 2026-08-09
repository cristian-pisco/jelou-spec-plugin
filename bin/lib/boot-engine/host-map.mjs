import { spawnSync } from 'node:child_process';
import { isContainerLauncher } from './launcher.mjs';

export function parsePublishedPort(stdout) {
  const line = String(stdout || '').split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const port = Number(line.slice(line.lastIndexOf(':') + 1));
  return Number.isInteger(port) && port > 0 ? port : null;
}

function defaultPublishedPort({ cwd, composeFile, composeService, internal }) {
  if (!cwd || !composeFile || !composeService || !internal) return null;
  const r = spawnSync('docker', ['compose', '-f', composeFile, 'port', composeService, String(internal)], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return parsePublishedPort(r.stdout);
}

export function hostByService({ plan, registry, publishedPort = defaultPublishedPort, occupiedOnHost = [] }) {
  const byId = {};
  for (const s of registry.services) byId[s.id] = s;
  const map = {};
  const occupied = [...occupiedOnHost];
  const unresolved = [];
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
    const published = publishedPort({
      cwd: entry.cwd,
      composeFile: dev.docker && dev.docker.compose_file,
      composeService: dev.docker && dev.docker.service,
      internal
    });
    map[entry.id] = published || internal;
    if (published) occupied.push(published);
    else unresolved.push(entry.id);
  }
  return { hostByService: map, occupied: [...new Set(occupied)], unresolved };
}
