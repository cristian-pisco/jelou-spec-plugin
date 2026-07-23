import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlLite, toYaml } from '../../bin/lib/registry/yaml-lite.mjs';
import {
  EXIT_CODES,
  buildVerifyEntry,
  composeBuildTargets,
  composeEnvFiles,
  computeDevBlockHash,
  parseArgs,
  persistBlock,
  runVerify,
  spliceDevBlock,
  spliceVerifiedMark,
  structuralPreflight,
  updateRegistryFile,
  validateBlockShape,
  writeMark,
} from '../../bin/verify-dev-block.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'bin', 'verify-dev-block.mjs');

const FIXTURE = [
  '# service registry — hand comments must survive every splice',
  'services:',
  '  alpha-service:',
  '    path: ../alpha-service # canonical checkout',
  '    stack: nestjs',
  '    docker:',
  '      service: app',
  '      compose_file: docker-compose.yml',
  '    dev:',
  '      launcher: docker-exec',
  '      docker:',
  '        service: app',
  '        compose_file: docker-compose.yml',
  '      command: npm run start:dev',
  `      teardown: "docker compose -f docker-compose.yml exec -T app pkill -f 'nest start' || true"`,
  '      ready_signal:',
  '        type: stdout_match',
  '        pattern: Nest application successfully started',
  '      ready_timeout_s: 1',
  '      ram_estimate_mb: 350',
  '      data_isolation: none',
  '  beta-ui:',
  '    path: ../beta-ui',
  '    stack: react',
  '  # gamma keeps its single-quoted path on purpose',
  '  gamma-api:',
  "    path: '../gamma-api'",
  '    stack: node-express',
  '  delta-web:',
  '    path: ../delta-web',
  '    dev:',
  '      launcher: npm',
  '      command: yarn dev',
  "      teardown: \"pkill -f 'vite' || true\"",
  '      env_files: [.env, .env.e2e]',
  '      ready_signal:',
  '        type: port_open',
  '        port: 5173',
  '      ready_timeout_s: 1',
  '      ram_estimate_mb: 400',
  '      data_isolation: none',
  '  epsilon-worker:',
  '    path: ../epsilon-worker',
  '    dev:',
  '      launcher: docker',
  '      docker:',
  '        compose_file: docker-compose.yml',
  '      ready_signal:',
  '        type: stdout_match',
  '        pattern: Nest application successfully started',
  '      ready_timeout_s: 1',
  '      data_isolation: none',
  '',
].join('\n');

const ALPHA_BLOCK = parseYamlLite(FIXTURE).services['alpha-service'].dev;

function makeWorkspace(fixture = FIXTURE) {
  const ws = mkdtempSync(join(tmpdir(), 'verify-dev-ws-'));
  mkdirSync(join(ws, 'registry'), { recursive: true });
  writeFileSync(join(ws, 'registry', 'services.yaml'), fixture);
  return ws;
}

