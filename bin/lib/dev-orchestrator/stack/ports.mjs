const MAX_PORT = 65535;

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

export function parseOccupiedPorts(dockerPsPortsOutput) {
  const ports = new Set();
  const hostBinding = /(?:\d+\.\d+\.\d+\.\d+:)?(\d{2,5})->/g;
  let m;
  while ((m = hostBinding.exec(dockerPsPortsOutput)) !== null) ports.add(Number(m[1]));
  return ports;
}
