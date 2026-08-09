// tests/unit/goal-dependency-boot.test.mjs
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
// Run: `node --test tests/unit/goal-dependency-boot.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const wf = read('jelou/workflows/goal.md');
const env = read('jelou/references/env-lifecycle.md');
const schema = read('jelou/references/dev-block-schema.md');

describe('goal — boots UI runtime/auth dependencies (depends_on)', () => {
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

describe('goal — reuse-or-reboot rejects a stale frontend', () => {
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

describe('goal — the task-isolated boot is executed, not transcribed', () => {
  const step10 = wf.slice(wf.indexOf('### Phase 2 — Boot once'), wf.indexOf('10b.'));

  test('the task-isolated branch drives boot-stack.mjs through the plugin-root placeholder', () => {
    assert.match(step10, /\{plugin-root\}\/bin\/boot-stack\.mjs/);
    assert.match(step10, /--plan-file "\$TASK_DIR\/\.goal\/boot-plan\.json"/);
    assert.match(step10, /--only "<service>"/);
  });

  test('it no longer hand-writes the up/install/exec/restart sequence', () => {
    assert.doesNotMatch(step10, /`docker <descriptor\.up>`/);
    assert.doesNotMatch(step10, /`docker <descriptor\.exec>`/);
    assert.doesNotMatch(step10, /`docker <descriptor\.restart>`/);
    assert.match(step10, /Do NOT transcribe those steps here/);
  });

  test('it bans the verifier as a booter', () => {
    assert.match(step10, /Never boot with `verifySharedReuse`/);
  });

  test('teardown is registered from what the runner actually created', () => {
    assert.match(step10, /mutations\[\]\.resource\.projectName/);
    assert.match(step10, /BOOTED\+=\(<service>\)/);
  });

  test('the deps gate and the migrate gate are both failure causes, not warnings', () => {
    assert.match(step10, /deps_install_failed/);
    assert.match(step10, /migrate_failed/);
    assert.match(step10, /Dependency provisioning is a gate, not a WARN/);
  });

  test('a degraded readiness signal boots the service and names the stale registry signal', () => {
    assert.match(step10, /degraded/);
    assert.match(step10, /ready_signal is stale/);
  });

  test('the run identity and workspace id the runner needs are captured before Phase 2', () => {
    const setup = wf.slice(0, wf.indexOf('### Phase 2 — Boot once'));

    assert.match(setup, /computeWorkspaceId/);
    assert.match(setup, /\{goalRunId\}/);
    assert.match(setup, /Persist `\{planJson\}` to `\$TASK_DIR\/\.goal\/boot-plan\.json` now, unconditionally/);
  });
});
