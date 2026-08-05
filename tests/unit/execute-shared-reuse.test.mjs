import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_READY_TIMEOUT_S, errorHints, verifySharedReuse } from '../../bin/lib/boot-engine/execute-shared-reuse.mjs';

function ok(stdout = '') {
  return { code: 0, stdout, stderr: '' };
}

function makeRunner(routes) {
  const calls = [];
  const counters = new Map();
  const runner = async (cmd, args, opts = {}) => {
    const key = [cmd, ...args].join(' ');
    calls.push({ cmd, args, opts, key });
    for (const route of routes) {
      if (key.includes(route.when)) {
        const n = (counters.get(route.when) || 0) + 1;
        counters.set(route.when, n);
        const results = Array.isArray(route.results) ? route.results : [route.results];
        return results[Math.min(n - 1, results.length - 1)];
      }
    }
    return ok();
  };
  return { calls, runner };
}

const instantSleep = async () => {};

function baseDeps(runner, extra = {}) {
  return { runner, sleep: instantSleep, pollIntervalMs: 500, ...extra };
}

function dockerExecEntry(overrides = {}) {
  return {
    cwd: '/repo/alpha-service',
    launcher: 'docker-exec',
    command: 'npm run start:dev',
    composeFile: 'docker-compose.yml',
    dockerService: 'app',
    envFiles: [],
    readiness: { type: 'stdout_match', pattern: 'Nest application successfully started' },
    readyTimeoutS: 1,
    teardownCmd: "docker compose -f docker-compose.yml exec -T app pkill -f 'nest start' || true",
    ...overrides,
  };
}

function npmEntry(overrides = {}) {
  return {
    cwd: '/repo/beta-ui',
    launcher: 'npm',
    command: 'yarn dev',
    composeFile: null,
    dockerService: null,
    envFiles: ['.env', '.env.e2e'],
    readiness: { type: 'port_open', port: 5173 },
    readyTimeoutS: 1,
    teardownCmd: "pkill -f 'vite' || true",
    ...overrides,
  };
}

function dockerEntry(overrides = {}) {
  return dockerExecEntry({ launcher: 'docker', command: null, teardownCmd: null, ...overrides });
}

function assertNeverComposeDown(calls) {
  assert.equal(calls.some((c) => c.cmd === 'docker' && c.args.includes('down')), false);
}

function findExecLaunch(calls) {
  return calls.find((c) => c.key.includes('/tmp/app.verify.') && c.key.includes('2>&1 &'));
}

function extractExecLogPath(calls) {
  const launch = findExecLaunch(calls);
  return launch.args[launch.args.length - 1].match(/> (\/tmp\/app\.verify\.\S+\.log) 2>&1/)[1];
}

describe('constants', () => {
  test('DEFAULT_READY_TIMEOUT_S is exported as 30', () => {
    assert.equal(DEFAULT_READY_TIMEOUT_S, 30);
  });
});

