// tests/unit/boot-engine-execute.test.mjs
//
// Run: `node --test tests/unit/boot-engine-execute.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { planEntryToCommands } from '../../bin/lib/boot-engine/execute.mjs';
import { maskWiredEnv } from '../../bin/lib/boot-engine/env-mask.mjs';

function taskEntry(over = {}) {
  return {
    id: 'jelou-api',
    policy: 'task-isolated',
    launcher: 'docker-exec',
    cwd: '/wt/jelou-api',
    command: 'yarn start:dev',
    projectName: 'jelou-api-t1',
    composeFile: 'docker-compose.yml',
    overrideYaml: 'services:\n  app:\n    image: jelou-api-app\n',
    image: 'jelou-api-app',
    imageResolved: true,
    wiredEnv: null,
    readiness: { type: 'stdout_match', pattern: 'started' },
    teardownCmd: 'docker compose -p jelou-api-t1 down',
    ports: [{ internal: 8080, host: 3100, portEnv: 'APP_PORT', primary: true }],
    ...over
  };
}

function sharedEntry(over = {}) {
  return {
    id: 'chatbot-server',
    policy: 'shared-reuse',
    launcher: 'docker-exec',
    cwd: '/repo/chatbot-server',
    command: 'yarn dev',
    readiness: { type: 'stdout_match', pattern: 'started' },
    teardownCmd: 'pkill -f nest',
    wiredEnv: null,
    ...over
  };
}

describe('planEntryToCommands task-isolated', () => {
  test('docker-exec with wiredEnv: files, up, exec, readiness, teardown', () => {
    const d = planEntryToCommands(taskEntry({ wiredEnv: 'CHATBOT_SERVER_URL=http://chatbot-server-t1:8080\n' }));
    assert.equal(d.policy, 'task-isolated');
    assert.equal(d.cwd, '/wt/jelou-api');
    assert.deepEqual(d.files, [
      { path: '/wt/jelou-api/docker-compose.jlu.yml', content: 'services:\n  app:\n    image: jelou-api-app\n' },
      { path: '/wt/jelou-api/.env', content: 'CHATBOT_SERVER_URL=http://chatbot-server-t1:8080\n' }
    ]);
    assert.deepEqual(d.up, ['compose', '-p', 'jelou-api-t1', '-f', 'docker-compose.yml', '-f', 'docker-compose.jlu.yml', 'up', '-d']);
    assert.deepEqual(d.exec, ['exec', '-d', 'jelou-api-t1', 'sh', '-lc', 'cd /app && yarn start:dev > /tmp/jelou-api-t1.dev.log 2>&1']);
    assert.deepEqual(d.teardown, ['compose', '-p', 'jelou-api-t1', 'down']);
    assert.equal(d.imageResolved, true);
  });

  test('no wiredEnv: files has only the override', () => {
    const d = planEntryToCommands(taskEntry());
    assert.deepEqual(d.files, [
      { path: '/wt/jelou-api/docker-compose.jlu.yml', content: 'services:\n  app:\n    image: jelou-api-app\n' }
    ]);
  });

  test('non-docker-exec launcher: exec is null', () => {
    const d = planEntryToCommands(taskEntry({ launcher: 'docker' }));
    assert.equal(d.exec, null);
  });

  test('http readiness carries the host port through; stdout_match carries logPath', () => {
    const http = planEntryToCommands(taskEntry({ readiness: { type: 'http_200', path: '/health', port: 3100 } }));
    assert.deepEqual(http.readiness, {
      type: 'http_200',
      path: '/health',
      port: 3100,
      logPath: '/tmp/jelou-api-t1.dev.log',
      logSource: { mode: 'exec-file', container: 'jelou-api-t1', path: '/tmp/jelou-api-t1.dev.log' }
    });
    const stdout = planEntryToCommands(taskEntry());
    assert.equal(stdout.readiness.logPath, '/tmp/jelou-api-t1.dev.log');
  });

  test('self-starting docker launcher reads readiness from container stdout, not a phantom log file', () => {
    const d = planEntryToCommands(taskEntry({ launcher: 'docker' }));
    assert.deepEqual(d.readiness.logSource, { mode: 'docker-logs', container: 'jelou-api-t1' });
    assert.equal(d.readiness.logPath, undefined);
  });

  test('self-starting docker launcher restarts the project after a deps install', () => {
    const install = { runs_in: 'container', cwd: '/app', cmd: 'pnpm install', timeoutMs: 900000, logPath: '/tmp/i.log' };
    const withInstall = planEntryToCommands(taskEntry({ launcher: 'docker', depsProvision: { install } }));
    assert.deepEqual(withInstall.restart, ['compose', '-p', 'jelou-api-t1', 'restart']);
    assert.equal(planEntryToCommands(taskEntry({ launcher: 'docker' })).restart, null);
    assert.equal(planEntryToCommands(taskEntry({ depsProvision: { install } })).restart, null);
  });

  test('unverified image-sourced deps are surfaced on the descriptor', () => {
    const d = planEntryToCommands(taskEntry({ launcher: 'docker', depsProvision: { source: 'image', unverified: true, install: null } }));
    assert.equal(d.depsUnverified, true);
    assert.equal(planEntryToCommands(taskEntry()).depsUnverified, false);
  });

  test('imageResolved false is propagated', () => {
    const d = planEntryToCommands(taskEntry({ imageResolved: false }));
    assert.equal(d.imageResolved, false);
  });

  test('a Docker consumer receives its generated overlay at process launch without a source env write', () => {
    const path = '/runtime/overlays/task-aware/jelou-api.env';
    const d = planEntryToCommands(taskEntry({
      environmentOverlay: { path, digest: 'stable-digest', restartRequired: false },
    }));

    assert.deepEqual(d.files, [
      { path: '/wt/jelou-api/docker-compose.jlu.yml', content: 'services:\n  app:\n    image: jelou-api-app\n' },
    ]);
    assert.deepEqual(d.environmentFiles, [path]);
    assert.deepEqual(d.exec, ['exec', '--env-file', path, '-d', 'jelou-api-t1', 'sh', '-lc', 'cd /app && yarn start:dev > /tmp/jelou-api-t1.dev.log 2>&1']);
  });

  test('carries the current run marker and observable execution stages', () => {
    const runIdentity = { workspaceId: 'workspace-1', taskSlug: 'task-a', runId: 'run-17' };

    const descriptor = planEntryToCommands(taskEntry(), { runIdentity });

    assert.deepEqual(descriptor.ownershipMarker, runIdentity);
    assert.deepEqual(descriptor.lifecycleStages, ['boot', 'cleanup']);
  });
});

