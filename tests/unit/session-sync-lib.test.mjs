// tests/unit/session-sync-lib.test.mjs
//
// Run: `node --test tests/unit/session-sync-lib.test.mjs`
// Pure helpers behind bin/e2e-session-sync.mjs. The decrypt is a port of
// tools/dev-session-sync/agent/cookie.js and the upsert doc a port of
// session-store.js — kept byte-compatible so a provisioned session is
// indistinguishable from the agent's. The Mongo write and storageState I/O are
// acceptance-tested; everything decision-shaped is tested here.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { createCipheriv, randomBytes } from 'node:crypto';

import {
  decryptSessionCookie,
  buildSessionUpdate,
} from '../../bin/lib/session-sync.mjs';

// Mirrors tools/dev-session-sync/agent/test-utils.js so the roundtrip exercises
// the exact wire format (k=v;...; payload, 32-byte key, aes-256-gcm, enc.iv.tag).
function encryptCookie(fields, secret) {
  const payload = `${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(';')};`;
  const key = Buffer.alloc(32, secret, 'utf8');
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = cipher.update(payload, 'utf8', 'hex') + cipher.final('hex');
  return `${encrypted}.${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}`;
}

const SECRET = 'test-secret-123';

describe('decryptSessionCookie', () => {
  test('extracts session fields from a well-formed cookie', () => {
    const cookie = encryptCookie({ sessionType: 'USER', userId: '42', sessionId: 'sess-1', companyId: '7' }, SECRET);
    assert.deepEqual(decryptSessionCookie(cookie, SECRET), { sessionId: 'sess-1', userId: '42', companyId: '7' });
  });

  test('handles the express s: prefix + trailing signature (4 parts)', () => {
    const cookie = `s:${encryptCookie({ sessionId: 'sess-2', userId: '1', companyId: '2' }, SECRET)}.fakesig`;
    assert.equal(decryptSessionCookie(cookie, SECRET).sessionId, 'sess-2');
  });

  test('handles the url-encoded s%3A prefix', () => {
    const cookie = `s%3A${encryptCookie({ sessionId: 'sess-3', userId: '1', companyId: '2' }, SECRET)}`;
    assert.equal(decryptSessionCookie(cookie, SECRET).sessionId, 'sess-3');
  });

  test('tags a wrong-secret failure with code decrypt_failed', () => {
    const cookie = encryptCookie({ sessionId: 's1', userId: '1', companyId: '2' }, SECRET);
    try {
      decryptSessionCookie(cookie, 'a-different-secret');
      assert.fail('expected a throw');
    } catch (err) {
      assert.equal(err.code, 'decrypt_failed');
    }
  });

  test('throws on garbage and on a missing sessionId', () => {
    assert.throws(() => decryptSessionCookie('garbage', SECRET));
    assert.throws(() => decryptSessionCookie(encryptCookie({ userId: '1', companyId: '2' }, SECRET), SECRET));
    assert.throws(() => decryptSessionCookie('', SECRET));
  });
});

describe('buildSessionUpdate', () => {
  test('builds a CONNECTED upsert keyed on sessionId with future expiry', () => {
    const now = new Date('2026-06-07T00:00:00Z');
    const { filter, update, options } = buildSessionUpdate({ sessionId: 's1', userId: '42', companyId: '7' }, 12, now);
    assert.deepEqual(filter, { sessionId: 's1' });
    assert.equal(update.$set.userId, 42);
    assert.equal(update.$set.companyId, 7);
    assert.equal(update.$set.status, 'CONNECTED');
    assert.equal(update.$set.expiredAt.getTime(), now.getTime() + 12 * 3600 * 1000);
    assert.equal(update.$set.updatedAt.getTime(), now.getTime());
    assert.equal(update.$setOnInsert.sessionId, 's1');
    assert.equal(update.$setOnInsert.createdAt.getTime(), now.getTime());
    assert.equal(options.upsert, true);
  });

  test('throws without a sessionId', () => {
    assert.throws(() => buildSessionUpdate({ userId: '1' }, 12));
  });
});