describe('verifySharedReuse — docker-exec', () => {
  test('green boot: up, detached exec with unique /tmp log, stdout_match polling, restore-to-found teardown', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: 'up -d', results: ok() },
      { when: 'cat /tmp/app.verify.', results: [ok(''), ok('Nest application successfully started\n')] },
    ]);
    const result = await verifySharedReuse(dockerExecEntry(), baseDeps(runner));
    assert.equal(result.status, 'green');
    assert.equal(result.command_executed, true);
    assert.deepEqual(result.started.containers, ['app']);
    assert.equal(result.teardown_clean, true);
    const launch = findExecLaunch(calls);
    assert.ok(launch);
    assert.deepEqual(launch.args.slice(0, 7), ['compose', '-f', 'docker-compose.yml', 'exec', '-T', 'app', 'sh']);
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1].includes('pkill')));
    assert.ok(calls.some((c) => c.key === 'docker compose -f docker-compose.yml stop app'));
    assertNeverComposeDown(calls);
  });

  test('probe-and-leave: running container with live process returns green-preexisting and touches nothing', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: ok('app\n') },
      { when: 'pgrep -f', results: ok() },
    ]);
    const result = await verifySharedReuse(dockerExecEntry(), baseDeps(runner));
    assert.equal(result.status, 'green-preexisting');
    assert.equal(result.command_executed, false);
    assert.deepEqual(result.started, { containers: [], processes: [] });
    assert.equal(result.teardown_clean, true);
    assert.equal(calls.some((c) => c.key.includes('up -d')), false);
    assert.equal(calls.some((c) => c.key.includes('stop')), false);
    assert.equal(calls.some((c) => c.key.includes('pkill')), false);
    assert.equal(calls.some((c) => c.key.includes('kill')), false);
    assertNeverComposeDown(calls);
  });

  test('in-container pgrep probe escapes ERE metacharacters in the command', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: ok('app\n') },
      { when: 'pgrep', results: ok() },
    ]);
    const entry = dockerExecEntry({ command: 'nest start --watch (dev) c++ [x]' });
    const result = await verifySharedReuse(entry, baseDeps(runner));
    assert.equal(result.status, 'green-preexisting');
    const pgrep = calls.find((c) => c.args.includes('pgrep'));
    assert.equal(pgrep.args[pgrep.args.length - 1], 'nest start --watch \\(dev\\) c\\+\\+ \\[x\\]');
  });

  test('readiness timeout: failed(ready_timeout) AND teardown still ran', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: 'cat /tmp/app.verify.', results: ok('still compiling') },
    ]);
    const result = await verifySharedReuse(dockerExecEntry(), baseDeps(runner));
    assert.equal(result.status, 'failed');
    assert.equal(result.cause, 'ready_timeout');
    assert.equal(result.command_executed, true);
    assert.ok(calls.some((c) => c.key === 'docker compose -f docker-compose.yml stop app'));
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1].includes('pkill')));
    assertNeverComposeDown(calls);
  });

  test('restore-to-found stops only the containers THIS run started, never preexisting peers', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok('mongo\n'), ok('mongo\n'), ok('mongo\napp\n')] },
      { when: 'cat /tmp/app.verify.', results: ok('Nest application successfully started') },
    ]);
    const result = await verifySharedReuse(dockerExecEntry(), baseDeps(runner));
    assert.equal(result.status, 'green');
    assert.deepEqual(result.started.containers, ['app']);
    const stop = calls.find((c) => c.cmd === 'docker' && c.args.includes('stop'));
    assert.deepEqual(stop.args, ['compose', '-f', 'docker-compose.yml', 'stop', 'app']);
    assert.equal(calls.some((c) => c.args.includes('stop') && c.args.includes('mongo')), false);
    assertNeverComposeDown(calls);
  });

  test('exec failure returns failed(exec_failed) but still stops the container this run started', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: '2>&1 &', results: { code: 1, stdout: '', stderr: 'sh missing' } },
    ]);
    const result = await verifySharedReuse(dockerExecEntry(), baseDeps(runner));
    assert.equal(result.status, 'failed');
    assert.match(result.cause, /exec_failed: sh missing/);
    assert.equal(result.command_executed, false);
    assert.deepEqual(result.started.containers, ['app']);
    assert.ok(calls.some((c) => c.key === 'docker compose -f docker-compose.yml stop app'));
    assertNeverComposeDown(calls);
  });

  test('failed container stop reports teardown_clean=false without masking the green status', async () => {
    const { runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: 'cat /tmp/app.verify.', results: ok('Nest application successfully started') },
      { when: 'stop app', results: { code: 1, stdout: '', stderr: 'stuck' } },
    ]);
    const result = await verifySharedReuse(dockerExecEntry(), baseDeps(runner));
    assert.equal(result.status, 'green');
    assert.equal(result.teardown_clean, false);
  });

  test('failed teardown command reports teardown_clean=false', async () => {
    const { runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: 'cat /tmp/app.verify.', results: ok('Nest application successfully started') },
      { when: 'pkill', results: { code: 1, stdout: '', stderr: '' } },
    ]);
    const result = await verifySharedReuse(dockerExecEntry(), baseDeps(runner));
    assert.equal(result.status, 'green');
    assert.equal(result.teardown_clean, false);
  });

  test('missing teardownCmd into a preexisting container reports teardown_clean=false without any pkill', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: ok('app\n') },
      { when: 'pgrep', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'cat /tmp/app.verify.', results: ok('Nest application successfully started') },
    ]);
    const result = await verifySharedReuse(dockerExecEntry({ teardownCmd: null }), baseDeps(runner));
    assert.equal(result.status, 'green');
    assert.equal(result.teardown_clean, false);
    assert.deepEqual(result.started.containers, []);
    assert.equal(calls.some((c) => c.key.includes('pkill')), false);
    assert.equal(calls.some((c) => c.args.includes('stop')), false);
  });

  test('missing teardownCmd is clean when this run started the container that will be stopped', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: 'cat /tmp/app.verify.', results: ok('Nest application successfully started') },
    ]);
    const result = await verifySharedReuse(dockerExecEntry({ teardownCmd: null }), baseDeps(runner));
    assert.equal(result.status, 'green');
    assert.equal(result.teardown_clean, true);
    assert.ok(calls.some((c) => c.key === 'docker compose -f docker-compose.yml stop app'));
    assert.equal(calls.some((c) => c.key.includes('pkill')), false);
  });

  test('two invocations for the same service redirect to different in-container log paths', async () => {
    async function runOnce() {
      const { calls, runner } = makeRunner([
        { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
        { when: 'cat /tmp/app.verify.', results: ok('Nest application successfully started') },
      ]);
      const result = await verifySharedReuse(dockerExecEntry(), baseDeps(runner));
      assert.equal(result.status, 'green');
      return extractExecLogPath(calls);
    }
    const first = await runOnce();
    const second = await runOnce();
    assert.notEqual(first, second);
  });

  test('up failure returns failed(up_failed) without executing the command', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: ok('') },
      { when: 'up -d', results: { code: 1, stdout: '', stderr: 'boom' } },
    ]);
    const result = await verifySharedReuse(dockerExecEntry(), baseDeps(runner));
    assert.equal(result.status, 'failed');
    assert.match(result.cause, /up_failed: boom/);
    assert.equal(result.command_executed, false);
    assert.equal(result.teardown_clean, true);
    assert.equal(calls.some((c) => c.key.includes('stop')), false);
    assertNeverComposeDown(calls);
  });

  test('read-only invariant: no file lands in entry.cwd and every redirect targets /tmp', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'verify-cwd-'));
    const before = readdirSync(cwd);
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: 'cat /tmp/app.verify.', results: ok('Nest application successfully started') },
    ]);
    const result = await verifySharedReuse(dockerExecEntry({ cwd }), baseDeps(runner));
    assert.equal(result.status, 'green');
    assert.deepEqual(readdirSync(cwd), before);
    for (const call of calls) {
      assert.equal(call.key.includes(`> ${cwd}`), false);
      if (call.key.includes('.verify.')) assert.match(call.key, /\/tmp\/app\.verify\.\d+\.\d+\.\d+\.log/);
    }
  });

  test('invalid stdout_match pattern fails fast with bad_ready_pattern and teardown still runs', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
    ]);
    const entry = dockerExecEntry({ readiness: { type: 'stdout_match', pattern: 'started (' } });
    const result = await verifySharedReuse(entry, baseDeps(runner));
    assert.equal(result.status, 'failed');
    assert.equal(result.cause, 'bad_ready_pattern');
    assert.equal(calls.some((c) => c.key.includes('cat ')), false);
    assert.ok(calls.some((c) => c.key === 'docker compose -f docker-compose.yml stop app'));
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1].includes('pkill')));
  });
});

