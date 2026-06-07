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
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRIVER = join(ROOT, 'bin', 'e2e-session-sync.mjs');

import {
  decryptSessionCookie,
  buildSessionUpdate,
  extractAuthCookie,
  isLocalHost,
  buildLocalCookie,
  shouldProvision,
  DEFAULT_COOKIE_NAME,
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

const STATE = {
  cookies: [
    { name: 'jelou_auth', value: 'prod-token', domain: '.jelou.ai', path: '/' },
    { name: '_ga', value: 'x', domain: 'localhost', path: '/' },
    { name: 'jelou_auth', value: 'other', domain: '.other.com', path: '/' },
  ],
};

describe('extractAuthCookie', () => {
  test('returns the value of the jelou_auth cookie on a *.jelou.ai domain', () => {
    assert.equal(extractAuthCookie(STATE), 'prod-token');
  });

  test('ignores other domains and tolerates a malformed state', () => {
    assert.equal(extractAuthCookie({ cookies: [{ name: 'jelou_auth', value: 'v', domain: '.other.com' }] }), null);
    assert.equal(extractAuthCookie(null), null);
    assert.equal(extractAuthCookie({}), null);
  });

  test('honors a custom cookie name', () => {
    const s = { cookies: [{ name: 'sid', value: 'v', domain: 'jelou.ai', path: '/' }] };
    assert.equal(extractAuthCookie(s, 'sid'), 'v');
  });
});

describe('isLocalHost', () => {
  test('loopback hosts are local', () => {
    assert.equal(isLocalHost('http://localhost:5173'), true);
    assert.equal(isLocalHost('http://127.0.0.1:5173'), true);
    assert.equal(isLocalHost('http://[::1]:5173'), true);
  });

  test('everything else and garbage is not local', () => {
    assert.equal(isLocalHost('https://apps.jelou.ai'), false);
    assert.equal(isLocalHost('not a url'), false);
  });
});

describe('buildLocalCookie', () => {
  test('host-only localhost cookie, secure follows the protocol', () => {
    const c = buildLocalCookie('jelou_auth', 'prod-token', 'http://localhost:5173', 12, 1_000_000);
    assert.equal(c.name, 'jelou_auth');
    assert.equal(c.value, 'prod-token');
    assert.equal(c.domain, 'localhost');
    assert.equal(c.path, '/');
    assert.equal(c.secure, false);
    assert.equal(c.sameSite, 'Lax');
    assert.equal(c.expires, Math.floor((1_000_000 + 12 * 3600 * 1000) / 1000));
  });

  test('https base url yields a secure cookie', () => {
    assert.equal(buildLocalCookie('jelou_auth', 'v', 'https://localhost:5173', 12, 0).secure, true);
  });
});

describe('shouldProvision', () => {
  test('runs only for loopback + secret + present cookie', () => {
    assert.equal(shouldProvision({ baseUrl: 'http://localhost:5173', secret: 's', storageState: STATE }).ok, true);
  });

  test('skips with a reason when any precondition is missing', () => {
    assert.equal(shouldProvision({ baseUrl: 'https://apps.jelou.ai', secret: 's', storageState: STATE }).ok, false);
    assert.equal(shouldProvision({ baseUrl: 'http://localhost:5173', secret: '', storageState: STATE }).ok, false);
    assert.equal(shouldProvision({ baseUrl: 'http://localhost:5173', secret: 's', storageState: { cookies: [] } }).ok, false);
  });

  test('exposes the default cookie name', () => {
    assert.equal(DEFAULT_COOKIE_NAME, 'jelou_auth');
  });
});

describe('e2e-session-sync CLI', () => {
  test('exits 2 when required env is missing', () => {
    const r = spawnSync('node', [DRIVER], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /E2E_STORAGE_STATE and E2E_BASE_URL are required/);
  });

  test('skips (exit 0) for a non-loopback target without touching Mongo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-sync-'));
    const state = join(dir, 'state.json');
    writeFileSync(state, JSON.stringify({ cookies: [{ name: 'jelou_auth', value: 'v', domain: '.jelou.ai', path: '/' }] }));
    const r = spawnSync('node', [DRIVER], {
      env: { PATH: process.env.PATH, E2E_STORAGE_STATE: state, E2E_BASE_URL: 'https://apps.jelou.ai', COOKIE_SECRET: 's' },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^SESSION_SYNC_SKIP/);
  });

  test('skips (exit 0) when no auth cookie is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-sync-'));
    const state = join(dir, 'state.json');
    writeFileSync(state, JSON.stringify({ cookies: [] }));
    const r = spawnSync('node', [DRIVER], {
      env: { PATH: process.env.PATH, E2E_STORAGE_STATE: state, E2E_BASE_URL: 'http://localhost:5173', COOKIE_SECRET: 's' },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^SESSION_SYNC_SKIP/);
  });

  test('never prints the cookie value or sessionId on the skip path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-sync-'));
    const state = join(dir, 'state.json');
    writeFileSync(state, JSON.stringify({ cookies: [{ name: 'jelou_auth', value: 'SUPERSECRETVALUE', domain: '.jelou.ai', path: '/' }] }));
    const r = spawnSync('node', [DRIVER], {
      env: { PATH: process.env.PATH, E2E_STORAGE_STATE: state, E2E_BASE_URL: 'https://apps.jelou.ai', COOKIE_SECRET: 's' },
      encoding: 'utf8',
    });
    assert.doesNotMatch(r.stdout + r.stderr, /SUPERSECRETVALUE/);
  });
});
