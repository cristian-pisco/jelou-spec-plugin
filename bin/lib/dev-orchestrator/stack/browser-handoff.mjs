import { renderInjectPage, sessionMarkersFor } from './inject-page.mjs';
import { isGenuineAuthCookie } from './auth-cookie-state.mjs';

export const HANDOFF_HOST = 'localhost';

export function sessionMarkerScript(sessionMarkers) {
  const writes = Object.entries(sessionMarkers)
    .map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(String(value))});`)
    .join(' ');
  return `(() => { ${writes} location.reload(); return true; })()`;
}

export function sessionMarkerProbeScript(sessionMarkers) {
  const keys = Object.keys(sessionMarkers);
  return `(() => ({ url: location.href, storage: Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, localStorage.getItem(k)])) }))()`;
}

export function planBrowserHandoff({ cookie, appUrl, account, port, sessionVerified, frontend = null }) {
  if (sessionVerified !== true) {
    return { ok: false, reason: 'session-unverified', page: null, entryUrl: null };
  }
  if (!isGenuineAuthCookie(cookie)) {
    return { ok: false, reason: 'no-genuine-cookie', page: null, entryUrl: null };
  }
  if (!appUrl || !port) {
    return { ok: false, reason: 'incomplete-target', page: null, entryUrl: null };
  }
  const sessionMarkers = sessionMarkersFor(frontend);
  return {
    ok: true,
    reason: null,
    port,
    entryUrl: `http://${HANDOFF_HOST}:${port}/`,
    appUrl,
    sessionMarkers,
    markerScript: sessionMarkerScript(sessionMarkers),
    probeScript: sessionMarkerProbeScript(sessionMarkers),
    page: renderInjectPage({ cookieName: cookie.name, cookieValue: cookie.value, appUrl, account })
  };
}

export function handoffSucceeded({ finalUrl, sessionMarkers = {}, observedStorage = null }) {
  if (typeof finalUrl !== 'string' || !finalUrl) return { ok: false, reason: 'no-final-url' };
  let pathname;
  try {
    pathname = new URL(finalUrl).pathname;
  } catch {
    return { ok: false, reason: 'no-final-url' };
  }
  if (pathname.startsWith('/login')) return { ok: false, reason: 'browser-on-login' };
  const expected = Object.entries(sessionMarkers);
  if (expected.length === 0) return { ok: true, reason: null };
  if (!observedStorage) return { ok: false, reason: 'session-markers-unobserved' };
  const missing = expected
    .filter(([key, value]) => String(observedStorage[key]) !== String(value))
    .map(([key]) => key);
  if (missing.length > 0) return { ok: false, reason: `session-markers-missing:${missing.join(',')}` };
  return { ok: true, reason: null };
}