describe('verifySharedReuse — docker', () => {
  test('probe-and-leave: running compose service is green-preexisting without any mutation', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: ok('app\n') },
    ]);
    const result = await verifySharedReuse(dockerEntry(), baseDeps(runner));
    assert.equal(result.status, 'green-preexisting');
    assert.equal(result.command_executed, false);
    assert.equal(calls.length, 1);
  });

  test('green boot reads readiness from compose logs, never an exec log', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: 'logs --no-color', results: [ok(''), ok('Nest application successfully started')] },
    ]);
    const result = await verifySharedReuse(dockerEntry(), baseDeps(runner));
    assert.equal(result.status, 'green');
    assert.equal(result.command_executed, true);
    assert.ok(calls.some((c) => c.key === 'docker compose -f docker-compose.yml logs --no-color app'));
    assert.equal(calls.some((c) => c.args.includes('exec')), false);
    assert.ok(calls.some((c) => c.key === 'docker compose -f docker-compose.yml stop app'));
    assertNeverComposeDown(calls);
  });

  test('logs are snapshotted before up -d so a pre-boot ready line never turns green', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: 'logs --no-color', results: ok('Nest application successfully started\n') },
    ]);
    const result = await verifySharedReuse(dockerEntry(), baseDeps(runner));
    assert.equal(result.status, 'failed');
    assert.equal(result.cause, 'ready_timeout');
    const upIndex = calls.findIndex((c) => c.key.includes('up -d'));
    const firstLogsIndex = calls.findIndex((c) => c.key.includes('logs --no-color'));
    assert.ok(firstLogsIndex < upIndex);
    assert.ok(calls.some((c) => c.key === 'docker compose -f docker-compose.yml stop app'));
  });

  test('new log lines appended after boot match against the delta and turn green', async () => {
    const { runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: 'logs --no-color', results: [ok('old boot noise\n'), ok('old boot noise\nNest application successfully started\n')] },
    ]);
    const result = await verifySharedReuse(dockerEntry(), baseDeps(runner));
    assert.equal(result.status, 'green');
  });

  test('logs shorter than the pre-boot snapshot are treated entirely as new', async () => {
    const { runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok(''), ok('app\n')] },
      { when: 'logs --no-color', results: [ok('long rotated buffer without the signal anywhere in it\n'), ok('Nest application successfully started\n')] },
    ]);
    const result = await verifySharedReuse(dockerEntry(), baseDeps(runner));
    assert.equal(result.status, 'green');
  });

  test('up -d that started nothing new yields command_executed=false and stops nothing', async () => {
    const { calls, runner } = makeRunner([
      { when: 'ps --services --status running', results: [ok(''), ok('app\n'), ok('app\n')] },
      { when: 'logs --no-color', results: [ok(''), ok('Nest application successfully started')] },
    ]);
    const result = await verifySharedReuse(dockerEntry(), baseDeps(runner));
    assert.equal(result.status, 'green');
    assert.equal(result.command_executed, false);
    assert.deepEqual(result.started.containers, []);
    assert.equal(calls.some((c) => c.args.includes('stop')), false);
    assertNeverComposeDown(calls);
  });
});

