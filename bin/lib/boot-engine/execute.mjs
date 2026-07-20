import { unmaskWiredEnv } from './env-mask.mjs';

function taskIsolated(entry) {
  const logPath = `/tmp/${entry.projectName}.dev.log`;
  const files = [{ path: `${entry.cwd}/docker-compose.jlu.yml`, content: entry.overrideYaml }];
  if (entry.wiredEnv) files.push({ path: `${entry.cwd}/.env`, content: unmaskWiredEnv(entry.wiredEnv) });
  const exec = entry.launcher === 'docker-exec'
    ? ['exec', '-d', entry.projectName, 'sh', '-lc', `cd /app && ${entry.command} > ${logPath} 2>&1`]
    : null;
  return {
    policy: 'task-isolated',
    cwd: entry.cwd,
    files,
    up: ['compose', '-p', entry.projectName, '-f', entry.composeFile, '-f', 'docker-compose.jlu.yml', 'up', '-d'],
    exec,
    readiness: { ...entry.readiness, logPath },
    teardown: ['compose', '-p', entry.projectName, 'down'],
    imageResolved: entry.imageResolved
  };
}

function sharedReuse(entry) {
  const files = entry.wiredEnv ? [{ path: `${entry.cwd}/.env`, content: unmaskWiredEnv(entry.wiredEnv) }] : [];
  return {
    policy: 'shared-reuse',
    cwd: entry.cwd,
    launcher: entry.launcher,
    command: entry.command,
    files,
    readiness: { ...entry.readiness },
    teardown: entry.teardownCmd || null
  };
}

export function planEntryToCommands(entry) {
  if (entry.policy === 'task-isolated') return taskIsolated(entry);
  if (entry.policy === 'shared-reuse') return sharedReuse(entry);
  throw new Error(`planEntryToCommands: unknown policy '${entry.policy}' for service '${entry.id}'`);
}
