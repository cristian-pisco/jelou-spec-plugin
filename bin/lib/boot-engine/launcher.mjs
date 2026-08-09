const CONTAINER_LAUNCHERS = new Set(['docker', 'docker-exec']);

export function isContainerLauncher(launcher) {
  return CONTAINER_LAUNCHERS.has(launcher);
}

export function startsDevOnUp(launcher) {
  return launcher === 'docker';
}

export function taskLogSource({ launcher, projectName, logPath }) {
  return startsDevOnUp(launcher)
    ? { mode: 'docker-logs', container: projectName }
    : { mode: 'exec-file', container: projectName, path: logPath };
}