describe('verifySharedReuse — host launchers (npm/make/shell)', () => {
  test('probe-and-leave via pgrep: a found dev server is NEVER stopped, even a frontend the boot contract would reboot', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: ok('999\n') },
    ]);
    const result = await verifySharedReuse(npmEntry(), baseDeps(runner));
    assert.equal(result.status, 'green-preexisting');
    assert.equal(result.command_executed, false);
    assert.deepEqual(result.started, { containers: [], processes: [] });
    assert.equal(calls.length, 1);
    assert.equal(calls.some((c) => c.key.includes('kill')), false);
    assert.equal(calls.some((c) => c.key.includes('pkill')), false);
  });

  test('host pgrep probe escapes ERE metacharacters in the command', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep', results: ok('12\n') },
    ]);
    const entry = npmEntry({ command: 'node server.js (dev) c++ [x]' });
    const result = await verifySharedReuse(entry, baseDeps(runner));
    assert.equal(result.status, 'green-preexisting');
    assert.deepEqual(calls[0].args, ['-f', 'node server\\.js \\(dev\\) c\\+\\+ \\[x\\]']);
  });

  test('probe-and-leave via port probe when pgrep misses but the readiness port answers', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
    ]);
    const probePort = async () => true;
    const result = await verifySharedReuse(npmEntry(), baseDeps(runner, { probePort }));
    assert.equal(result.status, 'green-preexisting');
    assert.equal(calls.length, 1);
  });

  test('probe-and-leave via http probe: an http_200 squatter answering 2xx is green-preexisting', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
    ]);
    const urls = [];
    const probeHttp = async (url) => {
      urls.push(url);
      return { status: 200 };
    };
    const entry = npmEntry({ readiness: { type: 'http_200', url: 'http://localhost:9090/health' } });
    const result = await verifySharedReuse(entry, baseDeps(runner, { probeHttp }));
    assert.equal(result.status, 'green-preexisting');
    assert.equal(result.command_executed, false);
    assert.deepEqual(urls, ['http://localhost:9090/health']);
    assert.equal(calls.length, 1);
  });

  test('green boot: setsid spawn in cwd with a unique tmp log, port_open polling, group kill of the spawned pid', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('4242\n') },
    ]);
    let portCalls = 0;
    const probePort = async () => {
      portCalls += 1;
      return portCalls >= 2;
    };
    const result = await verifySharedReuse(npmEntry(), baseDeps(runner, { probePort }));
    assert.equal(result.status, 'green');
    assert.equal(result.command_executed, true);
    assert.deepEqual(result.started.processes, [{ kind: 'host', pid: '4242', command: 'yarn dev' }]);
    const launch = calls.find((c) => c.key.includes('echo $!'));
    assert.equal(launch.opts.cwd, '/repo/beta-ui');
    assert.match(launch.args[1], /^setsid yarn dev > \S+\/beta-ui\.verify\.log 2>&1 & echo \$!$/);
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1] === 'kill -- -4242'));
  });

  test('the block teardown string is NEVER executed on the host path — only the spawned group is killed', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('4242\n') },
    ]);
    let portCalls = 0;
    const probePort = async () => {
      portCalls += 1;
      return portCalls >= 2;
    };
    const entry = npmEntry({ teardownCmd: "pkill -f 'sentinel-never-run' || true" });
    const result = await verifySharedReuse(entry, baseDeps(runner, { probePort }));
    assert.equal(result.teardown_clean, true);
    assert.equal(calls.some((c) => c.key.includes('sentinel-never-run')), false);
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1] === 'kill -- -4242'));
  });

  test('group kill failure falls back to a plain kill and stays clean when it succeeds', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('4242\n') },
      { when: 'kill -- -4242', results: { code: 1, stdout: '', stderr: '' } },
    ]);
    let portCalls = 0;
    const probePort = async () => {
      portCalls += 1;
      return portCalls >= 2;
    };
    const result = await verifySharedReuse(npmEntry(), baseDeps(runner, { probePort }));
    assert.equal(result.status, 'green');
    assert.equal(result.teardown_clean, true);
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1] === 'kill -- -4242'));
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1] === 'kill 4242'));
  });

  test('host log paths are unique per invocation and the log dir is removed at teardown', async () => {
    async function runOnce() {
      const { calls, runner } = makeRunner([
        { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
        { when: 'echo $!', results: ok('31\n') },
      ]);
      let portCalls = 0;
      const probePort = async () => {
        portCalls += 1;
        return portCalls >= 2;
      };
      const result = await verifySharedReuse(npmEntry(), baseDeps(runner, { probePort }));
      assert.equal(result.status, 'green');
      const launch = calls.find((c) => c.key.includes('echo $!'));
      return launch.args[1].match(/> (\S+) 2>&1/)[1];
    }
    const first = await runOnce();
    const second = await runOnce();
    assert.notEqual(first, second);
    assert.ok(first.endsWith('/beta-ui.verify.log'));
    assert.equal(existsSync(dirname(first)), false);
    assert.equal(existsSync(dirname(second)), false);
  });

  test('stdout_match readiness reads the unique tmp log via cat', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('777\n') },
      { when: 'cat ', results: [ok(''), ok('Local: http://localhost:5173\n')] },
    ]);
    const entry = npmEntry({ readiness: { type: 'stdout_match', pattern: 'Local:.*http' } });
    const result = await verifySharedReuse(entry, baseDeps(runner));
    assert.equal(result.status, 'green');
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1].includes('cat ') && c.args[1].includes('beta-ui.verify.log')));
  });

  test('invalid stdout_match pattern fails fast with bad_ready_pattern, no polling, teardown still kills', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('9\n') },
    ]);
    const entry = npmEntry({ readiness: { type: 'stdout_match', pattern: 'started (' } });
    const result = await verifySharedReuse(entry, baseDeps(runner));
    assert.equal(result.status, 'failed');
    assert.equal(result.cause, 'bad_ready_pattern');
    assert.equal(calls.some((c) => c.key.includes('cat ')), false);
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1] === 'kill -- -9'));
  });

  test('http_200 readiness accepts any 2xx and builds the url from port+path', async () => {
    const { runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('88\n') },
    ]);
    const urls = [];
    const responses = [{ status: 500 }, { status: 204 }];
    const probeHttp = async (url) => {
      urls.push(url);
      return responses.shift();
    };
    const probePort = async () => false;
    const entry = npmEntry({ readiness: { type: 'http_200', port: 8080, path: '/health' } });
    const result = await verifySharedReuse(entry, baseDeps(runner, { probeHttp, probePort }));
    assert.equal(result.status, 'green');
    assert.deepEqual(urls, ['http://localhost:8080/health', 'http://localhost:8080/health']);
  });

  test('readiness timeout kills the spawned process group anyway', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('551\n') },
    ]);
    const probePort = async () => false;
    const result = await verifySharedReuse(npmEntry(), baseDeps(runner, { probePort }));
    assert.equal(result.status, 'failed');
    assert.equal(result.cause, 'ready_timeout');
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1] === 'kill -- -551'));
  });

  test('readiness timeout is bounded by real elapsed time, not sleep-interval counting', async () => {
    const { runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('7\n') },
    ]);
    let probeCalls = 0;
    const probePort = async () => {
      probeCalls += 1;
      return false;
    };
    let t = 0;
    const now = () => {
      t += 2000;
      return t;
    };
    const result = await verifySharedReuse(npmEntry(), baseDeps(runner, { probePort, now }));
    assert.equal(result.status, 'failed');
    assert.equal(result.cause, 'ready_timeout');
    assert.equal(probeCalls, 2);
  });

  test('spawn failure returns failed(spawn_failed) with nothing to tear down', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: { code: 1, stdout: '', stderr: 'no shell' } },
    ]);
    const probePort = async () => false;
    const result = await verifySharedReuse(npmEntry(), baseDeps(runner, { probePort }));
    assert.equal(result.status, 'failed');
    assert.match(result.cause, /spawn_failed: no shell/);
    assert.equal(result.command_executed, false);
    assert.deepEqual(result.started, { containers: [], processes: [] });
    assert.equal(calls.some((c) => c.key.includes('kill ')), false);
  });

  test('failed group AND plain kill of the spawned pid reports teardown_clean=false', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('4242\n') },
      { when: 'kill', results: { code: 1, stdout: '', stderr: '' } },
    ]);
    let portCalls = 0;
    const probePort = async () => {
      portCalls += 1;
      return portCalls >= 2;
    };
    const result = await verifySharedReuse(npmEntry(), baseDeps(runner, { probePort }));
    assert.equal(result.status, 'green');
    assert.equal(result.teardown_clean, false);
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1] === 'kill -- -4242'));
    assert.ok(calls.some((c) => c.cmd === 'sh' && c.args[1] === 'kill 4242'));
  });

  test('missing ready signal fails fast with a precise cause', async () => {
    const { runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('12\n') },
    ]);
    const result = await verifySharedReuse(npmEntry({ readiness: null }), baseDeps(runner));
    assert.equal(result.status, 'failed');
    assert.equal(result.cause, 'missing_ready_signal');
  });
});

