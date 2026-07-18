import { allocateHostPorts } from './ports.mjs';
import { renderOverride } from './override.mjs';
import { wireEnv } from './wiring.mjs';

function primaryInternalPort(service) {
  const primary = service.port_mappings.find(m => m.primary) || service.port_mappings[0];
  return primary.internal;
}

export function buildTaskStack({ stack, slug, worktreePaths, occupied, readEnv }) {
  const peerInternalPort = {};
  for (const svc of stack.services) peerInternalPort[svc.name] = primaryInternalPort(svc);

  const taken = new Set(occupied);
  const plan = [];
  for (const svc of stack.services) {
    const allocations = allocateHostPorts({ mappings: svc.port_mappings, occupied: taken, basePort: stack.basePort });
    for (const a of allocations) taken.add(a.host);

    const ports = allocations.map((a, i) => ({ internal: a.internal, host: a.host, portEnv: svc.port_mappings[i].port_env }));
    const overrideYaml = renderOverride({ service: svc, slug, allocations, networkAlias: stack.composeNetworkAlias });
    const cwd = worktreePaths[svc.name] || svc.path;
    const envText = readEnv(svc, cwd);
    const wiredEnv = wireEnv({ envText, peers: svc.peers || {}, slug, peerInternalPort });

    plan.push({ name: svc.name, projectName: `${svc.name}-${slug}`, cwd, mode: svc.mode, composeFile: svc.compose_file, ports, overrideYaml, wiredEnv });
  }
  return plan;
}
