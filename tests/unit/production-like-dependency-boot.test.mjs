// tests/unit/production-like-dependency-boot.test.mjs
//
// Guards two production-like boot defects surfaced by the datum-legacy fullstack run:
//  1. Runtime/auth dependencies of a UI service (its login backend + session-validation
//     API) were never booted — they are not "affected" services, so the live flow 401s
//     even though the service-under-test is healthy. Fixed via a declarative `depends_on`
//     folded into the boot order.
//  2. The reuse-or-reboot decision was health-only, so a healthy-but-stale frontend (Vite
//     bakes env at dev-server start) got reused against the wrong backend. Fixed by an
//     env_file-staleness check in the reuse decision.
//
// Run: `node --test tests/unit/production-like-dependency-boot.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const wf = read('jelou/workflows/production-like.md');
const env = read('jelou/references/env-lifecycle.md');
const schema = read('jelou/references/dev-block-schema.md');

describe('production-like — boots UI runtime/auth dependencies (depends_on)', () => {
  test('the workflow folds depends_on into the boot order', () => {
    assert.match(wf, /depends_on/);
    assert.match(wf, /boot order/i);
  });

  test('depends_on is described as runtime/auth dependencies (login + session validation)', () => {
    assert.match(wf, /depends_on[\s\S]{0,400}(login|session|auth|runtime)/i);
  });

  test('depends_on services are resolved transitively and must have a dev block', () => {
    assert.match(wf, /depends_on[\s\S]{0,400}(transitiv)/i);
    assert.match(wf, /depends_on[\s\S]{0,500}dev.? block|step 8b/i);
  });

  test('env-lifecycle documents depends_on expansion', () => {
    assert.match(env, /depends_on/);
  });

  test('dev-block schema documents the depends_on field', () => {
    assert.match(schema, /depends_on/);
  });
});

describe('production-like — reuse-or-reboot rejects a stale frontend', () => {
  test('reuse decision checks env_file freshness, not only health', () => {
    assert.match(wf, /env[_-]?files?/i);
    assert.match(wf, /stale/i);
  });

  test('a service is rebooted when an env_file is newer than the running process', () => {
    assert.match(wf, /newer than|mtime|changed since/i);
    assert.match(wf, /re-?boot/i);
  });

  test('explains why: env baked at dev-server start (Vite base URL)', () => {
    assert.match(wf, /baked|bakes/i);
  });

  test('env-lifecycle documents the env_file-staleness reuse rule', () => {
    assert.match(env, /env[_-]?files?/i);
    assert.match(env, /stale|newer than|mtime/i);
  });
});
