import { rewriteFrontendEnv } from './frontend-env.mjs';

export const E2E_ENV_FILE = '.env.e2e';
export const FRONTEND_HOST_KEY = '__frontend__';

export function unresolvedServices({ envLocal, hostByService }) {
  return Object.entries(envLocal || {})
    .filter(([, spec]) => hostByService[spec.service] === undefined)
    .map(([key, spec]) => ({ key, service: spec.service }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function manageableEnvLocal({ envLocal, manageOnly }) {
  if (!manageOnly) return { ...(envLocal || {}) };
  const allowed = new Set(manageOnly);
  return Object.fromEntries(Object.entries(envLocal || {}).filter(([, spec]) => allowed.has(spec.service)));
}

export function rewriteE2eEnv({
  envText,
  envLocal,
  envBlank,
  hostByService,
  manageOnly = null,
  frontendHost = null,
  baseUrlKey = 'E2E_BASE_URL'
}) {
  const map = { ...hostByService };
  const local = manageableEnvLocal({ envLocal, manageOnly });
  if (frontendHost !== null) {
    map[FRONTEND_HOST_KEY] = frontendHost;
    local[baseUrlKey] = { service: FRONTEND_HOST_KEY, suffix: '' };
  }

  const unresolved = unresolvedServices({ envLocal: local, hostByService: map });
  if (unresolved.length > 0) {
    const detail = unresolved.map((u) => `${u.key} -> ${u.service}`).join(', ');
    throw new Error(`cannot wire the E2E env — no booted host for: ${detail}. Every frontend.envLocal service must be in the boot plan.`);
  }

  const text = rewriteFrontendEnv({ envText, envLocal: local, envBlank, hostByService: map });
  const managed = {};
  for (const [key, spec] of Object.entries(local)) {
    managed[key] = `http://localhost:${map[spec.service]}${spec.suffix || ''}`;
  }
  return { text, managed };
}
