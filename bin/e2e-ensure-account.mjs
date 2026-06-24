#!/usr/bin/env node
// bin/e2e-ensure-account.mjs — idempotent guard (B) keeping the local E2E
// account deterministically loginable: verified email, and no per-user 2FA row
// that would re-arm the OTP gate (company-level 2FA stays disabled separately).
// The SQL runs inside the local `mysql` container using its own root
// credentials, which never leave the container.
//
// Env: TEST_EMAIL (or E2E_USER_EMAIL), UI_WORKTREE; optional MYSQL_CONTAINER
//      (default mysql).
// Exit (shared EXIT): 0 ensured · 2 misconfig · 49 db error.

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { EXIT } from './lib/e2e-auth.mjs';
import { applyEnvFiles } from './lib/env-files.mjs';
import { buildEnsureAccountSql } from './lib/api-login.mjs';

function fail(msg, code) {
  console.error(`ensure-account: ${msg}`);
  process.exit(code);
}

function main() {
  const env = process.env;
  if (env.UI_WORKTREE) applyEnvFiles(env, env.UI_WORKTREE);

  const email = env.TEST_EMAIL || env.E2E_USER_EMAIL;
  if (!email) fail('missing TEST_EMAIL', 2);

  const container = env.MYSQL_CONTAINER || 'mysql';
  // A default DB must be selected: the multi-table `DELETE t FROM …` form needs
  // one even though every table is schema-qualified.
  const r = spawnSync(
    'docker',
    ['exec', '-i', container, 'sh', '-lc', 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" chatbot'],
    { input: buildEnsureAccountSql(email), encoding: 'utf8' },
  );
  if (r.status !== 0) {
    return fail(`mysql failed: ${(r.stderr || '').trim() || r.error?.message || 'unknown'}`, EXIT.DB_ERROR);
  }
  console.log('ENSURED');
  process.exit(EXIT.OK);
}

main();
