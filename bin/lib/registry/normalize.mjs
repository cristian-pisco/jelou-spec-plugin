const DEFAULT_PROVISIONING_ADAPTER = 'plugin:local-jelou-provisioning';

function normalizeService(id, svc, resolve) {
  const dev = { ...(svc.dev || {}) };
  dev.extra_ports = dev.extra_ports || [];
  const normalized = {
    id,
    path: resolve(svc.path),
    stack: svc.stack || null,
    peers: svc.peers || {},
    depends_on: svc.depends_on || [],
    runtimeMounts: svc.runtime_mounts || [],
    dev
  };
  if (svc.peer_suffixes) normalized.peerSuffixes = svc.peer_suffixes;
  return normalized;
}

function frontendService(frontend) {
  if (!frontend) return null;
  const id = frontend.id || 'jelou-apps';
  const routes = Object.entries(frontend.envLocal || {});
  const peers = Object.fromEntries(routes.map(([variable, route]) => [route.service, variable]));
  const peerSuffixes = Object.fromEntries(routes.map(([variable, route]) => [variable, route.suffix || '']));
  return {
    id,
    path: frontend.path,
    stack: frontend.stack || 'react',
    peers,
    peerSuffixes,
    depends_on: [...new Set(routes.map(([, route]) => route.service))],
    runtimeMounts: [],
    dev: {
      launcher: frontend.launcher || 'npm',
      command: frontend.command,
      teardown: frontend.teardown || null,
      port_env: frontend.portEnv || 'PORT',
      extra_ports: [],
      ports: { [frontend.portEnv || 'PORT']: frontend.port },
      ready_signal: frontend.readySignal || { type: 'http_200', path: '/' },
      ram_estimate_mb: frontend.ramEstimateMb ?? null,
    },
  };
}

export function ensureFrontendService(registry) {
  const normalized = registry.auth && !registry.auth.localProvisioningAdapter
    ? { ...registry, auth: { ...registry.auth, localProvisioningAdapter: DEFAULT_PROVISIONING_ADAPTER } }
    : registry;
  const candidate = frontendService(normalized.frontend);
  if (!candidate || normalized.services.some((service) => service.id === candidate.id)) return normalized;
  return { ...normalized, services: [...normalized.services, candidate] };
}

function normalizeVerify(verify) {
  if (!verify) return undefined;
  return Object.entries(verify).map(([service, path]) => ({ service, path }));
}

function normalizeAuth(auth, resolve) {
  if (!auth) return null;
  const out = { ...auth };
  out.localProvisioningAdapter = auth.localProvisioningAdapter
    ? (auth.localProvisioningAdapter.startsWith('plugin:') ? auth.localProvisioningAdapter : resolve(auth.localProvisioningAdapter))
    : DEFAULT_PROVISIONING_ADAPTER;
  const verify = normalizeVerify(auth.verify);
  if (verify) out.verify = verify;
  return out;
}

export { DEFAULT_PROVISIONING_ADAPTER };

export function resolveProvisioningAdapter(registry) {
  const auth = registry && registry.auth;
  if (!auth) return { required: false, adapter: null, ok: true, reason: null };
  if (auth.localProvisioningAdapter) {
    return { required: true, adapter: auth.localProvisioningAdapter, ok: true, reason: null };
  }
  return {
    required: true,
    adapter: null,
    ok: false,
    reason: 'the registry carries an auth block but no localProvisioningAdapter — this value is applied by normalizeRegistry, so the caller is reading the raw registry instead of the normalized one'
  };
}

export function normalizeRegistry(raw, { resolve }) {
  const services = Object.entries(raw.services || {}).map(([id, svc]) => normalizeService(id, svc, resolve));
  const frontend = raw.frontend ? { ...raw.frontend, path: resolve(raw.frontend.path) } : null;
  return ensureFrontendService({
    services,
    auth: normalizeAuth(raw.auth, resolve),
    frontend,
    network: {
      composeNetworkAlias: raw.compose_network_alias || null,
      basePort: raw.base_port || null,
      authInjectPort: raw.auth_inject_port || null
    }
  });
}