function makeCheckout({ compose = 'services:\n  app:\n    image: x\n', nodeModules = true, extraFiles = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-dev-co-'));
  if (compose !== null) writeFileSync(join(dir, 'docker-compose.yml'), compose);
  if (nodeModules) mkdirSync(join(dir, 'node_modules'));
  for (const [rel, content] of Object.entries(extraFiles)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

function registryText(ws) {
  return readFileSync(join(ws, 'registry', 'services.yaml'), 'utf8');
}

function recordingRunner(routes = []) {
  const calls = [];
  const runner = async (cmd, args, opts = {}) => {
    const key = [cmd, ...args].join(' ');
    calls.push({ cmd, args, opts, key });
    for (const route of routes) {
      if (key.includes(route.when)) return route.result;
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { calls, runner };
}

function gitRoute(sha = 'abc1234') {
  return { when: 'rev-parse --short HEAD', result: { code: 0, stdout: `${sha}\n`, stderr: '' } };
}

describe('computeDevBlockHash', () => {
  test('stable across key order', () => {
    const a = { launcher: 'npm', docker: { service: 'app', compose_file: 'x.yml' }, ready_timeout_s: 30 };
    const b = { ready_timeout_s: 30, docker: { compose_file: 'x.yml', service: 'app' }, launcher: 'npm' };
    assert.equal(computeDevBlockHash(a), computeDevBlockHash(b));
  });

  test('ignores the verified key', () => {
    const base = { launcher: 'npm', command: 'yarn dev' };
    const marked = { ...base, verified: { date: '2026-07-23', commit: 'abc1234', block_hash: 'deadbeef' } };
    assert.equal(computeDevBlockHash(base), computeDevBlockHash(marked));
  });

  test('changes when block content changes', () => {
    assert.notEqual(
      computeDevBlockHash({ launcher: 'npm', command: 'yarn dev' }),
      computeDevBlockHash({ launcher: 'npm', command: 'npm run dev' }),
    );
  });

  test('stable across cosmetic YAML reserialization (quoting differences)', () => {
    const plain = parseYamlLite('dev:\n  launcher: docker-exec\n  command: npm run start:dev\n  ready_timeout_s: 90').dev;
    const quoted = parseYamlLite('dev:\n  launcher: "docker-exec"\n  command: "npm run start:dev"\n  ready_timeout_s: 90').dev;
    assert.equal(computeDevBlockHash(plain), computeDevBlockHash(quoted));
  });
});

describe('toYaml round-trip through parseYamlLite', () => {
  test('docker-exec block with ready_signal survives parse(toYaml(block))', () => {
    assert.deepEqual(parseYamlLite(`dev:\n${toYaml(ALPHA_BLOCK)}`).dev, ALPHA_BLOCK);
  });

  test('npm block with env_files list survives parse(toYaml(block))', () => {
    const block = parseYamlLite(FIXTURE).services['delta-web'].dev;
    assert.deepEqual(parseYamlLite(`dev:\n${toYaml(block)}`).dev, block);
  });

  test('flow-list items containing commas or quotes round-trip', () => {
    const block = { env_files: ['a, b', '.env', 'say "hi"'] };
    assert.deepEqual(parseYamlLite(`dev:\n${toYaml(block)}`).dev, block);
  });
});

describe('spliceDevBlock', () => {
  const NEW_BLOCK = {
    launcher: 'docker-exec',
    docker: { service: 'app', compose_file: 'docker-compose.yml' },
    command: 'pnpm start:dev',
    teardown: "docker compose -f docker-compose.yml exec -T app pkill -f 'nest start' || true",
    ready_signal: { type: 'stdout_match', pattern: 'Nest application successfully started' },
    ready_timeout_s: 60,
    ram_estimate_mb: 350,
    data_isolation: 'none',
  };

  test('replaces an existing dev subtree in place', () => {
    const out = spliceDevBlock(FIXTURE, 'alpha-service', NEW_BLOCK);
    assert.deepEqual(parseYamlLite(out).services['alpha-service'].dev, NEW_BLOCK);
  });

  test('every byte outside the spliced dev subtree stays identical (comments, quoting, other services)', () => {
    const out = spliceDevBlock(FIXTURE, 'alpha-service', NEW_BLOCK);
    const tailFrom = (s) => s.slice(s.indexOf('  beta-ui:'));
    const headTo = (s) => s.slice(0, s.indexOf('    dev:'));
    assert.equal(tailFrom(out), tailFrom(FIXTURE));
    assert.equal(headTo(out), headTo(FIXTURE));
    assert.ok(out.includes('# service registry — hand comments must survive every splice'));
    assert.ok(out.includes('    path: ../alpha-service # canonical checkout'));
    assert.ok(out.includes("    path: '../gamma-api'"));
  });

  test('inserts after the entry last line when the service has no dev block, at the correct indentation', () => {
    const block = { launcher: 'npm', command: 'yarn dev', data_isolation: 'none' };
    const out = spliceDevBlock(FIXTURE, 'beta-ui', block);
    assert.deepEqual(parseYamlLite(out).services['beta-ui'].dev, block);
    assert.ok(out.includes('    stack: react\n    dev:\n      launcher: npm\n      command: yarn dev'));
    assert.ok(out.includes('  # gamma keeps its single-quoted path on purpose'));
    const gammaOn = (s) => s.slice(s.indexOf('  gamma-api:'));
    assert.equal(gammaOn(out), gammaOn(FIXTURE));
  });

  test('unknown service throws', () => {
    assert.throws(() => spliceDevBlock(FIXTURE, 'nope-service', { launcher: 'npm' }), /not found/);
  });

  test('a service id colliding with a nested key only touches the top-level service', () => {
    const colliding = [
      'services:',
      '  alpha:',
      '    path: ../alpha',
      '    docker:',
      '      service: app',
      '      compose_file: docker-compose.yml',
      '    dev:',
      '      launcher: docker-exec',
      '      command: npm run start:dev',
      '  docker:',
      '    path: ../docker-svc',
      '',
    ].join('\n');
    const block = { launcher: 'npm', command: 'yarn dev' };
    const out = spliceDevBlock(colliding, 'docker', block);
    const alphaRegion = (s) => s.slice(s.indexOf('  alpha:'), s.indexOf('\n  docker:\n'));
    assert.equal(alphaRegion(out), alphaRegion(colliding));
    const parsed = parseYamlLite(out);
    assert.deepEqual(parsed.services.docker.dev, block);
    assert.equal(parsed.services.alpha.docker.service, 'app');
    assert.deepEqual(parsed.services.alpha.dev, { launcher: 'docker-exec', command: 'npm run start:dev' });
  });
});

describe('spliceVerifiedMark', () => {
  const MARK = { date: '2026-07-23', commit: 'abc1234', block_hash: computeDevBlockHash(ALPHA_BLOCK) };

  test('appends the verified map under the dev block', () => {
    const out = spliceVerifiedMark(FIXTURE, 'alpha-service', MARK);
    assert.deepEqual(parseYamlLite(out).services['alpha-service'].dev.verified, MARK);
    assert.ok(out.includes('      data_isolation: none\n      verified:\n        date: 2026-07-23\n        commit: abc1234'));
  });

  test('replace is idempotent and updates in place', () => {
    const once = spliceVerifiedMark(FIXTURE, 'alpha-service', MARK);
    const twice = spliceVerifiedMark(once, 'alpha-service', MARK);
    assert.equal(twice, once);
    const updated = spliceVerifiedMark(once, 'alpha-service', { ...MARK, commit: 'def5678' });
    assert.equal(parseYamlLite(updated).services['alpha-service'].dev.verified.commit, 'def5678');
    assert.equal(updated.match(/verified:/g).length, 1);
  });

  test('leaves other services byte-identical', () => {
    const out = spliceVerifiedMark(FIXTURE, 'alpha-service', MARK);
    const tailFrom = (s) => s.slice(s.indexOf('  beta-ui:'));
    assert.equal(tailFrom(out), tailFrom(FIXTURE));
  });

  test('service without a dev block throws', () => {
    assert.throws(() => spliceVerifiedMark(FIXTURE, 'beta-ui', MARK), /no dev block/);
  });
});

describe('composeEnvFiles', () => {
  test('reads scalar, block-list, and quoted forms', () => {
    const text = [
      'services:',
      '  app:',
      '    env_file: .env',
      '  worker:',
      '    env_file:',
      '      - .env',
      '      - ".env.local"',
      '',
    ].join('\n');
    assert.deepEqual(composeEnvFiles(text), [
      { path: '.env', required: true },
      { path: '.env', required: true },
      { path: '.env.local', required: true },
    ]);
  });

  test('inline flow-list form is split and unquoted', () => {
    assert.deepEqual(
      composeEnvFiles('services:\n  app:\n    env_file: [.env, ".env.local"]\n'),
      [{ path: '.env', required: true }, { path: '.env.local', required: true }],
    );
  });

  test('object form carries the required flag', () => {
    const text = [
      'services:',
      '  app:',
      '    env_file:',
      '      - .env',
      '      - path: ./override.env',
      '        required: false',
      '',
    ].join('\n');
    assert.deepEqual(composeEnvFiles(text), [
      { path: '.env', required: true },
      { path: './override.env', required: false },
    ]);
  });

  test('no env_file yields empty list', () => {
    assert.deepEqual(composeEnvFiles('services:\n  app:\n    image: x\n'), []);
  });
});

describe('composeBuildTargets', () => {
  test('string form, map form, and defaults', () => {
    const text = [
      'services:',
      '  a:',
      '    build: ./svc-a',
      '  b:',
      '    build:',
      '      context: ./svc-b',
      '      dockerfile: Dockerfile.dev',
      '  c:',
      '    build:',
      '      dockerfile: docker/Dockerfile',
      '  d:',
      '    image: x',
      '',
    ].join('\n');
    assert.deepEqual(composeBuildTargets(text), [
      { context: './svc-a', dockerfile: 'Dockerfile' },
      { context: './svc-b', dockerfile: 'Dockerfile.dev' },
      { context: '.', dockerfile: 'docker/Dockerfile' },
    ]);
  });
});

describe('structuralPreflight', () => {
  const DELTA_BLOCK = parseYamlLite(FIXTURE).services['delta-web'].dev;

  test('docker launcher with missing compose file fails with a precise cause', () => {
    const checkout = makeCheckout({ compose: null });
    const cause = structuralPreflight(ALPHA_BLOCK, checkout);
    assert.match(cause, /compose file missing/);
  });

  test('package-manager command without node_modules fails for host launchers', () => {
    const checkout = makeCheckout({ compose: null, nodeModules: false });
    const cause = structuralPreflight(DELTA_BLOCK, checkout);
    assert.match(cause, /node_modules missing/);
  });

  test('docker-exec package-manager command runs in-container, node_modules not required', () => {
    const checkout = makeCheckout({ nodeModules: false });
    assert.equal(structuralPreflight({ ...ALPHA_BLOCK, command: 'yarn start:dev' }, checkout), null);
  });

  test('compose env_file reference to a missing file fails', () => {
    const checkout = makeCheckout({ compose: 'services:\n  app:\n    env_file: .env\n' });
    const cause = structuralPreflight(ALPHA_BLOCK, checkout);
    assert.match(cause, /env_file referenced by docker-compose\.yml missing/);
  });

  test('env_file paths resolve relative to the compose file directory, not the checkout root', () => {
    const block = { ...ALPHA_BLOCK, docker: { service: 'app', compose_file: 'deploy/docker-compose.yml' } };
    const missing = makeCheckout({
      compose: null,
      extraFiles: { 'deploy/docker-compose.yml': 'services:\n  app:\n    env_file: .env\n', '.env': 'A=1\n' },
    });
    assert.match(structuralPreflight(block, missing), /missing in checkout: \.env/);
    const present = makeCheckout({
      compose: null,
      extraFiles: { 'deploy/docker-compose.yml': 'services:\n  app:\n    env_file: .env\n', 'deploy/.env': 'A=1\n' },
    });
    assert.equal(structuralPreflight(block, present), null);
  });

  test('object-form env_file with required false is skipped', () => {
    const compose = [
      'services:',
      '  app:',
      '    env_file:',
      '      - path: ./missing.env',
      '        required: false',
      '',
    ].join('\n');
    assert.equal(structuralPreflight(ALPHA_BLOCK, makeCheckout({ compose })), null);
  });

  test('object-form env_file defaulting to required fails when missing', () => {
    const compose = 'services:\n  app:\n    env_file:\n      - path: ./missing.env\n';
    assert.match(structuralPreflight(ALPHA_BLOCK, makeCheckout({ compose })), /missing\.env/);
  });

  test('docker launcher without a declared compose_file fails with a precise cause', () => {
    const cause = structuralPreflight({ launcher: 'docker' }, makeCheckout(), {});
    assert.match(cause, /compose_file not declared/);
  });

  test('variable-based env_file references are skipped, not required', () => {
    const checkout = makeCheckout({ compose: 'services:\n  app:\n    env_file: $ENV_FILE\n' });
    assert.equal(structuralPreflight(ALPHA_BLOCK, checkout), null);
  });

  test('mid-path variable env_file references are skipped too', () => {
    const checkout = makeCheckout({ compose: 'services:\n  app:\n    env_file: ./conf/${STAGE}.env\n' });
    assert.equal(structuralPreflight(ALPHA_BLOCK, checkout), null);
  });

  test('build section referencing a missing Dockerfile fails', () => {
    const compose = 'services:\n  app:\n    build:\n      context: .\n      dockerfile: Dockerfile.dev\n';
    assert.match(structuralPreflight(ALPHA_BLOCK, makeCheckout({ compose })), /dockerfile Dockerfile\.dev missing/);
  });

  test('build section with the Dockerfile present passes', () => {
    const compose = 'services:\n  app:\n    build:\n      context: .\n      dockerfile: Dockerfile.dev\n';
    const checkout = makeCheckout({ compose, extraFiles: { 'Dockerfile.dev': 'FROM node\n' } });
    assert.equal(structuralPreflight(ALPHA_BLOCK, checkout), null);
  });

  test('variable-based build references are ambiguous and pass', () => {
    const compose = 'services:\n  app:\n    build:\n      context: .\n      dockerfile: ${DOCKERFILE}\n';
    assert.equal(structuralPreflight(ALPHA_BLOCK, makeCheckout({ compose })), null);
  });

  test('block with neither health_url nor typed ready_signal fails missing_ready_signal', () => {
    assert.equal(structuralPreflight({ launcher: 'shell', command: 'node server.js' }, makeCheckout()), 'missing_ready_signal');
    assert.equal(
      structuralPreflight({ launcher: 'shell', command: 'node server.js', ready_signal: { port: 3000 } }, makeCheckout()),
      'missing_ready_signal',
    );
    assert.equal(
      structuralPreflight({ launcher: 'shell', command: 'node server.js', health_url: 'http://localhost:1/health' }, makeCheckout()),
      null,
    );
  });

  test('all structure present proceeds to boot (null)', () => {
    const checkout = makeCheckout({ compose: 'services:\n  app:\n    env_file: .env\n', extraFiles: { '.env': 'A=1\n' } });
    assert.equal(structuralPreflight(ALPHA_BLOCK, checkout), null);
  });
});

describe('buildVerifyEntry', () => {
  test('is read-only: never carries files, wiredEnv, or envFiles', () => {
    const entry = buildVerifyEntry(ALPHA_BLOCK, {}, '/checkout');
    assert.equal('files' in entry, false);
    assert.equal('wiredEnv' in entry, false);
    assert.equal('envFiles' in entry, false);
    assert.equal(entry.cwd, '/checkout');
    assert.equal(entry.launcher, 'docker-exec');
    assert.equal(entry.composeFile, 'docker-compose.yml');
    assert.equal(entry.dockerService, 'app');
    assert.deepEqual(entry.readiness, { type: 'stdout_match', pattern: 'Nest application successfully started' });
  });

  test('falls back to the sibling docker block and to health_url readiness', () => {
    const entry = buildVerifyEntry(
      { launcher: 'docker', health_url: 'http://localhost:4001/health' },
      { docker: { service: 'api', compose_file: 'compose.yml' } },
      '/checkout',
    );
    assert.equal(entry.dockerService, 'api');
    assert.equal(entry.composeFile, 'compose.yml');
    assert.deepEqual(entry.readiness, { type: 'http_200', url: 'http://localhost:4001/health' });
    assert.equal(entry.readyTimeoutS, 30);
  });
});

describe('runVerify', () => {
  test('structural preflight short-circuits to failed(cause) WITHOUT invoking the executor', async () => {
    const ws = makeWorkspace();
    const checkout = makeCheckout({ compose: null });
    const { calls, runner } = recordingRunner([gitRoute()]);
    const { verdict } = await runVerify({ workspace: ws, service: 'alpha-service', checkout, runner });
    assert.equal(verdict.status, 'failed');
    assert.match(verdict.cause, /compose file missing/);
    assert.equal(verdict.command_executed, false);
    assert.equal(verdict.commit, 'abc1234');
    assert.equal(verdict.block_hash, computeDevBlockHash(ALPHA_BLOCK));
    assert.ok(calls.every((c) => c.cmd === 'git'));
  });

  test('missing node_modules short-circuits an npm-run block the same way', async () => {
    const ws = makeWorkspace();
    const checkout = makeCheckout({ compose: null, nodeModules: false });
    const { calls, runner } = recordingRunner([gitRoute()]);
    const { verdict } = await runVerify({ workspace: ws, service: 'delta-web', checkout, runner });
    assert.equal(verdict.status, 'failed');
    assert.match(verdict.cause, /node_modules missing/);
    assert.ok(calls.every((c) => c.cmd === 'git'));
  });

  test('service without a dev block returns an error (registry is the only source of the block)', async () => {
    const ws = makeWorkspace();
    const { runner } = recordingRunner([gitRoute()]);
    const { error } = await runVerify({ workspace: ws, service: 'beta-ui', checkout: makeCheckout(), runner });
    assert.match(error, /no dev block/);
  });

  test('already-serving service verifies green-preexisting with command_executed=false', async () => {
    const ws = makeWorkspace();
    const checkout = makeCheckout();
    const { runner } = recordingRunner([
      gitRoute('fff0001'),
      { when: 'ps --services --status running', result: { code: 0, stdout: 'app\n', stderr: '' } },
      { when: 'pgrep -f', result: { code: 0, stdout: '', stderr: '' } },
    ]);
    const { verdict } = await runVerify({ workspace: ws, service: 'alpha-service', checkout, runner });
    assert.equal(verdict.status, 'green-preexisting');
    assert.equal(verdict.command_executed, false);
    assert.equal(verdict.teardown_clean, true);
    assert.equal(verdict.commit, 'fff0001');
    assert.equal(verdict.block_hash, computeDevBlockHash(ALPHA_BLOCK));
  });
});

describe('persistBlock / writeMark — atomic CAS writes', () => {
  test('persistBlock splices and writes atomically', () => {
    const ws = makeWorkspace();
    const block = { launcher: 'npm', command: 'yarn dev', data_isolation: 'none' };
    const result = persistBlock({ workspace: ws, service: 'beta-ui', block });
    assert.deepEqual(result, { status: 'ok' });
    const text = registryText(ws);
    assert.deepEqual(parseYamlLite(text).services['beta-ui'].dev, block);
    assert.ok(text.includes('# service registry — hand comments must survive every splice'));
  });

  test('persistBlock refuses with conflict when the file mtime changed before the rename', () => {
    const ws = makeWorkspace();
    const path = join(ws, 'registry', 'services.yaml');
    const bumped = new Date(Date.now() + 10000);
    const result = persistBlock(
      { workspace: ws, service: 'beta-ui', block: { launcher: 'npm', command: 'yarn dev' } },
      { beforeWrite: () => utimesSync(path, bumped, bumped) },
    );
    assert.deepEqual(result, { status: 'conflict' });
    assert.equal(registryText(ws), FIXTURE);
  });

  test('writeMark computes block_hash from the current block minus verified and is idempotent per day', () => {
    const ws = makeWorkspace();
    const today = () => '2026-07-23';
    assert.deepEqual(writeMark({ workspace: ws, service: 'alpha-service', commit: 'abc1234', today }), { status: 'ok' });
    const once = registryText(ws);
    assert.deepEqual(parseYamlLite(once).services['alpha-service'].dev.verified, {
      date: '2026-07-23',
      commit: 'abc1234',
      block_hash: computeDevBlockHash(ALPHA_BLOCK),
    });
    assert.deepEqual(writeMark({ workspace: ws, service: 'alpha-service', commit: 'abc1234', today }), { status: 'ok' });
    assert.equal(registryText(ws), once);
  });

  test('writeMark conflicts on concurrent mtime change', () => {
    const ws = makeWorkspace();
    const path = join(ws, 'registry', 'services.yaml');
    const bumped = new Date(Date.now() + 10000);
    const result = writeMark(
      { workspace: ws, service: 'alpha-service', commit: 'abc1234' },
      { beforeWrite: () => utimesSync(path, bumped, bumped) },
    );
    assert.deepEqual(result, { status: 'conflict' });
  });

  test('a fresh lock held by another writer yields conflict without touching the registry', () => {
    const ws = makeWorkspace();
    const lockPath = join(ws, 'registry', 'services.yaml.lock');
    writeFileSync(lockPath, '99999');
    const result = persistBlock({ workspace: ws, service: 'beta-ui', block: { launcher: 'npm', command: 'yarn dev' } });
    assert.deepEqual(result, { status: 'conflict' });
    assert.equal(registryText(ws), FIXTURE);
    assert.equal(existsSync(lockPath), true);
  });

  test('a stale lock is removed and the write proceeds', () => {
    const ws = makeWorkspace();
    const lockPath = join(ws, 'registry', 'services.yaml.lock');
    writeFileSync(lockPath, '99999');
    const past = new Date(Date.now() - 60000);
    utimesSync(lockPath, past, past);
    const block = { launcher: 'npm', command: 'yarn dev' };
    const result = persistBlock({ workspace: ws, service: 'beta-ui', block });
    assert.deepEqual(result, { status: 'ok' });
    assert.deepEqual(parseYamlLite(registryText(ws)).services['beta-ui'].dev, block);
    assert.equal(existsSync(lockPath), false);
  });

  test('the lock is released after a successful write', () => {
    const ws = makeWorkspace();
    persistBlock({ workspace: ws, service: 'beta-ui', block: { launcher: 'npm', command: 'yarn dev' } });
    assert.equal(existsSync(join(ws, 'registry', 'services.yaml.lock')), false);
  });

  test('the tmp splice file is removed and the lock released when the rename fails', () => {
    const ws = makeWorkspace();
    const dir = join(ws, 'registry');
    assert.throws(
      () => persistBlock(
        { workspace: ws, service: 'beta-ui', block: { launcher: 'npm', command: 'yarn dev' } },
        { rename: () => { throw new Error('rename boom'); } },
      ),
      /rename boom/,
    );
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('.services.yaml.tmp-')), []);
    assert.equal(registryText(ws), FIXTURE);
    assert.equal(existsSync(join(dir, 'services.yaml.lock')), false);
  });

  test('splice invariant rejects a mutation whose tab-indented line truncates the parse', () => {
    const ws = makeWorkspace();
    const path = join(ws, 'registry', 'services.yaml');
    const result = updateRegistryFile(path, (text) => text.replace('  beta-ui:', '\tbeta-ui:'));
    assert.deepEqual(result, { status: 'error', cause: 'splice_invariant' });
    assert.equal(registryText(ws), FIXTURE);
    assert.equal(existsSync(`${path}.lock`), false);
  });

  test('splice invariant requires the target service to still parse with its dev block', () => {
    const ws = makeWorkspace();
    const path = join(ws, 'registry', 'services.yaml');
    const result = updateRegistryFile(path, (text) => text, { service: 'beta-ui' });
    assert.deepEqual(result, { status: 'error', cause: 'splice_invariant' });
    assert.equal(registryText(ws), FIXTURE);
  });
});

describe('parseArgs', () => {
  test('extracts all documented flags', () => {
    assert.deepEqual(
      parseArgs(['--workspace', 'ws', '--service', 'svc', '--checkout', 'dir']),
      { workspace: 'ws', service: 'svc', checkout: 'dir' },
    );
    assert.deepEqual(parseArgs(['--hash', '--workspace', 'ws', '--service', 'svc']).hash, true);
    assert.deepEqual(
      parseArgs(['--persist-block', '--block-file', '-', '--workspace', 'w', '--service', 's']),
      { persistBlock: true, blockFile: '-', workspace: 'w', service: 's' },
    );
    assert.deepEqual(
      parseArgs(['--write-mark', '--commit', 'abc', '--workspace', 'w', '--service', 's']),
      { writeMark: true, commit: 'abc', workspace: 'w', service: 's' },
    );
  });
});

describe('validateBlockShape', () => {
  test('accepts well-formed blocks from the fixture', () => {
    assert.equal(validateBlockShape(ALPHA_BLOCK), null);
    assert.equal(validateBlockShape(parseYamlLite(FIXTURE).services['delta-web'].dev), null);
  });

  test('docker launcher does not require a command', () => {
    assert.equal(validateBlockShape(parseYamlLite(FIXTURE).services['epsilon-worker'].dev), null);
  });

  test('rejects unknown launchers and non-object blocks', () => {
    assert.match(validateBlockShape({ launcher: 'systemd', command: 'x' }), /launcher must be one of/);
    assert.match(validateBlockShape(['npm']), /JSON object/);
    assert.match(validateBlockShape(null), /JSON object/);
  });
});

function makeShims() {
  const dir = mkdtempSync(join(tmpdir(), 'verify-dev-shim-'));
  const state = mkdtempSync(join(tmpdir(), 'verify-dev-state-'));
  writeFileSync(join(dir, 'git'), '#!/bin/sh\necho abc1234\nexit 0\n');
  writeFileSync(join(dir, 'docker'), [
    '#!/bin/sh',
    'case "$*" in',
    '  *"ps --services --status running"*) if [ -f "$FAKE_STATE/up" ]; then echo app; fi; exit 0;;',
    '  *"pgrep -f"*) if [ -n "$FAKE_PREEXISTING" ]; then exit 0; else exit 1; fi;;',
    '  *"cat /tmp/"*) if [ -n "$FAKE_READY" ]; then echo "Nest application successfully started"; fi; exit 0;;',
    '  *"logs --no-color"*) if [ -n "$FAKE_READY" ] && [ -f "$FAKE_STATE/up_called" ]; then echo "Nest application successfully started"; fi; exit 0;;',
    '  *"up -d"*) touch "$FAKE_STATE/up" "$FAKE_STATE/up_called"; exit 0;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(join(dir, 'git'), 0o755);
  chmodSync(join(dir, 'docker'), 0o755);
  return { dir, state };
}

function runCli(args, { shims, env = {}, input } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      PATH: shims ? `${shims.dir}:${process.env.PATH}` : process.env.PATH,
      FAKE_STATE: shims ? shims.state : tmpdir(),
      ...env,
    },
  });
}

describe('verify-dev-block CLI contract', () => {
  test('EXIT_CODES map is the pinned contract', () => {
    assert.deepEqual(EXIT_CODES, { green: 0, error: 2, 'green-preexisting': 3, failed: 4, conflict: 5 });
  });

  test('no args → usage error exit 2', () => {
    const r = runCli([]);
    assert.equal(r.status, 2);
    assert.match(JSON.parse(r.stdout).error, /usage/);
  });

  test('verify green: boots via shims, prints the verdict line, exit 0', () => {
    const ws = makeWorkspace();
    const checkout = makeCheckout();
    const shims = makeShims();
    const r = runCli(['--workspace', ws, '--service', 'alpha-service', '--checkout', checkout], { shims, env: { FAKE_READY: '1' } });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'green');
    assert.equal(out.command_executed, true);
    assert.equal(out.commit, 'abc1234');
    assert.equal(out.teardown_clean, true);
    assert.equal(out.block_hash, computeDevBlockHash(ALPHA_BLOCK));
  });

  test('verify green-preexisting: already-serving stack, exit 3, command_executed=false', () => {
    const ws = makeWorkspace();
    const checkout = makeCheckout();
    const shims = makeShims();
    writeFileSync(join(shims.state, 'up'), '');
    const r = runCli(['--workspace', ws, '--service', 'alpha-service', '--checkout', checkout], { shims, env: { FAKE_PREEXISTING: '1' } });
    assert.equal(r.status, 3);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'green-preexisting');
    assert.equal(out.command_executed, false);
  });

  test('verify readiness timeout: exit 4 with cause, teardown still clean', () => {
    const ws = makeWorkspace();
    const checkout = makeCheckout();
    const shims = makeShims();
    const r = runCli(['--workspace', ws, '--service', 'alpha-service', '--checkout', checkout], { shims });
    assert.equal(r.status, 4);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'failed');
    assert.equal(out.cause, 'ready_timeout');
    assert.equal(out.command_executed, true);
    assert.equal(out.teardown_clean, true);
  });

  test('preflight failure exits 4 without any docker call', () => {
    const ws = makeWorkspace();
    const checkout = makeCheckout({ compose: null });
    const shims = makeShims();
    const r = runCli(['--workspace', ws, '--service', 'alpha-service', '--checkout', checkout], { shims });
    assert.equal(r.status, 4);
    assert.match(JSON.parse(r.stdout).cause, /compose file missing/);
  });

  test('--hash prints the block hash, exit 0; missing block exits 2', () => {
    const ws = makeWorkspace();
    const r = runCli(['--hash', '--workspace', ws, '--service', 'alpha-service']);
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).block_hash, computeDevBlockHash(ALPHA_BLOCK));
    const missing = runCli(['--hash', '--workspace', ws, '--service', 'beta-ui']);
    assert.equal(missing.status, 2);
  });

  test('--persist-block splices from a block file and preserves the rest of the registry', () => {
    const ws = makeWorkspace();
    const blockPath = join(mkdtempSync(join(tmpdir(), 'verify-dev-blk-')), 'block.json');
    const block = { launcher: 'npm', command: 'yarn dev', data_isolation: 'none' };
    writeFileSync(blockPath, JSON.stringify(block));
    const r = runCli(['--persist-block', '--workspace', ws, '--service', 'beta-ui', '--block-file', blockPath]);
    assert.equal(r.status, 0);
    const text = registryText(ws);
    assert.deepEqual(parseYamlLite(text).services['beta-ui'].dev, block);
    const gammaOn = (s) => s.slice(s.indexOf('  gamma-api:'));
    assert.equal(gammaOn(text), gammaOn(FIXTURE));
  });

  test('--write-mark adds the verified map with today date + commit + block hash', () => {
    const ws = makeWorkspace();
    const before = new Date().toISOString().slice(0, 10);
    const r = runCli(['--write-mark', '--workspace', ws, '--service', 'alpha-service', '--commit', 'abc1234']);
    const after = new Date().toISOString().slice(0, 10);
    assert.equal(r.status, 0);
    const verified = parseYamlLite(registryText(ws)).services['alpha-service'].dev.verified;
    assert.equal(verified.commit, 'abc1234');
    assert.equal(verified.block_hash, computeDevBlockHash(ALPHA_BLOCK));
    assert.ok([before, after].includes(verified.date));
  });

  test('--write-mark without --commit exits 2', () => {
    const ws = makeWorkspace();
    const r = runCli(['--write-mark', '--workspace', ws, '--service', 'alpha-service']);
    assert.equal(r.status, 2);
  });

  test('--write-mark with a dash or empty commit exits 2 as usage', () => {
    const ws = makeWorkspace();
    const dash = runCli(['--write-mark', '--workspace', ws, '--service', 'alpha-service', '--commit', '-']);
    assert.equal(dash.status, 2);
    assert.match(JSON.parse(dash.stdout).error, /--commit/);
    const empty = runCli(['--write-mark', '--workspace', ws, '--service', 'alpha-service', '--commit', '']);
    assert.equal(empty.status, 2);
    assert.equal(registryText(ws), FIXTURE);
  });

  test('docker up -d over an already-running stack prints green-preexisting and exits 3', () => {
    const ws = makeWorkspace();
    const checkout = makeCheckout();
    const shims = makeShims();
    writeFileSync(join(shims.state, 'up'), '');
    const r = runCli(['--workspace', ws, '--service', 'epsilon-worker', '--checkout', checkout], { shims, env: { FAKE_READY: '1' } });
    assert.equal(r.status, 3);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'green-preexisting');
    assert.equal(out.command_executed, false);
  });

  test('--persist-block --block-file - reads the block from stdin', () => {
    const ws = makeWorkspace();
    const block = { launcher: 'npm', command: 'yarn dev', data_isolation: 'none' };
    const r = runCli(
      ['--persist-block', '--workspace', ws, '--service', 'beta-ui', '--block-file', '-'],
      { input: JSON.stringify(block) },
    );
    assert.equal(r.status, 0);
    assert.deepEqual(parseYamlLite(registryText(ws)).services['beta-ui'].dev, block);
  });

  test('--persist-block while the lock is held exits 5 with conflict', () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws, 'registry', 'services.yaml.lock'), '12345');
    const r = runCli(
      ['--persist-block', '--workspace', ws, '--service', 'beta-ui', '--block-file', '-'],
      { input: JSON.stringify({ launcher: 'npm', command: 'yarn dev' }) },
    );
    assert.equal(r.status, 5);
    assert.deepEqual(JSON.parse(r.stdout), { status: 'conflict' });
    assert.equal(registryText(ws), FIXTURE);
  });

  test('piping the derive envelope instead of the bare block exits 2', () => {
    const ws = makeWorkspace();
    const envelope = { block: { launcher: 'npm', command: 'yarn dev' }, source: 'derive', warnings: [] };
    const r = runCli(
      ['--persist-block', '--workspace', ws, '--service', 'beta-ui', '--block-file', '-'],
      { input: JSON.stringify(envelope) },
    );
    assert.equal(r.status, 2);
    assert.match(JSON.parse(r.stdout).error, /launcher/);
    assert.equal(registryText(ws), FIXTURE);
  });

  test('block strings with embedded control characters exit 2 (YAML injection)', () => {
    const ws = makeWorkspace();
    const cases = [
      { launcher: 'npm', command: 'yarn dev\nmalicious: true' },
      { launcher: 'npm', command: 'yarn dev', env_files: ['.env\nboom: x'] },
      { launcher: 'npm', command: 'yarn dev', teardown: 'pkill\tvite' },
    ];
    for (const block of cases) {
      const r = runCli(
        ['--persist-block', '--workspace', ws, '--service', 'beta-ui', '--block-file', '-'],
        { input: JSON.stringify(block) },
      );
      assert.equal(r.status, 2);
      assert.match(JSON.parse(r.stdout).error, /control characters/);
    }
    assert.equal(registryText(ws), FIXTURE);
  });

  test('missing command for a non-docker launcher exits 2', () => {
    const ws = makeWorkspace();
    const r = runCli(
      ['--persist-block', '--workspace', ws, '--service', 'beta-ui', '--block-file', '-'],
      { input: JSON.stringify({ launcher: 'docker-exec' }) },
    );
    assert.equal(r.status, 2);
    assert.match(JSON.parse(r.stdout).error, /command is required/);
  });

  test('unsupported block value types exit 2', () => {
    const ws = makeWorkspace();
    const r = runCli(
      ['--persist-block', '--workspace', ws, '--service', 'beta-ui', '--block-file', '-'],
      { input: JSON.stringify({ launcher: 'npm', command: 'yarn dev', extras: [{ nested: true }] }) },
    );
    assert.equal(r.status, 2);
    assert.match(JSON.parse(r.stdout).error, /unsupported value type/);
    assert.equal(registryText(ws), FIXTURE);
  });

  test('verify mode without --checkout exits 2 with a pointed message', () => {
    const ws = makeWorkspace();
    const r = runCli(['--workspace', ws, '--service', 'alpha-service']);
    assert.equal(r.status, 2);
    assert.match(JSON.parse(r.stdout).error, /--checkout/);
  });

  test('--persist-block without --block-file exits 2', () => {
    const ws = makeWorkspace();
    const r = runCli(['--persist-block', '--workspace', ws, '--service', 'beta-ui']);
    assert.equal(r.status, 2);
    assert.match(JSON.parse(r.stdout).error, /--block-file/);
  });

  test('--persist-block with malformed JSON exits 2 with the parse error', () => {
    const ws = makeWorkspace();
    const blockPath = join(mkdtempSync(join(tmpdir(), 'verify-dev-badjson-')), 'block.json');
    writeFileSync(blockPath, '{launcher: npm');
    const r = runCli(['--persist-block', '--workspace', ws, '--service', 'beta-ui', '--block-file', blockPath]);
    assert.equal(r.status, 2);
    assert.ok(JSON.parse(r.stdout).error);
    assert.equal(registryText(ws), FIXTURE);
  });

  test('--persist-block for an unknown service exits 2 and leaves the registry untouched', () => {
    const ws = makeWorkspace();
    const blockPath = join(mkdtempSync(join(tmpdir(), 'verify-dev-nosvc-')), 'block.json');
    writeFileSync(blockPath, JSON.stringify({ launcher: 'npm', command: 'yarn dev' }));
    const r = runCli(['--persist-block', '--workspace', ws, '--service', 'nope-service', '--block-file', blockPath]);
    assert.equal(r.status, 2);
    assert.match(JSON.parse(r.stdout).error, /not found/);
    assert.equal(registryText(ws), FIXTURE);
  });
});
