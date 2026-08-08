function normalizeService(id, svc, resolve) {
  const dev = { ...(svc.dev || {}) };
  dev.extra_ports = dev.extra_ports || [];
  return {
    id,
    path: resolve(svc.path),
    stack: svc.stack || null,
    peers: svc.peers || {},
    depends_on: svc.depends_on || [],
    runtimeMounts: svc.runtime_mounts || [],
    dev
  };
}

function normalizeVerify(verify) {
  if (!verify) return undefined;
  return Object.entries(verify).map(([service, path]) => ({ service, path }));
}

function normalizeAuth(auth, resolve) {
  if (!auth) return null;
  const out = { ...auth };
  if (auth.localProvisioningAdapter) out.localProvisioningAdapter = resolve(auth.localProvisioningAdapter);
  const verify = normalizeVerify(auth.verify);
  if (verify) out.verify = verify;
  return out;
}

export function normalizeRegistry(raw, { resolve }) {
  const services = Object.entries(raw.services || {}).map(([id, svc]) => normalizeService(id, svc, resolve));
  const frontend = raw.frontend ? { ...raw.frontend, path: resolve(raw.frontend.path) } : null;
  return {
    services,
    auth: normalizeAuth(raw.auth, resolve),
    frontend,
    network: {
      composeNetworkAlias: raw.compose_network_alias || null,
      basePort: raw.base_port || null,
      authInjectPort: raw.auth_inject_port || null
    }
  };
}
