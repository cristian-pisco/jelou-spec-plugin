import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authCookiePath,
  readAuthCookie,
  writeAuthCookie,
} from '../../bin/lib/dev-orchestrator/stack/auth-cookie-state.mjs';

describe('task authentication cookie state', () => {
  test('atomically persists and replaces the task cookie with mode 0600', (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-cookie-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const opts = { workspaceId: 'workspace-a', slug: 'task-a', baseDir };
    const first = {
      name: 'jelou_auth',
      value: 'first-session',
      domain: 'localhost',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    };
    const second = { ...first, value: 'second-session' };

    assert.equal(readAuthCookie(opts), null);
    assert.equal(writeAuthCookie(opts, first), authCookiePath(opts));
    assert.deepEqual(readAuthCookie(opts), first);
    writeAuthCookie(opts, second);

    const path = authCookiePath(opts);
    assert.deepEqual(readAuthCookie(opts), second);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(join(baseDir, 'workspaces', 'workspace-a', 'task-a')), ['auth-cookie.json']);
  });

  test('refuses to persist an unexpected cookie name or an empty cookie value', (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-cookie-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const opts = { workspaceId: 'workspace-a', slug: 'task-a', baseDir };

    assert.throws(() => writeAuthCookie(opts, { name: 'session', value: 'unexpected' }), /genuine jelou_auth/);
    assert.throws(() => writeAuthCookie(opts, { name: 'jelou_auth', value: '' }), /genuine jelou_auth/);
    assert.equal(existsSync(authCookiePath(opts)), false);
  });

  test('does not reuse malformed or unexpected stored cookie state', (t) => {
    const baseDir = mkdtempSync(join(tmpdir(), 'jlu-auth-cookie-'));
    t.after(() => rmSync(baseDir, { recursive: true, force: true }));
    const opts = { workspaceId: 'workspace-a', slug: 'task-a', baseDir };
    mkdirSync(join(baseDir, 'workspaces', 'workspace-a', 'task-a'), { recursive: true });
    writeFileSync(authCookiePath(opts), JSON.stringify({ name: 'session', value: 'stale-session' }));

    assert.equal(readAuthCookie(opts), null);
  });
});
