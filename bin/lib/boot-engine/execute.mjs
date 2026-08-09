import { unmaskWiredEnv } from './env-mask.mjs';
import { LIFECYCLE_STAGES } from '../dev-orchestrator/events.mjs';

function installDescriptor(entry) {
  const install = entry.depsProvision && entry.depsProvision.install;
  if (!install) return null;
  return {
    ...install,
    exec: install.runs_in === 'container'
      ? ['exec', entry.projectName, 'sh', '-lc', install.cmd]
      : null
  };
}

function environmentDescriptor(entry, readiness) {
  const overlay = entry.environmentOverlay;
  if (!overlay || (!overlay.path && !overlay.restartRequired)) {
    return { environmentFiles: [], restartRequired: false, readiness };
  }
  return {
    environmentFiles: overlay.path ? [overlay.path] : [],
    restartRequired: overlay.restartRequired,
    readiness: {
      ...readiness,
      overlayDigest: overlay.digest,
      priorReadinessValid: !overlay.restartRequired,
      requiresRestartBeforeReady: overlay.restartRequired,
    },
  };
}

function taskIsolated(entry) {
  const logPath = `/tmp/${entry.projectName}.dev.log`;
  const environment = environmentDescriptor(entry, { ...entry.readiness, logPath });
  const files = [{ path: `${entry.cwd}/docker-compose.jlu.yml`, content: entry.overrideYaml }];
  if (entry.wiredEnv) files.push({ path: `${entry.cwd}/.env`, content: unmaskWiredEnv(entry.wiredEnv) });
  const execEnvironment = environment.environmentFiles.flatMap((path) => ['--env-file', path]);
  const exec = entry.launcher === 'docker-exec'
    ? ['exec', ...execEnvironment, '-d', entry.projectName, 'sh', '-lc', `cd /app && ${entry.command} > ${logPath} 2>&1`]
    : null;
  return {
    policy: 'task-isolated',
    cwd: entry.cwd,
    files,
    up: ['compose', '-p', entry.projectName, '-f', entry.composeFile, '-f', 'docker-compose.jlu.yml', 'up', '-d'],
    install: installDescriptor(entry),
    exec,
    environmentFiles: environment.environmentFiles,
    restartRequired: environment.restartRequired,
    readiness: environment.readiness,
    teardown: ['compose', '-p', entry.projectName, 'down'],
    imageResolved: entry.imageResolved
  };
}

function sharedReuse(entry) {
  const files = entry.wiredEnv ? [{ path: `${entry.cwd}/.env`, content: unmaskWiredEnv(entry.wiredEnv) }] : [];
  const environment = environmentDescriptor(entry, { ...entry.readiness });
  return {
    policy: 'shared-reuse',
    cwd: entry.cwd,
    launcher: entry.launcher,
    command: entry.command,
    composeFile: entry.composeFile || null,
    dockerService: entry.dockerService || null,
    readyTimeoutS: entry.readyTimeoutS ?? null,
    files,
    environmentFiles: environment.environmentFiles,
    restartRequired: environment.restartRequired,
    readiness: environment.readiness,
    teardown: entry.teardownCmd || null
  };
}

export function planEntryToCommands(entry, { runIdentity } = {}) {
  let descriptor;
  if (entry.policy === 'task-isolated') descriptor = taskIsolated(entry);
  else if (entry.policy === 'shared-reuse') descriptor = sharedReuse(entry);
  else throw new Error(`planEntryToCommands: unknown policy '${entry.policy}' for service '${entry.id}'`);
  if (!runIdentity) return descriptor;
  return {
    ...descriptor,
    ownershipMarker: { ...runIdentity },
    lifecycleStages: [LIFECYCLE_STAGES.boot, LIFECYCLE_STAGES.cleanup],
  };
}