describe('errorHints', () => {
  test('surfaces error-shaped lines, newest last', () => {
    const log = [
      'starting up',
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@modelcontextprotocol/server' imported from /app/src/mcp/server.ts",
      'listening soon',
      'Error: connect ECONNREFUSED 127.0.0.1:5432',
    ].join('\n');
    const hints = errorHints(log);
    assert.equal(hints.length, 2);
    assert.match(hints[0], /ERR_MODULE_NOT_FOUND/);
    assert.match(hints[1], /ECONNREFUSED/);
  });

  test('never echoes env assignments, even when the value itself looks like an error', () => {
    const log = [
      'DATABASE_URL=refused-if-you-echo-this',
      'AUTH_TOKEN=failed-to-look-innocent',
      'Error: bind EADDRINUSE 0.0.0.0:8080',
    ].join('\n');
    const hints = errorHints(log).join('\n');
    assert.doesNotMatch(hints, /echo-this/);
    assert.doesNotMatch(hints, /failed-to-look-innocent/);
    assert.match(hints, /EADDRINUSE/);
  });

  test('caps the count and the line width, and strips ANSI colour', () => {
    const log = Array.from({ length: 9 }, (_, i) => `Error ${i}: ${'x'.repeat(400)}`).join('\n');
    const hints = errorHints(log);
    assert.equal(hints.length, 3);
    assert.ok(hints[0].length <= 201, `line was ${hints[0].length} chars`);
    assert.deepEqual(errorHints('\u001b[31mError: boom\u001b[0m'), ['Error: boom']);
  });

  test('a log with nothing error-shaped yields nothing', () => {
    assert.deepEqual(errorHints('compiling\nwatching for changes\n'), []);
    assert.deepEqual(errorHints(''), []);
    assert.deepEqual(errorHints(undefined), []);
  });
});