describe('planEntryToCommands dependency install', () => {
  test('no depsProvision means no install step', () => {
    assert.equal(planEntryToCommands(taskEntry()).install, null);
    assert.equal(planEntryToCommands(taskEntry({ depsProvision: { source: 'canonical', install: null } })).install, null);
  });

  test('a container install becomes a blocking docker exec into the idle container', () => {
    const install = { runs_in: 'container', cwd: '/app', cmd: 'cd /app || exit 1; npm ci', timeoutMs: 900000, logPath: '/tmp/jlu-install-jelou-api-t1.log' };
    const d = planEntryToCommands(taskEntry({ depsProvision: { source: 'named-volume', install } }));
    assert.deepEqual(d.install.exec, ['exec', 'jelou-api-t1', 'sh', '-lc', 'cd /app || exit 1; npm ci']);
    assert.equal(d.install.timeoutMs, 900000);
    assert.ok(!d.install.exec.includes('-d'));
  });

  test('the descriptor passes the guarded script through untouched, adding no redirect of its own', () => {
    const cmd = 'cd /app || exit 1; if [ "$(cat node_modules/.jlu-lock-hash 2>/dev/null)" = "h" ]; then exit 0; fi; { npm ci && printf %s h > node_modules/.jlu-lock-hash; } > /tmp/i.log 2>&1';
    const install = { runs_in: 'container', cwd: '/app', cmd, timeoutMs: 900000, logPath: '/tmp/i.log' };
    const script = planEntryToCommands(taskEntry({ depsProvision: { source: 'named-volume', install } })).install.exec[4];
    assert.equal(script, cmd);
    assert.doesNotMatch(script, /\.jlu-lock-hash > \/tmp/);
  });

  test('the install runs before the dev command is exec\'d', () => {
    const install = { runs_in: 'container', cwd: '/app', cmd: 'npm ci', timeoutMs: 900000, logPath: '/tmp/i.log' };
    const d = planEntryToCommands(taskEntry({ depsProvision: { source: 'named-volume', install } }));
    const keys = Object.keys(d);
    assert.ok(keys.indexOf('up') < keys.indexOf('install'));
    assert.ok(keys.indexOf('install') < keys.indexOf('exec'));
  });

  test('a host install carries no docker exec', () => {
    const install = { runs_in: 'host', cwd: '/wt/jelou-api', cmd: 'npm ci', timeoutMs: 900000, logPath: '/tmp/i.log' };
    const d = planEntryToCommands(taskEntry({ depsProvision: { source: 'worktree', install } }));
    assert.equal(d.install.exec, null);
    assert.equal(d.install.cwd, '/wt/jelou-api');
  });
});

