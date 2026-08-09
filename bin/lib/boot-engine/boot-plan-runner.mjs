import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { planEntryToCommands } from './execute.mjs';
import { isContainerLauncher } from './launcher.mjs';
import { bootSharedReuse, errorHints, pollReadinessSignal, resolveDeps, DEFAULT_READY_TIMEOUT_S } from './execute-shared-reuse.mjs';
import { LIFECYCLE_STAGES } from '../dev-orchestrator/events.mjs';

const GREEN = new Set(['green', 'green-degraded', 'green-preexisting']);

function defaultWriteFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function readLogsFor(logSource, deps, cwd) {
  if (!logSource) return async () => '';
  if (logSource.mode === 'docker-logs') {
    return async () => (await deps.runner('docker', ['logs', '--tail', '200', logSource.container], { cwd })).stdout || '';
  }
  return async () => (await deps.runner('docker', ['exec', logSource.container, 'sh', '-lc', `cat ${logSource.path} 2>/dev/null || true`], { cwd })).stdout || '';
}

function failure(cause, hints = []) {
  return { status: 'failed', cause, readiness_ms: 0, error_hints: hints };
}

async function runInstall(descriptor, deps) {
  const install = descriptor.install;
  if (!install) return null;
  const result = install.exec
    ? await deps.runner('docker', install.exec, { cwd: descriptor.cwd, timeout: install.timeoutMs })
    : await deps.runner('sh', ['-c', install.cmd], { cwd: install.cwd || descriptor.cwd, timeout: install.timeoutMs });
  if (result.code !== 0) return failure(`deps_install_failed: ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`);
  return null;
}

export async function runMigrations(descriptor, deps) {
  const migrate = descriptor.migrate;
  if (!migrate) return { ran: false, ok: true, cause: null };
  const result = migrate.exec
    ? await deps.runner('docker', migrate.exec, { cwd: descriptor.cwd, timeout: migrate.timeoutMs })
    : await deps.runner('sh', ['-c', migrate.command], { cwd: migrate.cwd || descriptor.cwd, timeout: migrate.timeoutMs });
  if (result.code === 0) return { ran: true, ok: true, cause: null };
  return { ran: true, ok: false, cause: `migrate_failed: ${(result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 400)}` };
}

export async function bootTaskIsolated(entry, descriptor, deps) {
  for (const file of descriptor.files || []) deps.writeFile(file.path, file.content);

  const up = await deps.runner('docker', descriptor.up, { cwd: descriptor.cwd });
  if (up.code !== 0) return failure(`up_failed: ${(up.stderr || up.stdout || '').trim().slice(0, 400)}`);

  const installFailure = await runInstall(descriptor, deps);
  if (installFailure) return installFailure;

  const migration = await runMigrations(descriptor, deps);
  if (!migration.ok && descriptor.migrate.blocking) return failure(migration.cause);

  if (descriptor.exec) {
    const exec = await deps.runner('docker', descriptor.exec, { cwd: descriptor.cwd });
    if (exec.code !== 0) return failure(`exec_failed: ${(exec.stderr || exec.stdout || '').trim().slice(0, 400)}`);
  } else if (descriptor.restart) {
    const restart = await deps.runner('docker', descriptor.restart, { cwd: descriptor.cwd });
    if (restart.code !== 0) return failure(`restart_failed: ${(restart.stderr || restart.stdout || '').trim().slice(0, 400)}`);
  }

  const readLogs = readLogsFor(descriptor.readiness.logSource, deps, descriptor.cwd);
  const startedAt = deps.now();
  const readiness = await pollReadinessSignal({ readiness: descriptor.readiness, readyTimeoutS: entry.readyTimeoutS ?? DEFAULT_READY_TIMEOUT_S }, deps, readLogs);
  const readinessMs = deps.now() - startedAt;
  const migrationWarning = migration.ran && !migration.ok ? [migration.cause] : [];
  if (readiness.ok) return { status: 'green', cause: null, readiness_ms: readinessMs, error_hints: migrationWarning };
  return { status: 'failed', cause: readiness.cause, readiness_ms: readinessMs, error_hints: [...migrationWarning, ...errorHints(await readLogs())] };
}

async function bootEntry(entry, runIdentity, deps) {
  const descriptor = planEntryToCommands(entry, { runIdentity });
  if (descriptor.policy === 'task-isolated') {
    const result = await bootTaskIsolated(entry, descriptor, deps);
    return {
      ...result,
      teardown: { kind: 'container', resource: { projectName: entry.projectName, cwd: entry.cwd, composeFile: entry.composeFile, overrideFile: 'docker-compose.jlu.yml' } },
      started: { containers: [entry.projectName], processes: [] },
    };
  }
  for (const file of descriptor.files || []) deps.writeFile(file.path, file.content);
  const migration = await runMigrations(descriptor, deps);
  if (!migration.ok && descriptor.migrate.blocking) {
    return { ...failure(migration.cause), teardown: null, started: { containers: [], processes: [] } };
  }
  const result = await bootSharedReuse({
    ...entry,
    environmentFiles: descriptor.environmentFiles,
    restartRequired: descriptor.restartRequired,
    readiness: descriptor.readiness,
  }, deps.sharedReuseOptions);
  return {
    status: result.status,
    cause: result.cause,
    readiness_ms: result.readiness_ms,
    error_hints: migration.ran && !migration.ok ? [migration.cause, ...result.error_hints] : result.error_hints,
    teardown: null,
    started: result.started,
  };
}

export function bootableEntries(plan) {
  const skipped = [];
  const bootable = [];
  for (const entry of plan.services || []) {
    if (!isContainerLauncher(entry.launcher)) {
      skipped.push({ id: entry.id, reason: `host launcher '${entry.launcher}' — booted by the frontend/host steps, never by the docker loop` });
      continue;
    }
    if (entry.policy === 'task-isolated' && !entry.projectName) {
      skipped.push({ id: entry.id, reason: 'task-isolated entry carries no projectName — it never compiled a compose override' });
      continue;
    }
    bootable.push(entry);
  }
  return { bootable, skipped };
}

export async function runBootPlan({ plan, runIdentity }, options = {}) {
  const shared = resolveDeps(options);
  const deps = {
    ...shared,
    writeFile: options.writeFile || defaultWriteFile,
    sharedReuseOptions: { ...options, onLifecycle: options.onLifecycle },
  };
  const onLifecycle = options.onLifecycle || (() => {});
  const { bootable, skipped } = bootableEntries(plan);

  const services = [];
  for (const entry of bootable) {
    onLifecycle({ stage: LIFECYCLE_STAGES.boot, outcome: 'started', service: entry.id });
    let outcome;
    try {
      outcome = await bootEntry(entry, runIdentity, deps);
    } catch (error) {
      outcome = { ...failure(`boot_threw: ${error && error.message || error}`), teardown: null, started: { containers: [], processes: [] } };
    }
    services.push({
      id: entry.id,
      policy: entry.policy,
      host: entry.ports ? entry.ports.find((port) => port.primary)?.host ?? null : null,
      ...outcome,
    });
  }

  return {
    services,
    skipped,
    green: services.filter((s) => GREEN.has(s.status)).map((s) => s.id),
    degraded: services.filter((s) => s.status === 'green-degraded').map((s) => s.id),
    down: services.filter((s) => !GREEN.has(s.status)).map((s) => s.id),
    mutations: services.filter((s) => s.teardown).map((s) => s.teardown),
  };
}
