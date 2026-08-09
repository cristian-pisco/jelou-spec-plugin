import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { proveLocalDatabaseTarget } from './local-target.mjs';
import { createRegisteredStackDriver } from './local-stack-driver.mjs';

const REQUIRED_IDS = ['dashboardServiceId', 'apiServiceId', 'uiServiceId'];

function rejectConfig(message) {
  const error = new Error(message);
  error.code = 'E2E_PREFLIGHT_FAILED';
  error.failures = [{ name: 'configuration', reason: message }];
  throw error;
}

function requireConfig(config) {
  if (!Array.isArray(config?.services) || config.services.length === 0) rejectConfig('config.services must be a non-empty array');
  for (const service of config.services) {
    if (!service || typeof service.id !== 'string' || typeof service.path !== 'string') rejectConfig('every config.services entry requires id and path');
    if (!existsSync(service.path)) rejectConfig('config.services entry path must identify an existing repository');
  }
  if (typeof config.registryPath !== 'string' || !existsSync(config.registryPath)) rejectConfig('config.registryPath must identify an existing registry');
  let registry;
  try {
    registry = JSON.parse(readFileSync(config.registryPath, 'utf8'));
  } catch {
    rejectConfig('config.registryPath must contain valid JSON');
  }
  if (!Array.isArray(registry.services)) rejectConfig('config registry must contain services');
  if (!config.localDatabase?.target || !config.localDatabase?.topology) rejectConfig('config.localDatabase target and topology are required');
  try {
    proveLocalDatabaseTarget(config.localDatabase.target, config.localDatabase.topology);
  } catch (error) {
    rejectConfig(error.message);
  }
  if (typeof config.browserExecutable !== 'string' || config.browserExecutable.length === 0) rejectConfig('config.browserExecutable is required');
  if (!existsSync(config.browserExecutable)) rejectConfig('config.browserExecutable must identify an existing browser');
  for (const field of REQUIRED_IDS) {
    const id = config[field];
    if (typeof id !== 'string' || !config.services.some((service) => service.id === id)) rejectConfig(`config.${field} must name a registered service`);
  }
  if (typeof config.pluginRoot !== 'string' || typeof config.projectRoot !== 'string') rejectConfig('config.pluginRoot and config.projectRoot are required');
  if (!existsSync(config.pluginRoot)) rejectConfig('config.pluginRoot must identify an existing path');
  if (!existsSync(config.projectRoot)) rejectConfig('config.projectRoot must identify an existing path');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function commandProof(command, args, options) {
  const result = run(command, args, options);
  return result.status === 0 ? { ok: true } : { ok: false, reason: String(result.stderr || result.stdout || `${command} exited ${result.status}`).trim() };
}

function serviceProof(config, field) {
  const service = config.services.find((candidate) => candidate.id === config[field]);
  return existsSync(service.path) ? { ok: true } : { ok: false, reason: `repository not found at ${service.path}` };
}

function tasksText(identity, services) {
  const rows = services.filter((service) => service.affected).map((service) => (
    `  - id: ${service.id}\n    sub_state: implementing\n    branch: production/${identity.marker.taskSlug}`
  )).join('\n');
  return `---\naffected_services:\n${rows}\n---\n\n# TASKS: Deterministic local stack E2E\n\n## Status: implementing\n\n| Field | Value |\n|---|---|\n| Slug | ${identity.marker.taskSlug} |\n| Created | 01-01-2099 |\n| Status | implementing |\n| Execution Mode | worktree |\n\n- Mode: worktree\n`;
}

function cloneRepositories(config, fixtureRoot, identity, registerResource) {
  const services = [];
  const worktrees = [];
  for (const service of config.services) {
    const path = join(fixtureRoot, 'repositories', service.id);
    mkdirSync(dirname(path), { recursive: true });
    const cloned = run('git', ['clone', '--shared', '--no-hardlinks', service.path, path]);
    if (cloned.status !== 0) throw new Error(`clone ${service.id} failed`);
    services.push({ ...service, path });
    if (!service.affected) continue;
    const worktree = join(path, '.worktrees', identity.marker.taskSlug);
    mkdirSync(dirname(worktree), { recursive: true });
    const created = run('git', ['worktree', 'add', '-b', `production/${identity.marker.taskSlug}`, worktree, service.commit || 'HEAD'], { cwd: path });
    if (created.status !== 0) throw new Error(`create ${service.id} worktree failed`);
    worktrees.push(worktree);
    registerResource({ kind: 'worktree', id: worktree, path: worktree, owner: identity.marker });
  }
  return { services, worktrees };
}

function writeFixture(config, fixtureRoot, identity, cloned) {
  const projectRoot = join(fixtureRoot, 'project');
  const workspaceRoot = join(fixtureRoot, 'spec-workspace');
  const taskRoot = join(workspaceRoot, 'specs', '01-01-2099', identity.marker.taskSlug);
  const registry = JSON.parse(readFileSync(config.registryPath, 'utf8'));
  const paths = new Map(cloned.services.map((service) => [service.id, service.path]));
  registry.services = registry.services.map((service) => ({ ...service, path: paths.get(service.id) }));
  if (registry.frontend) registry.frontend.path = paths.get(registry.frontend.id || 'jelou-apps');
  mkdirSync(join(projectRoot, 'registry'), { recursive: true });
  mkdirSync(taskRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'registry', 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(join(projectRoot, '.spec-workspace.json'), `${JSON.stringify({ workspace: workspaceRoot })}\n`);
  writeFileSync(join(taskRoot, 'TASKS.md'), tasksText(identity, cloned.services));
  writeFileSync(join(taskRoot, 'SPEC.md'), '# Deterministic local stack E2E\n');
  return { projectRoot, workspaceRoot, taskRoot };
}

export async function createAdapter(config) {
  requireConfig(config);
  const driver = createRegisteredStackDriver(config);
  return {
    async inspectPreflight(options) {
      let stackBoundary;
      try {
        await driver.inspectPreflight();
        stackBoundary = { ok: Boolean(options?.passwordCanary), reason: options?.passwordCanary ? undefined : 'password canary is required' };
      } catch (error) {
        stackBoundary = { ok: false, reason: error.message };
      }
      return {
        docker: commandProof('docker', ['info']),
        repositories: config.services.every((service) => commandProof('git', ['-C', service.path, 'rev-parse', '--is-inside-work-tree']).ok) ? { ok: true } : { ok: false, reason: 'registered repositories are unavailable' },
        keyring: commandProof('secret-tool', ['--version']),
        localDatabase: { ok: true },
        browser: existsSync(config.browserExecutable) ? { ok: true } : { ok: false, reason: `browser not found at ${config.browserExecutable}` },
        provisioningAdapter: stackBoundary,
        dashboard: serviceProof(config, 'dashboardServiceId'),
        api: serviceProof(config, 'apiServiceId'),
        ui: serviceProof(config, 'uiServiceId'),
      };
    },
    async createFixture({ identity, registerResource }) {
      const root = mkdtempSync(join(config.tempRoot || tmpdir(), 'jlu-local-stack-e2e-'));
      registerResource({ kind: 'workspace', id: root, path: root, owner: identity.marker });
      const cloned = cloneRepositories(config, root, identity, registerResource);
      const fixture = writeFixture(config, root, identity, cloned);
      const runtimeRoot = join(root, 'runtime');
      mkdirSync(runtimeRoot, { recursive: true });
      registerResource({ kind: 'runtimeFile', id: runtimeRoot, path: runtimeRoot, owner: identity.marker });
      return { root, runtimeRoot, ...fixture, worktrees: cloned.worktrees, resources: [] };
    },
    async runMode(input) {
      const planResult = run(process.execPath, [
        join(config.pluginRoot, 'bin', 'build-boot-plan.mjs'),
        '--workspace', input.fixture.projectRoot,
        '--slug', input.identity.marker.taskSlug,
        '--source-mode', input.sourceMode,
      ], { env: { ...process.env, JLU_HOME: input.fixture.runtimeRoot } });
      if (planResult.status !== 0) throw new Error(`build ${input.sourceMode} plan failed: ${planResult.stderr.trim()}`);
      return driver.runMode({ ...input, plan: JSON.parse(planResult.stdout) });
    },
    provisionAndVerify: (input) => driver.provisionAndVerify(input),
    collectEvidence: (input) => driver.collectEvidence(input),
    inspectCleanup: (input) => driver.inspectCleanup(input),
    async cleanupResource(resource) {
      if (['worktree', 'runtimeFile', 'workspace', 'overlay'].includes(resource.kind)) {
        rmSync(resource.path, { recursive: true, force: true });
        return;
      }
      return driver.cleanupResource(resource);
    },
  };
}