describe('planEntryToCommands shared-reuse', () => {
  test('with wiredEnv: files has the single .env, teardown string, no up/exec', () => {
    const d = planEntryToCommands(sharedEntry({ wiredEnv: 'JELOU_API_URL=http://jelou-api-t1:8080\n' }));
    assert.equal(d.policy, 'shared-reuse');
    assert.equal(d.launcher, 'docker-exec');
    assert.equal(d.command, 'yarn dev');
    assert.deepEqual(d.files, [{ path: '/repo/chatbot-server/.env', content: 'JELOU_API_URL=http://jelou-api-t1:8080\n' }]);
    assert.equal(d.teardown, 'pkill -f nest');
    assert.equal(d.up, undefined);
    assert.equal(d.exec, undefined);
  });

  test('no wiredEnv: files empty; teardown null when dev-block has none', () => {
    const d = planEntryToCommands(sharedEntry({ teardownCmd: null }));
    assert.deepEqual(d.files, []);
    assert.equal(d.teardown, null);
  });

  test('a changed task overlay requires restart before readiness under its new digest', () => {
    const d = planEntryToCommands(sharedEntry({
      launcher: 'shell',
      environmentOverlay: {
        path: '/runtime/overlays/main/chatbot-server.env',
        digest: 'new-digest',
        restartRequired: true,
      },
    }));

    assert.deepEqual(d.files, []);
    assert.deepEqual(d.environmentFiles, ['/runtime/overlays/main/chatbot-server.env']);
    assert.equal(d.restartRequired, true);
    assert.deepEqual(d.readiness, {
      type: 'stdout_match',
      pattern: 'started',
      overlayDigest: 'new-digest',
      priorReadinessValid: false,
      requiresRestartBeforeReady: true,
    });
  });
});

describe('planEntryToCommands env masking', () => {
  test('planEntryToCommands writes a de-obfuscated .env for a masked wiredEnv (task-isolated)', () => {
    const wired = 'B_URL=http://b-s:8080\nSECRET=x\n';
    const entry = {
      id: 'a', policy: 'task-isolated', cwd: '/repo/a/.worktrees/s', launcher: 'docker-exec',
      command: 'npm run start:dev', readiness: { type: 'stdout_match', pattern: 'ok' },
      projectName: 'a-s', composeFile: 'docker-compose.yml', overrideYaml: 'x: 1\n',
      imageResolved: true, wiredEnv: maskWiredEnv(wired)
    };
    const d = planEntryToCommands(entry);
    const envFile = d.files.find((f) => f.path.endsWith('/.env'));
    assert.equal(envFile.content, wired);
    assert.ok(!envFile.content.startsWith('JLUENV1:'));
  });

  test('planEntryToCommands de-obfuscates for shared-reuse too', () => {
    const wired = 'B_URL=http://b-s:8080\n';
    const d = planEntryToCommands({ id: 'c', policy: 'shared-reuse', cwd: '/repo/c', launcher: 'docker-exec', command: 'x', readiness: {}, teardownCmd: null, wiredEnv: maskWiredEnv(wired) });
    assert.equal(d.files.find((f) => f.path.endsWith('/.env')).content, wired);
  });
});

describe('planEntryToCommands errors', () => {
  test('unknown policy throws naming the id', () => {
    assert.throws(() => planEntryToCommands({ id: 'x', policy: 'weird' }), /planEntryToCommands.*weird.*x|x.*weird/);
  });
});
