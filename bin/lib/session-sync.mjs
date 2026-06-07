// bin/lib/session-sync.mjs — pure helpers for local cookie-guard session provisioning.
//
// Replicates jelou-apps/tools/dev-session-sync inside the E2E flow: decrypt the real
// jelou_auth cookie captured at login, build the userSessions upsert, extract/synthesize
// the localhost cookie copy, and decide when to run. Side-effect-free; the Mongo write
// and file I/O live in bin/e2e-session-sync.mjs.
//
// decryptSessionCookie ports tools/dev-session-sync/agent/cookie.js and buildSessionUpdate
// ports session-store.js — kept byte-compatible so a provisioned session is
// indistinguishable from one the agent provisions.

import { createDecipheriv } from 'node:crypto';

function decryptError(message, code) {
  return Object.assign(new Error(message), { code });
}

export function decryptSessionCookie(cookieValue, secret) {
  if (!cookieValue || typeof cookieValue !== 'string') throw decryptError('cookie value is required');

  let raw = cookieValue;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // value was not URL-encoded; use it as-is
  }
  if (raw.startsWith('s:')) raw = raw.slice(2);

  const parts = raw.split('.');
  if (parts.length < 3) throw decryptError('invalid cookie format');
  const [encryptedToken, ivHex, authTagHex] = parts;

  let decrypted;
  try {
    const key = Buffer.alloc(32, secret, 'utf8');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    decrypted = decipher.update(encryptedToken, 'hex', 'utf8') + decipher.final('utf8');
  } catch {
    throw decryptError('cookie decryption failed (wrong COOKIE_SECRET?)', 'decrypt_failed');
  }

  const fields = decrypted.split(';').reduce((acc, pair) => {
    const [k, v] = pair.split('=');
    if (k && v) acc[k] = v;
    return acc;
  }, {});
  if (!fields.sessionId) throw decryptError('sessionId not found in cookie');

  return { sessionId: fields.sessionId, userId: fields.userId, companyId: fields.companyId };
}

export function buildSessionUpdate(fields, ttlHours, now = new Date()) {
  const { sessionId, userId, companyId } = fields;
  if (!sessionId) throw new Error('sessionId is required to upsert a session');
  const expiredAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  return {
    filter: { sessionId },
    update: {
      $set: { userId: Number(userId), companyId: Number(companyId), status: 'CONNECTED', expiredAt, updatedAt: now },
      $setOnInsert: { sessionId, createdAt: now },
    },
    options: { upsert: true },
  };
}

const DEFAULT_COOKIE_NAME = 'jelou_auth';

function domainMatchesJelou(domain) {
  const d = String(domain || '').replace(/^\./, '');
  return d === 'jelou.ai' || d.endsWith('.jelou.ai');
}

export function extractAuthCookie(storageState, cookieName = DEFAULT_COOKIE_NAME) {
  const cookies = storageState?.cookies;
  if (!Array.isArray(cookies)) return null;
  const hit = cookies.find((c) => c?.name === cookieName && c?.value && domainMatchesJelou(c?.domain));
  return hit ? hit.value : null;
}

export function isLocalHost(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function buildLocalCookie(name, value, baseUrl, ttlHours, nowMs) {
  const u = new URL(baseUrl);
  return {
    name,
    value,
    domain: u.hostname,
    path: '/',
    expires: Math.floor((nowMs + ttlHours * 60 * 60 * 1000) / 1000),
    httpOnly: false,
    secure: u.protocol === 'https:',
    sameSite: 'Lax',
  };
}

export function shouldProvision({ baseUrl, secret, storageState, cookieName = DEFAULT_COOKIE_NAME }) {
  if (!isLocalHost(baseUrl)) return { ok: false, reason: `target ${baseUrl} is not a loopback host` };
  if (!secret) return { ok: false, reason: 'COOKIE_SECRET is not set' };
  if (!extractAuthCookie(storageState, cookieName)) {
    return { ok: false, reason: `no ${cookieName} cookie on a *.jelou.ai domain in storageState` };
  }
  return { ok: true, reason: 'ok' };
}

export { DEFAULT_COOKIE_NAME };
