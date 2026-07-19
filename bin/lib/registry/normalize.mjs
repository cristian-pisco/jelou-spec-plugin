function normalizeService(id, svc, resolve) {
  const dev = { ...(svc.dev || {}) };
  dev.extra_ports = dev.extra_ports || [];
  return {
    id,
    path: resolve(svc.path),
    stack: svc.stack || null,
    peers: svc.peers || {},
    depends_on: svc.depends_on || [],
    dev
  };
}

export function normalizeRegistry(raw, { resolve }) {
  const services = Object.entries(raw.services || {}).map(([id, svc]) => normalizeService(id, svc, resolve));
  const auth = raw.auth ? { ...raw.auth } : null;
  const frontend = raw.frontend ? { ...raw.frontend, path: resolve(raw.frontend.path) } : null;
  return {
    services,
    auth,
    frontend,
    network: { composeNetworkAlias: raw.compose_network_alias || null, basePort: raw.base_port || null }
  };
}