describe('verifySharedReuse — a failed readiness explains itself', () => {
  test('ready_timeout carries the launch log error lines', async () => {
    const { runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('4242\n') },
      { when: 'cat ', results: ok("boot\nError [ERR_MODULE_NOT_FOUND]: Cannot find package '@x/y'\n") },
    ]);
    const result = await verifySharedReuse(npmEntry(), baseDeps(runner, { probePort: async () => false }));
    assert.equal(result.status, 'failed');
    assert.equal(result.cause, 'ready_timeout');
    assert.match(result.error_hints.join('\n'), /ERR_MODULE_NOT_FOUND/);
  });

  test('a green boot reports no hints', async () => {
    const { runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('4242\n') },
    ]);
    let portCalls = 0;
    const probePort = async () => {
      portCalls += 1;
      return portCalls >= 2;
    };
    const result = await verifySharedReuse(npmEntry(), baseDeps(runner, { probePort }));
    assert.equal(result.status, 'green');
    assert.deepEqual(result.error_hints, []);
  });

  test('a block-level readiness failure never reads the log — nothing to learn there', async () => {
    const { calls, runner } = makeRunner([
      { when: 'pgrep -f', results: { code: 1, stdout: '', stderr: '' } },
      { when: 'echo $!', results: ok('9\n') },
    ]);
    const entry = npmEntry({ readiness: { type: 'stdout_match', pattern: 'started (' } });
    const result = await verifySharedReuse(entry, baseDeps(runner));
    assert.equal(result.cause, 'bad_ready_pattern');
    assert.deepEqual(result.error_hints, []);
    assert.equal(calls.some((c) => c.key.includes('cat ')), false);
  });
});
