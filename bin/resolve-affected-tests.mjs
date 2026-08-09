#!/usr/bin/env node
import { existsSync, statSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, relative, dirname, sep } from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function die(msg, code = 1) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(code);
}

function quote(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
}

function readManifest(repo) {
  try {
    return JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function detectRunner(repo) {
  const manifest = readManifest(repo);
  if (manifest) {
    const testScript = manifest.scripts?.test ?? '';
    for (const candidate of ['vitest', 'jest', 'mocha']) {
      if (new RegExp(`\\b${candidate}\\b`).test(testScript)) return candidate;
    }
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const candidate of ['vitest', 'jest', 'mocha']) {
      if (declared[candidate]) return candidate;
    }
    if (manifest.jest) return 'jest';
  }
  for (const ext of ['js', 'ts', 'mjs', 'cjs', 'json']) {
    if (existsSync(join(repo, `vitest.config.${ext}`))) return 'vitest';
    if (existsSync(join(repo, `jest.config.${ext}`))) return 'jest';
  }
  if (existsSync(join(repo, 'go.mod'))) return 'go';
  for (const marker of ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini']) {
    if (existsSync(join(repo, marker))) return 'pytest';
  }
  return 'unknown';
}

function installedJestVersion(repo) {
  try {
    return JSON.parse(readFileSync(join(repo, 'node_modules', 'jest', 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

function jestMajor(repo) {
  const manifest = readManifest(repo);
  const declaredRange = { ...manifest?.dependencies, ...manifest?.devDependencies }.jest;
  const m = String(installedJestVersion(repo) ?? declaredRange ?? '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 29;
}

function declaredJestConfig(repo) {
  const script = readManifest(repo)?.scripts?.test ?? '';
  const m = script.match(/--config[= ]+['"]?([^\s'"]+)/);
  if (!m) return null;
  return existsSync(join(repo, m[1])) ? m[1] : null;
}

function showJestConfig(repo, configPath) {
  const extra = configPath === null ? [] : ['--config', configPath];
  const local = join(repo, 'node_modules', '.bin', 'jest');
  const invocation = existsSync(local)
    ? { cmd: local, args: ['--showConfig', '--maxWorkers=1', ...extra] }
    : { cmd: 'npx', args: ['--no-install', 'jest', '--showConfig', '--maxWorkers=1', ...extra] };
  const res = spawnSync(invocation.cmd, invocation.args, { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (res.error || res.status !== 0) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed.configs) && parsed.configs.length > 0 ? parsed.configs : null;
  } catch {
    return null;
  }
}

function isUnder(file, dir) {
  return file === dir || file.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

function coveringRoot(repo, absFile) {
  const rel = relative(repo, absFile);
  if (rel.startsWith('..')) return dirname(absFile);
  const first = rel.split(sep)[0];
  return first === rel ? repo : join(repo, first);
}

function uncoveredFiles(config, absChanged) {
  const roots = Array.isArray(config.roots) && config.roots.length > 0 ? config.roots : [config.rootDir];
  return absChanged.filter((file) => !roots.some((root) => isUnder(file, root)));
}

function mergedIgnorePatterns(config) {
  const merged = [...(config.testPathIgnorePatterns ?? [])];
  for (const required of ['/node_modules/', '/\\.worktrees/']) {
    if (!merged.includes(required)) merged.push(required);
  }
  return merged;
}

function testGlobPattern(absChanged) {
  const stems = [...new Set(absChanged.map((file) => file.split(sep).pop().replace(/\.[^.]+$/, '')))];
  return stems.map((stem) => stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}

function jestPlan(repo, changed, absChanged, workers) {
  const configPath = declaredJestConfig(repo);
  const configFlag = configPath === null ? '' : ` --config ${quote(configPath)}`;
  const configNote = configPath === null ? '' : `; using the ${configPath} that the repo's own test script selects`;
  const configs = showJestConfig(repo, configPath);
  if (configs === null) {
    return {
      strategy: 'full-suite',
      command: `npx jest${configFlag} --maxWorkers=${workers} --testPathIgnorePatterns '/node_modules/' '/\\.worktrees/'`,
      reason: 'jest --showConfig could not be resolved in this repo, so the affected-test haystack is unknown',
    };
  }

  const targets = changed.map(quote).join(' ');
  const uncoveredPerConfig = configs.map((config) => uncoveredFiles(config, absChanged));
  const allCovered = uncoveredPerConfig.every((files) => files.length === 0);

  if (allCovered) {
    return {
      strategy: 'find-related',
      command: `npx jest${configFlag} --findRelatedTests ${targets} --maxWorkers=${workers}`,
      reason: `every changed source lies inside the resolved jest roots, so --findRelatedTests can see them${configNote}`,
    };
  }

  if (configs.length > 1) {
    return {
      strategy: 'test-glob',
      command: `npx jest${configFlag} --${jestMajor(repo) >= 30 ? 'testPathPatterns' : 'testPathPattern'} ${quote(testGlobPattern(absChanged))} --maxWorkers=${workers}`,
      reason: `jest declares multiple projects with differing roots, so a single --roots widening cannot be expressed; narrowing by changed-file name instead${configNote}`,
    };
  }

  const config = configs[0];
  const widened = [...new Set([
    ...(Array.isArray(config.roots) && config.roots.length > 0 ? config.roots : [config.rootDir]),
    ...uncoveredPerConfig[0].map((file) => coveringRoot(repo, file)),
  ])];
  const rootFlags = widened.map((root) => `--roots ${quote(root)}`).join(' ');
  const ignoreFlag = `--testPathIgnorePatterns ${mergedIgnorePatterns(config).map(quote).join(' ')}`;
  return {
    strategy: 'find-related',
    command: `npx jest${configFlag} --findRelatedTests ${targets} ${rootFlags} ${ignoreFlag} --maxWorkers=${workers}`,
    reason: `jest roots exclude ${uncoveredPerConfig[0].length} changed source(s), which makes --findRelatedTests match 0 tests; widened roots and re-declared the config's ignore patterns${configNote}`,
  };
}

function vitestPlan(changed, workers) {
  return {
    strategy: 'find-related',
    command: `npx vitest related ${changed.map(quote).join(' ')} --run --pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=${workers}`,
    reason: 'vitest resolves related tests from its own module graph, which is not restricted by a roots setting',
  };
}

const FULL_SUITE_COMMANDS = {
  mocha: 'npx mocha',
  pytest: 'pytest',
  go: 'go test ./... -p 2',
  unknown: 'npm test',
};

const args = parseArgs(process.argv);
const repoInput = args.repo;
const changedInput = args.changed;

if (typeof repoInput !== 'string' || repoInput === '') die('--repo=<path> required', 2);
if (typeof changedInput !== 'string' || changedInput === '') {
  die('--changed=<comma-separated paths> required and must be non-empty', 2);
}
if (!existsSync(repoInput) || !statSync(repoInput).isDirectory()) {
  die(`repo not found or not a directory: ${repoInput}`, 2);
}

const changed = changedInput.split(',').map((path) => path.trim()).filter(Boolean);
if (changed.length === 0) die('--changed=<comma-separated paths> required and must be non-empty', 2);

const workers = args.workers === undefined ? '2' : String(args.workers);
if (!/^[12]$/.test(workers)) die(`--workers must be 1 or 2 (got: ${workers})`, 2);

const repo = resolve(repoInput);
const absChanged = changed.map((path) => resolve(repo, path));
const runner = typeof args.runner === 'string' && args.runner !== '' ? args.runner : detectRunner(repo);

let plan;
if (runner === 'jest') plan = jestPlan(repo, changed, absChanged, workers);
else if (runner === 'vitest') plan = vitestPlan(changed, workers);
else {
  plan = {
    strategy: 'full-suite',
    command: FULL_SUITE_COMMANDS[runner] ?? FULL_SUITE_COMMANDS.unknown,
    reason: `runner '${runner}' has no native affected-test resolver — execute-task Step 8b skips this service and advises /jlu-test-suite`,
  };
}

process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
