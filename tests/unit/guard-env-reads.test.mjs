// tests/unit/guard-env-reads.test.mjs
//
// Run: `node --test tests/unit/guard-env-reads.test.mjs`
// Node 20+ required.
//
// Guards the env hygiene policy. Reading a real .env into the conversation
// has put 24 live secrets in context and triggered API-level Usage Policy
// rejections that killed the session (observed 2026-06-07, session 091e82e4:
// Read of jelou-apps/.env at 00:59Z, first AUP rejection at 01:03Z). Any edit
// that lets env-file contents reach the transcript must fail here.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { classifyRead, classifyBashCommand, findHazardousEnvLines } from '../../bin/guard-env-reads.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const expectReadDeny = (path) => {
  const verdict = classifyRead(path);
  assert.equal(verdict.decision, 'deny', `expected deny for Read: ${path}`);
  assert.match(verdict.reason, /jlu env guard/);
};

const expectReadAllow = (path) => {
  const verdict = classifyRead(path);
  assert.equal(verdict.decision, 'allow', `expected allow for Read: ${path} (got: ${verdict.reason})`);
};

const expectBashDeny = (command) => {
  const verdict = classifyBashCommand(command);
  assert.equal(verdict.decision, 'deny', `expected deny for: ${command}`);
  assert.match(verdict.reason, /jlu env guard/);
  return verdict.reason;
};

const expectBashAllow = (command) => {
  const verdict = classifyBashCommand(command);
  assert.equal(verdict.decision, 'allow', `expected allow for: ${command} (got: ${verdict.reason})`);
};

describe('guard — Read tool on env files', () => {
  test('blocks the exact Read that poisoned the session', () => {
    expectReadDeny('/home/user/jelou-projects/jelou-apps/.env');
  });

  test('blocks .env variants', () => {
    expectReadDeny('/repo/.env.e2e');
    expectReadDeny('/repo/.env.local');
    expectReadDeny('/repo/.env.production');
  });

  test('allows template env files', () => {
    expectReadAllow('/repo/.env.example');
    expectReadAllow('/repo/.env.sample');
    expectReadAllow('/repo/.env.template');
    expectReadAllow('/repo/.env.dist');
  });

  test('allows unrelated files', () => {
    expectReadAllow('/repo/src/env.ts');
    expectReadAllow('/repo/environment.md');
    expectReadAllow('/repo/.envrc.example.md');
  });
});

describe('guard — Bash printers over env files', () => {
  test('blocks cat/head/tail of env files', () => {
    expectBashDeny('cat .env');
    expectBashDeny('head -5 "$UI_WORKTREE/.env"');
    expectBashDeny('tail -n 20 .env.e2e');
  });

  test('blocks printers behind wrappers and pipes', () => {
    expectBashDeny('sudo cat /app/.env');
    expectBashDeny('cat .env | grep -i token');
  });

  test('blocks grep without a quiet flag (echoes values)', () => {
    expectBashDeny("grep -E '^E2E_BASE_URL=' .env.e2e");
    expectBashDeny('rg TOKEN .env');
  });

  test('allows quiet/name-only grep forms used by the workflow', () => {
    expectBashAllow("grep -qE '^[[:space:]]*E2E_BASE_URL=' .env.e2e");
    expectBashAllow('grep -c TOKEN .env');
    expectBashAllow('grep -l E2E_BASE_URL .env .env.e2e');
  });

  test('blocks sed without -i, allows in-place edits', () => {
    expectBashDeny("sed -n '1,10p' .env");
    expectBashAllow("sed -i 's/^E2E_BASE_URL=.*/E2E_BASE_URL=http:\\/\\/localhost:5173/' .env.e2e");
  });

  test('blocks awk over env files', () => {
    expectBashDeny("awk -F= '{print $2}' .env");
  });

  test('allows sourcing and existence checks (workflow contract)', () => {
    expectBashAllow('set -a; [ -f .env ] && . ./.env; [ -f .env.e2e ] && . ./.env.e2e; set +a');
    expectBashAllow('test -f .env.e2e && echo present');
  });

  test('allows writes and appends (values come from the model, not the file)', () => {
    expectBashAllow("printf '%s\\n' 'E2E_BASE_URL=http://localhost:5173' >> .env.e2e");
    expectBashAllow('cp .env.example .env.e2e');
  });

  test('allows template files everywhere', () => {
    expectBashAllow('cat .env.example');
  });

  test('deny reason teaches the corrected form', () => {
    const reason = expectBashDeny('cat .env');
    assert.match(reason, /grep -qE/);
    assert.match(reason, /sed -i/);
  });
});

describe('guard — sourcing malformed env files leaks value fragments', () => {
  // Observed 2026-06-07 (ui-qa-run): `source .env` over a file with 3 unquoted
  // `id|secret` values echoed the secret tails as "command not found" errors
  // straight into the transcript. Sourcing stays allowed (workflow contract)
  // only when the file would source cleanly.
  const dir = mkdtempSync(join(tmpdir(), 'jlu-env-guard-'));
  writeFileSync(join(dir, '.env'), 'CLEAN_URL=http://localhost:5173\nQUOTED="6|secret with pipe"\n');
  writeFileSync(
    join(dir, '.env.e2e'),
    'GOOD=1\nAPI_KEY=6|secretTail\nBRAIN_TOKEN=abc def\nnot a kv line\n',
  );

  test('allows sourcing a clean env file', () => {
    expectBashAllow(`set -a; . ${join(dir, '.env')}; set +a`);
  });

  test('denies sourcing a file with unquoted metachars, naming keys and lines only', () => {
    const reason = expectBashDeny(`source ${join(dir, '.env.e2e')}`);
    assert.match(reason, /line 2 \(API_KEY\)/);
    assert.match(reason, /line 3 \(BRAIN_TOKEN\)/);
    assert.match(reason, /line 4/);
    assert.doesNotMatch(reason, /secretTail/, 'deny reason must never include values');
  });

  test('denies dot-sourcing relative paths resolved against cwd', () => {
    const verdict = classifyBashCommand('[ -f .env.e2e ] && . ./.env.e2e', dir);
    assert.equal(verdict.decision, 'deny');
  });

  test('allows sourcing a missing env file (existence guards handle it)', () => {
    expectBashAllow(`. ${join(dir, '.env.production')}`);
  });

  test('findHazardousEnvLines accepts quoted values and comments', () => {
    assert.deepEqual(findHazardousEnvLines('# c\n\nA="x|y"\nB=plain\nexport C=ok\n'), []);
  });
});

describe('hooks.json — wiring', () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const pre = hooks.hooks.PreToolUse;

  test('env guard runs on Bash', () => {
    const bash = pre.find((h) => h.matcher === 'Bash');
    assert.ok(bash.hooks.some((h) => h.command.includes('guard-env-reads.mjs')));
  });

  test('env guard runs on Read', () => {
    const read = pre.find((h) => h.matcher === 'Read');
    assert.ok(read, 'hooks.json must register a Read matcher');
    assert.ok(read.hooks.some((h) => h.command.includes('guard-env-reads.mjs')));
  });
});
