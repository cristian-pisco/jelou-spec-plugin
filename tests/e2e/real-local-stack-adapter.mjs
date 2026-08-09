import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const REQUIRED_DRIVER_METHODS = [
  'runMode',
  'provisionAndVerify',
  'collectEvidence',
  'cleanupResource',
  'inspectCleanup',
];

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function commandProof(command, args, options) {
  const result = run(command, args, options);
  return result.status === 0
    ? { ok: true }
    : { ok: false, reason: String(result.stderr || result.stdout || `${command} exited ${result.status}`).trim() };
}

function fileProof(path, label) {
  return existsSync(path) ? { ok: true } : { ok: false, reason: `${label} not found at ${path}` };
}

function localDatabaseProof(database) {
  if (!database) return { ok: false, reason: 'localDatabase configuration is missing' };
  if (['localhost', '127.0.0.1', '::1'].includes(database.host)) return { ok: true, proof: 'loopback' };
  if (database.registeredLocalDocker === true && database.composeProject && database.service) {
    return { ok: true, proof: 'registered-local-docker' };
  }
  return { ok: false, reason: `database host ${database.host || '<missing>'} is not proven local` };
}

function serviceProof(services, id, label) {
  const service = services.find((candidate) => candidate.id === id);
  if (!service) return { ok: false, reason: `${label} service ${id || '<missing>'} is not registered` };
  if (!existsSync(service.path)) return { ok: false, reason: `${label} repository not found at ${service.path}` };
  return { ok: true };
}

function assertRun(result, action) {
  if (result.status !== 0) throw new Error(`${action} failed: ${String(result.stderr || result.stdout).trim()}`);
  return result;
}

function tasksText(identity, services) {
  const affected = services.filter(({ affected }) => affected);
  const rows = affected.map(({ id }) => `  - id: ${id}\n    sub_state: implementing\n    branch: production/${identity.marker.taskSlug}`).join('\n');
  return `---\naffected_services:\n${rows}\n---\n\n# TASKS: Deterministic local stack E2E\n\n## Status: implementing\n\n## Metadata\n\n| Field | Value |\n|---|---|\n| Slug | ${identity.marker.taskSlug} |\n| Created | 01-01-2099 |\n| Status | implementing |\n| Execution Mode | worktree |\n\n## Branching\n\n- Mode: worktree\n`;
}

function cloneRepositories(config, fixtureRoot, identity, registerResource) {
  const repositories = [];
  const worktrees = [];
  const services = [];
  for (const service of config.services) {
    const repository = join(fixtureRoot, 'repositories', service.id);
    mkdirSync(dirname(repository), { recursive: true });
    assertRun(run('git', ['clone', '--shared', '--no-hardlinks', service.path, repository]), `clone ${service.id}`);
    services.push({ ...service, sourcePath: service.path, path: repository });
    repositories.push(repository);
    if (!service.affected) continue;
    const worktree = join(repository, '.worktrees', identity.marker.taskSlug);
    mkdirSync(dirname(worktree), { recursive: true });
    assertRun(run('git', [
      'worktree',
      'add',
      '-b',
      `production/${identity.marker.taskSlug}`,
      worktree,
      service.commit || 'HEAD',
    ], { cwd: repository }), `create ${service.id} worktree`);
    worktrees.push(worktree);
    registerResource({ kind: 'worktree', id: worktree, path: worktree, owner: identity.marker });
  }
  return { services, repositories, worktrees };
}

