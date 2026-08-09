import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCommand, defaultResolveScript } from '../../bin/guard-test-commands.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'resolve-affected-tests.mjs');

const FAKE_JEST = [
  '#!/bin/sh',
  'REPO="$(cd "$(dirname "$0")/../.." && pwd)"',
  'if [ -f "$REPO/.showconfig-fails" ]; then echo "config error" >&2; exit 1; fi',
  'cat "$REPO/.showconfig.json"',
  '',
].join('\n');

function makeRepo({ manifest = {}, showConfig = null, jestVersion = '29.7.0', showConfigFails = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'resolve-affected-tests-'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', ...manifest }));
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'test'), { recursive: true });
  if (showConfig || showConfigFails) {
    mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(repo, 'node_modules', 'jest'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', 'jest', 'package.json'), JSON.stringify({ name: 'jest', version: jestVersion }));
    writeFileSync(join(repo, 'node_modules', '.bin', 'jest'), FAKE_JEST);
    chmodSync(join(repo, 'node_modules', '.bin', 'jest'), 0o755);
  }
  if (showConfigFails) writeFileSync(join(repo, '.showconfig-fails'), '');
  else if (showConfig) writeFileSync(join(repo, '.showconfig.json'), JSON.stringify(showConfig(repo)));
  return repo;
}

