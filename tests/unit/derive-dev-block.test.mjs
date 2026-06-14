// tests/unit/derive-dev-block.test.mjs
//
// Tests for bin/derive-dev-block.mjs — infers a services.yaml `dev:` block for
// a service that has none, so /jlu-production-like boots it deterministically
// instead of improvising the wrong package manager (the `docker exec yarn dev`
// on an npm project failure).
//
// Run: `node --test tests/unit/derive-dev-block.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectPackageManager,
  pickDevScript,
  runCommand,
  parseComposeServicePorts,
  primaryHostPort,
  isIdleDevContainer,
  deriveDevBlock,
  devBlockToYaml,
} from '../../bin/derive-dev-block.mjs';

function scratch(files) {
  const dir = mkdtempSync(join(tmpdir(), 'derive-dev-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

describe('detectPackageManager', () => {
  test('lockfiles win in priority order', () => {
    assert.equal(detectPackageManager(scratch({ 'pnpm-lock.yaml': '', 'package.json': '{}' })), 'pnpm');
    assert.equal(detectPackageManager(scratch({ 'yarn.lock': '', 'package.json': '{}' })), 'yarn');
    assert.equal(detectPackageManager(scratch({ 'package-lock.json': '', 'package.json': '{}' })), 'npm');
  });
  test('package.json alone -> npm', () => {
    assert.equal(detectPackageManager(scratch({ 'package.json': '{}' })), 'npm');
  });
  test('no manifest -> null', () => {
    assert.equal(detectPackageManager(scratch({ 'README.md': 'x' })), null);
  });
});

describe('pickDevScript', () => {
  test('prefers start:dev over start', () => {
    assert.equal(pickDevScript({ start: 'node .', 'start:dev': 'nest start --watch' }), 'start:dev');
  });
  test('falls back to dev, then start', () => {
    assert.equal(pickDevScript({ dev: 'vite', build: 'x' }), 'dev');
    assert.equal(pickDevScript({ start: 'node .' }), 'start');
  });
  test('no usable script -> null', () => {
    assert.equal(pickDevScript({ build: 'x', test: 'y' }), null);
    assert.equal(pickDevScript(undefined), null);
  });
});

describe('runCommand', () => {
  test('npm needs run; yarn/pnpm forward bare; bun uses run', () => {
    assert.equal(runCommand('npm', 'start:dev'), 'npm run start:dev');
    assert.equal(runCommand('yarn', 'dev'), 'yarn dev');
    assert.equal(runCommand('pnpm', 'dev'), 'pnpm dev');
    assert.equal(runCommand('bun', 'dev'), 'bun run dev');
  });
});

describe('parseComposeServicePorts + primaryHostPort', () => {
  const compose = `services:
  app:
    image: jelou/datum-service:latest
    ports:
      - "8787:8080"
      - "9797:9001"
    networks:
      - mynetwork
  db:
    ports:
      - "5432:5432"
`;
  test('reads only the target service ports', () => {
    assert.deepEqual(parseComposeServicePorts(compose, 'app'), [
      { host: 8787, container: 8080 },
      { host: 9797, container: 9001 },
    ]);
    assert.deepEqual(parseComposeServicePorts(compose, 'db'), [{ host: 5432, container: 5432 }]);
  });
  test('primaryHostPort skips the debugger mapping (container 9001)', () => {
    assert.equal(primaryHostPort(parseComposeServicePorts(compose, 'app')), 8787);
  });
});

describe('isIdleDevContainer', () => {
  test('detects sleep infinity', () => {
    assert.equal(isIdleDevContainer(scratch({ 'Dockerfile.dev': 'FROM node\nCMD sleep infinity' })), true);
  });
  test('detects tail -f /dev/null', () => {
    assert.equal(isIdleDevContainer(scratch({ 'Dockerfile': 'CMD ["tail","-f","/dev/null"]' })), true);
  });
  test('a real entrypoint is not idle', () => {
    assert.equal(isIdleDevContainer(scratch({ 'Dockerfile': 'CMD ["node","dist/main.js"]' })), false);
  });
});

describe('deriveDevBlock — idle dev container (the datum/api-gateway/auth pattern)', () => {
  const dir = scratch({
    'package-lock.json': '',
    'package.json': JSON.stringify({ scripts: { 'start:dev': 'nest start -b swc -w', build: 'nest build' } }),
    'Dockerfile.dev': 'FROM node:20\nWORKDIR /app\nCMD sleep infinity',
    'docker-compose.yml': `services:
  app:
    image: jelou/datum-service:latest
    ports:
      - "8787:8080"
      - "9797:9001"
`,
  });
  const { block, source, warnings } = deriveDevBlock(dir, { stack: 'nestjs' });

  test('uses launcher docker-exec', () => {
    assert.equal(block.launcher, 'docker-exec');
    assert.equal(source, 'derived:docker-exec');
  });
  test('detects npm + start:dev (NOT yarn) — the reported bug', () => {
    assert.equal(block.command, 'npm run start:dev');
  });
  test('targets the app compose service and its compose file', () => {
    assert.equal(block.docker.service, 'app');
    assert.equal(block.docker.compose_file, 'docker-compose.yml');
  });
  test('teardown pkills the in-container process, never docker compose down', () => {
    assert.match(block.teardown, /docker compose -f docker-compose\.yml exec -T app pkill -f 'nest start'/);
    assert.doesNotMatch(block.teardown, /down|rm\b/);
  });
  test('NestJS readiness is the startup log line (port_open/http_200 on / would false-pass)', () => {
    assert.deepEqual(block.ready_signal, { type: 'stdout_match', pattern: 'Nest application successfully started' });
  });
  test('stateless app container -> data_isolation none (no --allow-shared-data gate)', () => {
    assert.equal(block.data_isolation, 'none');
    assert.deepEqual(warnings, []);
  });
});

describe('deriveDevBlock — yarn idle container is detected as yarn, not hardcoded npm', () => {
  const dir = scratch({
    'yarn.lock': '',
    'package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
    'Dockerfile.dev': 'CMD sleep infinity',
    'docker-compose.yml': 'services:\n  app:\n    ports:\n      - "5173:5173"\n',
  });
  const { block } = deriveDevBlock(dir, { stack: 'react' });
  test('command honors the detected manager', () => {
    assert.equal(block.command, 'yarn dev');
  });
});

describe('deriveDevBlock — host dev server (no compose)', () => {
  const dir = scratch({
    'yarn.lock': '',
    'package.json': JSON.stringify({ scripts: { dev: 'vite apps/apps --force' } }),
  });
  const { block, source } = deriveDevBlock(dir, { stack: 'react' });
  test('host launcher with env_files for the dev server', () => {
    assert.equal(source, 'derived:host');
    assert.equal(block.command, 'yarn dev');
    assert.deepEqual(block.env_files, ['.env', '.env.e2e']);
    assert.deepEqual(block.ready_signal, { type: 'stdout_match', pattern: 'Local:.*http' });
  });
});

describe('deriveDevBlock — refuse cases (caller must not improvise)', () => {
  test('no package manager -> block null + reason', () => {
    const r = deriveDevBlock(scratch({ 'README.md': 'x' }));
    assert.equal(r.block, null);
    assert.match(r.reason, /package manager/);
  });
  test('no dev script -> block null + reason', () => {
    const r = deriveDevBlock(scratch({ 'package.json': JSON.stringify({ scripts: { build: 'x' } }) }));
    assert.equal(r.block, null);
    assert.match(r.reason, /dev script/);
  });
});

describe('deriveDevBlock — real datum compose format (4-space indent + trailing # comments)', () => {
  // The exact shape the fix targets: 4-space service indent, 8-space ports,
  // trailing `#Server` / `# Debug` comments, debugger mapping to skip.
  const dir = scratch({
    'package-lock.json': '',
    'package.json': JSON.stringify({ scripts: { 'start:dev': 'nest start -b swc -w' } }),
    'Dockerfile.dev': 'FROM node:20\nWORKDIR /app\nCMD sleep infinity',
    'docker-compose.yml': `version: "3.5"
services:
    app:
        container_name: datum-service
        # platform: linux/amd64 # commented out
        build:
            context: .
            dockerfile: ./Dockerfile.dev
        image: jelou/datum-service:latest
        ports:
            - "8787:8080" #Server
            - "9797:9001" #Debugger
        networks:
            - app-network
networks:
    app-network:
        external: true
`,
  });
  const { block, warnings } = deriveDevBlock(dir, { stack: 'nestjs' });
  test('parses the 4-space service + skips the debugger port + no spurious warning', () => {
    assert.equal(block.docker.service, 'app');
    assert.equal(block.command, 'npm run start:dev');
    assert.equal(primaryHostPort(parseComposeServicePorts(
      `services:\n    app:\n        ports:\n            - "8787:8080" #Server\n            - "9797:9001" #Debugger\n`, 'app')), 8787);
    assert.deepEqual(warnings, []);
  });
});

describe('parseComposeServicePorts — service header with a YAML anchor', () => {
  const compose = `services:
  app: &app-base
    image: x
    ports:
      - "8787:8080"
`;
  test('an anchored header (`app: &app-base`) is still detected', () => {
    assert.deepEqual(parseComposeServicePorts(compose, 'app'), [{ host: 8787, container: 8080 }]);
  });
  test('deriveDevBlock does not falsely refuse on an anchored app service', () => {
    const dir = scratch({
      'package-lock.json': '',
      'package.json': JSON.stringify({ scripts: { 'start:dev': 'nest start --watch' } }),
      'Dockerfile.dev': 'CMD sleep infinity',
      'docker-compose.yml': 'services:\n  app: &app-base\n    image: x\n    ports:\n      - "8998:8080"\n',
    });
    const { block } = deriveDevBlock(dir, { stack: 'nestjs' });
    assert.equal(block?.docker?.service, 'app');
  });
});

describe('deriveDevBlock — multi-service compose avoids picking the DB', () => {
  const dir = scratch({
    'package-lock.json': '',
    'package.json': JSON.stringify({ scripts: { 'start:dev': 'nest start --watch' } }),
    'Dockerfile.dev': 'CMD sleep infinity',
    'docker-compose.yml': 'services:\n  postgres:\n    ports:\n      - "5432:5432"\n  api:\n    ports:\n      - "8998:8080"\n',
  });
  const { block, warnings } = deriveDevBlock(dir, { stack: 'nestjs' });
  test('picks the app service (api), not the first-listed infra (postgres)', () => {
    assert.equal(block.docker.service, 'api');
    assert.match(warnings[0], /picked "api"/);
  });
});

describe('deriveDevBlock — bun teardown targets bun, not node', () => {
  const dir = scratch({
    'bun.lockb': '',
    'package.json': JSON.stringify({ scripts: { dev: 'bun run --watch index.ts' } }),
  });
  const { block } = deriveDevBlock(dir);
  test('host bun dev server pkills bun', () => {
    assert.equal(block.command, 'bun run dev');
    assert.match(block.teardown, /pkill -f 'bun'/);
  });
});

describe('devBlockToYaml', () => {
  test('renders a nested, persistable dev: block', () => {
    const { block } = deriveDevBlock(scratch({
      'package-lock.json': '',
      'package.json': JSON.stringify({ scripts: { 'start:dev': 'nest start --watch' } }),
      'Dockerfile.dev': 'CMD sleep infinity',
      'docker-compose.yml': 'services:\n  app:\n    ports:\n      - "8998:8080"\n',
    }), { stack: 'nestjs' });
    const yaml = devBlockToYaml(block);
    assert.match(yaml, /^dev:/);
    assert.match(yaml, /launcher: docker-exec/);
    assert.match(yaml, /command: npm run start:dev/);
    assert.match(yaml, /service: app/);
  });
});
