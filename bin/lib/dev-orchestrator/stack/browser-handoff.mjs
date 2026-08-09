import { renderInjectPage } from './inject-page.mjs';
import { isGenuineAuthCookie } from './auth-cookie-state.mjs';

export const HANDOFF_HOST = 'localhost';

export function planBrowserHandoff({ cookie, appUrl, account, port, sessionVerified }) {
  if (sessionVerified !== true) {
    return { ok: false, reason: 'session-unverified', page: null, entryUrl: null };
  }
  if (!isGenuineAuthCookie(cookie)) {
    return { ok: false, reason: 'no-genuine-cookie', page: null, entryUrl: null };
  }
  if (!appUrl || !port) {
    return { ok: false, reason: 'incomplete-target', page: null, entryUrl: null };
  }
  return {
    ok: true,
    reason: null,
    port,
    entryUrl: `http://${HANDOFF_HOST}:${port}/`,
    appUrl,
    page: renderInjectPage({ cookieName: cookie.name, cookieValue: cookie.value, appUrl, account })
  };
}

export function handoffSucceeded(finalUrl) {
  if (typeof finalUrl !== 'string' || !finalUrl) return false;
  try {
    return !new URL(finalUrl).pathname.startsWith('/login');
  } catch {
    return false;
  }
}
