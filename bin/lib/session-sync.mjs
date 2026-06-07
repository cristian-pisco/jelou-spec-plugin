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
