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

function normalizeVerify(verify) {
  if (!verify) return undefined;
  return Object.entries(verify).map(([service, path]) => ({ service, path }));
}

function normalizeAuth(auth) {
  if (!auth) return null;
  const out = { ...auth };
  const verify = normalizeVerify(auth.verify);
  if (verify) out.verify = verify;
  return out;
}

export function normalizeRegistry(raw, { resolve }) {
  const services = Object.entries(raw.services || {}).map(([id, svc]) => normalizeService(id, svc, resolve));
  const frontend = raw.frontend ? { ...raw.frontend, path: resolve(raw.frontend.path) } : null;
  return {
    services,
    auth: normalizeAuth(raw.auth),
    frontend,
    network: {
      composeNetworkAlias: raw.compose_network_alias || null,
      basePort: raw.base_port || null,
      authInjectPort: raw.auth_inject_port || null
    }
  };
}
