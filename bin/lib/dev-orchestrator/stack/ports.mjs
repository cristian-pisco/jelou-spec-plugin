const MAX_PORT = 65535;

function stableOffset(value, span) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % span;
}

function ownedPortTag({ workspaceId, taskSlug, sourceMode, serviceId, portEnv }) {
  return `${workspaceId}:${taskSlug}:${sourceMode}:${serviceId}:${portEnv}`;
}

function nextDeterministicPort({ ownerTag, basePort, unavailable }) {
  const span = MAX_PORT - basePort + 1;
  if (span <= 0) throw new Error(`no free host port available at or above ${basePort}`);
  const start = basePort + stableOffset(ownerTag, span);
  for (let offset = 0; offset < span; offset += 1) {
    const candidate = basePort + ((start - basePort + offset) % span);
    if (!unavailable.has(candidate)) return candidate;
  }
  throw new Error(`no free host port available at or above ${basePort}`);
}

export function allocateHostPorts({ mappings, occupied, basePort }) {
  const taken = new Set(occupied);
  const result = [];
  let next = basePort;
  for (const mapping of mappings) {
    while (next <= MAX_PORT && taken.has(next)) next += 1;
    if (next > MAX_PORT) throw new Error(`no free host port available at or above ${basePort}`);
    taken.add(next);
    result.push({ internal: mapping.internal, host: next });
    next += 1;
  }
  return result;
}

export function allocateOwnedPorts({ requests, workspaceId, taskSlug, sourceMode, basePort, persisted = [], live = [] }) {
  const persistedByOwner = new Map(persisted.map((allocation) => [allocation.ownerTag, allocation]));
  const liveByPort = new Map(live.map((listener) => [listener.port, listener]));
  const unavailable = new Set(live.map((listener) => listener.port));
  const allocated = new Set();

  return requests.map((request) => {
    const ownerTag = ownedPortTag({ workspaceId, taskSlug, sourceMode, ...request });
    const previous = persistedByOwner.get(ownerTag);
    if (previous) {
      const listener = liveByPort.get(previous.host);
      if (listener && listener.ownerTag !== ownerTag) {
        const identity = listener.pid == null ? 'unknown pid' : `pid ${listener.pid}`;
        throw new Error(`${request.serviceId} persisted port ${previous.host} has an unrelated live owner (${identity})`);
      }
      if (allocated.has(previous.host)) throw new Error(`${request.serviceId} persisted port ${previous.host} is allocated twice`);
      allocated.add(previous.host);
      return { ...request, host: previous.host, ownerTag };
    }

    let host = request.internal;
    if (unavailable.has(host) || allocated.has(host)) {
      host = nextDeterministicPort({ ownerTag, basePort, unavailable: new Set([...unavailable, ...allocated]) });
    }
    allocated.add(host);
    return { ...request, host, ownerTag };
  });
}

export function parseOccupiedPorts(dockerPsPortsOutput) {
  const ports = new Set();
  const hostBinding = /(?:\d+\.\d+\.\d+\.\d+:)?(\d{2,5})->/g;
  let m;
  while ((m = hostBinding.exec(dockerPsPortsOutput)) !== null) ports.add(Number(m[1]));
  return ports;
}

export function parseListeningPorts(snapshot) {
  const listeners = [];
  for (const line of String(snapshot || '').split('\n')) {
    if (!/^LISTEN\s/.test(line)) continue;
    const localAddress = line.split(/\s+/)[3] || '';
    const port = Number(/:(\d{2,5})$/.exec(localAddress)?.[1]);
    if (!port) continue;
    const pid = Number(/pid=(\d+)/.exec(line)?.[1]);
    const command = /users:\(\(\"([^\"]+)\"/.exec(line)?.[1] || null;
    listeners.push({ port, ownerTag: null, pid: pid || null, command });
  }
  return listeners;
}
