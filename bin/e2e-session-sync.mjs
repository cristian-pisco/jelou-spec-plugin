#!/usr/bin/env node
// bin/e2e-session-sync.mjs — provision a local cookie-guard session after login.
//
// Replicates jelou-apps/tools/dev-session-sync (extension + agent) for headless E2E:
// decrypts the real jelou_auth cookie captured in storageState, upserts the session into
// local Mongo (logsM.userSessions), and copies the cookie onto the localhost host so the
// suite's browser reaches the local gateway without 401. Auto-detects: a no-op unless the
// target is loopback, COOKIE_SECRET is set, and an auth cookie is present.
//
// SANCTIONED WRITE: runs only after a successful login; sessionId/userId/companyId come
// solely from decrypting the real cookie; fails closed (never fabricates). See
// jelou/workflows/ui-qa-run.md step 14c and the prohibition carve-out at :237.
//
// Env: E2E_STORAGE_STATE, E2E_BASE_URL, COOKIE_SECRET; optional UI_WORKTREE,
//   SESSION_SYNC_MONGO_URI (default mongodb://127.0.0.1:27017), SESSION_SYNC_DB (logsM),
//   SESSION_TTL_HOURS (12), SESSION_COOKIE_NAME (jelou_auth), JLU_MONGODB_MODULE,
//   SESSION_SYNC_ALLOW_REMOTE_MONGO (default off — refuse a non-loopback write target unless set).
// Exit: 0 ok/skip · 45 decrypt/secret mismatch · 46 Mongo unreachable · 2 misconfig
//   (includes a non-loopback SESSION_SYNC_MONGO_URI without SESSION_SYNC_ALLOW_REMOTE_MONGO).
// Secrets (COOKIE_SECRET, cookie value, sessionId) are never printed.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { EXIT } from './lib/e2e-auth.mjs';
import {
  decryptSessionCookie,
  buildSessionUpdate,
  extractAuthCookie,
  buildLocalCookie,
  shouldProvision,
  isLoopbackMongoUri,
  DEFAULT_COOKIE_NAME,
} from './lib/session-sync.mjs';
import { applyEnvFiles } from './lib/env-files.mjs';

function resolveStoragePath(env) {
  const p = env.E2E_STORAGE_STATE;
  if (!p) return null;
  return isAbsolute(p) ? p : resolve(env.UI_WORKTREE || process.cwd(), p);
}

// The mongodb driver is not a plugin dependency. Resolve it from the consumer at runtime:
// an explicit override first, then the dev-session-sync agent's node_modules (the one
// install that is known to exist), then the worktree root.
function redactMongoUri(uri) {
  try {
    const u = new URL(uri);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return uri;
  }
}

function loadMongodb(env) {
  const attempts = [];
  if (env.JLU_MONGODB_MODULE) attempts.push(() => createRequire(import.meta.url)(env.JLU_MONGODB_MODULE));
  if (env.UI_WORKTREE) {
    attempts.push(() => createRequire(join(env.UI_WORKTREE, 'tools', 'dev-session-sync', 'agent', 'package.json'))('mongodb'));
    attempts.push(() => createRequire(join(env.UI_WORKTREE, 'package.json'))('mongodb'));
  }
  for (const attempt of attempts) {
    try {
      const mod = attempt();
      if (mod?.MongoClient) return mod;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

async function main() {
  const env = process.env;
  if (env.UI_WORKTREE) applyEnvFiles(env, env.UI_WORKTREE);
  const storagePath = resolveStoragePath(env);
  if (!storagePath || !env.E2E_BASE_URL) {
    console.error('session-sync: E2E_STORAGE_STATE and E2E_BASE_URL are required');
    process.exit(2);
  }

  let storageState;
  try {
    storageState = JSON.parse(readFileSync(storagePath, 'utf8'));
  } catch (e) {
    console.error(`session-sync: cannot read storageState at ${storagePath}: ${e.message}`);
    process.exit(2);
  }

  const cookieName = env.SESSION_COOKIE_NAME || DEFAULT_COOKIE_NAME;
  const gate = shouldProvision({ baseUrl: env.E2E_BASE_URL, secret: env.COOKIE_SECRET, storageState, cookieName });
  if (!gate.ok) {
    console.log(`SESSION_SYNC_SKIP ${gate.reason}`);
    process.exit(EXIT.OK);
  }

  // Guard the WRITE TARGET independently of E2E_BASE_URL, before any work: a loopback base
  // with a prod SESSION_SYNC_MONGO_URI would otherwise forge a session row in prod. Refuse a
  // non-loopback Mongo unless explicitly opted in (e.g. a containerized local Mongo).
  const uri = env.SESSION_SYNC_MONGO_URI || 'mongodb://127.0.0.1:27017';
  const allowRemoteMongo = /^(1|true|yes)$/i.test(env.SESSION_SYNC_ALLOW_REMOTE_MONGO || '');
  if (!allowRemoteMongo && !isLoopbackMongoUri(uri)) {
    console.error(
      `session-sync: refusing to write a session to non-loopback Mongo ${redactMongoUri(uri)} — `
        + 'a sanctioned session write must target the local stack, not prod/staging. Set '
        + 'SESSION_SYNC_ALLOW_REMOTE_MONGO=1 to override (e.g. a containerized local Mongo).',
    );
    process.exit(2);
  }

  const cookieValue = extractAuthCookie(storageState, cookieName);
  let fields;
  try {
    fields = decryptSessionCookie(cookieValue, env.COOKIE_SECRET);
  } catch (e) {
    console.error(`session-sync: ${e.message}`);
    process.exit(EXIT.SECRET_MISMATCH);
  }

  const mongodb = loadMongodb(env);
  if (!mongodb) {
    console.error(
      'session-sync: could not resolve the mongodb driver. Run `npm install` in '
        + 'tools/dev-session-sync/agent, or set JLU_MONGODB_MODULE to an installed mongodb package path.',
    );
    process.exit(2);
  }

  const dbName = env.SESSION_SYNC_DB || 'logsM';
  const ttlHours = Math.max(1, Number(env.SESSION_TTL_HOURS) || 12);
  const client = new mongodb.MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const { filter, update, options } = buildSessionUpdate(fields, ttlHours);
    await client.db(dbName).collection('userSessions').updateOne(filter, update, options);
  } catch (e) {
    await client.close().catch(() => {});
    console.error(`session-sync: local Mongo write failed at ${redactMongoUri(uri)}: ${e.message}`);
    process.exit(EXIT.MONGO_UNREACHABLE);
  }
  await client.close().catch(() => {});

  const local = buildLocalCookie(cookieName, cookieValue, env.E2E_BASE_URL, ttlHours, Date.now());
  const others = (storageState.cookies || []).filter(
    (c) => !(c.name === local.name && c.domain === local.domain && c.path === local.path),
  );
  storageState.cookies = [...others, local];
  writeFileSync(storagePath, JSON.stringify(storageState, null, 2));

  console.log('SESSION_SYNC_OK provisioned 1 session; localhost cookie added');
  process.exit(EXIT.OK);
}

main().catch((e) => {
  console.error(`session-sync: ${e.message}`);
  process.exit(2);
});