function run(...args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function planFor(repo, changed, ...extra) {
  const res = run(`--repo=${repo}`, `--changed=${changed}`, ...extra);
  assert.equal(res.code, 0, res.stderr);
  return JSON.parse(res.stdout);
}

function assertGuardAllows(command, cwd) {
  const verdict = classifyCommand(command, { cwd, resolveScript: defaultResolveScript });
  assert.equal(verdict.decision, 'allow', verdict.reason);
}

const jestDeps = { devDependencies: { jest: '^29.7.0' } };

function config(repo, overrides = {}) {
  return {
    configs: [{
      rootDir: repo,
      roots: [join(repo, 'src'), join(repo, 'test')],
      testPathIgnorePatterns: ['/node_modules/'],
      ...overrides,
    }],
    globalConfig: {},
    version: '29.7.0',
  };
}

describe('resolve-affected-tests — jest with a haystack that already covers the diff', () => {
  const repo = makeRepo({ manifest: jestDeps, showConfig: (r) => config(r) });

  test('emits a plain --findRelatedTests invocation', () => {
    const plan = planFor(repo, 'src/calc.ts,src/util.ts');
    assert.equal(plan.strategy, 'find-related');
    assert.equal(plan.command, "npx jest --findRelatedTests 'src/calc.ts' 'src/util.ts' --maxWorkers=2");
    assert.match(plan.reason, /inside the resolved jest roots/);
  });

  test('honors the worker cap', () => {
    assert.match(planFor(repo, 'src/calc.ts', '--workers=1').command, /--maxWorkers=1$/);
  });

  test('the emitted command survives the resource guard', () => {
    assertGuardAllows(planFor(repo, 'src/calc.ts').command, repo);
  });
});

describe('resolve-affected-tests — jest roots that exclude the changed sources', () => {
  const repo = makeRepo({
    manifest: jestDeps,
    showConfig: (r) => config(r, { roots: [join(r, 'test')] }),
  });

  test('widens roots instead of matching zero tests', () => {
    const plan = planFor(repo, 'src/calc.ts');
    assert.equal(plan.strategy, 'find-related');
    assert.ok(plan.command.includes(`--roots '${join(repo, 'test')}'`));
    assert.ok(plan.command.includes(`--roots '${join(repo, 'src')}'`));
    assert.match(plan.reason, /roots exclude 1 changed source/);
  });

  test('re-declares the config ignore patterns plus the worktree exclusion', () => {
    const plan = planFor(repo, 'src/calc.ts');
    assert.ok(plan.command.includes("--testPathIgnorePatterns '/node_modules/' '/\\.worktrees/'"));
  });

  test('a changed file at the repo root widens to the repo root', () => {
    assert.ok(planFor(repo, 'index.ts').command.includes(`--roots '${repo}'`));
  });

  test('the widened command survives the resource guard', () => {
    assertGuardAllows(planFor(repo, 'src/calc.ts').command, repo);
  });
});

describe('resolve-affected-tests — jest projects with differing roots', () => {
  function multiProject(version) {
    return makeRepo({
      manifest: jestDeps,
      jestVersion: version,
      showConfig: (r) => ({
        configs: [
          { rootDir: r, roots: [join(r, 'src')], testPathIgnorePatterns: [] },
          { rootDir: r, roots: [join(r, 'test')], testPathIgnorePatterns: [] },
        ],
        globalConfig: {},
        version,
      }),
    });
  }

  test('falls back to a name-derived path pattern on jest 29', () => {
    const repo = multiProject('29.7.0');
    const plan = planFor(repo, 'src/calc.ts,src/util.ts');
    assert.equal(plan.strategy, 'test-glob');
    assert.equal(plan.command, "npx jest --testPathPattern 'calc|util' --maxWorkers=2");
    assert.match(plan.reason, /multiple projects/);
  });

  test('uses the renamed flag on jest 30', () => {
    const repo = multiProject('30.0.2');
    assert.match(planFor(repo, 'src/calc.ts').command, /--testPathPatterns 'calc'/);
  });

  test('the pattern command survives the resource guard', () => {
    const repo = multiProject('29.7.0');
    assertGuardAllows(planFor(repo, 'src/calc.ts').command, repo);
  });
});

describe('resolve-affected-tests — jest config selected by the repo test script', () => {
  function repoWithDeclaredConfig() {
    const repo = makeRepo({
      manifest: { ...jestDeps, scripts: { test: 'dotenv -e .env.test -- jest --config test/jest.config.ts' } },
      showConfig: (r) => config(r),
    });
    writeFileSync(join(repo, 'test', 'jest.config.ts'), 'export default {};\n');
    return repo;
  }

  test('propagates --config so the probe and the run read the same config', () => {
    const plan = planFor(repoWithDeclaredConfig(), 'src/calc.ts');
    assert.match(plan.command, /^npx jest --config 'test\/jest\.config\.ts' --findRelatedTests/);
    assert.match(plan.reason, /the repo's own test script selects/);
  });

  test('ignores a --config that points at a missing file', () => {
    const repo = makeRepo({
      manifest: { ...jestDeps, scripts: { test: 'jest --config test/absent.config.ts' } },
      showConfig: (r) => config(r),
    });
    assert.doesNotMatch(planFor(repo, 'src/calc.ts').command, /--config/);
  });
});

describe('resolve-affected-tests — jest whose config cannot be resolved', () => {
  test('falls back to a capped, worktree-safe full suite', () => {
    const repo = makeRepo({ manifest: jestDeps, showConfigFails: true });
    const plan = planFor(repo, 'src/calc.ts');
    assert.equal(plan.strategy, 'full-suite');
    assert.match(plan.reason, /--showConfig could not be resolved/);
    assertGuardAllows(plan.command, repo);
  });
});

describe('resolve-affected-tests — non-jest runners', () => {
  test('vitest uses its own related mode with a capped thread pool', () => {
    const repo = makeRepo({ manifest: { devDependencies: { vitest: '^1.0.0' } } });
    const plan = planFor(repo, 'src/calc.ts');
    assert.equal(plan.strategy, 'find-related');
    assert.match(plan.command, /^npx vitest related 'src\/calc\.ts' --run --pool=threads/);
    assert.match(plan.command, /maxThreads=2$/);
    assertGuardAllows(plan.command, repo);
  });

  test('mocha has no resolver and reports the Step 8b skip', () => {
    const repo = makeRepo({ manifest: { devDependencies: { mocha: '^10.0.0' } } });
    const plan = planFor(repo, 'src/calc.ts');
    assert.equal(plan.strategy, 'full-suite');
    assert.equal(plan.command, 'npx mocha');
    assert.match(plan.reason, /Step 8b skips this service/);
  });

  test('an unrecognized repo reports the unknown runner', () => {
    const repo = makeRepo();
    const plan = planFor(repo, 'src/calc.ts');
    assert.equal(plan.strategy, 'full-suite');
    assert.match(plan.reason, /runner 'unknown'/);
  });

  test('an explicit --runner overrides detection', () => {
    const repo = makeRepo({ manifest: jestDeps, showConfig: (r) => config(r) });
    assert.equal(planFor(repo, 'src/calc.ts', '--runner=mocha').command, 'npx mocha');
  });

  test('the test script wins over a declared dependency', () => {
    const repo = makeRepo({
      manifest: { scripts: { test: 'vitest run' }, devDependencies: { jest: '^29.0.0', vitest: '^1.0.0' } },
    });
    assert.match(planFor(repo, 'src/calc.ts').command, /^npx vitest related/);
  });
});

describe('resolve-affected-tests — argument validation', () => {
  test('missing --repo exits 2', () => {
    const res = run('--changed=src/a.ts');
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--repo/);
  });

  test('missing --changed exits 2', () => {
    const repo = makeRepo();
    const res = run(`--repo=${repo}`);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--changed/);
  });

  test('a comma-only --changed exits 2', () => {
    const repo = makeRepo();
    const res = run(`--repo=${repo}`, '--changed=, ,');
    assert.equal(res.code, 2);
  });

  test('a --repo that is not a directory exits 2', () => {
    const res = run('--repo=/nonexistent/jlu/repo', '--changed=src/a.ts');
    assert.equal(res.code, 2);
    assert.match(res.stderr, /not found or not a directory/);
  });

  test('an out-of-range worker cap exits 2', () => {
    const repo = makeRepo();
    const res = run(`--repo=${repo}`, '--changed=src/a.ts', '--workers=8');
    assert.equal(res.code, 2);
    assert.match(res.stderr, /--workers must be 1 or 2/);
  });
});