function writeFixtureWorkspace(config, fixtureRoot, identity, cloned) {
  const workspaceRoot = join(fixtureRoot, 'workspace');
  const taskRoot = join(workspaceRoot, 'specs', '01-01-2099', identity.marker.taskSlug);
  const registry = JSON.parse(readFileSync(config.registryPath, 'utf8'));
  const pathById = new Map(cloned.services.map(({ id, path }) => [id, path]));
  registry.services = registry.services.map((service) => ({ ...service, path: pathById.get(service.id) }));
  mkdirSync(join(workspaceRoot, 'registry'), { recursive: true });
  mkdirSync(taskRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, 'registry', 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(join(taskRoot, 'TASKS.md'), tasksText(identity, cloned.services));
  writeFileSync(join(taskRoot, 'SPEC.md'), '# Deterministic local stack E2E\n');
  return { workspaceRoot, taskRoot };
}

async function loadDriver(config) {
  const module = await import(pathToFileURL(resolve(config.stackDriverPath)).href);
  if (typeof module.createStackDriver !== 'function') throw new Error('stack driver must export createStackDriver(config)');
  return module.createStackDriver(config);
}

async function driverProof(load) {
  try {
    const stackDriver = await load();
    const missing = REQUIRED_DRIVER_METHODS.filter((name) => typeof stackDriver?.[name] !== 'function');
    return missing.length === 0
      ? { ok: true }
      : { ok: false, reason: `stack driver lacks required live evidence methods: ${missing.join(', ')}` };
  } catch (error) {
    return { ok: false, reason: `stack driver could not load: ${error.message}` };
  }
}

export async function createAdapter(config) {
  let driverPromise;
  const driver = () => {
    driverPromise ||= loadDriver(config);
    return driverPromise;
  };
  return {
    async inspectPreflight(options) {
      const services = config.services || [];
      const repositories = services.length > 0 && services.every(({ path }) => commandProof('git', ['-C', path, 'rev-parse', '--is-inside-work-tree']).ok)
        ? { ok: true }
        : { ok: false, reason: 'every registered repository must be an available Git checkout' };
      const adapterFilesExist = existsSync(config.provisioningAdapterPath || '') && existsSync(config.stackDriverPath || '');
      let provisioningAdapter = adapterFilesExist
        ? await driverProof(driver)
        : { ok: false, reason: 'provisioning adapter and stack driver must both exist' };
      if (provisioningAdapter.ok && !options?.passwordCanary) {
        provisioningAdapter = { ok: false, reason: 'JLU_LOCAL_STACK_E2E_PASSWORD_CANARY is required for live redaction evidence' };
      }
      return {
        docker: commandProof('docker', ['info']),
        repositories,
        keyring: commandProof('secret-tool', ['--version']),
        localDatabase: localDatabaseProof(config.localDatabase),
        browser: fileProof(config.browserExecutable || '', 'browser executable'),
        provisioningAdapter,
        dashboard: serviceProof(services, config.dashboardServiceId, 'dashboard'),
        api: serviceProof(services, config.apiServiceId, 'API'),
        ui: serviceProof(services, config.uiServiceId, 'UI'),
      };
    },
    async createFixture({ identity, registerResource }) {
      const fixtureRoot = mkdtempSync(join(config.tempRoot || tmpdir(), 'jlu-local-stack-e2e-'));
      registerResource({ kind: 'workspace', id: fixtureRoot, path: fixtureRoot, owner: identity.marker });
      const cloned = cloneRepositories(config, fixtureRoot, identity, registerResource);
      const written = writeFixtureWorkspace(config, fixtureRoot, identity, cloned);
      const runtimeRoot = join(fixtureRoot, 'runtime');
      mkdirSync(runtimeRoot, { recursive: true });
      registerResource({ kind: 'runtimeFile', id: runtimeRoot, path: runtimeRoot, owner: identity.marker });
      return {
        root: fixtureRoot,
        runtimeRoot,
        ...written,
        repositories: cloned.repositories,
        worktrees: cloned.worktrees,
        resources: [],
      };
    },
    async runMode({ sourceMode, attempt, fixture, identity, registerResource }) {
      const runner = join(config.pluginRoot, 'bin', 'build-boot-plan.mjs');
      const planResult = assertRun(run(process.execPath, [
        runner,
        '--workspace', fixture.workspaceRoot,
        '--slug', identity.marker.taskSlug,
        '--source-mode', sourceMode,
      ], { env: { ...process.env, JLU_HOME: fixture.runtimeRoot } }), `build ${sourceMode} plan`);
      const plan = JSON.parse(planResult.stdout);
      return (await driver()).runMode({ sourceMode, attempt, fixture, identity, plan, registerResource });
    },
    async provisionAndVerify(input) {
      return (await driver()).provisionAndVerify(input);
    },
    async collectEvidence(input) {
      return (await driver()).collectEvidence(input);
    },
    async inspectCleanup(input) {
      return (await driver()).inspectCleanup(input);
    },
    async cleanupResource(resource) {
      if (['worktree', 'runtimeFile', 'workspace', 'overlay'].includes(resource.kind)) {
        rmSync(resource.path, { recursive: true, force: true });
        return;
      }
      return (await driver()).cleanupResource(resource);
    },
  };
}
